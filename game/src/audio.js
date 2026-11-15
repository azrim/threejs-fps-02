// All the sound, synthesised where it stands: no audio files. One AudioContext created on the
// first user gesture, a shared noise buffer, and short voiced envelopes per event. Gunshots
// differ by weapon in filter and length; distance turns shots down, never off.
let context = null;
let noiseBuffer = null;
let master = null;

function ensureContext() {
  if (context !== null) return true;
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (typeof Ctx !== 'function') return false;
  context = new Ctx();
  master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);
  const length = context.sampleRate * 0.5;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const channel = noiseBuffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) channel[index] = Math.random() * 2 - 1;
  return true;
}

export function unlockAudio() {
  if (ensureContext() && context.state === 'suspended') context.resume();
}

function burst(duration, filterHz, gainValue, delay = 0, sweepTo = null) {
  if (!ensureContext()) return;
  const time = context.currentTime + delay;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterHz, time);
  if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(sweepTo, time + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(gainValue, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(time);
  source.stop(time + duration + 0.02);
}

function tone(frequency, duration, gainValue, type = 'sine', delay = 0, slideTo = null) {
  if (!ensureContext()) return;
  const time = context.currentTime + delay;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);
  if (slideTo !== null) oscillator.frequency.exponentialRampToValueAtTime(slideTo, time + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(gainValue, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.02);
}

const GUN_PROFILE = {
  pistol: { length: 0.14, filter: 2600, gain: 0.5 },
  smg: { length: 0.1, filter: 3200, gain: 0.4 },
  rifle: { length: 0.2, filter: 1800, gain: 0.6 },
};

function distanceGain(worldDistance) {
  return Math.max(0.06, 1 - worldDistance / 60);
}

export const audio = {
  shot(weaponId, worldDistance) {
    const profile = GUN_PROFILE[weaponId] ?? GUN_PROFILE.rifle;
    burst(profile.length, profile.filter, profile.gain * distanceGain(worldDistance), 0, 300);
    tone(140, 0.08, 0.12 * distanceGain(worldDistance), 'triangle');
  },
  reload() {
    tone(700, 0.05, 0.12, 'square');
    tone(500, 0.05, 0.1, 'square', 0.12);
  },
  hit() {
    tone(1150, 0.05, 0.16, 'square');
  },
  headshot() {
    tone(1600, 0.07, 0.2, 'square');
    tone(2100, 0.06, 0.14, 'square', 0.05);
  },
  death() {
    tone(300, 0.3, 0.18, 'sawtooth', 0, 90);
  },
  footstep() {
    burst(0.05, 500, 0.05);
  },
  beep(urgent) {
    tone(urgent ? 1750 : 1200, 0.07, 0.14, 'square');
  },
  plant() {
    tone(900, 0.09, 0.12, 'square');
    tone(900, 0.09, 0.12, 'square', 0.14);
  },
  defuseTick() {
    tone(600, 0.05, 0.1, 'sine');
  },
  explosion() {
    burst(1.1, 400, 0.9, 0, 60);
    tone(70, 0.9, 0.4, 'triangle', 0, 34);
  },
  buy() {
    tone(950, 0.06, 0.1, 'sine');
  },
  denied() {
    tone(220, 0.09, 0.12, 'square');
  },
  roundWin() {
    tone(520, 0.14, 0.16, 'triangle');
    tone(780, 0.22, 0.16, 'triangle', 0.14);
  },
  roundLoss() {
    tone(360, 0.18, 0.16, 'triangle');
    tone(240, 0.28, 0.16, 'triangle', 0.16);
  },
  start() {
    tone(660, 0.09, 0.12, 'sine');
    tone(880, 0.12, 0.12, 'sine', 0.1);
  },
};
