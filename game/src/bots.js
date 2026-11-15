// The bot mind. Bots walk the map's node graph to their assignment, look before they shoot,
// miss while their aim settles, burst-fire, reload behind the trigger, hear gunfire and turn
// to look, plant the bomb on the site and defuse it when it goes down. Every number here is
// the same for both teams.
import * as THREE from 'three';
import { NODES, EDGES, SITE_A, SITE_B, inSite } from './map.js';
import { hasLineOfSight, eyeOf, moveBody, STAND_HEIGHT, CROUCH_HEIGHT, STAND_EYE, CROUCH_EYE } from './physics.js';
import { WEAPONS, fireShot, startReload, finishReload, coolSpread } from './weapons.js';

const WALK_SPEED = 4.6;
const COMBAT_SPEED = 2.6;
const GRAVITY = 20;
const SIGHT_RANGE = 46;
const REACTION_MIN = 0.22;
const REACTION_RANGE = 0.2;
const AIM_SETTLE = 0.55;
const AIM_ERROR = 0.055;
const TARGET_MEMORY = 1.6;

const eye = new THREE.Vector3();
const targetEye = new THREE.Vector3();
const aim = new THREE.Vector3();
const wish = new THREE.Vector3();

// Adjacency as index lists, once.
const NEIGHBOURS = NODES.map(() => []);
for (const [a, b] of EDGES) {
  NEIGHBOURS[a].push(b);
  NEIGHBOURS[b].push(a);
}
const SEGMENTS = NODES.map(() => new Map());
for (const [a, b] of EDGES) {
  const cost = Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1]);
  SEGMENTS[a].set(b, cost);
  SEGMENTS[b].set(a, cost);
}

function nearestNode(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let index = 0; index < NODES.length; index += 1) {
    const dx = NODES[index][0] - x;
    const dz = NODES[index][1] - z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  }
  return best;
}

/** Dijkstra over the small node graph: the node list to walk from `from` to `to`. */
function findPath(from, to) {
  if (from === to) return [to];
  const dist = new Array(NODES.length).fill(Infinity);
  const prev = new Array(NODES.length).fill(-1);
  const open = [from];
  dist[from] = 0;
  while (open.length > 0) {
    let pick = 0;
    for (let index = 1; index < open.length; index += 1) {
      if (dist[open[index]] < dist[open[pick]]) pick = index;
    }
    const current = open.splice(pick, 1)[0];
    if (current === to) break;
    for (const [next, cost] of SEGMENTS[current]) {
      const candidate = dist[current] + cost;
      if (candidate < dist[next]) {
        dist[next] = candidate;
        prev[next] = current;
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  if (dist[to] === Infinity) return [to];
  const path = [];
  for (let at = to; at !== -1; at = prev[at]) path.push(at);
  path.reverse();
  return path;
}

/** Assignments for the round: where each bot heads. Recomputed when the round begins. */
export function briefBots(state, targetSite) {
  const other = targetSite === SITE_A ? SITE_B : SITE_A;
  const site = targetSite === SITE_A ? SITE_A : SITE_B;
  for (const bot of state.characters) {
    if (bot.isPlayer) continue;
    bot.target = null;
    bot.path = [];
    bot.planting = 0;
    bot.defusing = 0;
    bot.memory = 0;
    bot.thinkAt = state.time + Math.random() * 0.3;
    const node = nearestNode(bot.pos.x, bot.pos.z);
    bot.node = node;
    if (bot.team === state.attackers) {
      const goal = state.bomb.carrier === bot ? site : (Math.random() < 0.75 ? site : other);
      const goalNode = goal === site ? (site === SITE_A ? 13 : 18) : (site === SITE_A ? 12 : 17);
      bot.path = findPath(node, goalNode);
      bot.job = 'attack';
    } else {
      // Defenders split across the two sites, weighted to the louder flank.
      const home = Math.random() < 0.6 ? targetSite : (targetSite === SITE_A ? SITE_B : SITE_A);
      const homeNode = home === SITE_A ? (Math.random() < 0.5 ? 13 : 12) : (Math.random() < 0.5 ? 18 : 17);
      bot.path = findPath(node, homeNode);
      bot.job = 'defend';
    }
    bot.holdUntil = 0;
  }
}

function seeCharacter(bot, other, colliders) {
  eyeOf(bot, eye);
  targetEye.set(other.pos.x, other.pos.y + other.height * (other.crouching ? 0.6 : 0.72), other.pos.z);
  if (eye.distanceTo(targetEye) > SIGHT_RANGE) return false;
  return hasLineOfSight(eye, targetEye, colliders);
}

function faceTowards(bot, x, z) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  bot.yaw = Math.atan2(-dx, -dz);
}

function aimAtPoint(bot, point, error) {
  aim.set(point.x, point.y, point.z).sub(eye).normalize();
  // Cone error around the true direction: the settle fraction narrows it to zero.
  if (error > 0) {
    aim.x += (Math.random() - 0.5) * 2 * error;
    aim.y += (Math.random() - 0.5) * 2 * error;
    aim.z += (Math.random() - 0.5) * 2 * error;
    aim.normalize();
  }
  bot.pitch = Math.asin(aim.y);
  return aim;
}

function walkToward(bot, x, z, speed, dt, colliders) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 0.001) {
    wish.set(dx / distance, 0, dz / distance);
  } else {
    wish.set(0, 0, 0);
  }
  const blend = Math.min(1, 26 * dt / speed);
  bot.velocity.x += (wish.x * speed - bot.velocity.x) * blend;
  bot.velocity.z += (wish.z * speed - bot.velocity.z) * blend;
  bot.velocity.y -= GRAVITY * dt;
  moveBody(colliders, bot.pos, bot.velocity, dt, bot.height);
}

