// sim.js — one job: the fixed-step simulation. Rounds, economy, movement,
// hitscan gunplay, plant/defuse, grenades. It only mutates state and pushes
// events; rendering and audio live elsewhere and drain state.events.
import { CFG, playerOf, teamAlive, pushFeed, pushEvent } from "./state.js";
import { WEAPONS, GRENADE } from "./weapons.js";
import { SITE, SPAWNS, collideMove, rayVsBox, rayVsWalls, lineOfSight } from "./map.js";
import { updateBot } from "./bots.js";

export function eyeY(agent) {
  return agent.crouch ? CFG.crouchEye : CFG.eyeHeight;
}

export function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// --- Match / round lifecycle ---

export function startMatch(state) {
  state.score.ember = 0;
  state.score.ash = 0;
  state.round = 1;
  state.matchWinner = null;
  for (const p of state.players) {
    p.money = CFG.startMoney;
    p.weapon = "pistol";
    p.kills = 0;
    p.deaths = 0;
    p.grenades = 0;
  }
  startBuyPhase(state);
}

export function startBuyPhase(state) {
  state.phase = "buy";
  state.timer = CFG.buyTime;
  state.spike.planted = false;
  state.spike.dropped = false;
  state.spike.plantProgress = 0;
  state.spike.defuseProgress = 0;
  state.spike.defusingId = -1;
  state.grenades.length = 0;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const spawn = SPAWNS[p.team][i % 3];
    p.x = spawn.x;
    p.z = spawn.z;
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.vx = 0;
    p.vz = 0;
    p.speed = 0;
    p.hp = 100;
    p.alive = true;
    p.crouch = false;
    p.scoped = false;
    p.fireT = 0;
    p.reloadT = 0;
    p.bloom = 0;
    p.recoil = 0;
    refillAmmo(p);
    if (p.bot) botBuy(p, state);
  }
  // The spike starts with the Ember player each round.
  state.spike.carrierId = 0;
  pushEvent(state, { type: "buyPhase", round: state.round });
}

export function refillAmmo(p) {
  const w = WEAPONS[p.weapon];
  p.mag = w.mag;
  p.reserve = w.reserve;
  p.ammo[p.weapon] = { mag: p.mag, reserve: p.reserve };
}

function botBuy(p, state) {
  const rng = state.rng;
  if (p.money >= 4750 && rng.chance(0.25)) buyWeapon(state, p, "sniper");
  else if (p.money >= 2700) buyWeapon(state, p, "rifle");
  else if (p.money >= 1500) buyWeapon(state, p, "smg");
  if (p.money >= 300 && rng.chance(0.5)) buyWeapon(state, p, "grenade");
}

export function startRound(state) {
  state.phase = "live";
  state.timer = CFG.roundTime;
  pushEvent(state, { type: "roundStart", round: state.round });
}

export function endRound(state, winner, reason) {
  if (state.phase !== "live") return;
  state.phase = "roundEnd";
  state.timer = 4;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner]++;
  for (const p of state.players) {
    p.money += p.team === winner ? CFG.winMoney : CFG.lossMoney;
    if (p.money > 16000) p.money = 16000;
  }
  pushFeed(state, `${winner === "ember" ? "Ember" : "Ash"} takes round ${state.round} — ${reason}`);
  pushEvent(state, { type: "roundEnd", winner, reason });
  if (state.score[winner] >= CFG.winRounds) {
    state.phase = "matchEnd";
    state.matchWinner = winner;
    pushEvent(state, { type: "matchEnd", winner });
  }
}

// --- Economy ---

export function buyWeapon(state, p, id) {
  if (state.phase !== "buy" && state.phase !== "live") return false;
  if (id === "grenade") {
    if (p.grenades >= 2 || p.money < GRENADE.price) return false;
    p.money -= GRENADE.price;
    p.grenades++;
    pushEvent(state, { type: "bought", agentId: p.id, item: "grenade" });
    return true;
  }
  const w = WEAPONS[id];
  if (!w || p.weapon === id || p.money < w.price) return false;
  p.money -= w.price;
  p.ammo[p.weapon] = { mag: p.mag, reserve: p.reserve };
  p.weapon = id;
  if (!p._owned.includes(id)) p._owned.push(id);
  refillAmmo(p);
  pushEvent(state, { type: "bought", agentId: p.id, item: id });
  return true;
}

