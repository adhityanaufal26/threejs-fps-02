// state.js — one job: the single state store. Every module reads and writes
// this one object; nothing else holds game state. Fixed-step sim in sim.js
// mutates it, rendering in main.js only reads it.
import { makeRng } from "./rng.js";

export const CFG = {
  roundTime: 100, // seconds of live round time
  buyTime: 15, // seconds of buy phase between rounds
  winRounds: 5, // first team to this many rounds takes the match
  plantTime: 3, // seconds holding E to plant the spike
  defuseTime: 5, // seconds holding E to defuse the spike
  detonateTime: 40, // seconds from plant to detonation
  startMoney: 800,
  winMoney: 3250,
  lossMoney: 1900,
  killMoney: 300,
  plantMoney: 300,
  eyeHeight: 1.62,
  crouchEye: 1.05,
  playerRadius: 0.38,
};

// Team colours, shared by meshes, HUD and tracers.
export const TEAMS = {
  ember: { name: "Ember", color: 0x2fd4c4, css: "#2fd4c4", dark: 0x0e5a54 },
  ash: { name: "Ash", color: 0xff5a3c, css: "#ff5a3c", dark: 0x6e1f10 },
};

const NAMES = {
  ember: ["Vex", "Koda", "Mira"],
  ash: ["Rook", "Sable", "Jinx"],
};

function makeAgent(id, team, index, isPlayer) {
  return {
    id, name: NAMES[team][index], team, isPlayer,
    x: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vz: 0, speed: 0, // current horizontal speed, m/s
    hp: 100, alive: true,
    weapon: "pistol", mag: 12, reserve: 36, grenades: 0,
    // Ammo is tracked per weapon so switching slots keeps each mag honest.
    ammo: { pistol: { mag: 12, reserve: 36 } },
    _owned: ["pistol"],
    money: CFG.startMoney, kills: 0, deaths: 0,
    crouch: false, scoped: false,
    fireT: 0, reloadT: 0, bloom: 0, recoil: 0, // gunplay state
    lastShotAt: -99, lastShotX: 0, lastShotZ: 0,
    hurtAt: -99, hurtFromX: 0, hurtFromZ: 0,
    // Bot brain, null for the human player.
    bot: isPlayer ? null : {
      mode: "advance", // advance | engage | hold | plant | defuse | investigate
      path: [], pathIdx: 0, targetId: -1,
      reactT: 0, burstLeft: 0, burstT: 0, aimErr: 0,
      strafeDir: 1, strafeT: 0, holdT: 0,
      seenX: 0, seenZ: 0, heardX: 0, heardZ: 0, hasHeard: false,
      holdNode: -1, thinkT: 0,
    },
  };
}

export function createState(seed) {
  const rng = makeRng(seed);
  const players = [];
  let id = 0;
  for (const team of ["ember", "ash"]) {
    for (let i = 0; i < 3; i++) {
      players.push(makeAgent(id++, team, i, team === "ember" && i === 0));
    }
  }
  return {
    seed, rng,
    time: 0, tick: 0,
    phase: "menu", // menu | buy | live | roundEnd | matchEnd
    round: 1,
    score: { ember: 0, ash: 0 },
    timer: 0, // counts down in buy/live
    players,
    // The spike: Ember attacks, Ash defends.
    spike: {
      carrierId: 0, // agent id carrying it (player by default)
      droppedX: 0, droppedZ: 0, dropped: false,
      planted: false, plantX: 0, plantZ: 0, plantT: 0,
      defuseT: 0, defusingId: -1, plantProgress: 0, defuseProgress: 0,
    },
    roundWinner: null, roundReason: "",
    matchWinner: null,
    feed: [], // kill feed entries {text, t}
    events: [], // sim -> renderer/audio events, drained every frame
    grenades: [], // live thrown grenades {x,y,z,vx,vy,vz,fuse,owner}
    stats: { shotsFired: 0, shotsHit: 0, plants: 0, defuses: 0 },
  };
}

export function playerOf(state) {
  return state.players[0];
}

export function teamAlive(state, team) {
  let n = 0;
  for (const p of state.players) if (p.team === team && p.alive) n++;
  return n;
}

export function pushFeed(state, text) {
  state.feed.push({ text, t: state.time });
  if (state.feed.length > 6) state.feed.shift();
}

export function pushEvent(state, ev) {
  state.events.push(ev);
}
