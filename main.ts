// main.ts — entrypoint for the threejs-fps-02 make.fun entry (Node 22, stdlib only).
// Copies game/ and screenshots/ from this repository into the output directory
// (MAKEFUN_OUTPUT_DIR, else /output) and writes /output/dossier.json with
// buildDossier from vendor/makefun-threejs.ts. Deterministic: same input files
// always produce the same output bytes.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

// Start from a clean output directory so stale files can never leak in.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

cpSync(join(repoRoot, "game"), join(outDir, "game"), { recursive: true });
cpSync(join(repoRoot, "screenshots"), join(outDir, "screenshots"), {
  recursive: true,
});

const dossier = await buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, "dossier.json"), dossier);
console.log(`wrote ${join(outDir, "dossier.json")} (${dossier.length} bytes)`);
