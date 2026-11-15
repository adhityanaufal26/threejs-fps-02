// map.js — one job: the map. Layout data (walls, spawns, waypoints), the
// collision and line-of-sight math the sim uses, and the three.js meshes.
// Map: "Foundry Yard" — an industrial yard, 60 x 40 m. Ember spawns south,
// Ash spawns north, the reactor site sits north-centre. Two side lanes
// (west/east) plus a mid lane through the central press block.
import * as THREE from "three";

// A wall is an axis-aligned box: centre (x, z), half extents (hx, hz), height h.
export const WALLS = [
  // Perimeter.
  { x: 0, z: -20.5, hx: 31, hz: 0.5, h: 4.5 },
  { x: 0, z: 20.5, hx: 31, hz: 0.5, h: 4.5 },
  { x: -30.5, z: 0, hx: 0.5, hz: 21, h: 4.5 },
  { x: 30.5, z: 0, hx: 0.5, hz: 21, h: 4.5 },
  // Central press block — splits mid, forces a left/right choice.
  { x: 0, z: -2, hx: 3, hz: 2, h: 2.4 },
  // Mid lane cross-walls, each with a gap on one side.
  { x: -14, z: 2, hx: 1, hz: 6, h: 3.2 },
  { x: 14, z: -2, hx: 1, hz: 6, h: 3.2 },
  // Reactor site cover, two low blocks the defenders hold behind.
  { x: -8, z: -14, hx: 2, hz: 1, h: 2.0 },
  { x: 8, z: -14, hx: 2, hz: 1, h: 2.0 },
  // Spawn cover.
  { x: -10, z: 14, hx: 3, hz: 1, h: 2.0 },
  { x: 10, z: 14, hx: 3, hz: 1, h: 2.0 },
  // Crates: low cover, shootable over the top from standing.
  { x: -4, z: 6, hx: 1.5, hz: 1.5, h: 1.2 },
  { x: 5, z: 8, hx: 1.5, hz: 1.5, h: 1.2 },
  { x: -6, z: -8, hx: 1.5, hz: 1.5, h: 1.2 },
  { x: 6, z: -8, hx: 1.5, hz: 1.5, h: 1.2 },
  // Lane blocks.
  { x: -22, z: 0, hx: 1.5, hz: 3, h: 2.6 },
  { x: 22, z: 0, hx: 1.5, hz: 3, h: 2.6 },
  { x: -22, z: -10, hx: 1.5, hz: 1.5, h: 1.2 },
  { x: 22, z: 10, hx: 1.5, hz: 1.5, h: 1.2 },
];

export const SITE = { x: 0, z: -16, r: 5.5 };

export const SPAWNS = {
  ember: [
    { x: -4, z: 17, yaw: 0 },
    { x: 0, z: 18, yaw: 0 },
    { x: 4, z: 17, yaw: 0 },
  ],
  ash: [
    { x: -16, z: -17, yaw: Math.PI },
    { x: 0, z: -18, yaw: Math.PI },
    { x: 16, z: -17, yaw: Math.PI },
  ],
};

// Waypoint graph the bots walk. Nodes are (x, z); edges are index pairs.
export const WAYPOINTS = [
  { x: 0, z: 17 }, // 0 ember spawn
  { x: -20, z: 14 }, // 1 west lane south
  { x: 20, z: 14 }, // 2 east lane south
  { x: -20, z: 0 }, // 3 west lane mid
  { x: 20, z: 0 }, // 4 east lane mid
  { x: -20, z: -13 }, // 5 west lane north
  { x: 20, z: -13 }, // 6 east lane north
  { x: 0, z: 7 }, // 7 mid south
  { x: 0, z: -7 }, // 8 mid north
  { x: 0, z: -13 }, // 9 site approach
  { x: 0, z: -16 }, // 10 the reactor site
  { x: -10, z: -16 }, // 11 site west cover
  { x: 10, z: -16 }, // 12 site east cover
  { x: -8, z: 8 }, // 13 mid-west pocket
  { x: 8, z: -8 }, // 14 mid-east pocket
  { x: -16, z: -17 }, // 15 ash spawn west
  { x: 16, z: -17 }, // 16 ash spawn east
  { x: 0, z: -18 }, // 17 ash spawn centre
];

