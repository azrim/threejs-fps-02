// threejs-fps-02 entry program: hand the built game to the grader.
//
// The game is everything under game/ (static ES modules, three.js vendored) and the four
// screenshots under screenshots/. This program copies both into /output and writes
// /output/dossier.json with the kit's vendored dossier builder, which walks the game's
// source and caps its text where the sealed gate caps it.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json), restated so a refused entry is refused here:
// at most 4 screenshots of 256 KiB each, at most 993 files and 48 MiB of game, and the
// dossier's source text at 160 KiB.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
