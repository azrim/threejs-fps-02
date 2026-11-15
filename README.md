# CINDERPOINT

A round-based tactical FPS for the browser, built on three.js 0.187: two teams of five, one
map ("The Kiln"), short rounds won by elimination or by the bomb, money between rounds and a
buy menu, gunfire where stopping to aim pays. Runs offline from static files — no build step,
no server, no assets beyond geometry and a synthesised soundscape.

Play: serve `game/` from any static file server (`node serve.ts` starts one on :8080) and open
`index.html`. WASD to move, mouse to aim, click to fire, `R` reload, `G` grenade, `E` (held)
plant or defuse, `1`–`5` buy during the buy phase, `Ctrl` crouch, `Shift` walk, `Space` jump.

## How it fits together

| Module | Job |
| --- | --- |
| `state.js` | The whole match's state in one object: phases, score, money, the bomb, every character. |
| `map.js` | The Kiln as boxes — colliders, sightlines, spawns, bombsites, the node graph bots walk. |
| `physics.js` | Box-vs-map movement, the slab raycast, line of sight, the two-box body. |
| `weapons.js` | Weapon definitions and the one shared hitscan: spray, damage, armour, headshots. |
| `player.js` | Look, movement, crouch, jump, reload and the trigger — the player is one character among ten. |
| `bots.js` | The bot mind: routes over the node graph, sight, settling aim, bursts, hearing, planting, defusing. |
| `rounds.js` | The phase machine, rewards, the plant and defuse timers, win conditions. |
| `view.js` | The three.js scene glue: bodies, pooled tracers, wall chips, blood, grenade meshes. |
| `viewmodel.js` | The first-person weapon and its motion. |
| `hud.js` | DOM HUD, buy grid, banner, progress bars, minimap, end board. |
| `audio.js` | Every sound synthesised on a WebAudio context — no files. |
| `main.js` | Bootstrap and the fixed-step loop (64 Hz sim, render reads the latest state). |

The simulation steps on a fixed accumulator, keeps no allocations in its hot loops, and keeps
all mutable state in `state.js`; the renderer and the HUD only read it.

## Original work

Map, names, weapon silhouettes, palette and sound are original to this repository and drawn
only from code: boxes with flat materials, DOM overlays, WebAudio synthesis. No models, no
textures, no third-party assets besides three.js (vendored under `game/vendor/three/`).

MIT licensed. See `LICENSE`.
