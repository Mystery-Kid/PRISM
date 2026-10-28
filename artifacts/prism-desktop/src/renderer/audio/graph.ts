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

function sameEffectLayout(left: EffectState[], right: EffectState[]): boolean {
  return left.length === right.length && left.every(
    (effect, index) => effect.id === right[index]?.id && effect.type === right[index]?.type,
  );
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
  let handles: EffectHandle[] = [];

  const buildEffectChain = (next: EffectState[]) => {
    input.disconnect();
    handles.forEach((handle) => handle.dispose());
    handles = next.map((effect) => createEffectHandle(context, effect));
    let cursor: AudioNode = input;
    for (const handle of handles) {
      cursor.connect(handle.input);
      cursor = handle.output;
    }
    cursor.connect(pan);
    effects = next;
  };

  buildEffectChain(track.effects);

  const update = (updated: Track, isAudible: boolean) => {
    if (!sameEffectLayout(effects, updated.effects)) {
      buildEffectChain(updated.effects);
    } else {
      updated.effects.forEach((effect, index) => handles[index]?.update(effect));
      effects = updated.effects;
    }
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
      handles.forEach((handle) => handle.dispose());
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
  let handles: EffectHandle[] = [];

  const buildEffectChain = (next: EffectState[]) => {
    input.disconnect();
    handles.forEach((handle) => handle.dispose());
    handles = next.map((effect) => createEffectHandle(context, effect));
    let cursor: AudioNode = input;
    for (const handle of handles) {
      cursor.connect(handle.input);
      cursor = handle.output;
    }
    cursor.connect(fader);
    effects = next;
  };

  buildEffectChain(initialEffects);

  return {
    input,
    fader,
    analyser,
    update(nextVolume, nextEffects) {
      if (!sameEffectLayout(effects, nextEffects)) {
        buildEffectChain(nextEffects);
      } else {
        nextEffects.forEach((effect, index) => handles[index]?.update(effect));
        effects = nextEffects;
      }
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
      handles.forEach((handle) => handle.dispose());
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
