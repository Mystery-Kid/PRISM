// Loaded only by the isolated, opt-in installed-Windows acceptance URL.
import type { SongSession, Track } from "@shared/types";
import type { NativePluginState } from "@shared/native-plugins";
import { createInstrumentState, LEGACY_INSTRUMENT_ID } from "@shared/instrument-library";
import { encodeNativeSlice } from "@shared/native-contract";
import { renderNativeSessionBuffer } from "./native-render";
import { renderSessionWav } from "./render";
import { AudioEngine } from "./AudioEngine";

export async function runNativeSmoke(reopen: boolean): Promise<string[]> {
  function assert(v: unknown, message: string): asserts v { if (!v) throw new Error(message); }
  let status = await window.prism.nativePluginStatus();
  assert(status.available, status.reason ?? "Packaged native component missing");
  if (!reopen) status = await window.prism.scanNativePlugins();
  const find = (name: string) => {
    const found=status.plugins.find(p => p.name===name); assert(found, `Missing legal fixture: ${name}`); return found!;
  };
  const make = async (name: string, value?: number) => {
    const { plugin } = await window.prism.inspectNativePlugin(find(name).classId);
    return { ...plugin, instanceId: crypto.randomUUID(), ...(value === undefined ? {} : { parameters: {0:value} }) };
  };
  const release=(await window.prism.listReleases())[0];
  let stored=await window.prism.getSession(release.songIds[0]);
  assert(stored,"Installed native acceptance song is missing");
  if (reopen) {
    assert(stored.tracks[0].nativeInstrument?.name==="mda DX10","VST3 instrument assignment did not survive restart");
    assert(stored.nativeMasterEffects?.[0].componentState,"Native editor component state did not survive restart");
    assert(stored.nativeMasterEffects?.[0].parameters["0"]===.25,"Native editor parameters did not survive restart");
  }
  const dx = reopen ? stored.tracks[0].nativeInstrument! : await make("mda DX10");
  const gain = await make("PRISM Host Test Gain",.5), delay = await make("PRISM Host Delay Probe",1);
  const base = stored.tracks[0];
  const midi: Track = { ...base,id:"native-midi", name:"Native VST3 acceptance",type:"instrument",
    clips:[],notes:[{id:"native-note",pitch:60,velocity:100,startBeat:1,durationBeats:2}],midiClips:[],
    instrument:createInstrumentState(LEGACY_INSTRUMENT_ID),nativeInstrument:dx,nativeEffects:[],
    sampler:null,drumKit:null,instrumentRecovery:null,effects:[],volume:.6,pan:0,muted:false,solo:false,
    sends:[],outputBusId:null,recordArmed:false };
  const session: SongSession = { ...stored,tempo:120,timeSignature:"6/8",metronomeEnabled:false,
    masterEffects:[],nativeMasterEffects:[],masterVolume:1,loopRange:null,buses:[],tracks:[midi] };
  const noAudio = async (): Promise<AudioBuffer> => { throw new Error("Unexpected audio asset load in native MIDI test"); };
  const peak = (buffer: AudioBuffer, lo=0, hi=buffer.length) => {
    const a=buffer.getChannelData(0);let p=0;for(let i=lo;i<Math.min(hi,a.length);i++)p=Math.max(p,Math.abs(a[i]));return p;
  };
  const native = await renderNativeSessionBuffer(session,noAudio);
  assert(peak(native.audio)>.001,"Real native instrument was silent");
  assert(peak(native.audio,0,Math.floor(.24*48000))<1e-5,"Native note started before its denominator-aware project time");
  const source=new AudioBuffer({numberOfChannels:2,length:19200,sampleRate:48000});
  for(let c=0;c<2;c++)for(let i=0;i<source.length;i++)source.getChannelData(c)[i]=.2*Math.sin(2*Math.PI*220*i/48000);
  const track: Track={...midi,id:"native-audio",type:"audio",nativeInstrument:null,instrument:null,notes:[],
    volume:.6,outputBusId:"a",sends:[{id:"pre",busId:"b",level:.2,placement:"pre"}],
    nativeEffects:[gain,delay],clips:[{id:"clip",assetId:"test-audio",name:"Fixture",startSeconds:0,sourceStartSeconds:0,
      durationSeconds:.4,sourceDurationSeconds:.4,gain:1,fadeInSeconds:0,fadeOutSeconds:0,waveform:[]}]};
  const routed: SongSession={...session,tracks:[track],masterVolume:.8,
    nativeMasterEffects:[{...gain,instanceId:"master-gain"}],buses:[
      {id:"a",name:"Native bus",level:.4,muted:false,solo:false,sends:[],outputBusId:null,effects:[],
        nativeEffects:[{...gain,instanceId:"bus-gain"}]},
      {id:"b",name:"Pre-fader send",level:.25,muted:false,solo:false,sends:[],outputBusId:null,effects:[],nativeEffects:[]},
    ]};
  const mixed=await renderNativeSessionBuffer(routed,async()=>source), factor=.034;
  let error=0;for(let i=2400;i<12000;i++)error+=Math.abs(mixed.audio.getChannelData(0)[i]-source.getChannelData(0)[i]*factor);
  assert(error/9600<.00001,"Track/bus/master native FX, pre-send, faders or declared-latency compensation changed the expected PCM");
  const bypass={...routed,tracks:[{...track,nativeEffects:track.nativeEffects!.map(p=>({...p,enabled:false}))}]};
  const unprocessed=await renderNativeSessionBuffer(bypass,async()=>source);
  assert(peak(unprocessed.audio)>peak(mixed.audio)*1.8,"Native FX bypass did not change routed audio");
  const before=JSON.stringify(session), missing={...session,tracks:[{...midi,nativeInstrument:{...dx,classId:"00000000000000000000000000000000"}}]};
  let rejected=false;try{await renderNativeSessionBuffer(missing,noAudio);}catch{rejected=true;}
  assert(rejected && JSON.stringify(session)===before,"Missing plugin did not fail without changing MIDI/state");
  const crash=await make("PRISM Host Crash Probe");
  rejected=false;try{await renderNativeSessionBuffer({...session,nativeMasterEffects:[crash]},noAudio);}catch{rejected=true;}
  assert(rejected,"Crashing native plugin was not isolated");
  assert(peak((await renderNativeSessionBuffer(session,noAudio)).audio)>.001,"Host did not recover after a native crash");
  const wait=await make("PRISM Host Wait Probe"), token=(await window.prism.nativePluginStatus()).generation;
  const pending=window.prism.processNativePlugin({plugin:wait,generation:token,request:encodeNativeSlice(session,{...midi,notes:[]},{
    sampleRate:48000,blockSize:256,seconds:.1,input:[new Float32Array(4800),new Float32Array(4800)]})}).then(()=>false,()=>true);
  await new Promise(r=>setTimeout(r,200));await window.prism.cancelNativeProcessing();
  assert(await pending,"Cancellation did not stop an active native child");
  const edited=await window.prism.editNativePlugin(await make("PRISM Host Test Gain",.75));
  assert(edited.parameters["0"]===.25 && edited.componentState,"Real native editor did not save edited controller/component state");
  const engine=new AudioEngine(id=>window.prism.assetUrl(id));
  try {
    await engine.start(session,.1);
    assert(engine.snapshot().activeSources!>0 && engine.snapshot().status==="playing","Native audio was not scheduled in the real playback engine");
    engine.pause();await engine.start(session,.15);engine.pause();
    const changed={...session,tracks:[{...midi,volume:.3}]};engine.updateSession(changed);
    await engine.start(changed);assert(engine.snapshot().activeSources!>0,"Updated native settings did not prepare again");
    engine.stop(true);
  } finally { engine.dispose(); }
  const wav=await renderSessionWav({...session,nativeMasterEffects:[edited]},noAudio);
  assert(wav.length>44 && String.fromCharCode(...wav.subarray(0,4))==="RIFF","Native WAV export failed");
  if (!reopen) {
    stored={...session,nativeMasterEffects:[edited]};
    await window.prism.saveSession(stored);
  }
  return ["Packaged Windows native component and authorized folder cache","Real external VST3 instrument MIDI/tempo timing",
    "Real track/bus/master native FX, pre-send/faders and 64-sample latency compensation",
    "Bypass and missing plugin preserve project data","Actual plugin crash and active-child cancellation with recovery",
    "Win32 native editor attach/close and saved component/controller parameters","Real playback source scheduling, seek/resume and re-preparation",
    "Same native pipeline for WAV export",reopen?"Opaque plugin state and assignments survive process restart":"Native project state saved",
    "Silent/digital checks only; hardware and low-latency live input are not claimed"];
}
