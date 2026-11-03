import { dialog, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeEffectCatalog } from "../shared/effect-definitions";
import { captureThemeScreenshot } from "./theme-smoke";

/** Opt-in installed Windows acceptance; real renderer, IPC and isolated disk files. */
export async function verifyInstalledPedals(window: BrowserWindow, directory: string, reopen: boolean): Promise<string[]> {
  const evaluate = <T = unknown>(body: string): Promise<T> => window.webContents.executeJavaScript(`(async()=>{
    const $=id=>document.querySelector('[data-testid="'+id+'"]');
    const assert=(value,message)=>{if(!value)throw new Error(message)};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(fn,label)=>{for(let i=0;i<180;i++){const value=await fn();if(value)return value;await pause(50)}throw new Error('Pedal timeout: '+label)};
    const stored=async()=>{const releases=await window.prism.listReleases();return window.prism.getSession(releases[0].songIds[0])};
    const input=(id,value)=>{const e=$(id);assert(e,'Missing '+id);
      Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,String(value));
      e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));};
    const current=async()=>(await stored()).tracks.find(t=>t.id==='smoke-instrument').effects;
    ${body}
  })()`, true);
  window.setContentSize(1440, 1000);
  await evaluate(`
    await wait(()=>document.querySelector('.project-item'),'library');
    window.confirm=()=>true;
    window.__pedalContexts=[];
    window.AudioContext=new Proxy(window.AudioContext,{construct(Target,args){
      const context=Reflect.construct(Target,[{...args[0],sinkId:{type:'none'}}]);
      window.__pedalContexts.push(context);return context;
    }});
    ${!reopen ? `
    const session=await stored();
    session.tracks=session.tracks.map(t=>({...t,effects:[]}));
    session.masterEffects=[];
    if(!session.buses.length)session.buses=[{id:'pedal-bus',name:'Pedal Bus',level:1,muted:false,solo:false,outputBusId:null,sends:[],effects:[]}];
    session.buses=session.buses.map(b=>({...b,effects:[]}));
    await window.prism.saveSession(session);` : ""}
    document.querySelector('.project-item').click();
    await wait(()=>$('tab-effects'),'workstation');$('tab-effects').click();
    await wait(()=>$('select-effect-chain-target'),'effects');
    input('select-effect-track','smoke-instrument');await pause(80);
  `);
  if (reopen) {
    await evaluate(`
      const effects=await current();
      const presets=await window.prism.listEffectPresets((await stored()).releaseId);
      const preset=presets.find(p=>p.name==='Native Pedal Chain');
      assert(preset&&preset.effects.length===12,'Pedal preset missing after restart');
      assert(effects.length===12&&effects[0].type==='distortion','Pedal order was not restored');
      assert(effects[0].parameters.drive>4&&!effects.find(e=>e.type==='noise-gate').enabled,'Knob/bypass state was not restored');
      assert((await stored()).masterEffects.length===1&&(await stored()).buses[0].effects.length===1,'Bus/master chains were lost');
      $('button-effect-preset-load-'+preset.id).click();
      await wait(async()=>(await current()).length===12,'load reopened preset');
      assert(new Set((await current()).map(e=>e.id)).size===12,'Preset reused effect IDs');
    `);
    await captureThemeScreenshot(window, directory, "pedals-reopened", 250);
    return ["real pedal settings/order/bypass and global chain preset survive another Windows process", "bus/master state preserved", "preset loads with independent effect IDs"];
  }
  for (const definition of nativeEffectCatalog) {
    await evaluate(`
      input('input-effects-search',${JSON.stringify(definition.label)});await pause(60);
      assert($('button-browse-add-'+${JSON.stringify(definition.type)}),'Search hid implemented processor');
      $('button-browse-add-'+${JSON.stringify(definition.type)}).click();
      await wait(async()=>(await current()).some(e=>e.type===${JSON.stringify(definition.type)}),'add effect');
    `);
  }
  const driveId = await evaluate<string>(`
    input('input-effects-search','');await pause(50);
    return (await current()).find(e=>e.type==='distortion').id;
  `);
  const knobId = `track-effect-${driveId}-drive`;
  const point = await evaluate<{x:number;y:number}>(`
    const e=$(${JSON.stringify(knobId)});e.scrollIntoView({block:'center'});
    await pause(100);const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
  `);
  window.focus(); window.webContents.focus();
  const x = Math.round(point.x), y = Math.round(point.y);
  window.webContents.sendInputEvent({ type: "mouseMove", x, y });
  window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseMove", x, y: y-16, button: "left", modifiers: ["leftbuttondown"] });
  window.webContents.sendInputEvent({ type: "mouseUp", x, y: y-16, button: "left", clickCount: 1 });
  await evaluate(`await wait(async()=>(await current()).find(e=>e.id===${JSON.stringify(driveId)}).parameters.drive>4,'native rotary drag');
    $(${JSON.stringify(knobId)}).focus();`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Up", modifiers: ["shift"] });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Up", modifiers: ["shift"] });
  await evaluate(`
    await pause(100);
    const id=${JSON.stringify(driveId)}, pedal=$('effect-unit-'+id);
    const before=(await current()).find(e=>e.id===id).parameters.drive;
    assert(before>4&&before<30,'Rotary escaped parameter bounds');
    const transfer=new DataTransfer();transfer.setData('text/plain',id);
    const first=$('effect-unit-'+(await current())[0].id);
    first.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer,cancelable:true}));
    await wait(async()=>(await current())[0].id===id,'drag reorder persisted');
    $('button-undo').click();await wait(async()=>(await current())[0].type==='equalizer','reorder undo');
    $('button-redo').click();await wait(async()=>(await current())[0].id===id,'reorder redo');
    const gate=(await current()).find(e=>e.type==='noise-gate');$('track-effect-toggle-'+gate.id).click();
    await wait(async()=>!(await current()).find(e=>e.id===gate.id).enabled,'bypass');
    const compressor=(await current()).find(e=>e.type==='compressor');
    const advanced=$('effect-unit-'+compressor.id).querySelector('.pedal-advanced-toggle');
    assert(advanced,'Advanced settings missing');advanced.click();await pause(60);
    assert($('track-effect-'+compressor.id+'-release'),'Advanced parameter missing');
    input('input-effect-preset-name','Native Pedal Chain');input('select-effect-preset-scope','global');await pause(50);
    $('button-save-effect-preset').click();
    const preset=await wait(async()=>(await window.prism.listEffectPresets((await stored()).releaseId)).find(p=>p.name==='Native Pedal Chain'),'chain save');
    assert(preset.effects.length===12,'Chain preset incomplete');
    // Duplicate/remove works on concrete independent state.
    $('effect-unit-'+id).querySelector('[aria-label="Duplicate Distortion"]').click();
    await wait(async()=>(await current()).length===13,'duplicate pedal');
    const copy=(await current())[1];
    assert(copy.id!==id&&copy.parameters.drive===before,'Duplicate shares identity or loses parameters');
    $('effect-unit-'+copy.id).querySelector('[aria-label="Remove Distortion"]').click();
    await wait(async()=>(await current()).length===12,'remove duplicate');
    // Same browser and processor definitions are used for audio, bus and master.
    input('select-effect-track','smoke-audio');await pause(60);$('button-browse-add-overdrive').click();
    await wait(async()=>(await stored()).tracks.find(t=>t.id==='smoke-audio').effects.length===1,'audio chain');
    input('select-effect-chain-target','bus');await pause(60);$('button-browse-add-chorus').click();
    await wait(async()=>(await stored()).buses[0].effects.length===1,'bus chain');
    input('select-effect-chain-target','master');await pause(60);$('button-browse-add-limiter').click();
    await wait(async()=>(await stored()).masterEffects.length===1,'master chain');
    input('select-effect-chain-target','track');await pause(60);input('select-effect-track','smoke-instrument');await pause(60);
    $('button-play-pause').click();
    await wait(()=>window.__pedalContexts.some(c=>c.currentTime>.05),'real playback clock');
    $('track-effect-toggle-'+id).click();await pause(80);$('track-effect-toggle-'+id).click();
    await wait(async()=>(await current())[0].enabled,'live bypass restore');
    $('button-play-pause').click();
  `);
  for (const theme of ["theme.original", "theme.day", "theme.starry"]) {
    await evaluate(`
      $('menu-edit').click();
      const preferences=await wait(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.startsWith('Preferences')),'Preferences');
      preferences.click();await wait(()=>$('settings-dialog'),'settings');
      $('settings-tab-appearance').click();await wait(()=>$('appearance-section'),'appearance');
      const theme=${JSON.stringify(theme)};
      if(!$('theme-current-'+theme))$('theme-apply-'+theme).click();
      await wait(()=>document.documentElement.dataset.theme===theme&&$('theme-current-'+theme),'theme applied');
      $('settings-close').click();await pause(450);
      document.querySelector('.pedalboard-list').scrollTop=0;
      if(theme==='theme.starry')assert(getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim().toLowerCase()==='#60c1c1','Starry accent mismatch');
    `);
    await captureThemeScreenshot(window, directory, `pedals-${theme.split(".")[1]}`, 250);
  }
  // Real renderer export and IPC/file writer, with only the native file picker supplied by CI.
  const oldPicker = dialog.showSaveDialog;
  const exportPath = join(directory, "pedals-export.wav");
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: exportPath })) as typeof dialog.showSaveDialog;
  try {
    await evaluate(`document.activeElement?.blur();`);
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "e", modifiers: ["control"] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "e", modifiers: ["control"] });
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        const wav = await readFile(exportPath);
        if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.length <= 44) throw new Error("Invalid exported WAV");
        let peak = 0;
        for (let offset = 44; offset + 1 < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
        if (peak < 30) throw new Error("Pedal export was silent");
        return ["native pointer rotary drag and Shift keyboard fine adjustment", "real drag reorder with undo/redo",
          "independent bypass, advanced controls, duplicate/remove", "12-processor chain preset saved through real IPC",
          "audio/instrument/bus/master chains", "Original/Day/Starry pedals with exact Starry accent",
          "installed playback clock and live bypass", `real WAV export (${wav.length} bytes, peak ${peak})`,
          "silent audio sink; no physical device or native picker interaction claim"];
      } catch (error) { if (attempt === 199) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error("Export did not complete");
  } finally { dialog.showSaveDialog = oldPicker; }
}
