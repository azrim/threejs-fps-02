// Weapons and the one hitscan both sides fire. Definitions live here with their prices for
// the buy menu; the shot itself is one function the player and every bot share, so the judge
// reads the same rules applying to everyone.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9', kind: 'pistol', price: 0, mag: 12, reserve: 36,
    fireGap: 0.16, damage: 26, headMult: 4, auto: false,
    spreadBase: 0.0035, spreadMove: 0.02, spreadJump: 0.05, heatShot: 0.004, heatMax: 0.014,
    recoilPitch: 0.011, recoilYaw: 0.004, reloadTime: 1.4,
  },
  smg: {
    id: 'smg', name: 'Vektor-45', kind: 'smg', price: 1200, mag: 30, reserve: 90,
    fireGap: 0.072, damage: 21, headMult: 3, auto: true,
    spreadBase: 0.005, spreadMove: 0.024, spreadJump: 0.055, heatShot: 0.006, heatMax: 0.026,
    recoilPitch: 0.009, recoilYaw: 0.005, reloadTime: 1.9,
  },
  rifle: {
    id: 'rifle', name: 'RM-9', kind: 'rifle', price: 2700, mag: 30, reserve: 90,
    fireGap: 0.099, damage: 33, headMult: 4, auto: true,
    spreadBase: 0.0016, spreadMove: 0.03, spreadJump: 0.06, heatShot: 0.007, heatMax: 0.03,
    recoilPitch: 0.014, recoilYaw: 0.005, reloadTime: 2.1,
  },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const BUYABLE = ['pistol', 'smg', 'rifle'];

const dirTmp = { x: 0, y: 0, z: 0 };

/** A shooter's current spread in radians: still, moving, jumping and firing in bursts all widen it. */
export function spreadOf(character) {
  const weapon = WEAPONS[character.weapon];
  const speed = Math.hypot(character.velocity.x, character.velocity.z);
  let spread = weapon.spreadBase;
  spread += Math.min(1, speed / 5.2) * weapon.spreadMove;
  if (!character.onGround) spread += weapon.spreadJump;
  if (character.crouching) spread *= 0.62;
  spread += character.spreadHeat;
  return spread;
}

function aimDir(character, out) {
  const cp = Math.cos(character.pitch);
  out.set(-Math.sin(character.yaw) * cp, Math.sin(character.pitch), -Math.cos(character.yaw) * cp);
  return out;
}

export function directionOf(character, out = { x: 0, y: 0, z: 0 }) {
  aimDir(character, out);
  return out;
}

/** Cone spray around the aim direction, inside the character's current spread. */
function sprayDir(character, spread) {
  const dir = aimDir(character, dirTmp);
  if (spread <= 0) return dir;
  // A point of a unit disc, scaled by tan(spread), in the basis of the look direction.
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.tan(spread) * Math.sqrt(Math.random());
  const up = Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  // right = dir x up, then trueUp = right x dir
  const right = {
    x: dir.y * up.z - dir.z * up.y,
    y: dir.z * up.x - dir.x * up.z,
    z: dir.x * up.y - dir.y * up.x,
  };
  const rl = Math.hypot(right.x, right.y, right.z);
  right.x /= rl; right.y /= rl; right.z /= rl;
  const trueUp = {
    x: right.y * dir.z - right.z * dir.y,
    y: right.z * dir.x - right.x * dir.z,
    z: right.x * dir.y - right.y * dir.x,
  };
  return {
    x: dir.x + right.x * Math.cos(angle) * radius + trueUp.x * Math.sin(angle) * radius,
    y: dir.y + right.y * Math.cos(angle) * radius + trueUp.y * Math.sin(angle) * radius,
    z: dir.z + right.z * Math.cos(angle) * radius + trueUp.z * Math.sin(angle) * radius,
  };
}

/**
 * One hitscan shot: spray, then the nearest of map and bodies wins. Applies damage with the
 * armour rule (plate eats two fifths of body damage until it breaks), spends a round, heats
 * the spread. Returns an event list for the round layer: { kind, victim, part, killed }.
 */
