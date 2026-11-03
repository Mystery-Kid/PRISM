/** Original PRISM WSOLA (waveform-similarity overlap-add), no third-party code.
 * Offline source-preserving length change; samples are never resampled, retaining pitch.
 * Intended for moderate ratios, not transparent transient or polyphonic processing.
 */
export function stretchAudio(channels: readonly Float32Array[], sampleRate: number, ratio: number): Float32Array[] {
  if (!Number.isFinite(ratio) || ratio < .5 || ratio > 2) throw new Error("Stretch length must be between 0.5x and 2x.");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      channels.length < 1 || channels.length > 2 || !channels[0].length ||
      channels.some(channel => channel.length !== channels[0].length || !channel.every(Number.isFinite)))
    throw new Error("Stretching requires finite, matching mono/stereo PCM channels.");
  const length = channels[0].length;
  if (length > sampleRate * 60) throw new Error("Stretching supports sources up to 60 seconds.");
  if (ratio === 1) return channels.map(channel => channel.slice());
  const outputLength = Math.max(1, Math.round(length * ratio));
  const size = Math.max(128, Math.round(sampleRate * .04));
  const hop = Math.max(32, Math.round(size / 4));
  const search = Math.round(sampleRate * .006);
  const output = channels.map(() => new Float32Array(outputLength + size));
  const weights = new Float32Array(outputLength + size);
  const window = Float32Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * (i + .5) / size));
  let previous = 0;
  // Correlate both channels using one common offset to preserve stereo phase.
  const score = (candidate: number, reference: number, stride: number): number => {
    let dot = 0, a = 1e-12, b = 1e-12;
    for (let i = 0; i < size - hop; i += stride) {
      for (const channel of channels) {
        const x = channel[candidate + i] ?? 0, y = channel[reference + i] ?? 0;
        dot += x * y; a += x*x; b += y*y;
      }
    }
    return dot / Math.sqrt(a*b);
  };
  for (let position = 0; position < outputLength; position += hop) {
    const predicted = Math.round(position / ratio);
    let selected = Math.min(Math.max(0, length - size), predicted);
    if (position && predicted + size + search < length) {
      const lo = Math.max(0, predicted-search), hi = Math.min(length-size, predicted+search);
      let best = -Infinity;
      for (let candidate = lo; candidate <= hi; candidate += 8) {
        const value = score(candidate, previous+hop, 16);
        if (value > best) { best = value; selected = candidate; }
      }
      const coarse = selected;
      for (let candidate = Math.max(lo, coarse-7); candidate <= Math.min(hi, coarse+7); candidate++) {
        const value = score(candidate, previous+hop, 8);
        if (value > best) { best = value; selected = candidate; }
      }
    } else if (predicted >= length-size) {
      selected = predicted; // Preserve the actual source end; zero-padding only outside it.
    }
    for (let i = 0; i < size && position+i < weights.length; i++) {
      weights[position+i] += window[i];
      channels.forEach((channel, index) => { output[index][position+i] += (channel[selected+i] ?? 0) * window[i]; });
    }
    previous = selected;
  }
  return output.map(channel => Float32Array.from(channel.subarray(0, outputLength),
    (value, i) => weights[i] > 1e-9 ? value / weights[i] : 0));
}