// --- Movement (acceleration, friction, map collision) ---

export function moveAgent(state, p, wishX, wishZ, dt) {
  const w = WEAPONS[p.weapon];
  let maxSpeed = w.speed * (p.crouch ? 0.5 : 1);
  if (p.scoped) maxSpeed *= 0.55;
  const len = Math.hypot(wishX, wishZ);
  const tx = len > 0.01 ? (wishX / len) * maxSpeed : 0;
  const tz = len > 0.01 ? (wishZ / len) * maxSpeed : 0;
  const k = Math.min(1, 11 * dt);
  p.vx += (tx - p.vx) * k;
  p.vz += (tz - p.vz) * k;
  const moved = collideMove(p.x, p.z, p.vx * dt, p.vz * dt, CFG.playerRadius);
  p.x = moved.x;
  p.z = moved.z;
  p.speed = Math.hypot(p.vx, p.vz);
  // Footstep pacing, drained by the renderer for sound.
  p._stepAcc = (p._stepAcc ?? 0) + p.speed * dt;
  if (p._stepAcc > 2.4 && p.speed > 1) {
    p._stepAcc = 0;
    pushEvent(state, { type: "step", agentId: p.id, crouch: p.crouch });
  }
}

// --- Hitscan gunplay ---

function agentBoxes(p) {
  const ey = eyeY(p);
  return {
    body: { cx: p.x, cy: 0.75, cz: p.z, hx: 0.42, hy: 0.75, hz: 0.42 },
    head: { cx: p.x, cy: ey - 0.07, cz: p.z, hx: 0.26, hy: 0.17, hz: 0.26 },
  };
}

export function tryFire(state, p, aimYaw, aimPitch) {
  const w = WEAPONS[p.weapon];
  if (!p.alive || state.phase !== "live") return false;
  if (p.fireT > 0 || p.reloadT > 0) return false;
  if (p.mag <= 0) {
    p.fireT = 0.25;
    pushEvent(state, { type: "dryFire", agentId: p.id });
    return false;
  }
  p.fireT = w.rate;
  p.mag--;
  state.stats.shotsFired++;

  // Spread: base + movement + bloom, crouch and scope tighten it.
  const moveFrac = Math.min(1, p.speed / w.speed);
  let spread = w.spread + w.moveSpread * moveFrac + p.bloom;
  if (p.crouch) spread *= 0.6;
  if (p.scoped) spread *= 0.3;
  p.bloom = Math.min(0.05, p.bloom + w.bloom);
  p.recoil = Math.min(0.09, p.recoil + w.recoil);

  const a = state.rng.range(0, Math.PI * 2);
  const r = state.rng.next() * spread;
  const yaw = aimYaw + Math.cos(a) * r;
  const pitch = aimPitch + Math.sin(a) * r + p.recoil * 0.4;
  const d = dirFromYawPitch(yaw, pitch);
  const ox = p.x;
  const oy = eyeY(p);
  const oz = p.z;

  const wallT = rayVsWalls(ox, oy, oz, d.x, d.y, d.z, 200);
  let hit = null;
  for (const q of state.players) {
    if (q === p || !q.alive || q.team === p.team) continue;
    const boxes = agentBoxes(q);
    const tHead = rayVsBox(ox, oy, oz, d.x, d.y, d.z,
      boxes.head.cx, boxes.head.cy, boxes.head.cz, boxes.head.hx, boxes.head.hy, boxes.head.hz);
    const tBody = rayVsBox(ox, oy, oz, d.x, d.y, d.z,
      boxes.body.cx, boxes.body.cy, boxes.body.cz, boxes.body.hx, boxes.body.hy, boxes.body.hz);
    const t = Math.min(tHead, tBody);
    if (t < wallT && (!hit || t < hit.t)) {
      hit = { target: q, t, head: tHead <= tBody };
    }
  }

  const endT = hit ? hit.t : wallT;
  pushEvent(state, {
    type: "shot", agentId: p.id, weapon: p.weapon,
    from: { x: ox, y: oy, z: oz },
    to: { x: ox + d.x * endT, y: oy + d.y * endT, z: oz + d.z * endT },
    hit: !!hit, head: hit ? hit.head : false,
  });

  if (hit) {
    state.stats.shotsHit++;
    const falloff = hit.t <= w.range ? 1 : Math.max(0.55, 1 - (hit.t - w.range) / (w.range * 1.5) * 0.45);
    const dmg = Math.round(w.damage * falloff * (hit.head ? w.headMult : 1));
    damageAgent(state, hit.target, dmg, p, hit.head);
  }

  // Gunfire is heard: nearby bots investigate.
  p.lastShotAt = state.time;
  p.lastShotX = p.x;
  p.lastShotZ = p.z;
  for (const q of state.players) {
    if (!q.bot || !q.alive || q === p) continue;
    const dist = Math.hypot(q.x - p.x, q.z - p.z);
    if (dist < 45) {
      q.bot.heardX = p.x;
      q.bot.heardZ = p.z;
      q.bot.hasHeard = true;
    }
  }
  return true;
}

