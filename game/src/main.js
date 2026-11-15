// CINDERPOINT's spine: build the scene and the match, then run the fixed-step simulation and
// the render loop. The sim steps at 64 Hz on an accumulator; rendering interpolates nothing
// because the tick is faster than most displays — it just draws the latest state. Input intents
// land here and are handed to the layer that owns them.
import * as THREE from 'three';
import { createMap, SITE_A, SITE_B, inSite, WALLS } from './map.js';
import { raycastMap, eyeOf } from './physics.js';
import { createView, createEffects, attachBody, syncBodies } from './view.js';
import { createViewModel } from './viewmodel.js';
import { createMatch, startRound, stepMatch, onEvents } from './rounds.js';
import { stepBot, briefBots } from './bots.js';
import { createInput, createPlayerController } from './player.js';
import { WEAPONS, giveWeapon } from './weapons.js';
import { createHud } from './hud.js';
import { audio, unlockAudio } from './audio.js';
import { MAX_ROUNDS } from './state.js';

const TICK = 1 / 64;

const mount = document.getElementById('game');
const gameCanvas = document.createElement('canvas');
mount.appendChild(gameCanvas);
const view = createView(gameCanvas);
const { scene, camera, renderer } = view;
const map = createMap(scene);
const state = createMatch();
const effects = createEffects(scene, map.colliders);
const hud = createHud();
const input = createInput(renderer.domElement);
const playerController = createPlayerController(map.colliders, onShotEvents, effects);
const viewmodel = createViewModel(camera);

for (const character of state.characters) {
  if (!character.isPlayer) attachBody(scene, character);
}

// The grenade the player throws: one live at a time keeps the world honest and the code small.
const grenade = { live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0 };
const GRENADE_SPEED = 15;
const GRENADE_FUSE = 1.7;

const fireContext = {
  origin() {
    return eyeOf(state.player).clone();
  },
  kick(weapon) {
    viewmodel.shot();
    state.player.pitch = Math.min(1.45, state.player.pitch + weapon.recoilPitch);
    state.player.yaw += (Math.random() - 0.5) * 2 * weapon.recoilYaw;
  },
};

/** The weapons layer's view of the world: raycast plus every visual the shot deserves. */
const shotEffects = {
  raycastMap(origin, direction, maxDist) {
    return raycastMap(origin, direction, maxDist, map.colliders);
  },
  shotFired(shooter, origin, direction, dist, victim, mapHit) {
    const muzzle = shooter.isPlayer
      ? new THREE.Vector3(0.1, -0.1, -0.5).applyQuaternion(camera.quaternion).add(origin)
      : origin.clone();
    const end = new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(dist).add(origin);
    effects.spawnTracer(muzzle, end);
    if (victim !== null) {
      const hitPoint = end.clone();
      effects.blood(hitPoint, new THREE.Vector3(direction.x, 0.4, direction.z));
    } else if (mapHit !== null) {
      effects.impact(mapHit.point, mapHit.normal);
    }
    const listener = state.player;
    const distance = listener.alive ? listener.pos.distanceTo(shooter.pos) : 30;
    audio.shot(shooter.weapon, distance);
    if (shooter.team !== state.player.team) lastHeard = { x: shooter.pos.x, z: shooter.pos.z };
    if (shooter.isPlayer) {
      const weapon = WEAPONS[shooter.weapon];
      shooter.pitch = Math.min(1.45, shooter.pitch + weapon.recoilPitch);
      shooter.yaw += (Math.random() - 0.5) * 2 * weapon.recoilYaw;
    }
  },
};

function onShotEvents(shooter, events) {
  onEvents(state, events);
  for (const event of events) {
    if (event.kind === 'hit') {
      if (shooter.isPlayer) {
        hud.hitMarker(event.victim.health <= 0);
        if (event.part === 'head') audio.headshot();
        else audio.hit();
      }
      if (event.victim.health <= 0) audio.death();
    }
  }
}

