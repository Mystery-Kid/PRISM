import type { EffectState, Track } from "@shared/types";
import { createEffectHandle, type EffectHandle } from "./effects";

export type TrackGraph = {
  input: GainNode;
  pan: StereoPannerNode;
  fader: GainNode;
  analyser: AnalyserNode;
  update(track: Track, isAudible: boolean): void;
  dispose(): void;
};

type EffectChain = {
  first: AudioNode;
  handles: EffectHandle[];
  outputLevel: GainNode;
};

function sameEffectLayout(left: EffectState[], right: EffectState[]): boolean {
  return left.length === right.length && left.every(
    (effect, index) => effect.id === right[index]?.id && effect.type === right[index]?.type,
  );
}

function buildEffectChain(
  context: BaseAudioContext,
  input: AudioNode,
  destination: AudioNode,
  effects: EffectState[],
  initialLevel: number,
): EffectChain {
  const handles = effects.map((effect) => createEffectHandle(context, effect));
  const outputLevel = context.createGain();
  outputLevel.gain.setValueAtTime(initialLevel, context.currentTime);
  let cursor: AudioNode = input;
  for (const handle of handles) {
    cursor.connect(handle.input);
    cursor = handle.output;
  }
  const first = handles[0]?.input ?? outputLevel;
  cursor.connect(outputLevel);
  outputLevel.connect(destination);
  return { first, handles, outputLevel };
}

function fadeGain(context: BaseAudioContext, gain: GainNode, target: number): void {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(target, now + 0.025);
}

function disposeEffectChain(input: AudioNode, chain: EffectChain): void {
  try {
    input.disconnect(chain.first);
  } catch {
    // The graph may already be closing while a crossfade is being retired.
  }
  chain.handles.forEach((handle) => handle.dispose());
  chain.outputLevel.disconnect();
}

function transitionEffectChain(
  context: BaseAudioContext,
  input: AudioNode,
  destination: AudioNode,
  previous: EffectChain,
  effects: EffectState[],
): EffectChain {
  const next = buildEffectChain(context, input, destination, effects, 0);
  fadeGain(context, previous.outputLevel, 0);
  fadeGain(context, next.outputLevel, 1);
  window.setTimeout(() => disposeEffectChain(input, previous), 100);
  return next;
}

export function createTrackGraph(
  context: BaseAudioContext,
  track: Track,
  destination: AudioNode,
): TrackGraph {
  const input = context.createGain();
  const pan = context.createStereoPanner();
  const fader = context.createGain();
  fader.gain.value = track.muted ? 0 : track.volume;
  pan.pan.value = track.pan;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  pan.connect(fader);
  fader.connect(analyser);
  analyser.connect(destination);

  let effects = track.effects;
  let chain = buildEffectChain(context, input, pan, track.effects, 1);

  const update = (updated: Track, isAudible: boolean) => {
    if (!sameEffectLayout(effects, updated.effects)) {
      chain = transitionEffectChain(context, input, pan, chain, updated.effects);
    } else {
      updated.effects.forEach((effect, index) => chain.handles[index]?.update(effect));
      effects = updated.effects;
    }
    effects = updated.effects;
    fader.gain.setTargetAtTime(
      isAudible && !updated.muted ? updated.volume : 0,
      context.currentTime,
      0.015,
    );
    pan.pan.setTargetAtTime(updated.pan, context.currentTime, 0.015);
  };

  update(track, true);

  return {
    input,
    pan,
    fader,
    analyser,
    update,
    dispose() {
      input.disconnect();
      pan.disconnect();
      fader.disconnect();
      analyser.disconnect();
      disposeEffectChain(input, chain);
    },
  };
}

export type MasterGraph = {
  input: GainNode;
  fader: GainNode;
  analyser: AnalyserNode;
  update(volume: number, effects: EffectState[]): void;
  dispose(): void;
};

export function createMasterGraph(
  context: BaseAudioContext,
  volume: number,
  initialEffects: EffectState[],
  destination: AudioNode,
): MasterGraph {
  const input = context.createGain();
  const fader = context.createGain();
  fader.gain.value = Math.max(0, Math.min(1.5, volume));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  fader.connect(analyser);
  analyser.connect(destination);

  let effects = initialEffects;
  let chain = buildEffectChain(context, input, fader, initialEffects, 1);

  return {
    input,
    fader,
    analyser,
    update(nextVolume, nextEffects) {
      if (!sameEffectLayout(effects, nextEffects)) {
        chain = transitionEffectChain(context, input, fader, chain, nextEffects);
      } else {
        nextEffects.forEach((effect, index) => chain.handles[index]?.update(effect));
      }
      effects = nextEffects;
      fader.gain.setTargetAtTime(
        Math.max(0, Math.min(1.5, nextVolume)),
        context.currentTime,
        0.015,
      );
    },
    dispose() {
      input.disconnect();
      fader.disconnect();
      analyser.disconnect();
      disposeEffectChain(input, chain);
    },
  };
}

export function readMeter(analyser: AnalyserNode): { peak: number; rms: number } {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
  }
  return {
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
  };
}

export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= -60) return 0;
  return Math.min(1.5, Math.pow(10, db / 20));
}

export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0.001) return -60;
  return Math.max(-60, Math.min(6, 20 * Math.log10(gain)));
}
