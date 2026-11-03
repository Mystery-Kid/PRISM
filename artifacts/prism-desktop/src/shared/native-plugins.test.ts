import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNativePlugin, validateNativeSession, type NativePluginState } from "./native-plugins";
import { migrateProjectLibrary } from "./migrations";
import { encodeNativeSlice, decodeNativeSlice } from "./native-contract";
const plugin: NativePluginState = { instanceId: "plugin", classId: "0123456789ABCDEF0123456789ABCDEF", name: "Unavailable vendor synth",
  vendor: "Vendor", version: "1", kind: "instrument", enabled: true, parameters: { 7: .25 }, componentState: "AQID", controllerState: "BAU=" };
const library = () => migrateProjectLibrary({ version: 8, releases: [], assets: [], sessions: [{
  id: "song", releaseId: "release", title: "VST recovery", tempo: 120, timeSignature: "6/8",
  nativeMasterEffects: [{ ...plugin, instanceId: "master", kind: "effect" }],
  buses: [{ id: "bus", name: "Bus", nativeEffects: [{ ...plugin, instanceId: "bus-fx", kind: "effect" }] }],
  tracks: [{ id: "track", type: "instrument", nativeInstrument: plugin, nativeEffects: [{ ...plugin, instanceId: "track-fx", kind: "effect" }],
    notes: [{ id:"note", pitch:60, velocity:100, startBeat:1, durationBeats:1 }], outputBusId: "bus" }],
}] });
test("schema nine preserves unavailable VST3 roles, parameters and opaque states through JSON reopen", () => {
  const current = library(), reopened = migrateProjectLibrary(JSON.parse(JSON.stringify(current)));
  assert.equal(reopened.version,9); validateNativeSession(reopened.sessions[0]);
  assert.deepEqual(reopened.sessions[0].tracks[0].nativeInstrument, plugin);
  assert.deepEqual(reopened.sessions[0].nativeMasterEffects, current.sessions[0].nativeMasterEffects);
  assert.deepEqual(reopened.sessions[0].buses[0].nativeEffects, current.sessions[0].buses[0].nativeEffects);
  assert.deepEqual(reopened.sessions[0].tracks[0].notes, current.sessions[0].tracks[0].notes);
});
test("invalid IDs, parameter ranges, state encoding and duplicate instances fail explicitly", () => {
  assert.throws(() => validateNativePlugin({...plugin,classId:"theme/file.vst3"}));
  assert.throws(() => validateNativePlugin({...plugin,parameters:{3:NaN}}));
  assert.throws(() => validateNativePlugin({...plugin,componentState:"not base64!"}));
  assert.throws(() => validateNativeSession({ tracks:[{ nativeInstrument:plugin },{ nativeInstrument:plugin }] }));
});
test("native MIDI preserves denominator-aware project timing and source state", () => {
  const s=library().sessions[0], before=JSON.stringify(s), bytes=encodeNativeSlice(s,s.tracks[0],{seconds:1,sampleRate:48000,blockSize:256});
  const v=new DataView(bytes.buffer);
  assert.equal(v.getUint32(48,true),12000); assert.equal(v.getUint32(68,true),24000);
  assert.equal(v.getUint32(40,true),6); assert.equal(v.getUint32(44,true),8);
  assert.equal(JSON.stringify(s),before);
});
test("malformed native output never becomes playable audio", () => {
  assert.throws(() => decodeNativeSlice(new Uint8Array(3)));
  const bytes=new Uint8Array(32),v=new DataView(bytes.buffer);
  [0x4f535650,1,48000,1,0,0].forEach((n,i)=>v.setUint32(i*4,n,true));
  v.setFloat32(24,NaN,true); assert.throws(()=>decodeNativeSlice(bytes));
});
