// The match layer: rounds, money, the bomb, win conditions. It runs the phase machine
// (buy -> live -> roundEnd, to a match win at eight rounds), pays the rewards, advances the
// plant and defuse the bots ask for, and hands the HUD its strings.
import * as THREE from 'three';
import {
  createState, createCharacter, TEAM, REWARDS,
  ROUND_BUY_SECONDS, ROUND_LIVE_SECONDS, ROUND_END_SECONDS,
  BOMB_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS, WIN_ROUNDS, MAX_ROUNDS,
} from './state.js';
import { ATTACKER_SPAWNS, DEFENDER_SPAWNS, SITE_A, SITE_B, inSite } from './map.js';
import { WEAPONS, giveWeapon, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

export function createMatch() {
  const state = createState();
  const jackalNames = ['Harrow', 'Kestrel', 'Moss', 'Dune'];
  const viperNames = ['Fenn', 'Marlow', 'Rook', 'Sable'];
  state.player = createCharacter(TEAM.JACKALS, 'You', true);
  state.characters.push(state.player);
  for (const name of jackalNames) state.characters.push(createCharacter(TEAM.JACKALS, name, false));
  for (const name of viperNames) state.characters.push(createCharacter(TEAM.VIPERS, name, false));
  for (const character of state.characters) {
    character.pos = new THREE.Vector3();
    character.velocity = new THREE.Vector3();
  }
  state.attackers = TEAM.JACKALS;
  state.defenders = TEAM.VIPERS;
  return state;
}

function grantMoney(character, amount) {
  character.money = Math.min(REWARDS.cap, character.money + amount);
}

function giveLoadout(character, weaponId) {
  character.weapon = weaponId;
  character.armor = weaponId === 'pistol' ? 0 : character.armor;
  giveWeapon(character, weaponId);
}

/** Round start: everyone back to their spawn with their loadout, the bomb to a random attacker. */
export function startRound(state, effects) {
  state.phase = 'buy';
  state.phaseLeft = ROUND_BUY_SECONDS;
  state.roundTime = 0;
  state.pendingPlant = null;
  state.pendingDefuse = null;
  const bomb = state.bomb;
  bomb.state = 'carried';
  bomb.timer = BOMB_SECONDS;
  bomb.site = null;
  bomb.defuser = null;
  bomb.defuseLeft = 0;
  if (bomb.pos !== null && effects.bombRemove) effects.bombRemove();
  const attackers = state.characters.filter((character) => character.team === state.attackers);
  const carrier = attackers[Math.floor(Math.random() * attackers.length)];
  bomb.carrier = carrier;
  bomb.pos = null;
  for (const character of state.characters) {
    const diedLastRound = !character.alive;
    character.alive = true;
    character.health = 100;
    character.crouching = false;
    character.height = 1.72;
    character.eye = 1.6;
    character.reloadLeft = 0;
    character.cooldown = 0;
    character.spreadHeat = 0;
    character.hasBomb = false;
    character.planting = 0;
    character.defusing = 0;
    character.target = null;
    character.path = [];
    character.velocity.set(0, 0, 0);
    const spawns = character.team === state.attackers ? ATTACKER_SPAWNS : DEFENDER_SPAWNS;
    const index = state.characters.filter((other) => other.team === character.team).indexOf(character);
    const [x, z] = spawns[index % spawns.length];
    character.pos.set(x + (Math.random() - 0.5) * 0.6, 0, z + (Math.random() - 0.5) * 0.6);
    // Attackers face north (into the map), defenders face south.
    character.yaw = character.team === state.attackers ? 0 : Math.PI;
    character.pitch = 0;
    // Survivors keep their loadout; the dead fall back to the free pistol.
    if (diedLastRound) {
      character.loadout = 'pistol';
      character.armor = 0;
      character.grenades = 0;
    }
    giveWeapon(character, character.weapon ?? 'pistol');
  }
  carrier.hasBomb = true;
}

function botBuy(state) {
  for (const character of state.characters) {
    if (character.isPlayer) continue;
    if (character.armor === 0 && character.money >= ARMOR_PRICE) {
      character.money -= ARMOR_PRICE;
      character.armor = 50;
    }
    const best = character.money >= WEAPONS.rifle.price + GRENADE_PRICE ? 'rifle' : character.money >= WEAPONS.smg.price ? 'smg' : 'pistol';
    if (best !== 'pistol' && character.weapon !== best) {
      character.money -= WEAPONS[best].price;
      giveLoadout(character, best);
    }
    if (character.grenades === 0 && character.money >= GRENADE_PRICE) {
      character.money -= GRENADE_PRICE;
      character.grenades = 1;
    }
  }
}

/** The player's buy intents, spent only in the buy phase. */
function applyBuy(state, id) {
  const player = state.player;
  if (!id) return;
  if (WEAPONS[id] && player.money >= WEAPONS[id].price) {
    player.money -= WEAPONS[id].price;
    player.loadout = id;
    giveLoadout(player, id);
  } else if (id === 'armor' && player.money >= ARMOR_PRICE && player.armor === 0) {
    player.money -= ARMOR_PRICE;
    player.armor = 50;
  } else if (id === 'grenade' && player.money >= GRENADE_PRICE && player.grenades === 0) {
    player.money -= GRENADE_PRICE;
    player.grenades = 1;
  }
}

function endRound(state, winner, reason, effects) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.phaseLeft = ROUND_END_SECONDS;
  state.score[winner] += 1;
  state.roundWinner = winner;
  state.roundReason = reason;
  const loser = winner === state.attackers ? state.defenders : state.attackers;
  state.lossStreak[loser] = Math.min(3, state.lossStreak[loser] + 1);
  state.lossStreak[winner] = 0;
  const lossPay = Math.min(REWARDS.lossBase + REWARDS.lossStep * (state.lossStreak[loser] - 1), REWARDS.lossMax);
  for (const character of state.characters) {
    grantMoney(character, character.team === winner ? REWARDS.win : lossPay);
  }
  effects.roundEnd(winner, reason);
  if (state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    state.phase = 'roundEnd';
    state.matchOver = true;
  }
}