// Rounds layer bridge: its `effects` speak for the presentation side.
const matchEffects = {
  raycastMap: shotEffects.raycastMap,
  shotFired: shotEffects.shotFired,
  onShotEvents,
  roundLive() {
    hud.hideBanner();
    audio.start();
    briefBots(state, state.bomb.site ?? SITE_A);
    hud.closeBuy();
  },
  roundEnd(winner, reason) {
    hud.bannerFor(winner, reason, state.score.jackals, state.score.vipers);
    if (winner === state.player.team) audio.roundWin();
    else audio.roundLoss();
    if (state.matchOver) {
      hud.showScoreboard(state);
      hud.showOverlay('end');
      document.exitPointerLock();
    }
  },
  bombPlanted(pos) {
    audio.plant();
    effects.spawnGrenade('bomb');
    effects.moveGrenade('bomb', pos);
    hud.bombHintFor('The bomb is down. Defend it.');
  },
  bombRemove() {
    effects.removeGrenade('bomb');
  },
  bombExploded(pos) {
    audio.explosion();
    effects.removeGrenade('bomb');
    for (let index = 0; index < 8; index += 1) {
      effects.blood(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4)), new THREE.Vector3(0, 2, 0));
    }
  },
  plantProgress(fraction, character) {
    if (character.isPlayer || state.player.pos.distanceTo(character.pos) < 14) {
      hud.showProgress('Planting the bomb', fraction);
    }
  },
  defuseProgress(fraction, character) {
    if (character.isPlayer || state.player.pos.distanceTo(character.pos) < 14) {
      hud.showProgress('Defusing the bomb', fraction);
    }
  },
};

let lastHeard = null; // the latest enemy gunshot, so bots without a target turn towards it
let grenadeThrowQueued = false;
let plantHeld = false;
let defuseHeld = false;
let buyQueued = null;

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyG') grenadeThrowQueued = true;
  if (event.code === 'KeyE') {
    plantHeld = true;
    defuseHeld = true;
  }
  if (event.code === 'KeyR') state.player.reloadQueued = true;
  if (event.code === 'Digit1') buyQueued = 'pistol';
  if (event.code === 'Digit2') buyQueued = 'smg';
  if (event.code === 'Digit3') buyQueued = 'rifle';
  if (event.code === 'Digit4') buyQueued = 'armor';
  if (event.code === 'Digit5') buyQueued = 'grenade';
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyE') {
    plantHeld = false;
    defuseHeld = false;
  }
});

function throwGrenade() {
  const player = state.player;
  if (!player.alive || player.grenades <= 0 || state.phase !== 'live') return;
  player.grenades -= 1;
  grenade.live = true;
  grenade.fuse = GRENADE_FUSE;
  eyeOf(player, grenade.pos);
  const cp = Math.cos(player.pitch);
  grenade.vel.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch) + 0.28, -Math.cos(player.yaw) * cp).multiplyScalar(GRENADE_SPEED);
  effects.spawnGrenade('live');
}

function stepGrenade(dt) {
  if (!grenade.live) return;
  grenade.fuse -= dt;
  grenade.vel.y -= 18 * dt;
  const next = grenade.pos.clone().addScaledVector(grenade.vel, dt);
  const down = raycastMap(grenade.pos, grenade.vel.clone().normalize(), grenade.pos.distanceTo(next), map.colliders);
  if (down !== null) {
    // Bounce: flip the dominant axis and lose some heat.
    if (down.normal.y !== 0) grenade.vel.y = Math.abs(grenade.vel.y) * 0.38;
    else if (down.normal.x !== 0) grenade.vel.x *= -0.42;
    else grenade.vel.z *= -0.42;
    grenade.pos.copy(down.point).addScaledVector(down.normal, 0.05);
  } else {
    grenade.pos.copy(next);
  }
  effects.moveGrenade('live', grenade.pos);
  if (grenade.fuse <= 0) {
    grenade.live = false;
    effects.removeGrenade('live');
    for (const character of state.characters) {
      if (!character.alive) continue;
      const distance = character.pos.distanceTo(grenade.pos);
      if (distance < 7) {
        const damage = Math.round(140 * Math.max(0.1, 1 - distance / 7));
        character.health -= damage;
        if (character.health <= 0) {
          character.health = 0;
          character.alive = false;
          character.deaths += 1;
          onEvents(state, [{ kind: 'kill', attacker: state.player, victim: character, part: 'body' }]);
        }
      }
    }
    audio.explosion();
    for (let index = 0; index < 6; index += 1) {
      effects.blood(grenade.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3)), new THREE.Vector3(0, 2.4, 0));
    }
  }
}

let overlayMode = 'menu';
let minimapClock = 0;
let bombBeepClock = 0;

