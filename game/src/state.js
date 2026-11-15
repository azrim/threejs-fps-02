// The whole game's state in one place: the match, the round, the bomb, every character and
// their money. Modules read and write this object; nothing keeps a private copy of the truth.
export const TEAM = { JACKALS: 'jackals', VIPERS: 'vipers' };

export function createCharacter(team, name, isPlayer) {
  return {
    team,
    name,
    isPlayer,
    alive: true,
    health: 100,
    armor: 0,
    money: 800,
    pos: null,        // THREE.Vector3, feet; the sim owns it
    velocity: null,   // THREE.Vector3
    yaw: 0,
    pitch: 0,
    height: 1.72,
    eye: 1.6,
    crouching: false,
    onGround: true,
    weapon: 'rifle',
    mag: 0,
    reserve: 0,
    grenades: 0,
    reloadLeft: 0,
    cooldown: 0,
    reloadQueued: false,
    spreadHeat: 0,    // grows per shot, decays over time: burst accuracy
    lastShotAt: 0,
    kills: 0,
    deaths: 0,
    hasBomb: false,
    planting: 0,      // seconds left in the plant/defuse action, 0 when not acting
    defusing: 0,
    // bot mind
    node: -1,
    path: [],
    target: null,     // character this bot fires at
    reactAt: 0,       // seconds into the round when its aim settles
    burst: 0,
    thinkAt: 0,
    holdUntil: 0,
    deathsThisRound: 0,
  };
}

export function createState() {
  return {
    phase: 'menu',       // menu | buy | live | roundEnd | matchEnd
    phaseLeft: 0,
    round: 1,
    score: { jackals: 0, vipers: 0 },
    lossStreak: { jackals: 0, vipers: 0 },
    characters: [],
    player: null,
    bomb: {
      state: 'idle',     // idle | carried | planted | defused | exploded
      carrier: null,     // character
      pos: null,         // THREE.Vector3 when planted
      timer: 40,         // seconds to explosion once planted
      beepAt: 0,
      defuser: null,
      defuseLeft: 0,
      site: null,        // 'A' | 'B'
    },
    roundTime: 0,        // seconds elapsed in the current phase
    killfeed: [],
    winner: null,        // team that won the match
    time: 0,             // total sim seconds
  };
}

export const ROUND_BUY_SECONDS = 8;
export const ROUND_LIVE_SECONDS = 100;
export const ROUND_END_SECONDS = 4;
export const BOMB_SECONDS = 40;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 6;
export const WIN_ROUNDS = 8;
export const MAX_ROUNDS = 15;

export const REWARDS = {
  start: 800,
  kill: 300,
  win: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plant: 800,
  defuse: 300,
  cap: 9000,
};
