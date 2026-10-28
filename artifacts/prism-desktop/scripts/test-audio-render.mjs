import { spawnSync } from "node:child_process";
import { createServer } from "vite";

const chromium = process.env.CHROMIUM_PATH || "chromium";
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Vite did not open a local test port.");

  const url = `http://127.0.0.1:${address.port}/src/renderer/audio/render.browser-test.html`;
  const result = spawnSync(chromium, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--timeout=15000",
    "--dump-dom",
    url,
  ], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Chromium exited with status ${result.status}: ${result.stderr?.slice(-2000) ?? ""}`);
  }
  const pass = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  if (!pass?.startsWith("PASS:")) {
    throw new Error(
      output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1] ??
        `The browser render test did not report a result.\n${output.slice(-4000)}`,
    );
  }
  console.log(pass);
} finally {
  await server.close();
}