function followPath(bot, dt, colliders) {
  if (bot.path.length === 0) return true;
  const [x, z] = NODES[bot.path[0]];
  walkToward(bot, x, z, bot.target ? COMBAT_SPEED : WALK_SPEED, dt, colliders);
  faceTowards(bot, x, z);
  if (Math.hypot(bot.pos.x - x, bot.pos.z - z) < 0.9) {
    bot.node = bot.path.shift();
    return bot.path.length === 0;
  }
  return false;
}

function tryFire(bot, state, effects, spreadError) {
  const weapon = WEAPONS[bot.weapon];
  if (bot.reloadLeft > 0 || bot.cooldown > 0 || bot.mag <= 0) return;
  const dir = aimAtPoint(bot, targetEye, spreadError);
  eyeOf(bot, eye);
  const origin = eye.clone();
  const events = fireShot(state, bot, effects, origin, dir);
  effects.onShotEvents(bot, events);
  if (bot.mag <= 0) startReload(bot);
  bot.burst -= 1;
  if (bot.burst <= 0) {
    bot.burst = weapon.auto ? 3 + Math.floor(Math.random() * 3) : 1;
    bot.cooldown = Math.max(bot.cooldown, weapon.auto ? 0.22 + Math.random() * 0.25 : 0.16 + Math.random() * 0.12);
  }
}

function combatStep(bot, state, dt, colliders, effects) {
  const other = bot.target;
  eyeOf(bot, eye);
  targetEye.set(other.pos.x, other.pos.y + other.height * (other.crouching ? 0.6 : 0.72), other.pos.z);
  const visible = seeCharacter(bot, other, colliders);
  if (!visible) {
    bot.memory -= dt;
    if (bot.memory <= 0) {
      bot.target = null;
      return;
    }
    // Suppress the last known position while the memory lasts.
    faceTowards(bot, other.pos.x, other.pos.z);
    followPath(bot, dt, colliders);
    return;
  }
  bot.memory = TARGET_MEMORY;
  const distance = eye.distanceTo(targetEye);
  const settle = Math.max(0, Math.min(1, (state.time - bot.reactAt) / AIM_SETTLE));
  const error = AIM_ERROR * (1 - settle) + 0.004;
  faceTowards(bot, other.pos.x, other.pos.z);
  // Hold ground or sidestep; closing far targets is fine, near ones get a small strafe.
  if (distance > 22) walkToward(bot, other.pos.x, other.pos.z, COMBAT_SPEED, dt, colliders);
  else walkToward(bot, bot.pos.x + Math.cos(state.time * 1.3 + bot.pos.x) * 1.4, bot.pos.z, COMBAT_SPEED * 0.6, dt, colliders);
  if (state.time >= bot.reactAt) {
    if (bot.mag <= 0 && bot.reloadLeft <= 0) startReload(bot);
    tryFire(bot, state, effects, error);
  }
}

