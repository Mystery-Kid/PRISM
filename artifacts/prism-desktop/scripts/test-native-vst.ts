import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeNativeSlice, decodeNativeSlice } from "../src/shared/native-contract";
import { migrateProjectLibrary } from "../src/shared/migrations";
const execute = promisify(execFile);
async function main() {
const [exeArg, moduleArg] = process.argv.slice(2);
if (!exeArg || !moduleArg) throw new Error("Supply the compiled host and legally built MDA VST3 test module.");
const exe = resolve(exeArg), module = resolve(moduleArg);
const catalog = JSON.parse((await execute(exe, ["--scan", module], { timeout: 15000, maxBuffer: 4*1024*1024 })).stdout);
const instrument = catalog.find((item: { name: string }) => item.name === "mda DX10");
const effect = catalog.find((item: { name: string }) => item.name === "mda Overdrive");
assert.ok(instrument && effect, "External instrument/effect identities were not discovered.");
const library = migrateProjectLibrary({ version: 8, releases: [], assets: [], sessions: [{
  id: "song", releaseId: "release", title: "Native processing proof", tempo: 120, timeSignature: "6/8",
  tracks: [{ id: "midi", type: "instrument", notes: [{ id: "note", pitch: 60, velocity: 100, startBeat: 1, durationBeats: 2 }] }],
}] });
const session = library.sessions[0], track = session.tracks[0], rate = 48000;
const directory = await mkdtemp(join(tmpdir(), "prism-native-"));
try {
  const processPlugin = async (id: string, name: string, request: Uint8Array, state = "-") => {
    const input = join(directory, name+".pvst"), output = join(directory, name+".pvso");
    await writeFile(input, request);
    const result = await execute(exe, ["--render", module, id, input, output, state], { timeout: 30000, maxBuffer: 16384 });
    assert.equal(JSON.parse(result.stdout).ok, true);
    return { ...decodeNativeSlice(await readFile(output)), state: output+".state" };
  };
  const request = encodeNativeSlice(session, track, { seconds: 2, sampleRate: rate, blockSize: 256 });
  const synth = await processPlugin(instrument.id, "instrument", request);
  const peak = (samples: Float32Array, lo = 0, hi = samples.length) => {
    let value = 0; for (let i = lo; i < hi; i++) value = Math.max(value, Math.abs(samples[i])); return value;
  };
  assert.ok(peak(synth.channels[0]) > .001, "Native instrument returned silence.");
  assert.ok(peak(synth.channels[0], 0, Math.floor(rate*.24)) < 1e-5, "Project 6/8 note timing was lost.");
  assert.ok(peak(synth.channels[0], Math.floor(rate*.26), Math.floor(rate*.7)) > .001, "Native note-on was not scheduled.");
  const restored = await processPlugin(instrument.id, "restored", request, synth.state);
  assert.ok(peak(restored.channels[0]) > .001, "Restored native instrument is silent.");
  const source = Float32Array.from({ length: rate*2 }, (_, i) => .25*Math.sin(2*Math.PI*220*i/rate));
  const silentTrack = { ...track, notes: [] };
  const effectRequest = (drive: number) => encodeNativeSlice(session, silentTrack, {
    seconds: 2, sampleRate: rate, blockSize: 256, input: [source, source], parameters: [{ id: 0, value: drive }],
  });
  const clean = await processPlugin(effect.id, "effect-clean", effectRequest(0));
  const driven = await processPlugin(effect.id, "effect-driven", effectRequest(1));
  let difference = 0;
  for (let i = 0; i < source.length; i++) difference += Math.abs(clean.channels[0][i]-driven.channels[0][i]);
  assert.ok(peak(driven.channels[0]) > .001 && difference/source.length > .001, "Native effect parameters did not change real audio.");
  await assert.rejects(execute(exe, ["--scan", join(directory, "missing.vst3")], { timeout: 5000 }));
  await assert.rejects(processPlugin("00000000000000000000000000000000", "missing-class", request));
  await assert.rejects(processPlugin(instrument.id, "truncated", request.subarray(0, 40)));
  console.log(JSON.stringify({ ok: true, scope: "Native offline feasibility only, NOT completed workstation integration",
    instrument: instrument.name, effect: effect.name, checks: [
      "Actual native VST3 factory and processor", "PRISM saved-session MIDI converted with denominator-aware timing",
      "Non-silent instrument audio and component state restore", "Real effect PCM and normalized parameter changes",
      "Missing module/class and malformed request fail without project mutation",
    ], unverified: ["Live Web Audio bridge", "Workstation UI/editor windows", "Full session plugin persistence", "Hardware/latency"] }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
