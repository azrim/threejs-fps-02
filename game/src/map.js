// The Kiln, CINDERPOINT's one map: a compact three-lane plan — mid, the A corridor east, the
// B corridor west — with the attackers' court in the south, the defenders' court in the north
// and one bomb site on each flank. Built from boxes: every box is a collider for movement and
// a surface a bullet stops on. Plain geometry, no textures.
import * as THREE from 'three';
import { PAL } from './palette.js';

// Internal walls as {x, z, w, d, h}: centre, size, height. The compiler boxes them. Exported
// for the minimap, which draws the same plan at 1/80 scale.
export const WALLS = [
  // Attacker court walls with two gates: mid (x -4..4) and the lane mouths.
  { x: -13, z: 22, w: 18, d: 0.6, h: 4 },   // west of the mid gate
  { x: 13, z: 22, w: 18, d: 0.6, h: 4 },    // east of the mid gate
  { x: -33.5, z: 27.5, w: 11, d: 0.6, h: 4 }, // court west wall, south half
  { x: 33.5, z: 27.5, w: 11, d: 0.6, h: 4 },
  // Mid corridor: two long walls with a broken middle (the connector gap).
  { x: -4.3, z: 14.5, w: 0.6, d: 13, h: 4 },
  { x: 4.3, z: 14.5, w: 0.6, d: 13, h: 4 },
  { x: -4.3, z: -6.5, w: 0.6, d: 11, h: 4 },
  { x: 4.3, z: -6.5, w: 0.6, d: 11, h: 4 },
  // Mid nub: the corner both sides fight around.
  { x: 0, z: 3.2, w: 3.2, d: 0.6, h: 4 },
  // A corridor walls (east): from the lane mouth to site A.
  { x: 21.5, z: 6, w: 0.6, d: 30, h: 4 },
  { x: 15.5, z: -8.5, w: 11, d: 0.6, h: 4 },
  // B corridor walls (west), mirrored.
  { x: -21.5, z: 6, w: 0.6, d: 30, h: 4 },
  { x: -15.5, z: -8.5, w: 11, d: 0.6, h: 4 },
  // Site A walls: a room open to the north court through two doors.
  { x: 24.5, z: -19.75, w: 13, d: 0.6, h: 4 },
  { x: 30.5, z: -26, w: 0.6, d: 12, h: 4 },
  { x: 18.5, z: -30.5, w: 23, d: 0.6, h: 4 },
  // Site B walls, mirrored.
  { x: -24.5, z: -19.75, w: 13, d: 0.6, h: 4 },
  { x: -30.5, z: -26, w: 0.6, d: 12, h: 4 },
  { x: -18.5, z: -30.5, w: 23, d: 0.6, h: 4 },
  // North court spine: the wall the defenders peek along, with a mid door.
  { x: -12.5, z: -14, w: 15, d: 0.6, h: 4 },
  { x: 12.5, z: -14, w: 15, d: 0.6, h: 4 },
];

// Cover crates as {x, z, s, h, dark}: square footprints, jumpable at 0.9, full cover at 1.8.
const CRATES = [
  { x: 0, z: 9.5, s: 1.8, h: 1.1 }, { x: 2.2, z: 9.5, s: 1.8, h: 1.1 },
  { x: -2.6, z: -2.5, s: 1.9, h: 1.8, dark: true },
  { x: 18.5, z: 16, s: 1.8, h: 1.1 }, { x: 18.5, z: 13.6, s: 1.8, h: 1.8, dark: true },
  { x: -18.5, z: 16, s: 1.8, h: 1.1 }, { x: -18.5, z: 13.6, s: 1.8, h: 1.8, dark: true },
  { x: 24, z: -16.5, s: 2.2, h: 1.1 }, { x: 26.4, z: -16.5, s: 2.2, h: 1.8, dark: true },
  { x: 21, z: -24, s: 1.8, h: 1.1 },
  { x: -24, z: -16.5, s: 2.2, h: 1.1 }, { x: -26.4, z: -16.5, s: 2.2, h: 1.8, dark: true },
  { x: -21, z: -24, s: 1.8, h: 1.1 },
  { x: 8.5, z: -10, s: 1.8, h: 1.8, dark: true },
  { x: -8.5, z: -10, s: 1.8, h: 1.8, dark: true },
  { x: 0, z: -20, s: 1.8, h: 1.1 },
];

export const SITE_A = { minX: 19, maxX: 29, minZ: -27, maxZ: -20.5, name: 'A' };
export const SITE_B = { minX: -29, maxX: -19, minZ: -27, maxZ: -20.5, name: 'B' };

export const ATTACKER_SPAWNS = [
  [-6.5, 27], [-3.2, 28.5], [0, 26.5], [3.2, 28.5], [6.5, 27],
];
export const DEFENDER_SPAWNS = [
  [-6.5, -28.5], [-3.2, -27], [0, -28.8], [3.2, -27], [6.5, -28.5],
];

