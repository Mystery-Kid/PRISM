import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateProjectLibrary } from "../shared/migrations";
import { BUILT_IN_INSTRUMENTS, createInstrumentState, instrumentIsAvailable, withInstrumentParameter } from "../shared/instrument-library";
import { normalizeInstrumentPreset } from "../shared/instrument-presets";
import { createFactoryDrumPcm, createFactoryDrumWav, factoryDrumSamples } from "../shared/factory-drum-samples";
import { installFactoryDrums } from "./factory-drums";
import { saveProjectFile, importProjectFile } from "./project-file";

const project = (instrument: unknown) => migrateProjectLibrary({ version: 5, assets: [],
  releases: [{ id: "release", title: "Library fixture", songIds: ["song"], releaseType: "Single" }],
  sessions: [{ id: "song", releaseId: "release", title: "Song", tracks: [{
    id: "keys", type: "instrument", instrument, notes: [{ id: "note", pitch: 60, startBeat: 0, durationBeats: 2, velocity: 91 }],
  }] }],
});
test("legacy oscillator fields remain exact while the library upgrades safely", () => {
  const legacy = { waveform: "triangle", attack: .02, decay: .2, sustain: .6, release: .3 };
  const library = project(legacy);
  assert.equal(library.version, 6);
  assert.deepEqual(library.sessions[0].tracks[0].instrument, legacy);
  assert.deepEqual(library.instrumentPresets, []);
});
test("every catalog synth has a stable supported identity and persistent parameters", () => {
  for (const definition of BUILT_IN_INSTRUMENTS.filter((item) => item.kind === "synth")) {
    const state = createInstrumentState(definition.id);
    assert(instrumentIsAvailable(state));
    const library = project(state);
    assert.deepEqual(migrateProjectLibrary(JSON.parse(JSON.stringify(library))).sessions[0].tracks[0].instrument, state);
    for (const parameter of definition.parameters) assert.equal(withInstrumentParameter(state, parameter.key, Infinity).parameters?.[parameter.key], parameter.default);
  }
});
test("unavailable instruments retain their original raw state and MIDI through repeated reopening", () => {
  const missing = { instrumentId: "vendor.uninstalled.orchestra", waveform: "unsupported-waveform",
    parameters: { articulation: "future-articulation" }, vendorState: { bank: "unavailable.sfz", program: 7 } };
  let library = project(missing);
  const notes = library.sessions[0].tracks[0].notes;
  for (let index = 0; index < 3; index++) library = migrateProjectLibrary(JSON.parse(JSON.stringify(library)));
  const track = library.sessions[0].tracks[0];
  assert.equal(track.instrument?.instrumentId, missing.instrumentId);
  assert(!instrumentIsAvailable(track.instrument));
  assert.deepEqual(track.instrumentRecovery?.rawState, missing);
  assert.deepEqual(track.notes, notes);
});
test("named presets retain concrete state, reject invalid envelopes, and keep missing IDs recoverable", () => {
  const input = { id: "preset", version: 1, name: "Warm keys", type: "instrument", instrument: createInstrumentState("prism.keys.fm-ep.v1"), sampler: null, drumKit: null };
  const preset = normalizeInstrumentPreset(input);
  assert.equal(preset.instrument?.presetId, "preset");
  assert.equal(preset.instrument?.presetName, "Warm keys");
  assert.deepEqual(project(preset.instrument).sessions[0].tracks[0].instrument, preset.instrument);
  assert.throws(() => normalizeInstrumentPreset({ ...input, instrument: { ...input.instrument, attack: -1 } }), /invalid/);
  const unknown = normalizeInstrumentPreset({ ...input, instrument: { ...input.instrument, instrumentId: "future.instrument" } });
  assert(!instrumentIsAvailable(unknown.instrument));
  assert.throws(() => migrateProjectLibrary({ ...project(input.instrument), instrumentPresets: {} }), /damaged/);
});
test("all eight original factory samples are deterministic, distinct and non-silent valid WAVs", () => {
  const signatures = new Set<string>();
  for (const definition of factoryDrumSamples) {
    const pcm = createFactoryDrumPcm(definition.note);
    assert(Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length) > .015);
    const wav = createFactoryDrumWav(definition.note);
    assert.equal(Buffer.from(wav).subarray(0, 4).toString(), "RIFF");
    assert.deepEqual(createFactoryDrumWav(definition.note), wav);
    signatures.add(Buffer.from(wav).subarray(44, 300).toString("hex"));
  }
  assert.equal(signatures.size, 8);
});
test("factory installation is idempotent, portable with real media, and rolls metadata back on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-instruments-"));
  try {
    const assets = join(root, "assets"); await mkdir(assets);
    const library = project(createInstrumentState("prism.keys.organ.v1"));
    const kit = await installFactoryDrums(library, assets, async () => {});
    await installFactoryDrums(library, assets, async () => {});
    assert.equal(library.assets.length, 8);
    const drum = structuredClone(library.sessions[0].tracks[0]);
    drum.id = "drums"; drum.type = "drum"; drum.instrument = null; drum.drumKit = kit; drum.notes[0].pitch = 36;
    library.sessions[0].tracks.push(drum);
    library.instrumentPresets.push(normalizeInstrumentPreset({ id: "local", name: "EP", version: 1, type: "instrument",
      instrument: createInstrumentState("prism.keys.fm-ep.v1"), sampler: null, drumKit: null }));
    const destination = join(root, "instruments.prism");
    await saveProjectFile(destination, library, library.sessions[0], assets);
    const restoredAssets = join(root, "restored"); await mkdir(restoredAssets);
    const restored = await importProjectFile(destination, restoredAssets);
    assert.equal(restored.library.sessions[0].tracks[0].instrument?.instrumentId, "prism.keys.organ.v1");
    const restoredKit = restored.library.sessions[0].tracks[1].drumKit!;
    assert.equal(restoredKit.pads.length, 8);
    const asset = restored.library.assets.find((item) => item.id === restoredKit.pads[0].sampleAssetId)!;
    assert.equal((await readFile(join(restoredAssets, asset.storageName))).subarray(0, 4).toString(), "RIFF");
    const failing = project(createInstrumentState("prism.keys.organ.v1"));
    await assert.rejects(installFactoryDrums(failing, assets, async () => { throw new Error("Disk full"); }), /Disk full/);
    assert.deepEqual(failing.assets, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
