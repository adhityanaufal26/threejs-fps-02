// bots.js — one job: the bot brain. Waypoint routes, line-of-sight
// engagement with reaction time and burst fire, holding positions, reacting
// to gunfire, and carrying out the plant/defuse objective.
import { CFG, teamAlive } from "./state.js";
import { WEAPONS } from "./weapons.js";
import { SITE, WAYPOINTS, findPath, nearestWaypoint, lineOfSight, collideMove } from "./map.js";
import { tryFire, moveAgent, eyeY, dirFromYawPitch, throwGrenade, startReload } from "./sim.js";

const BOT_SPEED = 4.3;
const REACT_BASE = 0.45; // seconds to react to a newly seen enemy

function visibleEnemy(state, p) {
  let best = null;
  let bestD = Infinity;
  for (const q of state.players) {
    if (q.team === p.team || !q.alive) continue;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 48) continue;
    if (!lineOfSight(p.x, eyeY(p), p.z, q.x, eyeY(q), q.z)) continue;
    if (dist < bestD) {
      bestD = dist;
      best = q;
    }
  }
  return best ? { enemy: best, dist: bestD } : null;
}

function setPath(bot, fromNode, toNode) {
  bot.path = findPath(fromNode, toNode);
  bot.pathIdx = 0;
}

function followPath(state, p, dt) {
  const bot = p.bot;
  if (bot.pathIdx >= bot.path.length) return { x: 0, z: 0 };
  const node = WAYPOINTS[bot.path[bot.pathIdx]];
  const dx = node.x - p.x;
  const dz = node.z - p.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.9) {
    bot.pathIdx++;
    return followPath(state, p, dt);
  }
  return { x: dx / dist, z: dz / dist };
}

function faceToward(p, tx, tz, dt, rate = 7) {
  const want = Math.atan2(-(tx - p.x), -(tz - p.z));
  let diff = want - p.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  p.yaw += step;
}

function aimAt(p, target, dist, dt) {
  const bot = p.bot;
  const w = WEAPONS[p.weapon];
  // Aim error shrinks as the bot settles on target; grows with distance.
  const errBase = 0.012 + dist * 0.0009;
  const err = errBase + bot.aimErr;
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const yaw = Math.atan2(-dx, -dz) + (state_rng(p) * 2 - 1) * err;
  const pitch = Math.atan2(eyeY(target) - eyeY(p), dist) + (state_rng(p) * 2 - 1) * err * 0.7;
  p.yaw = yaw;
  p.pitch = Math.max(-1.2, Math.min(1.2, pitch));
  return { yaw, pitch };
}

// Bots get their randomness from the shared seeded rng via a per-bot jitter.
function state_rng(p) {
  return p._rngJitter ?? 0.5;
}

function engage(state, p, target, dist, dt) {
  const bot = p.bot;
  const w = WEAPONS[p.weapon];
  p._rngJitter = state.rng.next();
  bot.aimErr = Math.max(0, bot.aimErr - dt * 0.02);
  const { yaw, pitch } = aimAt(p, target, dist, dt);

  // Strafe sideways while firing, flip direction every 0.7–1.4 s.
  bot.strafeT -= dt;
  if (bot.strafeT <= 0) {
    bot.strafeDir = state.rng.chance(0.5) ? 1 : -1;
    bot.strafeT = state.rng.range(0.7, 1.4);
  }
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const strafeX = -fz * bot.strafeDir;
  const strafeZ = fx * bot.strafeDir;
  // Close distance when far, back off when point-blank.
  let approach = 0;
  if (dist > 26) approach = 1;
  else if (dist < 5) approach = -0.6;
  moveAgent(state, p, fx * approach + strafeX * 0.8, fz * approach + strafeZ * 0.8, dt);

  // Burst fire: 3–5 shots, then a pause. Sniper fires single aimed shots.
  if (bot.burstT > 0) {
    bot.burstT -= dt;
  } else if (bot.burstLeft > 0) {
    if (tryFire(state, p, yaw, pitch)) bot.burstLeft--;
    bot.burstT = w.id === "sniper" ? 0.9 : w.rate + 0.02;
  } else {
    bot.burstLeft = w.id === "sniper" ? 1 : state.rng.int(3, 5);
    bot.burstT = state.rng.range(0.35, 0.8);
  }
  if (p.mag === 0) startReload(state, p);
}

function chooseObjectiveNode(state, p) {
  const rng = state.rng;
  const bot = p.bot;
  if (p.team === "ember") {
    // Attackers push a lane toward the site; the carrier goes straight in.
    if (state.spike.carrierId === p.id) return 10;
    if (state.spike.planted) {
      // Planted: hold a defensive spot near the site.
      return rng.pick([9, 11, 12]);
    }
    if (state.spike.dropped) return nearestWaypoint(state.spike.droppedX, state.spike.droppedZ);
    return rng.pick([3, 4, 8, 9, 10]);
  }
  // Ash defends: hold near the site or a lane choke.
  if (state.spike.planted) return 10;
  return rng.pick([9, 10, 11, 12, 5, 6]);
}

