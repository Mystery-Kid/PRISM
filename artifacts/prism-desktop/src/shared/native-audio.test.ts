import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNativeAudioConfiguration } from "./native-audio";

const valid = { deviceId: "wasapi:real-endpoint", mode: "wasapi-exclusive", sampleRate: 96000, channels: 2, bufferFrames: 128 };
test("native settings validate integer format contracts without claiming device support", () => {
  assert.deepEqual(validateNativeAudioConfiguration(valid), valid);
  for (const change of [
    { channels: 0 }, { channels: 65 }, { channels: 2.5 }, { bufferFrames: 0 },
    { sampleRate: Infinity }, { sampleRate: "48000" }, { mode: "auto" }, { deviceId: "" },
  ]) assert.throws(() => validateNativeAudioConfiguration({ ...valid, ...change }));
  for (const value of [null, [], undefined, "device"]) assert.throws(() => validateNativeAudioConfiguration(value));
});