function simTick(dt) {
  if (state.frozen) return; // a screenshot composition holds its pose
  if (state.phase === 'menu' || state.phase === 'matchEnd') return;

  // Player look runs on the sim tick so sensitivity is frame-rate independent.
  playerController.look(state.player, input);

  const intent = { buy: buyQueued };
  buyQueued = null;
  if (state.player.reloadQueued) {
    state.player.reloadQueued = false;
    const weapon = WEAPONS[state.player.weapon];
    if (state.player.reloadLeft <= 0 && state.player.mag < weapon.mag && state.player.reserve > 0) {
      state.player.reloadLeft = weapon.reloadTime;
      audio.reload();
    }
  }
  if (grenadeThrowQueued) {
    grenadeThrowQueued = false;
    throwGrenade();
  }

  stepMatch(state, dt, matchEffects, intent);
  if (state.phase === 'buy' && !hud.isBuyOpen()) {
    hud.openBuy(state.player.money, state.player.weapon, state.player.armor > 0, state.player.grenades > 0);
  }
  if (state.phase === 'live' || state.phase === 'buy') {
    playerController.step(state, dt, input, fireContext);
    for (const character of state.characters) {
      if (!character.isPlayer) stepBot(character, state, dt, map.colliders, shotEffects, lastHeard);
    }
    lastHeard = null;
  }
  stepGrenade(dt);
  effects.step(dt);
  viewmodel.step(dt, Math.hypot(state.player.velocity.x, state.player.velocity.z));

  // Player plant/defuse: held E does what the round layer advances.
  if (plantHeld && state.phase === 'live' && state.player.alive) {
    const bomb = state.bomb;
    if (bomb.state === 'carried' && bomb.carrier === state.player && inSite(bomb.site ?? SITE_A, state.player.pos.x, state.player.pos.z)) {
      state.pendingPlant = state.player;
    } else if (bomb.state === 'planted' && state.player.team === state.defenders && state.player.pos.distanceTo(bomb.pos) < 1.7) {
      state.pendingDefuse = state.player;
    }
  } else {
    state.player.planting = 0;
    state.player.defusing = 0;
  }

  // Bomb beeps quicken as the timer burns.
  if (state.bomb.state === 'planted') {
    bombBeepClock -= dt;
    if (bombBeepClock <= 0) {
      audio.beep(state.bomb.timer < 10);
      bombBeepClock = Math.max(0.12, state.bomb.timer / 40 * 1.1);
    }
  }
}

function drawHud() {
  const player = state.player;
  hud.setHealth(player.health);
  hud.setArmor(player.armor);
  hud.setAmmo(player.mag, player.reserve, WEAPONS[player.weapon].name);
  hud.setMoney(player.money);
  hud.setGrenades(player.grenades);
  const clock = state.bomb.state === 'planted' ? state.bomb.timer : state.phaseLeft;
  hud.setClock(clock, state.phase);
  hud.setScore(state.score.jackals, state.score.vipers, state.round, MAX_ROUNDS);
  hud.setKillfeed(state.killfeed);
  const spread = player.alive && state.phase === 'live'
    ? spreadOfPlayer()
    : 0.004;
  hud.crosshairSpread(spread);
  if (state.phase === 'live' && player.alive) {
    const bomb = state.bomb;
    if (bomb.state === 'carried' && bomb.carrier === player) {
      const site = bomb.site ?? SITE_A;
      hud.bombHintFor(inSite(site, player.pos.x, player.pos.z)
        ? 'Hold E to plant'
        : `You carry the bomb — head for site ${site.name}`);
    } else if (bomb.state === 'planted' && player.team === state.defenders && player.pos.distanceTo(bomb.pos) < 6) {
      hud.bombHintFor('Hold E to defuse');
    } else if (bomb.state === 'dropped' && player.team === state.attackers) {
      hud.bombHintFor('The bomb is down — pick it up');
    } else {
      hud.bombHintFor(null);
    }
  } else {
    hud.bombHintFor(null);
  }
  if (state.phase !== 'live') hud.hideProgress();
  minimapClock -= 1;
  if (minimapClock <= 0) {
    minimapClock = 6;
    hud.drawMinimap(WALLS, player, state.bomb, state.characters);
  }
}

function spreadOfPlayer() {
  const weapon = WEAPONS[state.player.weapon];
  const speed = Math.hypot(state.player.velocity.x, state.player.velocity.z);
  let spread = weapon.spreadBase;
  spread += Math.min(1, speed / 5.2) * weapon.spreadMove;
  if (!state.player.onGround) spread += weapon.spreadJump;
  if (state.player.crouching) spread *= 0.62;
  spread += state.player.spreadHeat;
  return spread;
}

