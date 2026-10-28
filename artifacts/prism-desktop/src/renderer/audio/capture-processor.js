class PrismCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.monitoring = false;
    this.startFrame = 0;
    this.stopFrame = Number.POSITIVE_INFINITY;
    this.channels = 1;
    this.chunkFrames = 8192;
    this.chunk = new Float32Array(this.chunkFrames);
    this.chunkOffset = 0;
    this.totalFrames = 0;
    this.meterPeak = 0;
    this.meterSquares = 0;
    this.meterSamples = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "start") {
        this.channels = Math.max(1, Math.min(2, message.channels || 1));
        this.chunk = new Float32Array(this.chunkFrames * this.channels);
        this.chunkOffset = 0;
        this.totalFrames = 0;
        this.meterPeak = 0;
        this.meterSquares = 0;
        this.meterSamples = 0;
        this.startFrame = message.startFrame;
        this.stopFrame = Number.POSITIVE_INFINITY;
        this.monitoring = Boolean(message.monitoring);
        this.recording = true;
      } else if (message.type === "monitor") {
        this.monitoring = Boolean(message.enabled);
      } else if (message.type === "stop") {
        this.stopFrame = message.stopFrame;
      } else if (message.type === "cancel") {
        this.recording = false;
        this.chunkOffset = 0;
      }
    };
  }

  flush() {
    if (this.chunkOffset === 0) return;
    const data = this.chunk.slice(0, this.chunkOffset);
    this.port.postMessage({ type: "chunk", samples: data.buffer }, [data.buffer]);
    this.chunkOffset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || input[0]?.length || 128;
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[Math.min(channel, Math.max(0, input.length - 1))];
      const target = output[channel];
      if (this.monitoring && source) target.set(source);
      else target.fill(0);
    }

    if (!this.recording) return true;
    const sourceChannels = Math.min(this.channels, input.length);
    for (let frame = 0; frame < frames; frame += 1) {
      const absoluteFrame = currentFrame + frame;
      if (absoluteFrame < this.startFrame) continue;
      if (absoluteFrame >= this.stopFrame) {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: "complete", frames: this.totalFrames });
        return true;
      }
      for (let channel = 0; channel < this.channels; channel += 1) {
        const source = input[Math.min(channel, sourceChannels - 1)];
        const sample = source ? source[frame] : 0;
        const cleanSample = Number.isFinite(sample) ? sample : 0;
        this.chunk[this.chunkOffset++] = cleanSample;
        this.meterPeak = Math.max(this.meterPeak, Math.abs(cleanSample));
        this.meterSquares += cleanSample * cleanSample;
        this.meterSamples += 1;
      }
      this.totalFrames += 1;
      if (this.chunkOffset >= this.chunk.length) this.flush();
      if (this.meterSamples >= sampleRate / 15) {
        this.port.postMessage({
          type: "meter",
          peak: this.meterPeak,
          rms: Math.sqrt(this.meterSquares / this.meterSamples),
        });
        this.meterPeak = 0;
        this.meterSquares = 0;
        this.meterSamples = 0;
      }
    }
    return true;
  }
}

registerProcessor("prism-capture", PrismCaptureProcessor);
