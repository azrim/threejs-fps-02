// The first-person view model: hands-off geometry that reads as the held weapon, with the
// muzzle flash, the kick per shot and the dip on reload. Styled boxes only — the shape is
// the silhouette, the motion is the feel.
import * as THREE from 'three';
import { PAL } from './palette.js';

const METAL = { roughness: 0.42, metalness: 0.5 };
const POLY = { roughness: 0.72, metalness: 0.12 };

function buildPistol() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, ...METAL });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3c4048, ...POLY });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.3), dark);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.05, 0.22), grip);
  frame.position.set(0, -0.055, 0.02);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.15, 0.06), grip);
  handle.position.set(0, -0.13, 0.1);
  handle.rotation.x = 0.18;
  group.add(slide, frame, handle);
  return { group, muzzleZ: -0.22 };
}

function buildSmg() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, ...METAL });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.42), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.2), dark);
  barrel.position.set(0, 0.012, -0.3);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.07), new THREE.MeshStandardMaterial({ color: 0x3c4048, ...POLY }));
  mag.position.set(0, -0.14, -0.02);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.16), new THREE.MeshStandardMaterial({ color: 0x3c4048, ...POLY }));
  stock.position.set(0, -0.01, 0.26);
  group.add(body, barrel, mag, stock);
  return { group, muzzleZ: -0.44 };
}

function buildRifle() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x26292f, ...METAL });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a2a, ...POLY });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.5), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.34), dark);
  barrel.position.set(0, 0.02, -0.4);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 0.26), wood);
  handguard.position.set(0, 0.005, -0.32);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.09), dark);
  mag.position.set(0, -0.14, -0.05);
  mag.rotation.x = 0.12;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.24), wood);
  stock.position.set(0, -0.02, 0.33);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.045, 0.02), dark);
  sight.position.set(0, 0.075, -0.12);
  group.add(receiver, barrel, handguard, mag, stock, sight);
  return { group, muzzleZ: -0.6 };
}

const BUILDERS = { pistol: buildPistol, smg: buildSmg, rifle: buildRifle };

export function createViewModel(camera) {
  const holder = new THREE.Group();
  holder.position.set(0.22, -0.2, -0.36);
  camera.add(holder);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.flash), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PAL.flash), 0, 7);
  flashLight.position.set(0.22, -0.12, -0.8);
  camera.add(flashLight);

  const models = new Map();
  let current = null;
  let kick = 0;
  let sway = 0;
  let reloadDip = 0;
  let bobTime = 0;

  function show(weaponId) {
    let built = models.get(weaponId);
    if (!built) {
      built = BUILDERS[weaponId]();
      holder.add(built.group);
      models.set(weaponId, built);
    }
    for (const model of models.values()) model.group.visible = false;
    built.group.visible = true;
    current = built;
    flash.position.set(0.22, -0.16, holder.position.z + built.muzzleZ);
  }

  function shot() {
    kick = 1;
    flash.visible = true;
    flash.rotation.z = Math.random() * Math.PI;
    flashLight.intensity = 16;
  }

  function reloading(fraction) {
    reloadDip = Math.sin(Math.min(1, fraction) * Math.PI) * 0.12;
  }

  function step(dt, speed) {
    kick = Math.max(0, kick - dt * 9);
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 130);
    if (flashLight.intensity === 0) flash.visible = false;
    reloadDip = Math.max(0, reloadDip - dt * 0.3);
    sway += dt * (2 + speed * 1.6);
    bobTime += dt * speed;
    const bob = Math.min(1, speed / 5.2) * 0.012;
    holder.position.x = 0.22 + Math.cos(sway) * bob * 0.5;
    holder.position.y = -0.2 + Math.abs(Math.sin(bobTime * 2)) * bob + reloadDip;
    holder.position.z = -0.36 + kick * 0.045;
    holder.rotation.x = kick * 0.16 + reloadDip * 2.2;
    holder.rotation.z = Math.cos(sway) * bob * 0.4;
  }

  return { show, shot, reloading, step };
}
