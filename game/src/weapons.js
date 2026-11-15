// weapons.js — one job: the weapon table. Every number the gunplay reads
// lives here, so tuning never touches the simulation code.
// damage: body damage at close range. headMult: headshot multiplier.
// rate: seconds between shots. spread: base radians of cone. moveSpread:
// extra cone at full sprint. recoil: pitch kick per shot (radians).
// bloom: extra spread added per shot, decays. range: metres before falloff.
export const WEAPONS = {
  pistol: {
    id: "pistol", name: "P9 Sidearm", price: 0, damage: 34, headMult: 2.5,
    rate: 0.16, auto: false, mag: 12, reserve: 36, reload: 1.1,
    spread: 0.011, moveSpread: 0.045, recoil: 0.011, bloom: 0.006,
    speed: 6.0, range: 26, zoom: 1, tracer: 0xffe08a,
  },
  smg: {
    id: "smg", name: "VK-9 Ripper", price: 1500, damage: 26, headMult: 2.5,
    rate: 0.085, auto: true, mag: 30, reserve: 90, reload: 1.6,
    spread: 0.02, moveSpread: 0.065, recoil: 0.008, bloom: 0.004,
    speed: 5.6, range: 22, zoom: 1, tracer: 0xffd27a,
  },
  rifle: {
    id: "rifle", name: "AR-77 Longshot", price: 2700, damage: 33, headMult: 2.5,
    rate: 0.11, auto: true, mag: 25, reserve: 75, reload: 2.0,
    spread: 0.008, moveSpread: 0.055, recoil: 0.013, bloom: 0.005,
    speed: 5.2, range: 42, zoom: 1.4, tracer: 0xffe08a,
  },
  sniper: {
    id: "sniper", name: "Lance-50", price: 4750, damage: 110, headMult: 2.0,
    rate: 1.15, auto: false, mag: 5, reserve: 15, reload: 2.8,
    spread: 0.001, moveSpread: 0.11, recoil: 0.05, bloom: 0.02,
    speed: 4.6, range: 90, zoom: 3.2, tracer: 0x9fd8ff,
  },
};

// The grenade is a thrown weapon, not a hitscan one: it lives in the same
// table so the buy menu and HUD treat every weapon the same way.
export const GRENADE = {
  id: "grenade", name: "Frag Charge", price: 300, damage: 120,
  radius: 6.5, fuse: 1.6, speed: 14,
};

export const BUY_ORDER = ["pistol", "smg", "rifle", "sniper", "grenade"];

export function weaponOf(id) {
  return id === "grenade" ? GRENADE : WEAPONS[id];
}
