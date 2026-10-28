export function encodePcm16Wav(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  if (channels.length < 1 || channels.length > 2) {
    throw new Error("PRISM WAV export currently supports mono and stereo audio.");
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("The rendered audio has an unsupported sample rate.");
  }
  const frameCount = channels[0].length;
  if (channels.some((channel) => channel.length !== frameCount)) {
    throw new Error("The rendered audio channels do not have matching lengths.");
  }
  const channelCount = channels.length;
  const dataBytes = frameCount * channelCount * 2;
  if (dataBytes > 0xffff_ffff - 36) {
    throw new Error("The rendered song is too large for a standard WAV file.");
  }

  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      const pcm = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }
  return bytes;
}

export function encodeAudioBufferWav(buffer: AudioBuffer): Uint8Array {
  return encodePcm16Wav(
    Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) =>
      buffer.getChannelData(index),
    ),
    buffer.sampleRate,
  );
}
