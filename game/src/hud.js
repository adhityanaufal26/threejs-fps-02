// hud.js — one job: the DOM HUD. Health, ammo, money, round timer, team
// score, objective state, kill feed, crosshair, buy menu and banners. It
// only writes a DOM node when its text actually changes.
import { WEAPONS, GRENADE, BUY_ORDER, weaponOf } from "./weapons.js";
import { CFG, playerOf } from "./state.js";

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(state, hooks) {
    this.state = state;
    this.hooks = hooks; // { onBuy(id), onResume(), onRestart() }
    this.cache = {};
    this.buyOpen = false;
    this._buildBuyMenu();
    this._bind();
  }

  set(id, text) {
    if (this.cache[id] !== text) {
      this.cache[id] = text;
      $(id).textContent = text;
    }
  }

  _bind() {
    $("buy-close").addEventListener("click", () => this.showBuy(false));
    $("resume-btn").addEventListener("click", () => this.hooks.onResume());
    $("restart-btn").addEventListener("click", () => this.hooks.onRestart());
    $("start-btn").addEventListener("click", () => this.hooks.onStart());
    for (const id of BUY_ORDER) {
      $(`buy-${id}`).addEventListener("click", () => this.hooks.onBuy(id));
    }
  }

  _buildBuyMenu() {
    const list = $("buy-list");
    const items = [
      ...BUY_ORDER.map((id) => ({ id, w: weaponOf(id) })),
    ];
    for (const { id, w } of items) {
      const row = document.createElement("div");
      row.className = "buy-row";
      row.id = `buy-${id}`;
      const key = BUY_ORDER.indexOf(id) + 1;
      const desc = id === "grenade"
        ? `area damage, ${GRENADE.radius}m blast`
        : `${w.damage} dmg · ${w.mag} rnd mag · ${w.auto ? "auto" : "semi"}`;
      row.innerHTML = `<span class="buy-key">[${key}]</span> <b>${w.name}</b> — ${desc} <span class="buy-price">$${w.price}</span>`;
      list.appendChild(row);
    }
  }

  showBuy(open) {
    this.buyOpen = open;
    $("buy-menu").style.display = open ? "block" : "none";
    if (open) this.refreshBuy();
  }

  refreshBuy() {
    const p = playerOf(this.state);
    for (const id of BUY_ORDER) {
      const row = $(`buy-${id}`);
      const w = weaponOf(id);
      const afford = id === "grenade" ? p.grenades < 2 && p.money >= w.price : p.money >= w.price && p.weapon !== id;
      row.classList.toggle("cant", !afford);
      row.classList.toggle("owned", id !== "grenade" && p.weapon === id);
    }
    this.set("buy-money", `$${p.money}`);
  }

  update() {
    const st = this.state;
    const p = playerOf(st);
    const w = WEAPONS[p.weapon];

    this.set("hud-hp", `${Math.max(0, Math.ceil(p.hp))}`);
    $("hp-bar").style.width = `${Math.max(0, p.hp)}%`;
    this.set("hud-ammo", p.reloadT > 0 ? "––" : `${p.mag}`);
    this.set("hud-reserve", `/${p.reserve}`);
    this.set("hud-weapon", w.name);
    this.set("hud-money", `$${p.money}`);
    this.set("hud-grenades", `◉ ${p.grenades}`);
    this.set("hud-round", `ROUND ${st.round}`);
    const scoreHtml = `<span class="ember">${st.score.ember}</span> — <span class="ash">${st.score.ash}</span>`;
    if (this.cache.score !== scoreHtml) {
      this.cache.score = scoreHtml;
      $("hud-score").innerHTML = scoreHtml;
    }
    const t = Math.max(0, Math.ceil(st.timer));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, "0");
    this.set("hud-timer", st.phase === "live" || st.phase === "buy" ? `${mm}:${ss}` : "—");
    this.set("hud-phase", st.phase === "buy" ? "BUY PHASE" : st.phase === "live" ? "ROUND LIVE" : "");

    const spike = st.spike;
    let obj = "Plant the spike at the reactor";
    if (spike.planted) obj = `SPIKE PLANTED — ${Math.max(0, Math.ceil(CFG.detonateTime - spike.plantT))}s to detonation`;
    else if (spike.dropped) obj = "Spike dropped — pick it up";
    else if (spike.carrierId === 0) obj = "You carry the spike — plant at the reactor";
    this.set("hud-objective", obj);
    $("hud-objective").classList.toggle("danger", spike.planted);

    // Crosshair gap follows spread: still, crouched, moving, firing.
    const moveFrac = Math.min(1, p.speed / (w.speed || 6));
    const gap = 6 + moveFrac * 14 + p.bloom * 220 + (p.scoped ? -4 : 0);
    document.documentElement.style.setProperty("--ch-gap", `${gap.toFixed(1)}px`);
    $("crosshair").style.display = st.phase === "live" && p.alive && !p.scoped ? "block" : "none";
    $("scope").style.display = p.scoped ? "block" : "none";

    // Plant/defuse progress bar.
    const prog = spike.planted ? spike.defuseProgress / CFG.defuseTime
      : spike.plantProgress / CFG.plantTime;
    const bar = $("progress-wrap");
    if (prog > 0 && st.phase === "live") {
      bar.style.display = "block";
      $("progress-fill").style.width = `${Math.min(100, prog * 100)}%`;
      this.set("progress-label", spike.planted ? "DEFUSING…" : "PLANTING…");
    } else {
      bar.style.display = "none";
    }

    // Kill feed, newest last.
    const feed = $("killfeed");
    const html = st.feed.slice(-5).map((f) => `<div>${f.text}</div>`).join("");
    if (this.cache.feed !== html) {
      this.cache.feed = html;
      feed.innerHTML = html;
    }

    // Damage vignette and low-health pulse.
    $("damage").style.opacity = p.hp < 35 && p.alive ? String(0.35 + 0.2 * Math.sin(st.time * 5)) : "0";
    $("hud").style.display = st.phase === "menu" ? "none" : "block";
  }

  banner(title, sub, cls = "") {
    const b = $("banner");
    $("banner-title").textContent = title;
    $("banner-sub").textContent = sub;
    b.className = `show ${cls}`;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { b.className = ""; }, 3200);
  }

  hitmarker(head, kill) {
    const h = $("hitmarker");
    h.className = `show ${head ? "head" : ""} ${kill ? "kill" : ""}`;
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => { h.className = ""; }, 120);
  }

  flashDamage() {
    const d = $("damage-flash");
    d.className = "show";
    setTimeout(() => { d.className = ""; }, 180);
  }

  showMenu(show) {
    $("menu").style.display = show ? "flex" : "none";
  }

  showMatchEnd(winner) {
    $("match-title").textContent = winner === "ember" ? "EMBER WINS THE MATCH" : "ASH WINS THE MATCH";
    $("match-sub").textContent = `Final score ${this.state.score.ember} — ${this.state.score.ash}. The yard is yours — run it back.`;
    $("match-end").style.display = "flex";
  }

  hideMatchEnd() {
    $("match-end").style.display = "none";
  }
}