function routeStep(bot, state, dt, colliders) {
  const arrived = followPath(bot, dt, colliders);
  if (!arrived) return;
  if (bot.job === 'attack' && state.bomb.carrier === bot) {
    const site = state.bomb.site ?? (bot.pos.x > 0 ? SITE_A : SITE_B);
    if (inSite(site, bot.pos.x, bot.pos.z)) {
      bot.planting += dt;
      return;
    }
    bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z), site === SITE_A ? 13 : 18);
    return;
  }
  // Hold: stand the post, sweep the likely approach now and then.
  bot.holdUntil = state.time + 1.2 + Math.random() * 1.5;
  faceTowards(bot, bot.pos.x + (Math.random() - 0.5) * 24, bot.pos.z + (bot.team === state.defenders ? 18 : -18));
}

/**
 * One bot's tick: perception first, then the mind's two modes. `heardAt` carries the loudest
 * recent gunfire so a bot with no target turns towards the noise.
 */
export function stepBot(bot, state, dt, colliders, effects, heard) {
  if (!bot.alive) return;
  const weapon = WEAPONS[bot.weapon];
  if (bot.reloadLeft > 0) {
    bot.reloadLeft -= dt;
    if (bot.reloadLeft <= 0) finishReload(bot);
  }
  bot.cooldown = Math.max(0, bot.cooldown - dt);
  coolSpread(bot, dt);
  bot.height = bot.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  bot.eye = bot.crouching ? CROUCH_EYE : STAND_EYE;
  if (state.phase !== 'live') {
    // Freeze time: bots stand their ground between rounds.
    bot.velocity.x = 0;
    bot.velocity.z = 0;
    bot.velocity.y -= GRAVITY * dt;
    moveBody(colliders, bot.pos, bot.velocity, dt, bot.height);
    return;
  }

  if (state.time >= bot.thinkAt) {
    bot.thinkAt = state.time + 0.22 + Math.random() * 0.08;
    let best = null;
    let bestDist = Infinity;
    for (const other of state.characters) {
      if (other.team === bot.team || !other.alive) continue;
      const dx = other.pos.x - bot.pos.x;
      const dz = other.pos.z - bot.pos.z;
      const dist = dx * dx + dz * dz;
      if (dist > SIGHT_RANGE * SIGHT_RANGE || dist >= bestDist) continue;
      if (seeCharacter(bot, other, colliders)) {
        best = other;
        bestDist = dist;
      }
    }
    if (best !== null) {
      if (bot.target !== best) {
        bot.target = best;
        bot.memory = TARGET_MEMORY;
        bot.reactAt = state.time + REACTION_MIN + Math.random() * REACTION_RANGE;
        bot.burst = 1;
      }
    } else if (bot.target !== null) {
      bot.memory = bot.memory ?? TARGET_MEMORY;
    }
    if (best === null && bot.target !== null && !(bot.memory > 0)) bot.target = null;
    if (heard !== null && bot.target === null) faceTowards(bot, heard.x, heard.z);
  }

  if (bot.target !== null && bot.target.alive) {
    combatStep(bot, state, dt, colliders, effects);
    return;
  }
  bot.target = null;
  if (bot.job === 'attack' && state.bomb.carrier === bot) {
    const site = state.bomb.site ?? (bot.pos.x > 0 ? SITE_A : SITE_B);
    if (inSite(site, bot.pos.x, bot.pos.z)) {
      state.pendingPlant = bot; // the round layer advances the plant timer
      return;
    }
    bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z), site === SITE_A ? 13 : 18);
    return;
  }
  if (state.bomb.state === 'planted' && bot.team === state.defenders) {
    const bomb = state.bomb;
    const dist = Math.hypot(bomb.pos.x - bot.pos.x, bomb.pos.z - bot.pos.z);
    if (dist < 1.7) {
      if (bot.defusing === 0) {
        const guarded = state.characters.some((other) => other.alive && other.team !== bot.team && seeCharacter(bot, other, colliders));
        if (!guarded) bot.defusing = 0.0001;
      } else {
        state.pendingDefuse = bot; // the round layer advances the defuse timer
      }
      return;
    }
    if (bot.defusing > 0) bot.defusing = 0;
    bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z), nearestNode(bomb.pos.x, bomb.pos.z));
  }
  routeStep(bot, state, dt, colliders);
}
