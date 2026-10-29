import type { AudioBus, BusSend, EffectState, Track } from "@shared/types";
import { createEffectHandle, type EffectHandle } from "./effects";

export type TrackGraph = {
  input: GainNode;
  pan: StereoPannerNode;
  fader: GainNode;
  analyser: AnalyserNode;
  preFaderOutput: StereoPannerNode;
  output: AnalyserNode;
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
  destination?: AudioNode,
): TrackGraph {
  const input = context.createGain();
  const audibility = context.createGain();
  const pan = context.createStereoPanner();
  const fader = context.createGain();
  audibility.gain.value = track.muted ? 0 : 1;
  fader.gain.value = track.volume;
  pan.pan.value = track.pan;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  audibility.connect(pan);
  pan.connect(fader);
  fader.connect(analyser);
  if (destination) analyser.connect(destination);

  let effects = track.effects;
  let chain = buildEffectChain(context, input, audibility, track.effects, 1);

  const update = (updated: Track, isAudible: boolean) => {
    if (!sameEffectLayout(effects, updated.effects)) {
      chain = transitionEffectChain(context, input, audibility, chain, updated.effects);
    } else {
      updated.effects.forEach((effect, index) => chain.handles[index]?.update(effect));
      effects = updated.effects;
    }
    effects = updated.effects;
    audibility.gain.setTargetAtTime(
      isAudible && !updated.muted ? 1 : 0,
      context.currentTime,
      0.015,
    );
    fader.gain.setTargetAtTime(
      updated.volume,
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
    preFaderOutput: pan,
    output: analyser,
    update,
    dispose() {
      input.disconnect();
      audibility.disconnect();
      pan.disconnect();
      fader.disconnect();
      analyser.disconnect();
      disposeEffectChain(input, chain);
    },
  };
}

export type BusGraph = {
  input: GainNode;
  fader: GainNode;
  analyser: AnalyserNode;
  preFaderOutput: GainNode;
  output: AnalyserNode;
  update(bus: AudioBus, isAudible: boolean): void;
  dispose(): void;
};

export function createBusGraph(
  context: BaseAudioContext,
  bus: AudioBus,
  destination?: AudioNode,
): BusGraph {
  const input = context.createGain();
  const audibility = context.createGain();
  const fader = context.createGain();
  audibility.gain.value = bus.muted ? 0 : 1;
  fader.gain.value = bus.level;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  audibility.connect(fader);
  fader.connect(analyser);
  if (destination) analyser.connect(destination);

  let effects = bus.effects;
  let chain = buildEffectChain(context, input, audibility, bus.effects, 1);
  const update = (updated: AudioBus, isAudible: boolean) => {
    if (!sameEffectLayout(effects, updated.effects)) {
      chain = transitionEffectChain(context, input, audibility, chain, updated.effects);
    } else {
      updated.effects.forEach((effect, index) => chain.handles[index]?.update(effect));
    }
    effects = updated.effects;
    audibility.gain.setTargetAtTime(
      isAudible && !updated.muted ? 1 : 0,
      context.currentTime,
      0.015,
    );
    fader.gain.setTargetAtTime(
      Math.max(0, Math.min(1.5, updated.level)),
      context.currentTime,
      0.015,
    );
  };
  update(bus, true);
  return {
    input,
    fader,
    analyser,
    preFaderOutput: audibility,
    output: analyser,
    update,
    dispose() {
      input.disconnect();
      audibility.disconnect();
      fader.disconnect();
      analyser.disconnect();
      disposeEffectChain(input, chain);
    },
  };
}

type AudioRouteConnection = {
  source: AudioNode;
  destination: AudioNode;
  gain: GainNode;
};

export class AudioRoutingGraph {
  private connections = new Map<string, AudioRouteConnection>();

  update(
    tracks: Track[],
    buses: AudioBus[],
    trackGraphs: Map<string, TrackGraph>,
    busGraphs: Map<string, BusGraph>,
    masterInput: AudioNode,
  ): void {
    const desired = new Map<string, { source: AudioNode; destination: AudioNode; level: number }>();
    const destinationFor = (busId: string | null | undefined): AudioNode =>
      busId ? busGraphs.get(busId)?.input ?? masterInput : masterInput;
    const add = (key: string, source: AudioNode, destination: AudioNode, level: number) =>
      desired.set(key, { source, destination, level });
    const addSends = (
      sourceKey: string,
      preFaderOutput: AudioNode,
      output: AudioNode,
      sends: BusSend[],
    ) => {
      for (const send of sends) {
        const source = send.placement === "pre" ? preFaderOutput : output;
        add(
          JSON.stringify(["send", sourceKey, send.id]),
          source,
          destinationFor(send.busId),
          Math.max(0, Math.min(1.5, send.level)),
        );
      }
    };

    for (const track of tracks) {
      const graph = trackGraphs.get(track.id);
      if (!graph) continue;
      const sourceKey = `track:${track.id}`;
      add(JSON.stringify(["main", sourceKey]), graph.output, destinationFor(track.outputBusId), 1);
      addSends(sourceKey, graph.preFaderOutput, graph.output, track.sends ?? []);
    }
    for (const bus of buses) {
      const graph = busGraphs.get(bus.id);
      if (!graph) continue;
      const sourceKey = `bus:${bus.id}`;
      add(JSON.stringify(["main", sourceKey]), graph.output, destinationFor(bus.outputBusId), 1);
      addSends(sourceKey, graph.preFaderOutput, graph.output, bus.sends ?? []);
    }

    const retargeted = new Set<string>();
    for (const [key, existing] of this.connections) {
      const next = desired.get(key);
      if (!next || next.source !== existing.source || next.destination !== existing.destination) {
        this.fadeAndRetire(existing);
        this.connections.delete(key);
        if (next) retargeted.add(key);
      }
    }
    for (const [key, next] of desired) {
      const existing = this.connections.get(key);
      if (existing) {
        existing.gain.gain.setTargetAtTime(next.level, existing.gain.context.currentTime, 0.015);
      } else {
        const connection = next.source.context.createGain();
        const now = connection.context.currentTime;
        connection.gain.setValueAtTime(retargeted.has(key) ? 0 : next.level, now);
        next.source.connect(connection);
        connection.connect(next.destination);
        if (retargeted.has(key)) {
          connection.gain.linearRampToValueAtTime(next.level, now + 0.025);
        }
        this.connections.set(key, {
          source: next.source,
          destination: next.destination,
          gain: connection,
        });
      }
    }
  }

  dispose(): void {
    for (const connection of this.connections.values()) {
      try {
        connection.source.disconnect(connection.gain);
      } catch {
        // The context may be closing during cleanup.
      }
      connection.gain.disconnect();
    }
    this.connections.clear();
  }

  private fadeAndRetire(connection: AudioRouteConnection): void {
    const now = connection.gain.context.currentTime;
    connection.gain.gain.cancelScheduledValues(now);
    connection.gain.gain.setValueAtTime(connection.gain.gain.value, now);
    connection.gain.gain.linearRampToValueAtTime(0, now + 0.025);
    window.setTimeout(() => {
      try {
        connection.source.disconnect(connection.gain);
      } catch {
        // A context can close while a faded route is waiting to retire.
      }
      connection.gain.disconnect();
    }, 100);
  }
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
