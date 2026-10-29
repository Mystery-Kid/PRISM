import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";

const chromium = process.env.CHROMIUM_PATH || "chromium";
const profile = await mkdtemp(join(tmpdir(), "prism-audio-test-"));
let browser;
let timer;
let lastProgress = "loading the test page";
let stderr = "";
let resolveResult;
let rejectResult;
const completion = new Promise((resolve, reject) => {
  resolveResult = resolve;
  rejectResult = reject;
});
const receiveResult = (request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    try {
      const message = JSON.parse(body);
      response.end("ok");
      if (message.progress) lastProgress = message.progress;
      else if (message.result?.startsWith("PASS:")) resolveResult(message.result);
      else rejectResult(new Error(message.result || "The browser returned no result."));
    } catch (error) {
      response.statusCode = 400;
      response.end("invalid result");
      rejectResult(error);
    }
  });
};
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src/renderer"),
      "@shared": resolve(process.cwd(), "src/shared"),
    },
  },
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
  plugins: [{
    name: "prism-audio-test-results",
    configureServer(vite) {
      vite.middlewares.use("/__prism_audio_test_result", receiveResult);
    },
  }],
});

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Vite did not open a local test port.");
  const url = `http://127.0.0.1:${address.port}/src/renderer/audio/render.browser-test.html`;
  browser = spawn(chromium, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    `--user-data-dir=${profile}`, url,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4000); });
  browser.once("error", rejectResult);
  browser.once("exit", (code) => rejectResult(new Error(`Chromium exited early (${code}).\n${stderr}`)));
  timer = setTimeout(() => {
    rejectResult(new Error(`Audio check timed out while ${lastProgress}.\n${stderr}`));
  }, 45_000);
  console.log(await completion);
} finally {
  clearTimeout(timer);
  if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGKILL");
    await once(browser, "exit");
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
