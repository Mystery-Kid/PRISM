import {
  effectDefaults,
  normalizeEffectParameters,
} from "@shared/effect-definitions";
import type { EffectState } from "@shared/types";

export type EffectHandle = {
  input: GainNode;
  output: GainNode;
  update(effect: EffectState): void;
  dispose(): void;
};

type ReverbBranch = {
  processor: ConvolverNode;
  level: GainNode;
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function setParam(
  node: AudioParam,
  value: number,
  context: BaseAudioContext,
  immediate = false,
): void {
  if (immediate) {
    node.setValueAtTime(value, context.currentTime);
  } else {
    node.setTargetAtTime(value, context.currentTime, 0.02);
  }
}

function fadeGain(node: GainNode, value: number, context: BaseAudioContext, duration = 0.025): void {
  const now = context.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(value, now + duration);
}

function createReverbBranch(
  context: BaseAudioContext,
  input: AudioNode,
  wet: AudioNode,
  decay: number,
  gainValue: number,
): ReverbBranch {
  const processor = context.createConvolver();
  const level = context.createGain();
  processor.buffer = createImpulse(context, decay);
  level.gain.setValueAtTime(gainValue, context.currentTime);
  input.connect(processor);
  processor.connect(level);
  level.connect(wet);
  return { processor, level };
}

export function createEffectHandle(
  context: BaseAudioContext,
  initial: EffectState,
): EffectHandle {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);

  let equalizer: BiquadFilterNode | null = null;
  let reverb: ReverbBranch | null = null;
  let delay: DelayNode | null = null;
  let compressor: DynamicsCompressorNode | null = null;
  const processors: AudioNode[] = [];
  let currentReverbDecay = 1.6;
  let lastParameters: Record<string, number> | null = null;
  let lastEnabled: boolean | null = null;

  if (initial.type === "equalizer") {
    equalizer = context.createBiquadFilter();
    equalizer.type = "peaking";
    input.connect(equalizer);
    equalizer.connect(wet);
    processors.push(equalizer);
  } else if (initial.type === "reverb") {
    currentReverbDecay = clamp(initial.parameters.decay ?? 1.6, 0.15, 4, 1.6);
    reverb = createReverbBranch(context, input, wet, currentReverbDecay, 1);
    processors.push(reverb.processor, reverb.level);
  } else if (initial.type === "delay") {
    delay = context.createDelay(2);
    const feedback = context.createGain();
    delay.connect(feedback);
    feedback.connect(delay);
    input.connect(delay);
    delay.connect(wet);
    processors.push(delay, feedback);
  } else {
    compressor = context.createDynamicsCompressor();
    input.connect(compressor);
    compressor.connect(wet);
    processors.push(compressor);
  }

  const update = (effect: EffectState, immediate = false): void => {
    const parameters = normalizeEffectParameters(effect.type, effect.parameters);
    const enabled = effect.enabled;
    if (
      !immediate &&
      enabled === lastEnabled &&
      lastParameters &&
      Object.keys(parameters).every((key) => parameters[key] === lastParameters?.[key])
    ) return;

    if (effect.type === "equalizer" && equalizer) {
      setParam(equalizer.frequency, parameters.frequency, context, immediate);
      setParam(equalizer.gain, parameters.gain, context, immediate);
      setParam(equalizer.Q, parameters.q, context, immediate);
    } else if (effect.type === "reverb" && reverb) {
      const decay = parameters.decay;
      if (Math.abs(decay - currentReverbDecay) > 0.001) {
        const previous = reverb;
        const next = createReverbBranch(context, input, wet, decay, 0);
        fadeGain(previous.level, 0, context);
        fadeGain(next.level, 1, context);
        reverb = next;
        processors.push(next.processor, next.level);
        currentReverbDecay = decay;
        window.setTimeout(() => {
          try {
            input.disconnect(previous.processor);
            previous.processor.disconnect();
            previous.level.disconnect();
          } catch {
            // Disposal can race this crossfade when a song is closed.
          }
        }, 100);
      }
    } else if (effect.type === "delay" && delay) {
      setParam(delay.delayTime, parameters.time, context, immediate);
      const feedback = processors.find((node) => node !== delay) as GainNode | undefined;
      if (feedback) setParam(feedback.gain, parameters.feedback, context, immediate);
    } else if (effect.type === "compressor" && compressor) {
      setParam(compressor.threshold, parameters.threshold, context, immediate);
      setParam(compressor.ratio, parameters.ratio, context, immediate);
      setParam(compressor.attack, parameters.attack, context, immediate);
      setParam(compressor.release, parameters.release, context, immediate);
      setParam(compressor.knee, parameters.knee, context, immediate);
    }

    const fullWet = effect.type === "equalizer" || effect.type === "compressor";
    const mix = parameters.mix ?? 1;
    setParam(wet.gain, enabled ? (fullWet ? 1 : mix) : 0, context, immediate);
    setParam(dry.gain, enabled ? (fullWet ? 0 : 1 - mix) : 1, context, immediate);
    lastParameters = parameters;
    lastEnabled = enabled;
  };

  update(initial, true);

  return {
    input,
    output,
    update: (effect) => update(effect),
    dispose() {
      input.disconnect();
      output.disconnect();
      dry.disconnect();
      wet.disconnect();
      processors.forEach((processor) => processor.disconnect());
    },
  };
}

function createImpulse(context: BaseAudioContext, requestedDecay: number): AudioBuffer {
  const decay = clamp(requestedDecay, 0.15, 4, 1.6);
  const length = Math.max(1, Math.floor(context.sampleRate * decay));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
    const channel = impulse.getChannelData(channelIndex);
    for (let sample = 0; sample < length; sample += 1) {
      const fade = Math.pow(1 - sample / length, 3);
      const seed = Math.sin((sample + 1) * 12.9898 + channelIndex * 78.233) * 43_758.5453;
      channel[sample] = (seed - Math.floor(seed)) * 2 * fade - fade;
    }
  }
  return impulse;
}

export { effectDefaults };
