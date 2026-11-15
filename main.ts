// The program half of the CINDERPOINT entry: it is what the grader runs to receive the game.
//
// game/ is the playable half — plain ES modules with three.js vendored under game/vendor/three —
// and screenshots/ holds the four captures. Both trees are copied into /output as they are, and
// then /output/dossier.json is written through the kit's buildDossier, the exact library the
// scorer uses, so the dossier the judge reads is the dossier this repository can reproduce.
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

// The gate's numbers, restated from reference/gate.json so this program refuses locally what
// the scorer refuses on arrival: four captures at 256 KiB each, 993 game files at 48 MiB in
// all, and 160 KiB of source text in the dossier.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
