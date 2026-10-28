import assert from "node:assert/strict";
import test from "node:test";
import { encodePcm16Wav } from "./wav";

test("PCM WAV output has a valid header and interleaves stereo frames", () => {
  const wav = encodePcm16Wav([new Float32Array([-1, 0.5]), new Float32Array([1, -0.5])], 48_000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...wav.subarray(offset, offset + length));

  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 44);
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), 16384);
  assert.equal(view.getInt16(50, true), -16384);
});

test("WAV encoder rejects invalid channel layouts", () => {
  assert.throws(
    () => encodePcm16Wav([new Float32Array(4), new Float32Array(4), new Float32Array(4)], 44_100),
    /mono and stereo/,
  );
});
