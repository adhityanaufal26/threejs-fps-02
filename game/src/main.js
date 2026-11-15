// main.js — one job: bootstrap and the render loop. Builds the three.js
// scene, runs the fixed-step simulation (60 Hz accumulator, apart from
// rendering), syncs meshes from state, and drains sim events into audio and
// effects. Exposes window.__game for tests and screenshots.
import * as THREE from "three";
import { createState, CFG, TEAMS, playerOf } from "./state.js";
import { WEAPONS } from "./weapons.js";
import { buildMapMeshes, SITE } from "./map.js";
import { AudioSys } from "./audio.js";
import { Effects } from "./effects.js";
import { HUD } from "./hud.js";
import { PlayerInput, rememberOwned, lockPointer } from "./player.js";
import { startMatch, startRound, step, eyeY, buyWeapon } from "./sim.js";

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get("seed") ?? "1337", 10) || 1337;
const shot = params.get("shot"); // menu | buy | combat | plant | end
const state = createState(seed);
const audio = new AudioSys();

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232c35);
scene.fog = new THREE.Fog(0x232c35, 35, 95);

const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 200);

const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x2a2118, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9a0, 1.9);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
scene.add(sun);

buildMapMeshes(scene);
const effects = new Effects(scene);

// --- Agent meshes: body capsule, head, visor, gun. One group per agent. ---
const agentMeshes = new Map();
const bodyGeo = new THREE.CylinderGeometry(0.34, 0.42, 1.05, 10);
const headGeo = new THREE.SphereGeometry(0.26, 12, 10);
const visorGeo = new THREE.BoxGeometry(0.3, 0.1, 0.08);
const gunGeo = new THREE.BoxGeometry(0.09, 0.14, 0.85);

function makeAgentMesh(p) {
  const g = new THREE.Group();
  const team = TEAMS[p.team];
  const bodyMat = new THREE.MeshStandardMaterial({ color: team.dark, roughness: 0.7 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5 }));
  head.position.y = 1.55;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(visorGeo, new THREE.MeshBasicMaterial({ color: team.color }));
  visor.position.set(0, 1.56, -0.22);
  g.add(visor);
  const gun = new THREE.Mesh(gunGeo, new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.4, metalness: 0.5 }));
  gun.position.set(0.3, 1.15, -0.35);
  g.add(gun);
  // Team ring on the floor so friend/foe reads at a glance.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.55, 24),
    new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  g.userData = { body, head, visor, gun, ring, deadT: 0 };
  scene.add(g);
  return g;
}
for (const p of state.players) agentMeshes.set(p.id, makeAgentMesh(p));

// The spike, carried visibly: a small orange canister at the carrier's hip.
const spikeMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.09, 0.34, 8),
  new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff5a1a, emissiveIntensity: 0.7 }),
);
scene.add(spikeMesh);

// --- Player viewmodel: a simple rifle that bobs and kicks. ---
const viewmodel = new THREE.Group();
const vmBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.05, 0.08, 0.38),
  new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.35, metalness: 0.55 }),
);
viewmodel.add(vmBody);
const vmGrip = new THREE.Mesh(
  new THREE.BoxGeometry(0.05, 0.11, 0.07),
  new THREE.MeshStandardMaterial({ color: 0x4a525a, roughness: 0.5 }),
);
vmGrip.position.set(0, -0.09, 0.11);
viewmodel.add(vmGrip);
const vmSight = new THREE.Mesh(
  new THREE.BoxGeometry(0.025, 0.04, 0.08),
  new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.3, metalness: 0.7 }),
);
vmSight.position.set(0, 0.06, -0.06);
viewmodel.add(vmSight);
viewmodel.scale.setScalar(0.7);
viewmodel.position.set(0.32, -0.34, -0.6);
camera.add(viewmodel);
scene.add(camera);

// --- HUD and input ---
const hud = new HUD(state, {
  onBuy: (id) => {
    const p = playerOf(state);
    if (buyWeapon(state, p, id)) {
      rememberOwned(p);
      audio.buy();
      hud.refreshBuy();
    } else {
      audio.deny();
    }
  },
  onResume: () => {
    hud.showMenu(false);
    lockPointer(canvas);
  },
  onRestart: () => {
    hud.hideMatchEnd();
    startMatch(state);
  },
  onStart: () => {
    audio.ensure();
    hud.showMenu(false);
    // DEPLOY starts a fresh match from the menu; resuming after Esc just
    // re-locks the pointer and keeps the round going.
    if (state.phase === "menu") startMatch(state);
    lockPointer(canvas);
  },
});

const input = new PlayerInput(state, canvas, {
  buyMenuOpen: () => hud.buyOpen,
  onBuyMenu: () => {
    if (state.phase === "buy") {
      hud.showBuy(!hud.buyOpen);
      hud.refreshBuy();
    }
  },
  onLockChange: (locked) => {
    if (!locked && state.phase === "live" && !shot) hud.showMenu(true);
  },
  onPause: () => {
    if (state.phase === "live") {
      document.exitPointerLock();
      hud.showMenu(true);
    }
  },
});

