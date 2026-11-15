// effects.js — one job: transient visuals. Tracers, muzzle flash, hit
// sparks, explosions, and the spike beacon. Everything here is pooled or
// short-lived; nothing allocates in the render loop.
import * as THREE from "three";

const MAX_TRACERS = 24;
const MAX_SPARKS = 12;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffe08a, transparent: true, opacity: 0,
      }));
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;

    this.sparks = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }),
      );
      scene.add(mesh);
      this.sparks.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.sparkIdx = 0;

    // Muzzle flash: one reusable point light + quad, shown for ~40 ms.
    this.flashLight = new THREE.PointLight(0xffc36b, 0, 9);
    scene.add(this.flashLight);
    this.flashLife = 0;

    // Explosion: one reusable expanding shell + light.
    this.boom = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0 }),
    );
    scene.add(this.boom);
    this.boomLight = new THREE.PointLight(0xff7a1a, 0, 18);
    scene.add(this.boomLight);
    this.boomLife = 0;

    // Spike beacon: a vertical beam shown while the spike is planted.
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 30, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff5a1a, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.beacon.visible = false;
    scene.add(this.beacon);
  }

  tracer(from, to, color) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  muzzle(pos) {
    this.flashLight.position.set(pos.x, pos.y, pos.z);
    this.flashLight.intensity = 14;
    this.flashLife = 0.045;
  }

  spark(pos) {
    const s = this.sparks[this.sparkIdx];
    this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
    s.mesh.position.set(pos.x, pos.y, pos.z);
    s.mesh.material.opacity = 1;
    s.vx = (Math.random() - 0.5) * 3;
    s.vy = Math.random() * 2.5;
    s.vz = (Math.random() - 0.5) * 3;
    s.life = 0.3;
  }

  explosion(pos) {
    this.boom.position.set(pos.x, pos.y + 0.4, pos.z);
    this.boom.scale.setScalar(0.4);
    this.boom.material.opacity = 0.85;
    this.boomLight.position.set(pos.x, pos.y + 1, pos.z);
    this.boomLight.intensity = 60;
    this.boomLife = 0.5;
  }

  setBeacon(x, z, on) {
    this.beacon.visible = on;
    if (on) this.beacon.position.set(x, 15, z);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.material.opacity = 0;
      }
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.mesh.material.opacity = Math.max(0, s.life / 0.3);
      }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flashLight.intensity = 0;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      const k = 1 - this.boomLife / 0.5;
      this.boom.scale.setScalar(0.4 + k * 6);
      this.boom.material.opacity = 0.85 * (1 - k);
      this.boomLight.intensity = 60 * (1 - k);
      if (this.boomLife <= 0) {
        this.boom.material.opacity = 0;
        this.boomLight.intensity = 0;
      }
    }
  }
}