function placeCamera() {
  const player = state.player;
  const eyeHeight = player.alive ? player.eye : 0.4;
  camera.position.set(player.pos.x, player.pos.y + eyeHeight, player.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

function frame() {
  requestAnimationFrame(frame);
  if (state.frozen) {
    document.title = `dbg cam=${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)} rot=${camera.rotation.x.toFixed(2)},${camera.rotation.y.toFixed(2)} p=${state.player.pos.x.toFixed(1)},${state.player.pos.y.toFixed(1)},${state.player.pos.z.toFixed(1)} phase=${state.phase} nades=${effects.grenadeCount ?? '-'}`;
  }
  const now = performance.now();
  let delta = (now - lastFrame) / 1000;
  lastFrame = now;
  if (delta > 0.1) delta = 0.1;
  accumulator += delta;
  let ticks = 0;
  while (accumulator >= TICK && ticks < 8) {
    simTick(TICK);
    accumulator -= TICK;
    ticks += 1;
  }
  syncBodies(state);
  placeCamera();
  drawHud();
  renderer.render(scene, camera);
}

let lastFrame = performance.now();
let accumulator = 0;

// Menu flow: the overlay button starts the match and asks for the pointer.
document.getElementById('play').addEventListener('click', () => {
  unlockAudio();
  startFromMenu();
});

function startFromMenu() {
  unlockAudio();
  if (state.phase === 'menu') {
    startRound(state, matchEffects);
    hud.hideOverlay();
    overlayMode = 'play';
    input.requestLock();
    return;
  }
  if (state.phase === 'matchEnd') {
    location.reload();
    return;
  }
  hud.hideOverlay();
  hud.hideScoreboard();
  input.requestLock();
}

// Screenshot presets: ?shot=N composes a moment of the real game and freezes it, so the
// entry's screenshots show true states the sim can reach.
function setupShot(number) {
  const player = state.player;
  state.phase = 'live';
  state.phaseLeft = 75;
  state.frozen = true;
  const place = (character, x, z, yaw) => {
    character.alive = true;
    character.pos.set(x, 0, z);
    character.yaw = yaw;
    character.velocity.set(0, 0, 0);
  };
  const viper = state.characters.filter((character) => character.team === 'vipers');
  const mate = state.characters.filter((character) => character.team === 'jackals' && !character.isPlayer);
  if (number === 1) {
    // The buy phase, board open.
    state.phase = 'buy';
    state.phaseLeft = 7;
    giveWeapon(player, 'pistol');
    hud.openBuy(player.money, player.weapon, false, false);
  } else if (number === 2) {
    // Mid fight: two vipers working the connector, the player at the corner.
    place(player, 0, 10, 0);
    player.weapon = 'rifle';
    giveWeapon(player, 'rifle');
    player.mag = 24;
    player.money = 2450;
    place(mate[0], -2.2, 4, 0);
    place(viper[0], 1.4, -6.5, Math.PI);
    place(viper[1], 14, -9, Math.PI * 0.8);
    place(viper[2], -14, -9, Math.PI * 1.2);
    state.bomb.site = SITE_A;
    state.bomb.carrier = mate[1];
    mate[1].hasBomb = true;
  } else if (number === 3) {
    // Site A taken: the bomb is down, a viper is caught in the open.
    place(player, 21.5, -20.5, Math.PI * 0.15);
    player.weapon = 'rifle';
    giveWeapon(player, 'rifle');
    player.mag = 19;
    place(viper[0], 26, -22.5, Math.PI);
    place(viper[1], 12, -18, Math.PI * 1.1);
    place(mate[0], 24, -17, 0);
    state.bomb.site = SITE_A;
    state.bomb.state = 'planted';
    state.bomb.pos = new THREE.Vector3(24, 0, -23.5);
    state.bomb.timer = 26;
    matchEffects.bombPlanted(state.bomb.pos);
  } else {
    // Round's end: the feed and the banner.
    place(player, 0, 8, 0);
    state.phase = 'roundEnd';
    state.phaseLeft = 3;
    state.roundWinner = 'jackals';
    state.roundReason = 'bomb';
    state.score.jackals = 5;
    state.score.vipers = 3;
    state.killfeed = [
      { attacker: 'You (RM-9)', victim: 'Fenn', headshot: true, roundTime: 41.2 },
      { attacker: 'Rook (Vektor-45)', victim: 'Moss', headshot: false, roundTime: 38.9 },
      { attacker: 'Kestrel (RM-9)', victim: 'Sable', headshot: false, roundTime: 36.4 },
    ];
    hud.bannerFor('jackals', 'bomb', 5, 3);
  }
}

document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    hud.hideOverlay();
  } else if (overlayMode === 'play' && state.phase !== 'matchEnd') {
    hud.showOverlay('pause');
  }
});

// Buy buttons are DOM: clicking one queues the same intent its key sends.
for (const button of document.querySelectorAll('#buy-menu button')) {
  button.addEventListener('click', () => {
    buyQueued = button.dataset.buy;
    audio.buy();
  });
}

const headlessParam = new URLSearchParams(location.search);
if (headlessParam.has('demo') || headlessParam.has('shot')) {
  // Headless capture: start straight into the match, no overlay, no pointer lock.
  startFromMenu();
  if (headlessParam.has('shot')) setupShot(Number(headlessParam.get('shot')));
} else {
  hud.showOverlay('menu');
}

frame();