function checkTeamWipe(state) {
  const attackersAlive = state.characters.some((character) => character.alive && character.team === state.attackers);
  const defendersAlive = state.characters.some((character) => character.alive && character.team === state.defenders);
  if (!defendersAlive && state.bomb.state !== 'defused') {
    endRound(state, state.attackers, 'elimination');
    return true;
  }
  if (!attackersAlive && state.bomb.state !== 'planted') {
    endRound(state, state.defenders, 'elimination');
    return true;
  }
  return false;
}

export function explodeBomb(state, effects) {
  state.bomb.state = 'exploded';
  effects.bombExploded(state.bomb.pos);
  // The blast: heavy up close, falling off with distance, walls not modelled.
  for (const character of state.characters) {
    if (!character.alive) continue;
    const distance = character.pos.distanceTo(state.bomb.pos);
    if (distance < 14) {
      const damage = Math.round(220 * Math.max(0.12, 1 - distance / 14));
      character.health -= damage;
      if (character.health <= 0) {
        character.health = 0;
        character.alive = false;
        character.deaths += 1;
        pushKill(state, 'the bomb', character, false);
      }
    }
  }
  endRound(state, state.attackers, 'bomb');
}

function pushKill(state, attackerName, victim, headshot) {
  state.killfeed.unshift({ attacker: attackerName, victim: victim.name, headshot, roundTime: state.roundTime });
  if (state.killfeed.length > 5) state.killfeed.pop();
}

/** Kills and hits arrive here from the weapons layer; kills pay and feed. */
export function onEvents(state, events) {
  for (const event of events) {
    if (event.kind !== 'kill') continue;
    event.attacker.kills += 1;
    grantMoney(event.attacker, REWARDS.kill);
    pushKill(state, `${event.attacker.name} (${WEAPONS[event.attacker.weapon].name})`, event.victim, event.part === 'head');
    if (state.bomb.carrier === event.victim && state.bomb.state === 'carried') {
      // The bomb drops where its carrier fell: the nearest attacker picks it up by walking near.
      state.bomb.state = 'dropped';
      state.bomb.pos = event.victim.pos.clone();
      state.bomb.carrier = null;
    }
  }
}

