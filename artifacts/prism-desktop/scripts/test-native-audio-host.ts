import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
async function main(): Promise<void> {
const executable = process.argv[2];
assert(executable, "Provide the real compiled native audio host path.");
const child = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
let buffer = "", sequence = 0;
const replies = new Map<number, (value: any) => void>();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  buffer += chunk;
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const response = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    replies.get(response.id)?.(response); replies.delete(response.id);
  }
});
const timeout = setTimeout(() => { child.kill(); throw new Error("Native audio protocol check timed out."); }, 20000);
try {
  const request = (command: string, fields: Record<string, unknown> = {}) => new Promise<any>(resolve => {
    const id = ++sequence;
    replies.set(id, resolve);
    child.stdin.write(JSON.stringify({ protocolVersion: 1, id, command, ...fields }) + "\n");
  });
  const status = await request("status");
  assert.equal(status.ok, true);
  assert.equal(status.result.protocolVersion, 1);
  assert.equal(status.result.asioCompiled, false, "Public CI build must not include unlicensed ASIO.");
  assert.equal(status.result.active, null);
  assert(Array.isArray(status.result.devices));
  const wrongDevice = { deviceId: "wasapi:missing", mode: "wasapi-shared", channels: 2, sampleRate: 48000, bufferFrames: 256 };
  assert.equal((await request("probe", wrongDevice)).ok, false, "Nonexistent device cannot be probed successfully.");
  assert.equal((await request("open", wrongDevice)).ok, false, "No silent default-device fallback.");
  assert.equal((await request("test-tone")).ok, false, "Diagnostic output requires an explicitly opened stream.");
  assert.equal((await request("status", { protocolVersion: 999 })).ok, false);
  assert.equal((await request("unsupported")).ok, false);
  assert.equal((await request("close")).ok, true);
  const exited = once(child, "exit");
  child.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0);
  console.log("Real native host protocol, enumeration contract, missing-device errors and safe close passed. No physical audio claims.");
} finally { clearTimeout(timeout); child.kill(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
