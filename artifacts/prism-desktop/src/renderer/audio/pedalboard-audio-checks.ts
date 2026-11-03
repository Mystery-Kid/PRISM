import { nativeEffectCatalog, effectDefaults } from "@shared/effect-definitions";
import type { EffectState } from "@shared/types";
import { createEffectHandle } from "./effects";
import { createTrackGraph } from "./graph";
import { migrateProjectLibrary } from "@shared/migrations";

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const energy = (signal: Float32Array, start = 0, end = signal.length) => {
  let sum = 0; for (let i = start; i < end; i++) sum += signal[i] ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
};
const difference = (a: Float32Array, b: Float32Array) =>
  energy(Float32Array.from(a, (value, index) => value - b[index]));

export async function runPedalboardAudioChecks(): Promise<string[]> {
  const results: string[] = [];
  const make = (type: EffectState["type"], parameters = {}): EffectState => ({
    id: type, type, enabled: true, parameters: { ...effectDefaults(type), ...parameters },
  });
  const render = async (effects: EffectState[], amplitude = .6): Promise<Float32Array> => {
    const context = new OfflineAudioContext(2, 48000, 48000);
    const source = context.createBufferSource(), buffer = context.createBuffer(2, 48000, 48000);
    for (let ch = 0; ch < 2; ch++) {
      const samples = buffer.getChannelData(ch);
      for (let i = 0; i < samples.length; i++)
        samples[i] = amplitude * (.7 * Math.sin(i * 2 * Math.PI * 220 / 48000) + .3 * Math.sin(i * 2 * Math.PI * 1723 / 48000));
    }
    source.buffer = buffer;
    const handles = effects.map(effect => createEffectHandle(context, effect));
    let cursor: AudioNode = source;
    for (const handle of handles) { cursor.connect(handle.input); cursor = handle.output; }
    cursor.connect(context.destination); source.start(0);
    const output = await context.startRendering();
    handles.forEach(handle => handle.dispose());
    return output.getChannelData(0);
  };
  const reference = await render([]);
  for (const definition of nativeEffectCatalog) {
    const effect = make(definition.type, definition.type === "equalizer" ? { gain: 12 } :
      definition.type === "limiter" ? { input: 12, ceiling: -6 } : {});
    const processed = await render([effect]);
    assert(processed.every(Number.isFinite) && energy(processed) > .001, `${effect.type} is silent or unstable.`);
    assert(difference(reference, processed) > .001, `${effect.type} does not process the signal.`);
    const bypassed = await render([{ ...effect, enabled: false }]);
    assert(difference(reference, bypassed) < 1e-6, `${effect.type} bypass changes the signal.`);
    const parameter = definition.parameters[0];
    const altered = await render([{ ...effect, parameters: { ...effect.parameters, [parameter.key]:
      effect.parameters[parameter.key] === parameter.min ? parameter.max : parameter.min } }]);
    assert(difference(processed, altered) > .0001, `${effect.type} primary parameter is inert.`);
    results.push(`${effect.type}: real processing, parameter response, exact bypass`);
  }
  const quiet = await render([make("noise-gate", { threshold: -24 })], .004);
  const quietReference = await render([], .004);
  const loud = await render([make("noise-gate", { threshold: -24 })]);
  assert(energy(quiet, 12000) < energy(quietReference, 12000) * .02, "Gate does not close on quiet input.");
  assert(energy(loud, 12000) > energy(reference, 12000) * .9, "Gate does not open on loud input.");
  const limited = await render([make("limiter", { input: 24, ceiling: -6 })]);
  assert(limited.every(value => Math.abs(value) <= Math.pow(10, -6 / 20) + .0001), "Limiter exceeded its sample ceiling.");
  const eq = make("equalizer", { frequency: 1500, gain: 18, q: 2 });
  const drive = make("distortion", { drive: 10, tone: 8000 });
  assert(difference(await render([eq, drive]), await render([drive, eq])) > .01, "Reordering does not change nonlinear processing.");
  const driveSignals = await Promise.all((["distortion", "overdrive", "fuzz"] as const).map(type => render([make(type)])));
  assert(difference(driveSignals[0], driveSignals[1]) > .001 && difference(driveSignals[1], driveSignals[2]) > .001, "Drive types are not distinct.");

  // Exercise the SAME graph live, including rapid reorder/bypass and immediate close.
  const context = new AudioContext({ sinkId: { type: "none" } } as AudioContextOptions);
  await context.resume();
  let started = 0, ended = 0;
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create(); started++;
    oscillator.addEventListener("ended", () => ended++);
    return oscillator;
  };
  const fixture = migrateProjectLibrary({ version: 7, assets: [], releases: [], sessions: [{
    id: "pedals", releaseId: "release", title: "Pedals", tracks: [{ id: "track", type: "audio", volume: 1 }],
  }] }).sessions[0].tracks[0];
  const track = { ...fixture, effects: [make("chorus"), make("flanger"), make("phaser")] };
  const graph = createTrackGraph(context, track, context.destination);
  const oscillator = create(); oscillator.connect(graph.input); oscillator.start();
  for (let i = 0; i < 12; i++) {
    graph.update({ ...track, effects: i % 2 ? [...track.effects].reverse() : track.effects }, true);
  }
  await new Promise(resolve => setTimeout(resolve, 160));
  graph.update({ ...track, effects: track.effects.map(effect => ({ ...effect, enabled: false })) }, true);
  graph.dispose(); oscillator.stop();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(started > 3 && ended === started, `Modulation sources leaked: ${started} started, ${ended} ended.`);
  await context.close();
  results.push("Gate open/close, sample-peak ceiling, distinct drives, order-dependent audio, live reorder/bypass/LFO cleanup");
  return results;
}
