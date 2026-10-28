import type { EffectState } from "@shared/types";

export type EffectHandle = {
  input: GainNode;
  output: GainNode;
  update(effect: EffectState): void;
  dispose(): void;
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function param(
  node: AudioParam,
  value: number,
  context: BaseAudioContext,
  timeConstant = 0.02,
): void {
  node.setTargetAtTime(value, context.currentTime, timeConstant);
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

  let processor: AudioNode;
  let parameters: AudioParam[];
  let currentReverbDecay = clamp(initial.parameters.decay ?? 1.6, 0.15, 4, 1.6);

  if (initial.type === "equalizer") {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    input.connect(filter);
    filter.connect(wet);
    wet.connect(output);
    processor = filter;
    parameters = [filter.frequency, filter.gain, filter.Q];
  } else if (initial.type === "reverb") {
    const convolver = context.createConvolver();
    convolver.buffer = createImpulse(context, currentReverbDecay);
    input.connect(convolver);
    convolver.connect(wet);
    wet.connect(output);
    processor = convolver;
    parameters = [];
  } else if (initial.type === "delay") {
    const delay = context.createDelay(2);
    const feedback = context.createGain();
    delay.connect(feedback);
    feedback.connect(delay);
    input.connect(delay);
    delay.connect(wet);
    wet.connect(output);
    processor = delay;
    parameters = [delay.delayTime, feedback.gain];
  } else {
    const compressor = context.createDynamicsCompressor();
    input.connect(compressor);
    compressor.connect(wet);
    wet.connect(output);
    processor = compressor;
    parameters = [
      compressor.threshold,
      compressor.ratio,
      compressor.attack,
      compressor.release,
      compressor.knee,
    ];
  }

  const update = (effect: EffectState) => {
    const enabled = effect.enabled;
    if (effect.type === "equalizer" && processor instanceof BiquadFilterNode) {
      param(processor.frequency, clamp(effect.parameters.frequency ?? 1_000, 20, 20_000, 1_000), context);
      param(processor.gain, clamp(effect.parameters.gain ?? 0, -24, 24, 0), context);
      param(processor.Q, clamp(effect.parameters.q ?? 1, 0.1, 18, 1), context);
    } else if (effect.type === "reverb" && processor instanceof ConvolverNode) {
      const decay = clamp(effect.parameters.decay ?? 1.6, 0.15, 4, 1.6);
      if (Math.abs(decay - currentReverbDecay) > 0.001) {
        processor.buffer = createImpulse(context, decay);
        currentReverbDecay = decay;
      }
      param(wet.gain, enabled ? clamp(effect.parameters.mix ?? 0.2, 0, 1, 0.2) : 0, context);
      param(dry.gain, enabled ? 1 - clamp(effect.parameters.mix ?? 0.2, 0, 1, 0.2) : 1, context);
      return;
    } else if (effect.type === "delay" && processor instanceof DelayNode) {
      param(processor.delayTime, clamp(effect.parameters.time ?? 0.25, 0.01, 1.5, 0.25), context);
      const feedback = parameters[1];
      if (feedback) param(feedback, clamp(effect.parameters.feedback ?? 0.25, 0, 0.85, 0.25), context);
      const mix = clamp(effect.parameters.mix ?? 0.2, 0, 1, 0.2);
      param(wet.gain, enabled ? mix : 0, context);
      param(dry.gain, enabled ? 1 - mix : 1, context);
      return;
    } else if (effect.type === "compressor" && processor instanceof DynamicsCompressorNode) {
      param(processor.threshold, clamp(effect.parameters.threshold ?? -18, -60, 0, -18), context);
      param(processor.ratio, clamp(effect.parameters.ratio ?? 4, 1, 20, 4), context);
      param(processor.attack, clamp(effect.parameters.attack ?? 0.003, 0.001, 1, 0.003), context);
      param(processor.release, clamp(effect.parameters.release ?? 0.25, 0.01, 2, 0.25), context);
      param(processor.knee, clamp(effect.parameters.knee ?? 12, 0, 40, 12), context);
    }

    const fullWet = effect.type === "equalizer" || effect.type === "compressor";
    param(wet.gain, enabled ? (fullWet ? 1 : clamp(effect.parameters.mix ?? 0.2, 0, 1, 0.2)) : 0, context);
    param(dry.gain, enabled ? (fullWet ? 0 : 1 - clamp(effect.parameters.mix ?? 0.2, 0, 1, 0.2)) : 1, context);
  };

  update(initial);

  return {
    input,
    output,
    update,
    dispose() {
      input.disconnect();
      output.disconnect();
      dry.disconnect();
      wet.disconnect();
      processor.disconnect();
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
      channel[sample] = (Math.random() * 2 - 1) * fade;
    }
  }
  return impulse;
}