export function updateBot(state, p, dt) {
  const bot = p.bot;
  const rng = state.rng;
  bot.thinkT -= dt;

  // The spike carrier plants when inside the site.
  if (p.team === "ember" && state.spike.carrierId === p.id && !state.spike.planted) {
    if (Math.hypot(p.x - SITE.x, p.z - SITE.z) < SITE.r - 0.5) {
      p._planting = true;
      bot.mode = "plant";
      moveAgent(state, p, 0, 0, dt);
      const seen = visibleEnemy(state, p);
      if (seen && bot.reactT <= 0) {
        bot.mode = "engage";
        bot.targetId = seen.enemy.id;
        bot.reactT = REACT_BASE + seen.dist * 0.01;
      }
      return;
    }
    p._planting = false;
  } else {
    p._planting = false;
  }

  // Defuse: Ash walks to a planted spike and stands on it.
  if (p.team === "ash" && state.spike.planted) {
    bot.mode = "defuse";
    const seen = visibleEnemy(state, p);
    if (seen && seen.dist < 20 && bot.reactT <= 0) {
      bot.mode = "engage";
      bot.targetId = seen.enemy.id;
      bot.reactT = REACT_BASE;
    } else {
      const d = Math.hypot(state.spike.plantX - p.x, state.spike.plantZ - p.z);
      if (d > 1.5) {
        if (bot.thinkT <= 0 || bot.pathIdx >= bot.path.length) {
          setPath(bot, nearestWaypoint(p.x, p.z), 10);
          bot.thinkT = 2;
        }
        const dir = followPath(state, p, dt);
        faceToward(p, p.x + dir.x, p.z + dir.z, dt);
        moveAgent(state, p, dir.x, dir.z, dt);
      } else {
        moveAgent(state, p, 0, 0, dt);
        faceToward(p, state.spike.plantX, state.spike.plantZ, dt);
      }
    }
    if (bot.mode === "engage") engage(state, p, state.players[bot.targetId], 15, dt);
    return;
  }

  // Combat: an enemy in sight, after reaction time, becomes the target.
  const seen = visibleEnemy(state, p);
  if (seen) {
    if (bot.targetId !== seen.enemy.id) {
      bot.targetId = seen.enemy.id;
      bot.reactT = REACT_BASE + seen.dist * 0.012;
      bot.aimErr = 0.03;
    }
    bot.reactT -= dt;
    if (bot.reactT <= 0) {
      bot.mode = "engage";
      engage(state, p, seen.enemy, seen.dist, dt);
      return;
    }
  } else if (bot.mode === "engage") {
    bot.targetId = -1;
    bot.mode = "advance";
    bot.thinkT = 0;
  }

  // Heard a shot nearby: go look.
  if (bot.hasHeard && bot.mode !== "engage") {
    bot.hasHeard = false;
    bot.mode = "investigate";
    setPath(bot, nearestWaypoint(p.x, p.z), nearestWaypoint(bot.heardX, bot.heardZ));
    bot.thinkT = 3;
  }

  // Pick a destination and walk it.
  if (bot.thinkT <= 0 || bot.pathIdx >= bot.path.length) {
    if (bot.mode === "investigate" && bot.pathIdx >= bot.path.length) {
      bot.mode = "hold";
      bot.holdT = rng.range(1.5, 3);
    } else if (bot.mode !== "hold") {
      const dest = chooseObjectiveNode(state, p);
      setPath(bot, nearestWaypoint(p.x, p.z), dest);
      bot.mode = "advance";
      bot.thinkT = rng.range(4, 7);
      // Sometimes a defender just holds a lane instead of walking.
      if (p.team === "ash" && rng.chance(0.35)) {
        bot.mode = "hold";
        bot.holdT = rng.range(3, 6);
        bot.holdNode = dest;
      }
    }
  }

  if (bot.mode === "hold") {
    bot.holdT -= dt;
    moveAgent(state, p, 0, 0, dt);
    // Scan: slow yaw sweep while holding.
    p.yaw += Math.sin(state.time * 0.5 + p.id) * 0.4 * dt;
    if (bot.holdT <= 0) {
      bot.mode = "advance";
      bot.thinkT = 0;
    }
    return;
  }

  const dir = followPath(state, p, dt);
  if (dir.x !== 0 || dir.z !== 0) {
    faceToward(p, p.x + dir.x, p.z + dir.z, dt);
    moveAgent(state, p, dir.x, dir.z, dt);
  } else {
    moveAgent(state, p, 0, 0, dt);
  }

  // Occasionally toss a grenade at a far enemy the bot cannot see.
  if (p.grenades > 0 && seen && seen.dist > 18 && rng.chance(0.002)) {
    throwGrenade(state, p);
  }
  if (p.mag === 0) startReload(state, p);
}
