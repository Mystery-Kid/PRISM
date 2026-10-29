/** Original procedural sample recipes. Generated PCM data: CC0-1.0; no third-party recordings. */
export const factoryDrumSamples = [
  { note: 36, name: "Kick", duration: .65 }, { note: 38, name: "Snare", duration: .28 },
  { note: 42, name: "Closed Hat", duration: .12 }, { note: 46, name: "Open Hat", duration: .55 },
  { note: 39, name: "Clap", duration: .3 }, { note: 43, name: "Low Tom", duration: .5 },
  { note: 51, name: "Ride", duration: 1 }, { note: 49, name: "Crash", duration: 1.4 },
] as const;
export const factoryDrumAssetId = (note: number) => `cba00000-0000-4000-8000-${String(note).padStart(12, "0")}`;
export function createFactoryDrumPcm(note: number, sampleRate = 24_000): Float32Array {
  const definition = factoryDrumSamples.find((item) => item.note === note);
  if (!definition) throw new Error("Unsupported factory drum note.");
  const samples = new Float32Array(Math.ceil(definition.duration * sampleRate));
  let seed = note * 9719, previousNoise = 0;
  for (let index = 0; index < samples.length; index++) {
    const t = index / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    const bright = (noise - previousNoise) / 2; previousNoise = noise;
    const sine = (frequency: number) => Math.sin(2 * Math.PI * frequency * t);
    let value: number;
    switch (note) {
      case 36: value = Math.sin(2 * Math.PI * (48 * t + 12 * (1 - Math.exp(-t * 20)))) * Math.exp(-t * 8); break;
      case 38: value = (noise * .65 + sine(185) * .35) * Math.exp(-t * 17); break;
      case 42: value = bright * Math.exp(-t * 45); break;
      case 46: value = (bright * .8 + sine(7301) * .2) * Math.exp(-t * 7); break;
      case 39: {
        const burst = [0, .012, .026].reduce((sum, start) => sum + (t >= start ? Math.exp(-(t - start) * 90) : 0), 0);
        value = bright * (.7 * burst + .2 * Math.exp(-t * 15)); break;
      }
      case 43: value = Math.sin(2 * Math.PI * (85 * t + 4 * (1 - Math.exp(-t * 18)))) * Math.exp(-t * 9); break;
      case 51: value = (sine(2701) + sine(3911) + sine(6103) + bright) * .25 * Math.exp(-t * 4); break;
      default: value = (bright * .7 + (sine(1667) + sine(3121) + sine(5443)) * .1) * Math.exp(-t * 3);
    }
    samples[index] = Math.max(-.9, Math.min(.9, value * Math.min(1, t / .0015) * .8));
  }
  return samples;
}
export function createFactoryDrumWav(note: number): Uint8Array {
  const samples = createFactoryDrumPcm(note);
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((character, index) => view.setUint8(at + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.round(value * 32767), true));
  return bytes;
}