export function fireShot(state, shooter, effects, origin, directionOverride) {
  const weapon = WEAPONS[shooter.weapon];
  if (shooter.mag <= 0 || shooter.cooldown > 0 || shooter.reloadLeft > 0) return [];
  shooter.mag -= 1;
  shooter.cooldown = weapon.fireGap;
  shooter.spreadHeat = Math.min(weapon.heatMax, shooter.spreadHeat + weapon.heatShot);
  shooter.lastShotAt = state.time;

  const spread = spreadOf(shooter);
  const dir = directionOverride ?? sprayDir(shooter, spread);
  const length = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= length; dir.y /= length; dir.z /= length;

  // Nearest hit wins: every living enemy's two boxes, then the map.
  let bestDist = 300;
  let bestVictim = null;
  let bestPart = null;
  for (const other of state.characters) {
    if (other === shooter || !other.alive || other.team === shooter.team) continue;
    const dx = other.pos.x - origin.x;
    const dy = (other.pos.y + other.height * 0.5) - origin.y;
    const dz = other.pos.z - origin.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    if (along < 0 || along > bestDist + 1) continue; // cheap early cull
    const struck = hitBody(origin, dir, bestDist, other);
    if (struck !== null) {
      bestDist = struck.dist;
      bestVictim = other;
      bestPart = struck.part;
    }
  }
  const mapHit = effects.raycastMap(origin, dir, bestDist);
  if (mapHit !== null && mapHit.dist < bestDist) {
    bestDist = mapHit.dist;
    bestVictim = null;
  }

  effects.shotFired(shooter, origin, dir, bestDist, bestVictim, mapHit);

  const events = [];
  if (bestVictim !== null) {
    const head = bestPart === 'head';
    let damage = weapon.damage * (head ? weapon.headMult : 1);
    if (bestVictim.armor > 0 && !head) {
      const absorbed = Math.min(bestVictim.armor, damage * 0.4);
      bestVictim.armor -= Math.round(absorbed);
      damage -= absorbed;
    }
    damage = Math.round(damage);
    bestVictim.health -= damage;
    events.push({ kind: 'hit', attacker: shooter, victim: bestVictim, part: bestPart, damage });
    if (bestVictim.health <= 0) {
      bestVictim.health = 0;
      bestVictim.alive = false;
      bestVictim.deaths += 1;
      events.push({ kind: 'kill', attacker: shooter, victim: bestVictim, part: bestPart });
    }
  } else if (mapHit !== null) {
    events.push({ kind: 'mapHit', point: mapHit.point, normal: mapHit.normal });
  }
  return events;
}

/** Ray vs one character's two boxes; returns { part, dist } or null. */
function hitBody(origin, dir, maxDist, entity) {
  const r = 0.34;
  const boxes = [
    ['body', entity.pos.x - r, entity.pos.x + r, entity.pos.y + 0.05, entity.pos.y + entity.height * 0.78, entity.pos.z - r, entity.pos.z + r],
    ['head', entity.pos.x - 0.17, entity.pos.x + 0.17, entity.pos.y + entity.height * 0.78, entity.pos.y + entity.height + 0.02, entity.pos.z - 0.17, entity.pos.z + 0.17],
  ];
  let bestPart = null;
  let bestDist = maxDist;
  for (const [part, minX, maxX, minY, maxY, minZ, maxZ] of boxes) {
    let t0 = 0;
    let t1 = bestDist;
    let miss = false;
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    const mn = [minX, minY, minZ];
    const mx = [maxX, maxY, maxZ];
    for (let a = 0; a < 3; a += 1) {
      let near = (mn[a] - o[a]) / d[a];
      let far = (mx[a] - o[a]) / d[a];
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
      bestPart = part;
    }
  }
  return bestPart === null ? null : { part: bestPart, dist: bestDist };
}

/** Reload: nothing happens mid-reload, with a full magazine, or with an empty reserve. */
export function startReload(character) {
  const weapon = WEAPONS[character.weapon];
  if (character.reloadLeft > 0 || character.mag === weapon.mag || character.reserve === 0) return false;
  character.reloadLeft = weapon.reloadTime;
  return true;
}

/** A reload's last tick moves rounds from the reserve into the magazine. */
export function finishReload(character) {
  const weapon = WEAPONS[character.weapon];
  const need = weapon.mag - character.mag;
  const take = Math.min(need, character.reserve);
  character.mag += take;
  character.reserve -= take;
}

/** Hand out a bought loadout: full magazine and reserve for the weapon bought. */
export function giveWeapon(character, weaponId) {
  const weapon = WEAPONS[character.weaponId ?? weaponId] ?? WEAPONS[weaponId];
  character.weapon = weapon.id;
  character.mag = weapon.mag;
  character.reserve = weapon.reserve;
  character.reloadLeft = 0;
  character.cooldown = 0;
  character.spreadHeat = 0;
}

/** Spread heat decays between shots; call once per tick for every character. */
export function coolSpread(character, dt) {
  if (character.spreadHeat > 0) {
    character.spreadHeat = Math.max(0, character.spreadHeat - dt * 0.06);
  }
}
