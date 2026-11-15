// serve.ts — dev-only static server for game/ (Node 22, stdlib only).
// Serves the directory ./game on http://localhost:8080. Not part of the game.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "game");
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(root, decodeURIComponent(req.url ?? "/")));
    if (!path.startsWith(root)) throw new Error("outside root");
    const file = path.endsWith("/") ? join(path, "index.html") : path;
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(8080, () => console.log("serving game/ at http://localhost:8080"));