/** A dropped bomb returns to whoever walks within arm's reach of it. */
function pickupDroppedBomb(state) {
  if (state.bomb.state !== 'dropped') return;
  for (const character of state.characters) {
    if (!character.alive || character.team !== state.attackers) continue;
    if (character.pos.distanceTo(state.bomb.pos) < 1.2) {
      state.bomb.state = 'carried';
      state.bomb.carrier = character;
      character.hasBomb = true;
      return;
    }
  }
}

/**
 * One tick of the match layer. Player intents arrive as `intent`:
 * { buy: id, plant, defuse, throwGrenade } — the input layer decides what they mean.
 */
export function stepMatch(state, dt, effects, intent) {
  state.time += dt;
  state.phaseLeft -= dt;
  state.roundTime += dt;

  if (state.phase === 'buy') {
    botBuy(state);
    applyBuy(state, intent.buy);
    if (state.phaseLeft <= 0) {
      state.phase = 'live';
      state.phaseLeft = ROUND_LIVE_SECONDS;
      if (state.bomb.site === null) state.bomb.site = Math.random() < 0.5 ? SITE_A : SITE_B;
      effects.roundLive();
    }
    return;
  }

  if (state.phase === 'roundEnd') {
    if (state.phaseLeft <= 0 && state.matchOver) {
      state.phase = 'matchEnd';
      state.winner = state.score.jackals > state.score.vipers ? TEAM.JACKALS : TEAM.VIPERS;
      return;
    }
    if (state.phaseLeft <= 0) {
      // Halftime at the halfway point: teams swap ends.
      if (state.round === Math.floor(MAX_ROUNDS / 2)) {
        const swap = state.attackers;
        state.attackers = state.defenders;
        state.defenders = swap;
      }
      state.round += 1;
      startRound(state, effects);
    }
    return;
  }

  if (state.phase !== 'live') return;

  pickupDroppedBomb(state);

  // The carrier announces the target site by walking into it first; default to the nearer one.
  if (state.bomb.state === 'carried' && state.bomb.site === null) {
    state.bomb.site = Math.random() < 0.5 ? SITE_A : SITE_B;
  }
  if (state.pendingPlant && state.bomb.state === 'carried') {
    const planter = state.pendingPlant;
    if (planter.alive && inSite(state.bomb.site ?? SITE_A, planter.pos.x, planter.pos.z)) {
      planter.planting += dt;
      effects.plantProgress(planter.planting / PLANT_SECONDS, planter);
      if (planter.planting >= PLANT_SECONDS) {
        state.bomb.state = 'planted';
        state.bomb.pos = planter.pos.clone().setY(0);
        state.bomb.carrier = null;
        planter.hasBomb = false;
        state.bomb.plantedBy = planter;
        planter.planting = 0;
        grantMoney(planter, REWARDS.plant);
        effects.bombPlanted(state.bomb.pos);
      }
    }
  }
  if (state.pendingDefuse && state.bomb.state === 'planted') {
    const defuser = state.pendingDefuse;
    defuser.defusing += dt;
    effects.defuseProgress(defuser.defusing / DEFUSE_SECONDS, defuser);
    if (defuser.defusing >= DEFUSE_SECONDS) {
      state.bomb.state = 'defused';
      grantMoney(defuser, REWARDS.defuse);
      endRound(state, state.defenders, 'defuse');
      return;
    }
  }
  if (state.bomb.state === 'planted') {
    state.bomb.timer -= dt;
    if (state.bomb.timer <= 0) {
      explodeBomb(state, effects);
      return;
    }
  } else if (state.phaseLeft <= 0 && state.bomb.state !== 'planted') {
    endRound(state, state.defenders, 'time');
    return;
  }

  if (!checkTeamWipe(state)) {
    // A live round can also end by the clock; handled above only when no bomb is down.
  }
}
