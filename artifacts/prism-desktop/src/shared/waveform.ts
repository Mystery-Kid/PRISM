/** Aggregate every channel. A silent left channel must not hide a right-channel signal. */
export function computeWaveformPeaks(channels: readonly Float32Array[], bins = 512): number[] {
  const count = Math.max(1, Math.min(2048, Math.round(bins)));
  const length = Math.max(0, ...channels.map((channel) => channel.length));
  if (!length) return [];
  return Array.from({ length: count }, (_, index) => {
    const from = Math.floor(index * length / count);
    const to = Math.min(length, Math.max(from + 1, Math.ceil((index + 1) * length / count)));
    let peak = 0;
    for (const channel of channels) {
      for (let sample = from; sample < Math.min(to, channel.length); sample++) {
        const value = Math.abs(channel[sample]);
        if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, value));
      }
    }
    return peak;
  });
}

/** Read the source's peak envelope at the clip's real trim/offset window. */
export function getWaveformWindow(
  peaks: readonly number[], sourceDurationSeconds: number, sourceStartSeconds: number,
  durationSeconds: number, bins = 112,
): number[] {
  if (!peaks.length || !Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0 ||
      !Number.isFinite(sourceStartSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const start = Math.max(0, sourceStartSeconds);
  const end = Math.min(sourceDurationSeconds, start + durationSeconds);
  if (end <= start) return [];
  const count = Math.max(1, Math.min(2048, Math.round(bins)));
  return Array.from({ length: count }, (_, index) => {
    const from = Math.floor((start + (end - start) * index / count) / sourceDurationSeconds * peaks.length);
    const to = Math.min(peaks.length, Math.max(from + 1,
      Math.ceil((start + (end - start) * (index + 1) / count) / sourceDurationSeconds * peaks.length)));
    let peak = 0;
    for (let bin = from; bin < to; bin++) {
      if (Number.isFinite(peaks[bin])) peak = Math.max(peak, Math.max(0, Math.min(1, peaks[bin])));
    }
    return peak;
  });
}