// Bot routes: node coordinates and, by index, the edges. Lane runs: spawn court -> lane ->
// site; the mid spur splits at the connector gap. Bots walk node to node, so the graph is
// the map's play promise: corners, doors and sightlines.
export const NODES = [
  [0, 24],      // 0 attacker court centre
  [-3.4, 18],   // 1 mid south door
  [3.4, 18],    // 2 mid south door east side
  [0, 8],       // 3 mid court
  [-2.6, 1.5],  // 4 mid corner west
  [2.6, 6.5],   // 5 mid corner east
  [-2.6, -5],   // 6 mid north
  [0, -17],     // 7 mid north door
  [0, -22.5],   // 8 north court
  [18.5, 20.5], // 9 A lane mouth
  [18.5, 6],    // 10 A lane mid
  [18.5, -12],  // 11 A lane end
  [24, -20],    // 12 site A approach
  [24, -23.5],  // 13 site A plant
  [-18.5, 20.5],// 14 B lane mouth
  [-18.5, 6],   // 15 B lane mid
  [-18.5, -12], // 16 B lane end
  [-24, -20],   // 17 site B approach
  [-24, -23.5], // 18 site B plant
  [-8, -17.5],  // 19 north door west
  [8, -17.5],   // 20 north door east
  [28, -17],    // 21 site A back door
  [12.5, -20],  // 22 A court west
  [-12.5, -20], // 23 B court east
];
export const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 5], [4, 3], [4, 6], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12], [12, 13], [2, 9], [1, 14], [14, 15], [15, 16], [16, 17], [17, 18],
  [8, 19], [8, 20], [19, 7], [20, 7], [19, 16], [20, 11], [12, 21], [21, 22], [22, 8], [17, 23], [23, 8],
];

export function inSite(site, x, z) {
  return x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const key of ['ground', 'wall', 'wallDark', 'crate', 'crateDark', 'metal', 'accent', 'siteA', 'siteB']) {
    materials[key] = new THREE.MeshStandardMaterial({ color: new THREE.Color(PAL[key]), roughness: 0.9, metalness: 0.04 });
  }
  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const bounds = new THREE.Box3().setFromObject(mesh);
    colliders.push(bounds);
    shootables.push(mesh);
    return mesh;
  }

  // Ground and the four perimeter walls.
  box(80.6, 0.4, 64.6, 0, -0.2, 0, 'ground');
  box(0.6, 5, 64.6, -40.3, 2.5, 0, 'wallDark');
  box(0.6, 5, 64.6, 40.3, 2.5, 0, 'wallDark');
  box(80.6, 5, 0.6, 0, 2.5, -32.3, 'wallDark');
  box(80.6, 5, 0.6, 0, 2.5, 32.3, 'wallDark');
  for (const wall of WALLS) box(wall.w, wall.h, wall.d, wall.x, wall.h / 2, wall.z, 'wall');
  for (const crate of CRATES) {
    const half = crate.s / 2;
    box(crate.s, crate.h, crate.s, crate.x, crate.h / 2, crate.z, crate.dark ? 'crateDark' : 'crate');
    // A lid line: a thin darker slab on top reads as crate boards at a glance.
    box(crate.s + 0.08, 0.07, crate.s + 0.08, crate.x, crate.h + 0.035, crate.z, 'metal');
    void half;
  }

  // Bombsite decals: flat coloured plates with a painted letter made of boxes.
  for (const [site, material] of [[SITE_A, 'siteA'], [SITE_B, 'siteB']]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(site.maxX - site.minX, 0.05, site.maxZ - site.minZ), materials[material]);
    plate.position.set((site.minX + site.maxX) / 2, 0.026, (site.minZ + site.maxZ) / 2);
    plate.receiveShadow = true;
    group.add(plate);
    const letter = material === 'siteA' ? SITE_A_LETTER : SITE_B_LETTER;
    for (const [lx, lz, lw, ld] of letter) {
      box(lw, 0.06, ld, site.minX + 3 + lx, 0.03, site.minZ + 2.5 + lz, 'wallDark');
    }
  }

  // Light: a warm key over the whole map, a bright cool sky fill, and fog that hushes the far
  // court without swallowing it.
  const sky = new THREE.HemisphereLight(new THREE.Color(0xdfe6f2), new THREE.Color(0x9a938a), 2.6);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xfff0d8), 3.4);
  key.position.set(-18, 26, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -46;
  key.shadow.camera.right = 46;
  key.shadow.camera.top = 40;
  key.shadow.camera.bottom = -40;
  key.shadow.camera.far = 100;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0xaebdd4), 0.7);
  fill.position.set(20, 14, -20);
  scene.add(fill);

  return { colliders, shootables, group };
}

// Letters painted on the sites, as box runs [dx, dz, w, d] within each site plate.
const SITE_A_LETTER = [[0, 0, 0.7, 3], [0.35, 0, 1.6, 0.7], [0.35, 1.15, 1.6, 0.7], [0.35, 2.3, 1.6, 0.7]];
const SITE_B_LETTER = [[0, 0, 0.7, 3], [1.25, 0, 0.7, 1.5], [0.35, 0.35, 1.25, 0.7], [1.25, 2.3, 0.7, 0.7], [0.35, 2.3, 1.25, 0.7]];