// --- Event drain: sim events -> audio, effects, HUD. ---
function drainEvents() {
  const me = playerOf(state);
  for (const ev of state.events) {
    switch (ev.type) {
      case "shot": {
        const shooter = state.players[ev.agentId];
        const w = WEAPONS[ev.weapon];
        const dist = Math.hypot(me.x - ev.from.x, me.z - ev.from.z);
        audio.shot(ev.weapon, ev.agentId === 0 ? 0 : dist);
        effects.tracer(ev.from, ev.to, w.tracer);
        if (ev.agentId === 0) effects.muzzle(ev.from);
        if (ev.hit) effects.spark(ev.to);
        break;
      }
      case "dryFire":
        if (ev.agentId === 0) audio.dryFire();
        break;
      case "reload":
        if (ev.agentId === 0) audio.reload();
        break;
      case "step": {
        const a = state.players[ev.agentId];
        const dist = Math.hypot(me.x - a.x, me.z - a.z);
        if (dist < 18) audio.step(ev.crouch);
        break;
      }
      case "damage":
        if (ev.targetId === 0) {
          audio.hurt();
          hud.flashDamage();
        } else if (ev.attackerId === 0) {
          audio.hit();
        }
        break;
      case "kill":
        if (ev.killerId === 0) {
          audio.kill();
          hud.hitmarker(ev.head, true);
        } else if (ev.targetId === 0) {
          hud.hitmarker(false, false);
        } else if (ev.attackerId === 0 || ev.targetId === 0) {
          hud.hitmarker(ev.head, false);
        }
        break;
      case "explosion": {
        const dist = Math.hypot(me.x - ev.x, me.z - ev.z);
        audio.explosion(dist);
        effects.explosion(ev);
        break;
      }
      case "throw":
        if (ev.agentId === 0) audio.throwWhoosh();
        break;
      case "plantBeep":
      case "defuseBeep":
        audio.plantBeep();
        break;
      case "planted":
        hud.banner("SPIKE PLANTED", "Ash must defuse it before it blows", "danger");
        break;
      case "buyPhase":
        hud.banner(`ROUND ${ev.round}`, "Buy up — B opens the shop", "");
        break;
      case "roundStart":
        hud.showBuy(false);
        break;
      case "roundEnd": {
        const won = ev.winner === "ember";
        hud.banner(won ? "ROUND WON" : "ROUND LOST", ev.reason, won ? "win" : "lose");
        if (won) audio.roundWin();
        else audio.roundLose();
        break;
      }
      case "matchEnd":
        hud.showMatchEnd(ev.winner);
        break;
      case "bought":
        break;
    }
  }
  state.events.length = 0;
}

// --- Per-frame mesh sync from state (render reads, never writes sim). ---
const tmpV = new THREE.Vector3();
function syncMeshes() {
  for (const p of state.players) {
    const g = agentMeshes.get(p.id);
    if (p.isPlayer || state.phase === "menu") {
      // The player never sees their own body; the menu vista is a clean yard.
      g.visible = false;
      continue;
    }
    g.visible = true;
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;
    const u = g.userData;
    if (!p.alive) {
      u.deadT = Math.min(1, u.deadT + 0.05);
      g.rotation.x = -Math.PI / 2 * u.deadT;
      g.position.y = -0.1 * u.deadT;
      u.ring.visible = false;
    } else {
      u.deadT = 0;
      g.rotation.x = 0;
      g.position.y = 0;
      u.ring.visible = true;
      // Walk bob.
      const bob = Math.sin(state.time * 9 + p.id * 2) * Math.min(1, p.speed / 4) * 0.05;
      u.body.position.y = 0.85 + bob;
    }
  }
  // Spike mesh: on the carrier's hip, dropped on the floor, or at the site.
  const s = state.spike;
  if (s.planted) {
    spikeMesh.position.set(s.plantX, 0.5, s.plantZ);
    spikeMesh.visible = true;
    effects.setBeacon(s.plantX, s.plantZ, true);
  } else if (s.dropped) {
    spikeMesh.position.set(s.droppedX, 0.2, s.droppedZ);
    spikeMesh.visible = true;
    effects.setBeacon(s.droppedX, s.droppedZ, false);
  } else {
    const carrier = state.players[s.carrierId];
    if (carrier && carrier.alive && !carrier.isPlayer) {
      spikeMesh.position.set(carrier.x + 0.25, 1.0, carrier.z);
      spikeMesh.visible = true;
    } else {
      spikeMesh.visible = false;
    }
    effects.setBeacon(0, 0, false);
  }
  // Grenade meshes: reuse the spike mesh shape via small spheres in the scene.
  updateGrenadeMeshes();
}

const grenadeMeshes = [];
function updateGrenadeMeshes() {
  while (grenadeMeshes.length < state.grenades.length) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.4, metalness: 0.6 }),
    );
    scene.add(m);
    grenadeMeshes.push(m);
  }
  state.grenades.forEach((g, i) => {
    grenadeMeshes[i].visible = true;
    grenadeMeshes[i].position.set(g.x, g.y, g.z);
  });
  for (let i = state.grenades.length; i < grenadeMeshes.length; i++) {
    grenadeMeshes[i].visible = false;
  }
}

