// Simulation maths shared by the player, the bots and the bullets: box-against-map movement,
// a slab raycast that answers distance and the face hit, line-of-sight, and the two-box body
// every character carries (a torso slab and a head box, so headshots are geometry, not dice).
import * as THREE from 'three';

export const PLAYER_RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.02;
const SKIN = 0.02;

const probe = new THREE.Box3();

function boxFor(x, y, z, height, lift) {
  probe.min.set(x - PLAYER_RADIUS, y + lift, z - PLAYER_RADIUS);
  probe.max.set(x + PLAYER_RADIUS, y + height - lift, z + PLAYER_RADIUS);
}

/** The first map box the standing body would overlap at (x, y, z), or null. */
export function colliderAt(colliders, x, y, z, height, lift) {
  boxFor(x, y, z, height, lift);
  for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
  return null;
}

/**
 * Move one axis at a time: horizontal steps are refused on contact, the vertical step lands
 * on top of a box or bounces off its underside. Mutates and returns the entity's position.
 */
export function moveBody(colliders, position, velocity, dt, height) {
  const nextX = position.x + velocity.x * dt;
  if (!colliderAt(colliders, nextX, position.y, position.z, height, 0.04)) position.x = nextX;
  else velocity.x = 0;
  const nextZ = position.z + velocity.z * dt;
  if (!colliderAt(colliders, position.x, position.y, nextZ, height, 0.04)) position.z = nextZ;
  else velocity.z = 0;
  position.y += velocity.y * dt;
  const hit = colliderAt(colliders, position.x, position.y, position.z, height, 0);
  if (hit && velocity.y <= 0) {
    position.y = hit.max.y;
    velocity.y = 0;
    return true; // grounded
  }
  if (hit) {
    position.y = hit.min.y - height;
    velocity.y = 0;
  }
  if (position.y <= 0) {
    position.y = 0;
    velocity.y = 0;
    return true;
  }
  return false;
}

/**
 * Slab raycast against every map box plus the ground plane. Returns null or
 * { dist, point, normal } — point and normal are pooled vectors, valid until the next call.
 */
const hit = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };
const inv = new THREE.Vector3();

export function raycastMap(origin, direction, maxDist, colliders) {
  let best = maxDist;
  let axis = -1;
  let sign = 0;
  inv.set(1 / direction.x, 1 / direction.y, 1 / direction.z);
  for (const box of colliders) {
    let t0 = 0;
    let t1 = best;
    let hitAxis = -1;
    let hitSign = 0;
    let miss = false;
    for (let a = 0; a < 3; a += 1) {
      const oa = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
      const ia = a === 0 ? inv.x : a === 1 ? inv.y : inv.z;
      const mn = a === 0 ? box.min.x : a === 1 ? box.min.y : box.min.z;
      const mx = a === 0 ? box.max.x : a === 1 ? box.max.y : box.max.z;
      let near = (mn - oa) * ia;
      let far = (mx - oa) * ia;
      let s = -1;
      if (near > far) {
        const swap = near;
        near = far;
        far = swap;
        s = 1;
      }
      if (near > t0) {
        t0 = near;
        hitAxis = a;
        hitSign = s;
      }
      if (far < t1) t1 = far;
      if (t0 > t1) {
        miss = true;
        break;
      }
    }
    if (!miss && t0 > 0 && t0 < best) {
      best = t0;
      axis = hitAxis;
      sign = hitSign;
    }
  }
  // The ground plane at y = 0 catches shots aimed across open ground.
  if (direction.y < 0) {
    const tGround = -origin.y / direction.y;
    if (tGround > 0 && tGround < best) {
      best = tGround;
      axis = 1;
      sign = -1;
    }
  }
  if (axis === -1) return null;
  hit.dist = best;
  hit.point.copy(direction).multiplyScalar(best).add(origin);
  hit.normal.set(0, 0, 0);
  if (axis === 0) hit.normal.x = sign;
  else if (axis === 1) hit.normal.y = sign === -1 ? 1 : -1;
  else hit.normal.z = sign;
  return hit;
}

/** Line of sight: true when nothing stands between the two eye points. */
const sightDir = new THREE.Vector3();

function hasLineOfSight(from, to, colliders) {
  sightDir.copy(to).sub(from);
  const distance = sightDir.length();
  if (distance < 0.001) return true;
  sightDir.multiplyScalar(1 / distance);
  const struck = raycastMap(from, sightDir, distance, colliders);
  return struck === null || struck.dist >= distance - 0.01;
}

export { hasLineOfSight };

/**
 * Ray against one character's two hit boxes: the torso slab (y + 0.05 .. y + 0.78 * height)
 * and the head box (y + 0.78 * height .. y + height). Returns null or { part, dist }.
 */
export function raycastBody(origin, direction, maxDist, entity) {
  const r = PLAYER_RADIUS;
  const h = entity.height;
  const x = entity.pos.x;
  const y = entity.pos.y;
  const z = entity.pos.z;
  let bestPart = null;
  let bestDist = maxDist;
  const boxes = [
    { part: 'body', minX: x - r, maxX: x + r, minY: y + 0.05, maxY: y + h * 0.78, minZ: z - r, maxZ: z + r },
    { part: 'head', minX: x - 0.17, maxX: x + 0.17, minY: y + h * 0.78, maxY: y + h + 0.02, minZ: z - 0.17, maxZ: z + 0.17 },
  ];
  for (const box of boxes) {
    let t0 = 0;
    let t1 = bestDist;
    let miss = false;
    for (let a = 0; a < 3; a += 1) {
      const oa = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
      const ia = a === 0 ? 1 / direction.x : a === 1 ? 1 / direction.y : 1 / direction.z;
      const mn = a === 0 ? box.minX : a === 1 ? box.minY : box.minZ;
      const mx = a === 0 ? box.maxX : a === 1 ? box.maxY : box.maxZ;
      let near = (mn - oa) * ia;
      let far = (mx - oa) * ia;
      if (near > far) {
        const swap = near;
        near = far;
        far = swap;
      }
      if (near > t0) t0 = near;
      if (far < t1) t1 = far;
      if (t0 > t1) {
        miss = true;
        break;
      }
    }
    if (!miss && t0 > 0 && t0 < bestDist) {
      bestDist = t0;
      bestPart = box.part;
    }
  }
  return bestPart === null ? null : { part: bestPart, dist: bestDist };
}

const eye = new THREE.Vector3();

/** A character's eye point: eye height, or the head box's centre when crouching keeps its own. */
export function eyeOf(entity, out = eye) {
  return out.set(entity.pos.x, entity.pos.y + (entity.eye ?? STAND_EYE), entity.pos.z);
}

export { SKIN };
