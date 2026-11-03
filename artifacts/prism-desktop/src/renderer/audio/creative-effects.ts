import type { EffectState } from "@shared/types";

/** Original PRISM DSP built from Web Audio nodes; shared by live and offline graphs. */
export function createCreativeProcessor(context: BaseAudioContext, input: GainNode, wet: GainNode, type: EffectState["type"]) {
  const nodes: AudioNode[] = [];
  const sources: OscillatorNode[] = [];
  const own = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
  const param = (target: AudioParam, value: number, immediate: boolean) => {
    if (immediate) target.setValueAtTime(value, context.currentTime);
    else target.setTargetAtTime(value, context.currentTime, .02);
  };
  const curve = (fn: (x: number) => number): Float32Array<ArrayBuffer> => {
    const result = new Float32Array(65537);
    for (let i = 0; i < result.length; i++) result[i] = fn(i / 32768 - 1);
    return result;
  };
  let update: (p: Record<string, number>, immediate: boolean) => void;
  if (type === "distortion" || type === "overdrive" || type === "fuzz") {
    const shape = own(context.createWaveShaper());
    shape.oversample = "2x";
    const dc = own(context.createBiquadFilter()); dc.type = "highpass"; dc.frequency.value = 20;
    const tone = own(context.createBiquadFilter()); tone.type = "lowpass"; tone.Q.value = .707;
    const level = own(context.createGain());
    input.connect(shape); shape.connect(dc); dc.connect(tone); tone.connect(level); level.connect(wet);
    let drive = Number.NaN;
    update = (p, immediate) => {
      if (drive !== p.drive) {
        drive = p.drive;
        shape.curve = curve(x => type === "distortion" ? Math.tanh(x * drive)
          : type === "overdrive" ? (x >= 0 ? Math.tanh(x * drive) : .75 * Math.tanh(x * drive / .75))
          : Math.max(-.65, Math.min(1, x * drive)));
      }
      param(tone.frequency, p.tone, immediate);
      param(level.gain, Math.pow(10, p.level / 20), immediate);
    };
  } else if (type === "noise-gate") {
    // Full-wave envelope follower -> threshold transfer -> smoothed VCA.
    // This is an envelope gate, not a sample-by-sample dead-zone distortion.
    const rectify = own(context.createWaveShaper()); rectify.curve = curve(Math.abs);
    const detector = own(context.createBiquadFilter()); detector.type = "lowpass"; detector.frequency.value = 25; detector.Q.value = .5;
    const transfer = own(context.createWaveShaper());
    const smooth = own(context.createBiquadFilter()); smooth.type = "lowpass"; smooth.Q.value = .5;
    const vca = own(context.createGain()); vca.gain.value = 0;
    input.connect(rectify); rectify.connect(detector); detector.connect(transfer); transfer.connect(smooth); smooth.connect(vca.gain);
    input.connect(vca); vca.connect(wet);
    let signature = "";
    update = (p, immediate) => {
      const next = `${p.threshold}/${p.floor}`;
      if (next !== signature) {
        const threshold = Math.pow(10, p.threshold / 20);
        const floor = Math.pow(10, p.floor / 20);
        transfer.curve = curve(x => {
          const position = Math.max(0, Math.min(1, (x - threshold * .75) / (threshold * .5)));
          return floor + (1 - floor) * position * position * (3 - 2 * position);
        });
        signature = next;
      }
      param(smooth.frequency, 1000 / (2 * Math.PI * p.response), immediate);
    };
  } else if (type === "limiter") {
    const gain = own(context.createGain()), shape = own(context.createWaveShaper());
    input.connect(gain); gain.connect(shape); shape.connect(wet);
    let ceiling = Number.NaN;
    update = (p, immediate) => {
      param(gain.gain, Math.pow(10, p.input / 20), immediate);
      if (ceiling !== p.ceiling) {
        ceiling = p.ceiling;
        const limit = Math.pow(10, ceiling / 20);
        shape.curve = curve(x => Math.max(-limit, Math.min(limit, x)));
      }
    };
  } else if (type === "chorus" || type === "flanger" || type === "phaser") {
    const lfo = own(context.createOscillator()); lfo.type = "sine";
    const depth = own(context.createGain()); lfo.connect(depth); sources.push(lfo);
    let feedback: GainNode | undefined;
    if (type === "phaser") {
      let cursor: AudioNode = input;
      for (let i = 0; i < 4; i++) {
        const stage = own(context.createBiquadFilter()); stage.type = "allpass";
        stage.frequency.value = 900 * (1 + i * .35); stage.Q.value = .7;
        depth.connect(stage.frequency); cursor.connect(stage); cursor = stage;
      }
      cursor.connect(wet);
    } else {
      const delay = own(context.createDelay(.1));
      delay.delayTime.value = type === "chorus" ? .025 : .004;
      depth.connect(delay.delayTime); input.connect(delay); delay.connect(wet);
      if (type === "flanger") {
        feedback = own(context.createGain()); delay.connect(feedback); feedback.connect(delay);
      }
    }
    update = (p, immediate) => {
      param(lfo.frequency, p.rate, immediate);
      param(depth.gain, p.depth * (type === "phaser" ? 650 : type === "chorus" ? .012 : .0035), immediate);
      if (feedback) param(feedback.gain, p.feedback, immediate);
    };
    lfo.start(0);
  } else {
    throw new Error(`No processor is implemented for ${type}.`);
  }
  let disposed = false;
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) { try { source.stop(); } catch { /* Already stopped. */ } }
      for (const node of nodes) node.disconnect();
    },
  };
}
