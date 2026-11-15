// Everything the renderer draws besides the map and the DOM: the three.js scene, the bodies
// bots wear, pooled tracers, wall chips, blood puffs and grenades. Every pool is fixed size
// and recycled — the render loop allocates nothing once the match has loaded.
import * as THREE from 'three';
import { PAL } from './palette.js';

const TRACERS = 40;
const IMPACTS = 48;
const PUFFS = 30;

export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(0x39424f, 70, 190);

  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 200);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera, resize: null };
}

/** A character's body: a torso slab, a head, a small gun box. Team colour on the torso. */
const bodyGeometry = {
  torso: new THREE.BoxGeometry(0.56, 0.98, 0.34),
  head: new THREE.SphereGeometry(0.165, 14, 10),
  gun: new THREE.BoxGeometry(0.07, 0.07, 0.44),
};
const teamMaterials = new Map();

function teamMaterial(team) {
  let material = teamMaterials.get(team);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PAL[team]), roughness: 0.65, metalness: 0.05 });
    teamMaterials.set(team, material);
  }
  return material;
}
const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd9cfc0), roughness: 0.55 });
const gunMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x23262b), roughness: 0.5, metalness: 0.3 });

export function attachBody(scene, character) {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(bodyGeometry.torso, teamMaterial(character.team));
  torso.position.y = 0.86;
  const head = new THREE.Mesh(bodyGeometry.head, headMaterial);
  head.position.y = 1.55;
  const gun = new THREE.Mesh(bodyGeometry.gun, gunMaterial);
  gun.position.set(0.18, 1.06, -0.3);
  group.add(torso, head, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  character.body = { group, torso, head };
  return group;
}

/** Bodies follow the sim: position, yaw, crouch height, death fall. */
export function syncBodies(state) {
  for (const character of state.characters) {
    if (character.isPlayer || !character.body) continue;
    const body = character.body;
    if (!character.alive) {
      if (body.group.visible) {
        body.group.visible = false;
      }
      continue;
    }
    body.group.visible = true;
    body.group.position.set(character.pos.x, character.pos.y, character.pos.z);
    body.group.rotation.y = character.yaw;
    const scale = character.height / 1.72;
    body.group.scale.set(1, scale, 1);
    // A dead-drop lean for the round's casualties is not needed: the dead are hidden.
    body.torso.rotation.x = character.crouching ? 0.25 : 0;
  }
}

/** One smoke puff or blood sprite; sprite pool entries share a material colour per use. */
function makeSpritePool(scene, count, color, size) {
  const material = new THREE.SpriteMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0, depthWrite: false });
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.scale.set(size, size, 1);
    sprite.visible = false;
    scene.add(sprite);
    items.push({ sprite, life: 0, max: 1, velocity: new THREE.Vector3() });
  }
  return items;
}

function makeTracerPool(scene, count) {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.tracer), transparent: true, opacity: 0, depthWrite: false });
  const geometry = new THREE.BoxGeometry(0.02, 0.02, 1);
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.visible = false;
    scene.add(mesh);
    items.push({ mesh, life: 0 });
  }
  return items;
}

export function createEffects(scene, colliders) {
  const tracers = makeTracerPool(scene, TRACERS);
  const impacts = makeSpritePool(scene, IMPACTS, PAL.smoke, 0.16);
  const puffs = makeSpritePool(scene, PUFFS, PAL.blood, 0.2);
  const grenadeMeshes = new Map();
  let tracerCursor = 0;
  let impactCursor = 0;
  let puffCursor = 0;

  function spawnTracer(from, to) {
    const item = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % tracers.length;
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const end = new THREE.Vector3(to.x, to.y, to.z);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    item.mesh.position.copy(mid);
    item.mesh.lookAt(end);
    item.mesh.scale.set(1, 1, start.distanceTo(end));
    item.mesh.material.opacity = 0.85;
    item.mesh.visible = true;
    item.life = 0.05;
  }

  function burst(pool, point, color, velocity) {
    const item = pool[puffCursor % pool.length];
    if (pool === impacts) impactCursor += 1;
    else puffCursor += 1;
    item.sprite.position.set(point.x, point.y, point.z);
    item.sprite.material.color.set(color);
    item.sprite.material.opacity = 0.9;
    item.sprite.visible = true;
    item.life = 0;
    item.max = 0.3;
    item.velocity.copy(velocity);
  }

  function spawnGrenade(id) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PAL.metal), roughness: 0.4, metalness: 0.4 }),
    );
    mesh.castShadow = true;
    scene.add(mesh);
    grenadeMeshes.set(id, mesh);
  }

  function moveGrenade(id, position) {
    const mesh = grenadeMeshes.get(id);
    if (mesh) mesh.position.copy(position);
  }

  function removeGrenade(id) {
    const mesh = grenadeMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      grenadeMeshes.delete(id);
    }
  }

  function step(dt) {
    for (const item of tracers) {
      if (!item.mesh.visible) continue;
      item.life -= dt;
      item.mesh.material.opacity = Math.max(0, item.life / 0.05) * 0.85;
      if (item.life <= 0) item.mesh.visible = false;
    }
    for (const item of impacts) {
      if (!item.sprite.visible) continue;
      item.life += dt;
      item.sprite.material.opacity = Math.max(0, 0.9 - item.life * 2.4);
      if (item.life >= 0.38) item.sprite.visible = false;
    }
    for (const item of puffs) {
      if (!item.sprite.visible) continue;
      item.life += dt;
      item.sprite.position.addScaledVector(item.velocity, dt);
      item.velocity.y -= 4 * dt;
      item.sprite.material.opacity = Math.max(0, 0.85 - item.life * 3);
      item.sprite.scale.setScalar(0.2 + item.life * 1.4);
      if (item.life >= 0.28) item.sprite.visible = false;
    }
  }

  return {
    step,
    spawnTracer,
    impact(point, normal) {
      const at = point.clone().addScaledVector(normal, 0.02);
      burst(impacts, at, PAL.smoke, normal.clone().multiplyScalar(0.6));
    },
    blood(point, direction) {
      for (let index = 0; index < 3; index += 1) {
        const jitter = new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 1.2, (Math.random() - 0.5) * 1.4);
        burst(puffs, point, PAL.blood, direction.clone().multiplyScalar(1.2).add(jitter));
      }
    },
    spawnGrenade,
    moveGrenade,
    removeGrenade,
  };
}
