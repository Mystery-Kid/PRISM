/**
 * Browser-only integration harness. Uses the real disk-backed ThemeStore, but
 * substitutes HTTP for Electron IPC. It is NOT installed-desktop verification.
 * Run `pnpm build` first. All data is isolated in a temporary directory.
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { ThemeStore } from "../src/main/theme-store";

async function main() {
const root = resolve(process.cwd(), "out/renderer");
const directory = await mkdtemp(join(tmpdir(), "prism-theme-ui-"));
let store = new ThemeStore(directory);
await store.initialize();
const bridge = `
const call = async (action, id) => {
  const response = await fetch('/__theme-test/' + action, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
};
window.prism = {
  getThemeState: () => call('get'),
  claimTheme: id => call('claim', id),
  applyTheme: id => call('apply', id),
  repairTheme: id => call('repair', id),
  listReleases: async () => [],
  onCloseRequested: () => () => {},
  openDataFolder: async () => {},
};
`;
const mime: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (path === "/__theme-test-bridge.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bridge);
      return;
    }
    if (path.startsWith("/__theme-test/")) {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1000) throw new Error("Request too large.");
      }
      const { id } = JSON.parse(body || "{}");
      const action = path.split("/").pop();
      let value: unknown;
      switch (action) {
        case "get": value = await store.getState(); break;
        case "claim": value = await store.claim(id); break;
        case "apply": value = await store.apply(id); break;
        case "repair": value = await store.repair(id); break;
        case "restart":
          store = new ThemeStore(directory);
          await store.initialize();
          value = await store.getState();
          break;
        case "remove-package":
          await rm(join(directory, "themes", "starry.json"), { force: true });
          value = await store.getState();
          break;
        default: throw new Error("Unknown test action.");
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(value));
      return;
    }
    const relative = path === "/" ? "/index.html" : decodeURIComponent(path);
    const file = resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}/`)) throw new Error("Invalid path.");
    let content: Buffer | string = await readFile(file);
    if (file.endsWith(".html")) {
      content = content.toString().replace('<script type="module"', '<script src="/__theme-test-bridge.js"></script><script type="module"');
    }
    response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
    response.end(content);
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
server.listen(5193, "0.0.0.0", () => console.log("Isolated PRISM theme UI test harness: http://localhost:5193"));
const cleanup = async () => {
  server.close();
  await rm(directory, { recursive: true, force: true });
  process.exit();
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
