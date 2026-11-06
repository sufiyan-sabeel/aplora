#!/usr/bin/env node
/**
 * Serves the built Pages artifact exactly as GitHub Pages would: under the
 * repository sub-path, with a 404 page for unknown routes and no SPA fallback.
 *
 *   npm run serve:pages        → http://localhost:8080/aplora/
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../dist");
const prefix = "/aplora";
const port = Number(process.env.PORT ?? 8080);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith(prefix)) {
    response.writeHead(302, { Location: `${prefix}/` });
    response.end();
    return;
  }

  pathname = pathname.slice(prefix.length) || "/";
  let target = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));

  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
  if (!existsSync(target) && existsSync(`${target}.html`)) target = `${target}.html`;
  if (!existsSync(target)) target = join(root, "404.html");

  const status = target.endsWith("404.html") ? 404 : 200;
  response.writeHead(status, {
    "content-type": types[extname(target)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(target).pipe(response);
}).listen(port, () => {
  console.log(`Serving the Pages artifact at http://localhost:${port}${prefix}/`);
});
