// player.js — one job: the human player's input. Keyboard movement, mouse
// look via pointer lock, firing, reload, grenade, crouch, scope, plant and
// the buy menu. It translates input into sim calls; it holds no game state.
import { CFG, playerOf } from "./state.js";
import { WEAPONS, BUY_ORDER, weaponOf } from "./weapons.js";
import {
  moveAgent, tryFire, startReload, throwGrenade, buyWeapon,
} from "./sim.js";

// Pointer lock returns a promise in newer Chrome; swallow a rejection
// (headless, or the user Esc-ing at the wrong moment) so it never surfaces
// as an unhandled page error.
export function lockPointer(el) {
  try {
    const r = el.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch {
    // Pointer lock unavailable; the game still renders and plays.
  }
}

export class PlayerInput {
  constructor(state, canvas, hooks) {
    this.state = state;
    this.canvas = canvas;
    this.hooks = hooks; // { onBuyMenu(open), onLockChange(locked), onPause() }
    this.keys = {};
    this.mouseDown = false;
    this.mouseRight = false;
    this.locked = false;
    this._planting = false;
    this._bind();
  }

  get player() {
    return playerOf(this.state);
  }

  _bind() {
    const canvas = this.canvas;
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      const st = this.state;
      if (e.code === "KeyR") startReload(st, this.player);
      if (e.code === "KeyG") throwGrenade(st, this.player);
      if (e.code === "KeyB") this.hooks.onBuyMenu();
      if (e.code === "Digit1") this.selectSlot(1);
      if (e.code === "Digit2") this.selectSlot(2);
      if (e.code === "Digit3") this.selectSlot(3);
      if (e.code === "Digit4") this.selectSlot(4);
      if (e.code === "Digit5") this.selectSlot(5);
      if (e.code === "KeyE") this._planting = true;
      if (e.code === "Escape") this.hooks.onPause();
    });
    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
      if (e.code === "KeyE") this._planting = false;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.mouseRight = true;
      if (!this.locked && this.state.phase !== "menu") {
        lockPointer(canvas);
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRight = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      this.hooks.onLockChange(this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      const p = this.player;
      const sens = p.scoped ? 0.0009 : 0.0022;
      p.yaw -= e.movementX * sens;
      p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - e.movementY * sens));
    });
    window.addEventListener("blur", () => {
      this.keys = {};
      this.mouseDown = false;
      this.mouseRight = false;
      this._planting = false;
    });
  }

  // Buy-menu number keys double as weapon-slot keys during a round.
  selectSlot(n) {
    const st = this.state;
    const p = this.player;
    if (st.phase === "buy" && this.hooks.buyMenuOpen()) {
      const id = BUY_ORDER[n - 1];
      if (id) buyWeapon(st, p, id);
      return;
    }
    if (st.phase !== "live" || !p.alive) return;
    if (n >= 1 && n <= 4) {
      const ids = ["pistol", "smg", "rifle", "sniper"];
      const id = ids[n - 1];
      if (p.weapon !== id && p._owned?.includes(id)) {
        // Park the current weapon's ammo, load the other weapon's.
        p.ammo[p.weapon] = { mag: p.mag, reserve: p.reserve };
        p.weapon = id;
        const saved = p.ammo[id] ?? { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
        p.mag = saved.mag;
        p.reserve = saved.reserve;
        p.reloadT = 0;
      }
    } else if (n === 5) {
      throwGrenade(st, p);
    }
  }

  // Called every fixed step. Returns nothing; writes into the player agent.
  update(dt) {
    const st = this.state;
    const p = this.player;
    p._planting = this._planting && st.phase === "live";
    if (st.phase !== "live" || !p.alive) {
      p.scoped = false;
      return;
    }
    p.crouch = !!this.keys["ControlLeft"] || !!this.keys["KeyC"];
    const w = WEAPONS[p.weapon];
    p.scoped = this.mouseRight && p.weapon === "sniper" && p.mag > 0;

    // WASD in camera space; Shift walks (quieter, tighter spread via speed).
    const f = (this.keys["KeyW"] ? 1 : 0) - (this.keys["KeyS"] ? 1 : 0);
    const s = (this.keys["KeyD"] ? 1 : 0) - (this.keys["KeyA"] ? 1 : 0);
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    if (this.keys["ShiftLeft"]) {
      wx *= 0.45;
      wz *= 0.45;
    }
    moveAgent(st, p, wx, wz, dt);

    // Recoil recovery pulls the pitch back toward where the player aimed.
    if (p.recoil > 0) p.pitch -= p.recoil * dt * 2.2;

    if (this.mouseDown) {
      const fired = tryFire(st, p, p.yaw, p.pitch);
      if (!w.auto) this.mouseDown = false;
      if (fired) {
        // Recoil kick: the camera jumps up a touch on every shot.
        p.pitch += w.recoil * 0.55;
      }
    }
  }
}

// Remember which weapons a player owns so slot keys can switch between them.
// Called by the HUD buy handler after a purchase.
export function rememberOwned(p) {
  if (!p._owned) p._owned = ["pistol"];
  if (!p._owned.includes(p.weapon)) p._owned.push(p.weapon);
}
