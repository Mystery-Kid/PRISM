import { AudioEngine } from "./AudioEngine";
import { renderSessionWav } from "./render";
import { scheduleInstrumentVoice } from "./instrument-voice";
import { createMidiEnvelopePlan, midiPitchToFrequency } from "./midi";
import { BUILT_IN_INSTRUMENTS, createInstrumentState } from "@shared/instrument-library";
import { createFactoryDrumWav, factoryDrumAssetId, factoryDrumSamples } from "@shared/factory-drum-samples";
import { migrateProjectLibrary } from "@shared/migrations";
import type { SongSession, Track } from "@shared/types";

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(`Instrument acceptance: ${message}`); };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pcm = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: Math.min(14400, Math.floor((bytes.length - 44) / 4)) }, (_, index) => view.getInt16(44 + index * 4, true) / 32768);
};
const energy = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
function fixture(): SongSession {
  return migrateProjectLibrary({ version: 6, assets: [], releases: [], sessions: [{
    id: "instruments", releaseId: "release", title: "Instrument audio acceptance", tempo: 120, timeSignature: "4/4", masterVolume: .8,
    tracks: [{ id: "keys", name: "Keys", type: "instrument", instrument: createInstrumentState("prism.keys.fm-ep.v1"),
      volume: .7, notes: [{ id: "note", pitch: 60, startBeat: 0, durationBeats: 2, velocity: 110 }] }],
  }] }).sessions[0];
}
const noAssets = async () => { throw new Error("A synthesized instrument unexpectedly requested an audio asset."); };
export async function runInstrumentAudioChecks(): Promise<string[]> {
  const results: string[] = [], session = fixture(), track = session.tracks[0];
  const signals: { id: string; values: Float32Array }[] = [];
  for (const definition of BUILT_IN_INSTRUMENTS.filter((item) => item.kind === "synth")) {
    const current = { ...session, tracks: [{ ...track, instrument: createInstrumentState(definition.id) }] };
    const values = pcm(await renderSessionWav(current, noAssets));
    assert(energy(values) > .001, `${definition.name} is silent.`);
    const quiet = pcm(await renderSessionWav({ ...current, tracks: [{ ...current.tracks[0], notes: [{ ...track.notes[0], velocity: 30 }] }] }, noAssets));
    assert(energy(quiet) < energy(values) * .6, `${definition.name} ignores velocity.`);
    for (const previous of signals) {
      let dot = 0, a = 0, b = 0;
      for (let index = 0; index < values.length; index++) { dot += values[index]! * previous.values[index]!; a += values[index]! ** 2; b += previous.values[index]! ** 2; }
      assert(Math.abs(dot / Math.sqrt(a * b)) < .995, `${definition.id} is indistinguishable from ${previous.id}.`);
    }
    signals.push({ id: definition.id, values });
    results.push(`${definition.name}: nonzero/distinct/velocity`);
  }
  const legacy = { waveform: "triangle" as const, attack: .02, decay: .12, sustain: .55, release: .2 };
  const old = new OfflineAudioContext(1, 96000, 48000), current = new OfflineAudioContext(1, 96000, 48000);
  const oscillator = old.createOscillator(), gain = old.createGain(), note = track.notes[0];
  oscillator.type = legacy.waveform; oscillator.frequency.value = midiPitchToFrequency(note.pitch);
  const plan = createMidiEnvelopePlan(note, legacy, 1);
  gain.gain.setValueAtTime(plan.initialValue, 0);
  for (const event of plan.events) {
    if (event.curve === "set") gain.gain.setValueAtTime(event.value, event.timeSeconds);
    else gain.gain.linearRampToValueAtTime(event.value, event.timeSeconds);
  }
  oscillator.connect(gain); gain.connect(old.destination); oscillator.start(0); oscillator.stop(1.01);
  scheduleInstrumentVoice(current, current.destination, legacy, note, { when: 0, duration: 1 });
  const [before, after] = await Promise.all([old.startRendering(), current.startRendering()]);
  assert(before.getChannelData(0).every((value, index) => Math.abs(value - after.getChannelData(0)[index]!) < 1e-7), "Legacy waveform/ADSR sound changed.");
  const drum = { ...track, type: "drum", instrument: null, drumKit: { pads: factoryDrumSamples.map((sample) =>
    ({ id: String(sample.note), name: sample.name, note: sample.note, gain: 1, sampleAssetId: factoryDrumAssetId(sample.note) })) },
    notes: factoryDrumSamples.map((sample, index) => ({ id: String(index), pitch: sample.note, velocity: 110, durationBeats: .125, startBeat: index * .25 })) } as Track;
  const drumAudio = await renderSessionWav({ ...session, tracks: [drum] }, async (id) => {
    const definition = factoryDrumSamples.find((sample) => factoryDrumAssetId(sample.note) === id)!;
    const data = createFactoryDrumWav(definition.note);
    return new OfflineAudioContext(1, 1, 48000).decodeAudioData(data.buffer as ArrayBuffer);
  });
  assert(energy(pcm(drumAudio)) > .01, "Bundled drum sampler is silent.");
  let unavailableFailed = false;
  try { await renderSessionWav({ ...session, tracks: [{ ...track, instrument: { ...legacy, instrumentId: "missing.bank" } }] }, noAssets); }
  catch (error) { unavailableFailed = String(error).includes("unavailable"); }
  assert(unavailableFailed, "Missing instrument was silently exported with a substitute.");
  results.push("Legacy sample-exact parity; real generated drum sample decoding; unavailable export rejection");
  const engine = new AudioEngine(() => "");
  try {
    await engine.previewInstrumentNote(session, track.id, 60, 110);
    const context = (engine as unknown as { context: AudioContext & { setSinkId(value: { type: string }): Promise<void> } }).context;
    await context.setSinkId({ type: "none" });
    engine.stop(true);
    const organ = { ...track, id: "organ", instrument: createInstrumentState("prism.keys.organ.v1"), pan: .4 };
    let live = { ...session, tracks: [track, organ] };
    await engine.start(live); await wait(240);
    assert(engine.snapshot().meters[track.id]?.peak > .005 && engine.snapshot().meters.organ?.peak > .005, "Independent simultaneous live instruments are silent.");
    live = { ...live, tracks: [{ ...track, muted: true }, { ...organ, volume: .2 }] };
    engine.updateSession(live); await wait(100);
    assert(engine.snapshot().meters.keys?.peak < .003 && engine.snapshot().meters.organ?.peak > .005, "Track mute/gain did not reach the instrument graph.");
    engine.seek(.4); await wait(260);
    assert(engine.snapshot().meters.organ?.peak > .005, "Seeking into a sustained instrument lost the voice.");
    engine.stop(true);
    assert(engine.snapshot().activeSources === 0, "Stop retained oscillator/modulator sources.");
    await engine.previewInstrumentNote(session, track.id, 60, 96);
    engine.updateSession({ ...session, tracks: [{ ...track, instrument: createInstrumentState("prism.synth.pad.v1") }] });
    assert(engine.snapshot().activeSources === 0, "Instrument replacement retained an old preview voice.");
    results.push("Live independent polyphony, track gating, seek, stop/replacement cleanup");
  } finally { await engine.dispose(); }
  return results;
}
