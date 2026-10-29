import type { BrowserWindow } from "electron";
import { createInstrumentState, LEGACY_INSTRUMENT_ID } from "../shared/instrument-library";
import { captureThemeScreenshot } from "./theme-smoke";

/** Opt-in acceptance against the installed, context-isolated app and its real disk library. */
export async function verifyInstalledInstruments(window: BrowserWindow, directory: string, reopen: boolean): Promise<string[]> {
  const evaluate = <T = unknown>(body: string): Promise<T> => window.webContents.executeJavaScript(`(async () => {
    const $=id=>document.querySelector('[data-testid="'+id+'"]');
    const assert=(value,message)=>{if(!value)throw new Error(message)};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(predicate,message)=>{for(let i=0;i<150;i++){const result=await predicate();if(result)return result;await pause(50)}throw new Error('Instrument timeout: '+message)};
    const stored=async()=>{const releases=await window.prism.listReleases();return window.prism.getSession(releases[0].songIds[0])};
    const input=(id,value)=>{const element=$(id);assert(element,'Missing control '+id);
      const prototype=element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,String(value));
      element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));};
    ${body}
  })()`, true);
  await evaluate(`
    await wait(()=>document.querySelector('.project-item'),'library');
    window.confirm=()=>true;
    window.__prismInstrumentAudio={started:0,ended:0,sampleStarted:0,contexts:[]};
    const original=window.AudioContext;
    window.AudioContext=new Proxy(original,{construct(Target,args){
      const context=Reflect.construct(Target,[{...args[0],sinkId:{type:'none'}}]);
      window.__prismInstrumentAudio.contexts.push(context);
      const create=context.createOscillator.bind(context);
      context.createOscillator=()=>{
        const source=create(),start=source.start.bind(source);
        source.start=(...args)=>{window.__prismInstrumentAudio.started++;return start(...args)};
        source.addEventListener('ended',()=>window.__prismInstrumentAudio.ended++);return source;
      };
      const createBuffer=context.createBufferSource.bind(context);
      context.createBufferSource=()=>{
        const source=createBuffer(),start=source.start.bind(source);
        source.start=(...args)=>{window.__prismInstrumentAudio.sampleStarted++;return start(...args)};return source;
      };return context;
    }});
  `);
  if (!reopen) {
    await evaluate(`
      const session=await stored();
      const template=session.tracks.find(track=>track.type==='instrument');
      assert(template,'Legacy instrument fixture missing');
      const make=(name,pitch,instrument)=>{
        const clip=crypto.randomUUID();
        return {...structuredClone(template),id:crypto.randomUUID(),name,type:'instrument',instrument,
          clips:[],sampler:null,drumKit:null,instrumentRecovery:null,effects:[],sends:[],outputBusId:null,
          volume:.65,pan:0,muted:false,solo:false,recordArmed:false,
          midiClips:[{id:clip,name:'Instrument phrase',startBeat:0,durationBeats:4}],
          notes:[{id:crypto.randomUUID(),midiClipId:clip,pitch,velocity:96,startBeat:0,durationBeats:2}]};
      };
      const fm=make('Native Library EP',60,${JSON.stringify(createInstrumentState(LEGACY_INSTRUMENT_ID))});
      const organ=make('Native Library Organ',55,${JSON.stringify(createInstrumentState("prism.keys.organ.v1"))});
      const drums=make('Native Library Drums',36,${JSON.stringify(createInstrumentState(LEGACY_INSTRUMENT_ID))});
      const missing=make('Native Missing Recovery',64,{...${JSON.stringify(createInstrumentState(LEGACY_INSTRUMENT_ID))},
        instrumentId:'vendor.missing.bank',vendorState:{program:7,bank:'unavailable.sfz'}});
      missing.instrumentRecovery={originalType:'instrument',rawState:structuredClone(missing.instrument),
        message:'Missing vendor instrument; original state and MIDI were kept.'};
      await window.prism.saveSession({...session,tracks:[...session.tracks,fm,organ,drums,missing]});
    `);
  }
  const ids = await evaluate<Record<string, string>>(`
    const session=await stored();
    const names=['Native Library EP','Native Library Organ','Native Library Drums','Native Missing Recovery'];
    return Object.fromEntries(names.map(name=>{const track=session.tracks.find(track=>track.name===name);
      assert(track,'Missing saved fixture '+name);return [name,track.id]}));
  `);
  await evaluate(`document.querySelector('.project-item').click();await wait(()=>document.querySelector('.workstation'),'workstation');`);
  const selectTrack = async (id: string) => {
    await evaluate(`document.querySelector('button[aria-label="Close instrument browser"]')?.click();await pause(60);`);
    const point = await evaluate<{ x: number; y: number }>(`
      const lane=$('timeline-lane-'+${JSON.stringify(id)});assert(lane,'Track lane missing');
      lane.scrollIntoView({block:'nearest',inline:'nearest'});await pause(100);
      const rect=lane.getBoundingClientRect();
      return {x:Math.round(Math.min(innerWidth-40,rect.right-10)),y:Math.round(rect.top+Math.min(25,rect.height/2))};
    `);
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await evaluate(`await pause(100);$('button-instrument-browser').click();await wait(()=>$('instrument-browser'),'browser');`);
    const name = Object.entries(ids).find(([, value]) => value === id)?.[0];
    await evaluate(`assert(document.querySelector('.ib-current').textContent.includes(${JSON.stringify(name)}),'Wrong track selected in instrument browser');`);
  };
  const choose = async (id: string) => evaluate(`
    input('input-instrument-search','');input('select-instrument-category','All');await pause(80);
    const choice=await wait(()=>$('instrument-choice-'+${JSON.stringify(id)}),'instrument choice');choice.click();
  `);
  await selectTrack(ids["Native Library EP"]);
  if (!reopen) {
    await evaluate(`
      input('input-instrument-search','electric');await pause(100);
      assert($('instrument-choice-prism.keys.fm-ep.v1'),'Search hid electric piano');
      assert(!$('instrument-choice-prism.keys.organ.v1'),'Search retained unrelated organ');
      input('input-instrument-search','');input('select-instrument-category','Keys');await pause(80);
      assert(!$('instrument-choice-prism.synth.pad.v1'),'Category filter retained pad');
    `);
    await choose("prism.keys.fm-ep.v1");
    await evaluate(`
      await wait(()=>$('instrument-param-bell'),'FM control');input('instrument-param-bell',3.2);
      await wait(async()=>{const track=(await stored()).tracks.find(track=>track.id===${JSON.stringify(ids["Native Library EP"])});
        return track.instrument.instrumentId==='prism.keys.fm-ep.v1'&&track.instrument.parameters.bell===3.2},'FM save');
      input('input-instrument-preset-name','Native Glass EP');$('button-instrument-preset-save').click();
      window.__prismInstrumentPreset=await wait(async()=>(await window.prism.listInstrumentPresets()).find(preset=>preset.name==='Native Glass EP'),'preset save');
    `);
    await choose("prism.synth.pad.v1");
    await evaluate(`
      await wait(()=>$('instrument-param-detune'),'Pad control');
      input('select-instrument-preset',window.__prismInstrumentPreset.id);await pause(60);$('button-instrument-preset-load').click();
      await wait(async()=>{const track=(await stored()).tracks.find(track=>track.id===${JSON.stringify(ids["Native Library EP"])});
        return track.instrument.instrumentId==='prism.keys.fm-ep.v1'&&track.instrument.parameters.bell===3.2&&track.instrument.presetId===window.__prismInstrumentPreset.id},'preset restore');
      const source=(await stored()).tracks.find(track=>track.id===${JSON.stringify(ids["Native Library EP"])});
      assert(source.notes.length===1&&source.notes[0].pitch===60&&source.midiClips.length===1,'Replacement damaged MIDI');
      input('input-instrument-preset-name','Native temporary preset');$('button-instrument-preset-save').click();
      const temporary=await wait(async()=>(await window.prism.listInstrumentPresets()).find(preset=>preset.name==='Native temporary preset'),'temporary preset');
      await wait(()=>$('select-instrument-preset').value===temporary.id&&!$('button-instrument-preset-delete').disabled,'delete ready');
      $('button-instrument-preset-delete').click();
      await wait(async()=>!(await window.prism.listInstrumentPresets()).some(preset=>preset.id===temporary.id),'preset deletion');
    `);
  } else {
    await evaluate(`
      const session=await stored(),ep=session.tracks.find(track=>track.id===${JSON.stringify(ids["Native Library EP"])});
      const organ=session.tracks.find(track=>track.id===${JSON.stringify(ids["Native Library Organ"])});
      assert(ep.instrument.instrumentId==='prism.keys.fm-ep.v1'&&ep.instrument.parameters.bell===3.2,'FM identity/parameters lost on restart');
      assert(ep.notes[0].pitch===60&&organ.notes[0].pitch===55&&organ.instrument.instrumentId==='prism.keys.organ.v1','Independent instrument tracks changed');
      const preset=(await window.prism.listInstrumentPresets()).find(preset=>preset.name==='Native Glass EP');
      assert(preset&&ep.instrument.presetId===preset.id&&preset.instrument.parameters.bell===3.2,'Preset identity/state lost on restart');
      assert(!(await window.prism.listInstrumentPresets()).some(preset=>preset.name==='Native temporary preset'),'Deleted preset returned');
      assert(Number($('instrument-param-bell').value)===3.2,'FM control did not restore');
    `);
  }
  await evaluate(`
    $('button-instrument-preview').click();await pause(220);
    assert(window.__prismInstrumentAudio.started>=3,'FM preview did not create its real carrier/modulator sources');
    await pause(1400);
    assert(window.__prismInstrumentAudio.ended===window.__prismInstrumentAudio.started,'FM preview left unfinished sources');
    assert(window.__prismInstrumentAudio.contexts.some(context=>context.currentTime>.5),'Native silent-sink clock stalled');
  `);
  await captureThemeScreenshot(window, directory, reopen ? "instruments-reopened-fm" : "instruments-fm-browser", 250);
  await selectTrack(ids["Native Library Drums"]);
  if (!reopen) await choose("prism.drums.electronic.v1");
  await evaluate(`
    const track=await wait(async()=>{const track=(await stored()).tracks.find(track=>track.id===${JSON.stringify(ids["Native Library Drums"])});
      return track.type==='drum'&&track.drumKit?.pads.length===8?track:null},'factory kit save');
    assert(track.notes.length===1&&track.notes[0].pitch===36,'Kit selection removed MIDI');
    const response=await fetch(window.prism.assetUrl(track.drumKit.pads[0].sampleAssetId));
    assert(response.ok,'Installed factory sample is missing');
    const context=new AudioContext({sinkId:{type:'none'}});
    const decoded=await context.decodeAudioData(await response.arrayBuffer());
    assert(decoded.duration>.1&&decoded.getChannelData(0).some(value=>Math.abs(value)>.05),'Installed factory sample did not decode to nonzero PCM');
    await context.close();
    $('button-instrument-preview').click();await pause(850);
    assert(window.__prismInstrumentAudio.sampleStarted>0,'Drum audition did not start its sample source');
  `);
  await captureThemeScreenshot(window, directory, reopen ? "instruments-reopened-drums" : "instruments-drum-browser", 250);
  await selectTrack(ids["Native Missing Recovery"]);
  if (!reopen) {
    await evaluate(`assert($('instrument-browser').textContent.includes('Missing instrument'),'Missing instrument was advertised as available');
      assert($('button-instrument-preview').disabled&&$('button-instrument-preset-save').disabled,'Missing instrument has misleading active controls');`);
    await choose("prism.synth.analog.v1");
  }
  await evaluate(`
    const track=await wait(async()=>{const item=(await stored()).tracks.find(track=>track.id===${JSON.stringify(ids["Native Missing Recovery"])});
      return item.instrument.instrumentId==='prism.synth.analog.v1'?item:null},'recovery replacement');
    assert(track.instrumentRecovery.rawState.vendorState.program===7&&track.notes[0].pitch===64,'Recovery discarded original state or MIDI');
  `);
  return ["installed searchable/category-filtered instrument browser", "FM controls and sound replacement preserve MIDI",
    "local preset create/restore/delete through real IPC", "real carrier/modulator preview and finite source cleanup",
    "factory drum files decoded through installed media protocol", "independent FM/organ/drum tracks",
    "unavailable source preserved during replacement", reopen ? "instrument/preset/asset state survives process restart" : "instrument/preset state saved to real disk",
    "silent-sink checks only; no claim of physical speaker/device testing"];
}