const EDGES = [
  [0, 1], [0, 2], [0, 7], [1, 3], [2, 4], [3, 5], [4, 6],
  [3, 13], [4, 14], [7, 13], [7, 8], [8, 14], [8, 9], [9, 10],
  [9, 11], [9, 12], [5, 11], [6, 12], [5, 15], [6, 16],
  [10, 11], [10, 12], [11, 15], [12, 16], [15, 17], [16, 17],
  [1, 13], [2, 7], [13, 8], [14, 9],
];

const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

// Breadth-first path between waypoint nodes. Returns node indices.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of ADJ[cur]) {
      if (prev[n] === -1) {
        prev[n] = cur;
        if (n === to) {
          const path = [to];
          let p = cur;
          while (p !== from) {
            path.unshift(p);
            p = prev[p];
          }
          path.unshift(from);
          return path;
        }
        queue.push(n);
      }
    }
  }
  return [from, to];
}

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// --- Collision: circle (agent) vs wall AABBs, resolved per axis. ---
export function collideMove(x, z, dx, dz, radius) {
  let nx = x + dx;
  for (const w of WALLS) {
    if (Math.abs(nx - w.x) < w.hx + radius && Math.abs(z - w.z) < w.hz + radius) {
      nx = x;
      break;
    }
  }
  let nz = z + dz;
  for (const w of WALLS) {
    if (Math.abs(nx - w.x) < w.hx + radius && Math.abs(nz - w.z) < w.hz + radius) {
      nz = z;
      break;
    }
  }
  return { x: nx, z: nz };
}

// --- Ray tests. dir must be normalised. Returns distance or Infinity. ---
export function rayVsBox(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const c = [cx, cy, cz];
  const h = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < c[i] - h[i] || o[i] > c[i] + h[i]) return Infinity;
    } else {
      let t1 = (c[i] - h[i] - o[i]) / d[i];
      let t2 = (c[i] + h[i] - o[i]) / d[i];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function rayVsWalls(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const w of WALLS) {
    const t = rayVsBox(ox, oy, oz, dx, dy, dz, w.x, w.h / 2, w.z, w.hx, w.h / 2, w.hz);
    if (t < best) best = t;
  }
  // The ground plane.
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t > 0 && t < best) best = t;
  }
  return best;
}

// True when nothing solid stands between two eye-level points.
export function lineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const t = rayVsWalls(ax, ay, az, dx / len, dy / len, dz / len, len);
  return t >= len - 0.05;
}

// --- Meshes. Palette: dusk foundry — slate floor, rust crates, teal Ember
// trim, warm hazard stripes around the reactor site. ---
export function buildMapMeshes(scene) {
  const group = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(62, 42), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Yard grid lines, cheap readability: thin dark strips every 5 m.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x2c3138 });
  for (let x = -25; x <= 25; x += 5) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 42), lineMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.01, 0);
    group.add(strip);
  }
  for (let z = -15; z <= 15; z += 5) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(62, 0.12), lineMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.01, z);
    group.add(strip);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.85 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9a5a28, roughness: 0.8 });
  const tallMat = new THREE.MeshStandardMaterial({ color: 0x46525e, roughness: 0.85 });
  for (const w of WALLS) {
    const mat = w.h > 3 ? tallMat : w.h > 2 ? wallMat : crateMat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.hx * 2, w.h, w.hz * 2), mat);
    mesh.position.set(w.x, w.h / 2, w.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Rust-orange top edge on low cover so it reads as cover at a glance.
    if (w.h <= 2.6) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w.hx * 2 + 0.06, 0.08, w.hz * 2 + 0.06),
        new THREE.MeshStandardMaterial({ color: 0xc96a1e, roughness: 0.7 }),
      );
      cap.position.set(w.x, w.h + 0.04, w.z);
      group.add(cap);
    }
  }

  // The reactor: glowing core cylinder + ring on the floor marking the site.
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.8, 3.2, 12),
    new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.4, metalness: 0.6,
      emissive: 0xff7a1a, emissiveIntensity: 0.55,
    }),
  );
  core.position.set(SITE.x, 1.6, SITE.z);
  core.castShadow = true;
  group.add(core);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SITE.r - 0.25, SITE.r, 48),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.02, SITE.z);
  group.add(ring);

  // Site label board.
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.6 }),
  );
  board.position.set(SITE.x, 3.6, SITE.z - 4.6);
  group.add(board);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(4.1, 0.25, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffb020 }),
  );
  stripe.position.set(SITE.x, 3.0, SITE.z - 4.6);
  group.add(stripe);

  scene.add(group);
  return group;
}