// --- Camera from the player agent. In the menu phase the orbit camera
// owns the view, so this stays out of its way. ---
function syncCamera(dt) {
  const p = playerOf(state);
  if (state.phase === "menu") {
    viewmodel.visible = false;
    return;
  }
  camera.position.set(p.x, eyeY(p), p.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  // Scope zoom narrows the field of view; viewmodel hides when scoped.
  const targetFov = p.scoped ? 78 / 3.2 : 78;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  viewmodel.visible = !p.scoped && p.alive && state.phase !== "menu";
  // Viewmodel bob and recoil kick.
  const bobAmp = Math.min(1, p.speed / 5) * 0.012;
  viewmodel.position.x = 0.32 + Math.sin(state.time * 9) * bobAmp;
  viewmodel.position.y = -0.34 + Math.abs(Math.cos(state.time * 9)) * bobAmp;
  viewmodel.position.z = -0.6 + p.recoil * 1.2;
  if (!p.alive) {
    // Death cam: sink and tilt.
    camera.position.y = 0.5;
    camera.rotation.z = 0.5;
  } else {
    camera.rotation.z = 0;
  }
}

// --- Screenshot setups: deterministic poses for ?shot= modes. ---
function setupShot(mode) {
  audio.ensure();
  if (mode === "menu") return; // menu overlay over the yard, no round yet.
  startMatch(state);
  // Shot modes pose a scene, they do not play the buy-phase banner.
  state.events.length = 0;
  // Skip the buy phase: jump straight into a live round.
  state.phase = "live";
  state.timer = 87;
  const me = playerOf(state);
  if (mode === "buy") {
    state.phase = "buy";
    state.timer = 12;
    me.money = 5200;
    hud.showBuy(true);
    hud.refreshBuy();
    return;
  }
  if (mode === "combat") {
    // Player in the east gap with a rifle, an Ash bot in sight up the lane.
    me.x = 8;
    me.z = 8;
    me.yaw = 0;
    me.pitch = 0.01;
    me.weapon = "rifle";
    me.mag = 25;
    me.reserve = 75;
    me.money = 2700;
    const foe = state.players[4]; // Sable
    foe.x = 8;
    foe.z = -4;
    foe.yaw = Math.PI;
    foe.bot.mode = "hold";
    foe.bot.holdT = 99;
    const ally = state.players[1]; // Koda
    ally.x = 5;
    ally.z = 2;
    ally.yaw = 0;
    // A tracer across the lane for the action read.
    effects.tracer({ x: 5, y: 1.5, z: 2 }, { x: 8, y: 1.4, z: -4 }, 0xffe08a);
    return;
  }
  if (mode === "plant") {
    me.x = 4;
    me.z = -6;
    me.yaw = 0.2;
    me.pitch = -0.03;
    me.weapon = "rifle";
    me.mag = 18;
    me.reserve = 50;
    state.spike.planted = true;
    state.spike.plantX = 2.5;
    state.spike.plantZ = -13.5;
    state.spike.plantT = 12;
    state.spike.carrierId = -1;
    return;
  }
  if (mode === "end") {
    state.phase = "roundEnd";
    state.timer = 3;
    state.roundWinner = "ember";
    state.roundReason = "Ash eliminated";
    state.score.ember = 2;
    state.score.ash = 1;
    hud.banner("ROUND WON", "Ash eliminated", "win");
  }
}

// --- Fixed-step loop: 60 Hz accumulator, sim apart from rendering. ---
// In the menu phase the clock runs only for the orbit camera.
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  if (state.phase === "menu") {
    state.time += dt;
    menuCam(dt);
  } else {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      input.update(STEP);
      step(state, STEP);
      acc -= STEP;
      n++;
    }
  }
  // The combat screenshot keeps a tracer in the lane so the shot reads.
  if (shot === "combat" && state.phase === "live" && state.tick % 10 === 0) {
    effects.tracer({ x: 5, y: 1.5, z: 2 }, { x: 8, y: 1.4, z: -4 }, 0xffe08a);
  }
  drainEvents();
  syncMeshes();
  syncCamera(dt);
  effects.update(dt);
  hud.update();
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Menu camera: a low orbit over the yard, at eye level, so the lanes,
// the press block and the reactor all read in one frame.
function menuCam(dt) {
  if (state.phase !== "menu") return;
  const t = state.time * 0.08;
  camera.position.set(Math.sin(t) * 18, 4.2, Math.cos(t) * 13);
  camera.lookAt(0, 1.2, -4);
}

// Boot.
if (shot) {
  hud.showMenu(false);
  setupShot(shot);
} else {
  hud.showMenu(true);
}
requestAnimationFrame(frame);

// Test and screenshot hook. State is the single store; everything else reads it.
window.__game = {
  state,
  startMatch: () => startMatch(state),
  startRound: () => startRound(state),
  step: (dt) => step(state, dt),
  buy: (id) => buyWeapon(state, playerOf(state), id),
  players: state.players,
  version: "emberline-1.0.0",
};
