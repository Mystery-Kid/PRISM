import { stretchAudio } from "@shared/time-stretch";
import { encodePcm16Wav } from "./wav";
import { computeWaveformPeaks } from "@shared/waveform";

self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; sampleRate: number; ratio: number }>) => {
  try {
    const { channels, sampleRate, ratio } = event.data;
    const stretched = stretchAudio(channels, sampleRate, ratio);
    const wav = encodePcm16Wav(stretched, sampleRate);
    const waveform = computeWaveformPeaks(stretched);
    self.postMessage({ wav, waveform, duration: stretched[0].length / sampleRate });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