export function startReload(state, p) {
  const w = WEAPONS[p.weapon];
  if (!p.alive || p.reloadT > 0 || p.mag === w.mag || p.reserve <= 0) return false;
  p.reloadT = w.reload;
  pushEvent(state, { type: "reload", agentId: p.id });
  return true;
}

function finishReload(p) {
  const w = WEAPONS[p.weapon];
  const need = w.mag - p.mag;
  const take = Math.min(need, p.reserve);
  p.mag += take;
  p.reserve -= take;
  p.ammo[p.weapon] = { mag: p.mag, reserve: p.reserve };
}

export function damageAgent(state, target, dmg, attacker, isHead) {
  if (!target.alive) return;
  target.hp -= dmg;
  target.hurtAt = state.time;
  target.hurtFromX = attacker ? attacker.x : target.x;
  target.hurtFromZ = attacker ? attacker.z : target.z;
  pushEvent(state, {
    type: "damage", targetId: target.id, attackerId: attacker ? attacker.id : -1,
    dmg, head: !!isHead, hp: Math.max(0, target.hp),
  });
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    target.scoped = false;
    if (attacker) {
      attacker.kills++;
      attacker.money += CFG.killMoney;
    }
    pushFeed(state, `${attacker ? attacker.name : "—"} ▸ ${target.name}${isHead ? " (headshot)" : ""}`);
    pushEvent(state, {
      type: "kill", targetId: target.id,
      killerId: attacker ? attacker.id : -1, head: !!isHead,
    });
    // The spike drops where its carrier falls.
    if (state.spike.carrierId === target.id && !state.spike.planted) {
      state.spike.dropped = true;
      state.spike.droppedX = target.x;
      state.spike.droppedZ = target.z;
      state.spike.carrierId = -1;
    }
  }
}

// --- Grenades ---

export function throwGrenade(state, p) {
  if (!p.alive || p.grenades <= 0 || state.phase !== "live") return false;
  p.grenades--;
  const d = dirFromYawPitch(p.yaw, p.pitch);
  state.grenades.push({
    x: p.x, y: eyeY(p), z: p.z,
    vx: d.x * GRENADE.speed, vy: d.y * GRENADE.speed + 3.5, vz: d.z * GRENADE.speed,
    fuse: GRENADE.fuse, owner: p.id,
  });
  pushEvent(state, { type: "throw", agentId: p.id });
  return true;
}

function updateGrenades(state, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vy -= 14 * dt;
    const moved = collideMove(g.x, g.z, g.vx * dt, g.vz * dt, 0.15);
    g.x = moved.x;
    g.z = moved.z;
    g.y += g.vy * dt;
    if (g.y < 0.15) {
      g.y = 0.15;
      g.vy = Math.abs(g.vy) * 0.35;
      g.vx *= 0.6;
      g.vz *= 0.6;
    }
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      explodeGrenade(state, g);
    }
  }
}

function explodeGrenade(state, g) {
  pushEvent(state, { type: "explosion", x: g.x, y: g.y, z: g.z });
  for (const p of state.players) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - g.x, eyeY(p) - g.y, p.z - g.z);
    if (dist > GRENADE.radius) continue;
    const owner = state.players[g.owner];
    let dmg = Math.round(GRENADE.damage * (1 - dist / GRENADE.radius));
    const los = lineOfSight(g.x, g.y, g.z, p.x, eyeY(p), p.z);
    if (!los) dmg = Math.round(dmg * 0.5);
    if (dmg > 0) damageAgent(state, p, dmg, owner, false);
  }
}

