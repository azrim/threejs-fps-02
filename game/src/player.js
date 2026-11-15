// The player's body: mouse look, WASD with acceleration and friction, crouch, jump and the
// shared box-vs-map movement. The player is one of the match's characters — same health, same
// weapons, same damage — only with hands and eyes.
import * as THREE from 'three';
import { colliderAt, moveBody, STAND_HEIGHT, CROUCH_HEIGHT, STAND_EYE, CROUCH_EYE } from './physics.js';
import { startReload, finishReload, coolSpread, WEAPONS, fireShot } from './weapons.js';

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

const wish = new THREE.Vector3();

/** Keyboard and mouse into one small input record; pointer lock turns the mouse into look. */
export function createInput(canvas) {
  const keys = new Set();
  const input = { keys, locked: false, lookX: 0, lookY: 0, firing: false, requestedFire: false };
  window.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!input.locked) return;
    input.lookX += event.movementX;
    input.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!input.locked || event.button !== 0) return;
    input.firing = true;
    input.requestedFire = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      keys.clear();
      input.firing = false;
    }
  });
  input.requestLock = () => canvas.requestPointerLock();
  return input;
}

export function createPlayerController(colliders, onShotEvents, effects) {
  return {
    /** One fixed step for the player character: look was already applied; this is body only. */
    step(state, dt, input, fireContext) {
      const player = state.player;
      const keys = input.keys;
      if (!player.alive || state.phase !== 'live') {
        if (player.alive && state.phase === 'buy') {
          // Walk inside the spawn court during buy time; the court walls keep it honest.
          const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
          const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
          moveWish(player, forward, strafe, WALK_SPEED * 0.7, dt, colliders);
        } else {
          player.velocity.x = 0;
          player.velocity.z = 0;
          player.velocity.y = Math.max(-30, player.velocity.y - GRAVITY * dt);
          moveBody(colliders, player.pos, player.velocity, dt, player.height);
        }
        return;
      }

      const crouchKey = keys.has('ControlLeft') || keys.has('KeyC');
      if (crouchKey && !player.crouching) {
        player.crouching = true;
        player.height = CROUCH_HEIGHT;
      } else if (!crouchKey && player.crouching && !colliderAt(colliders, player.pos.x, player.pos.y, player.pos.z, STAND_HEIGHT, 0.02)) {
        player.crouching = false;
        player.height = STAND_HEIGHT;
      }
      player.eye += ((player.crouching ? CROUCH_EYE : STAND_EYE) - player.eye) * Math.min(1, dt * 12);

      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const walking = keys.has('ShiftLeft');
      const speed = player.crouching ? CROUCH_SPEED : walking ? WALK_SPEED * 0.52 : WALK_SPEED;
      moveWish(player, forward, strafe, speed, dt, colliders);

      if (keys.has('Space') && player.onGround) {
        player.velocity.y = JUMP_SPEED;
        player.onGround = false;
      }
      player.onGround = moveBody(colliders, player.pos, player.velocity, dt, player.height);

      if (player.reloadLeft > 0) {
        player.reloadLeft -= dt;
        if (player.reloadLeft <= 0) finishReload(player);
      }
      player.cooldown = Math.max(0, player.cooldown - dt);
      coolSpread(player, dt);

      const weapon = WEAPONS[player.weapon];
      const wantsFire = weapon.auto ? input.firing : input.requestedFire;
      input.requestedFire = false;
      if (wantsFire && player.mag > 0 && player.cooldown === 0 && player.reloadLeft === 0) {
        fireShot(state, player, effects, fireContext.origin(), null);
        onShotEvents(state, player);
        fireContext.kick(weapon);
        if (player.mag === 0) startReload(player);
      }
    },
    look(player, input) {
      player.yaw -= input.lookX * 0.0022;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - input.lookY * 0.0022));
      input.lookX = 0;
      input.lookY = 0;
    },
  };
}

function moveWish(player, forward, strafe, speed, dt, colliders) {
  wish.set(0, 0, 0);
  if (forward || strafe) {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
  }
  const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
  player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
  if (player.onGround && !forward && !strafe) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    player.velocity.x *= damp;
    player.velocity.z *= damp;
  }
  player.velocity.y = Math.max(-30, player.velocity.y - GRAVITY * dt);
  player.onGround = moveBody(colliders, player.pos, player.velocity, dt, player.height);
}