// --- Plant / defuse ---

function updateSpike(state, dt) {
  const s = state.spike;
  if (s.planted) {
    s.plantT += dt;
    if (s.plantT >= CFG.detonateTime) {
      endRound(state, "ember", "spike detonated");
      return;
    }
    // An Ash agent on the spike defuses it.
    let defuser = null;
    for (const p of state.players) {
      if (p.team === "ash" && p.alive &&
        Math.hypot(p.x - s.plantX, p.z - s.plantZ) < 2.0) {
        defuser = p;
        break;
      }
    }
    if (defuser) {
      if (s.defusingId !== defuser.id) {
        s.defusingId = defuser.id;
        s.defuseProgress = 0;
      }
      s.defuseProgress += dt;
      if (Math.floor(s.defuseProgress * 2) !== Math.floor((s.defuseProgress - dt) * 2)) {
        pushEvent(state, { type: "defuseBeep", agentId: defuser.id });
      }
      if (s.defuseProgress >= CFG.defuseTime) {
        state.stats.defuses++;
        s.planted = false;
        endRound(state, "ash", "spike defused");
      }
    } else {
      s.defusingId = -1;
      s.defuseProgress = 0;
    }
    return;
  }
  // Pickup of a dropped spike.
  if (s.dropped) {
    for (const p of state.players) {
      if (p.team === "ember" && p.alive &&
        Math.hypot(p.x - s.droppedX, p.z - s.droppedZ) < 1.4) {
        s.carrierId = p.id;
        s.dropped = false;
        pushFeed(state, `${p.name} picked up the spike`);
        break;
      }
    }
    return;
  }
  // Planting: carrier inside the site, holding the plant action.
  const carrier = state.players[s.carrierId];
  if (carrier && carrier.alive && carrier.team === "ember") {
    const inSite = Math.hypot(carrier.x - SITE.x, carrier.z - SITE.z) < SITE.r;
    const planting = inSite && carrier._planting;
    if (planting) {
      s.plantProgress += dt;
      if (Math.floor(s.plantProgress * 2) !== Math.floor((s.plantProgress - dt) * 2)) {
        pushEvent(state, { type: "plantBeep", agentId: carrier.id });
      }
      if (s.plantProgress >= CFG.plantTime) {
        s.planted = true;
        s.plantX = carrier.x;
        s.plantZ = carrier.z;
        s.plantT = 0;
        state.stats.plants++;
        carrier.money += CFG.plantMoney;
        pushFeed(state, `${carrier.name} planted the spike`);
        pushEvent(state, { type: "planted", x: s.plantX, z: s.plantZ });
      }
    } else {
      s.plantProgress = 0;
    }
  }
}

// --- Fixed step ---

export function step(state, dt) {
  state.time += dt;
  state.tick++;

  // Timers and cooldowns, every agent, every tick.
  for (const p of state.players) {
    if (p.fireT > 0) p.fireT -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) finishReload(p);
    }
    if (p.bloom > 0) p.bloom = Math.max(0, p.bloom - dt * 0.09);
    if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - dt * 0.12);
  }

  if (state.phase === "buy") {
    state.timer -= dt;
    if (state.timer <= 0) startRound(state);
    return;
  }
  if (state.phase === "roundEnd") {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.round++;
      startBuyPhase(state);
    }
    return;
  }
  if (state.phase !== "live") return;

  state.timer -= dt;
  if (state.timer <= 0 && !state.spike.planted) {
    endRound(state, "ash", "time expired — site held");
    return;
  }

  for (const p of state.players) {
    if (p.bot && p.alive) updateBot(state, p, dt);
  }
  updateGrenades(state, dt);
  updateSpike(state, dt);

  // Elimination ends the round (unless the spike is ticking).
  const emberAlive = teamAlive(state, "ember");
  const ashAlive = teamAlive(state, "ash");
  if (emberAlive === 0 && !state.spike.planted) {
    endRound(state, "ash", "Ember eliminated");
  } else if (ashAlive === 0) {
    endRound(state, "ember", state.spike.planted ? "Ash eliminated" : "Ash eliminated");
  }
}
