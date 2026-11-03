import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureThemeScreenshot } from "./theme-smoke";

export async function verifyInstalledTempo(window: BrowserWindow, directory: string, reopen: boolean): Promise<string[]> {
  const evaluate = <T = unknown>(body: string): Promise<T> => window.webContents.executeJavaScript(`(async()=>{
    const $=id=>document.querySelector('[data-testid="'+id+'"]');
    const assert=(value,message)=>{if(!value)throw new Error(message)};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(fn,label)=>{for(let i=0;i<300;i++){const value=await fn();if(value)return value;await pause(50)}throw new Error('Tempo timeout: '+label)};
    const stored=async()=>{const releases=await window.prism.listReleases();return window.prism.getSession(releases[0].songIds[0])};
    const input=(id,value)=>{const e=$(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));};
    const request=async value=>{input('input-tempo',value);await pause(60);$('input-tempo').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await wait(()=>$('tempo-dialog'),'confirmation');};
    ${body}
  })()`, true);
  await evaluate(`
    await wait(()=>document.querySelector('.project-item'),'library');
    window.AudioContext=new Proxy(window.AudioContext,{construct(Target,args){return Reflect.construct(Target,[{...args[0],sinkId:{type:'none'}}]);}});
    ${!reopen ? `
    const session=await stored(), audio=session.tracks.find(t=>t.id==='smoke-audio'), midi=session.tracks.find(t=>t.id==='smoke-instrument');
    audio.clips=[audio.clips[0]];audio.effects=[];audio.outputBusId=null;audio.sends=[];audio.muted=false;
    midi.effects=[];midi.outputBusId=null;midi.sends=[];midi.muted=true;
    session.tracks=[audio,midi];session.buses=[];session.masterEffects=[];session.tempo=123;session.timeSignature='6/8';
    session.loopRange={enabled:false,startSeconds:1,endSeconds:3};
    await window.prism.saveSession(session);` : ""}
    document.querySelector('.project-item').click();await wait(()=>$('input-tempo'),'workstation');
    await pause(500);
  `);
  if (reopen) {
    await evaluate(`
      const session=await stored(), clip=session.tracks[0].clips[0];
      assert(session.tempo===82&&clip.tempoAdaptation?.algorithm==='prism-wsola-v1','Tempo derivative was lost after restart');
      assert(clip.assetId!==clip.tempoAdaptation.originalAssetId,'Original source was replaced');
      const response=await fetch(window.prism.assetUrl(clip.assetId));assert(response.ok,'Derivative cannot load offline');
      const original=await fetch(window.prism.assetUrl(clip.tempoAdaptation.originalAssetId));assert(original.ok,'Original cannot load offline');
      $('button-play-pause').click();await pause(200);$('button-play-pause').click();
    `);
    await captureThemeScreenshot(window, directory, "tempo-reopened", 250);
    return ["tempo, WSOLA mapping, original and derivative survive another Windows process", "installed adapted-media playback"];
  }
  const original = await evaluate<number[]>(`
    window.__tempoBefore=await stored();const clip=window.__tempoBefore.tracks[0].clips[0];
    return Array.from(new Uint8Array(await (await fetch(window.prism.assetUrl(clip.assetId))).arrayBuffer()));
  `);
  await writeFile(join(directory, "tempo-original-reference.wav"), Buffer.from(original));
  await evaluate(`
    await request(110);
    assert($('tempo-dialog').textContent.includes('Do you want to change all media to match the new tempo?'),'Incorrect prompt');
    $('button-tempo-cancel').click();await pause(350);
    assert((await stored()).tempo===123,'Cancel changed tempo');
    await request(100);$('button-tempo-only').click();
    await wait(async()=>(await stored()).tempo===100,'tempo-only save');
    assert(JSON.stringify((await stored()).tracks[0].clips)===JSON.stringify(window.__tempoBefore.tracks[0].clips),'Tempo-only changed audio');
    $('button-undo').click();await wait(async()=>(await stored()).tempo===123,'tempo-only undo');
    await request(82);
  `);
  await captureThemeScreenshot(window, directory, "tempo-confirmation", 250);
  // Cancellation before processing finishes must never publish a mixed tempo/clip state.
  await evaluate(`
    $('button-tempo-adapt').click();await pause(0);$('button-tempo-cancel').click();await pause(250);
    assert((await stored()).tempo===123,'Cancelled stretch changed tempo');
    await request(82);$('button-tempo-adapt').click();
    await wait(()=>!$('tempo-dialog'),'real worker completion');
    await wait(async()=>(await stored()).tempo===82,'adaptation save');
    const session=await stored(), clip=session.tracks[0].clips[0], before=window.__tempoBefore.tracks[0].clips[0];
    assert(clip.assetId!==before.assetId&&clip.tempoAdaptation.originalAssetId===before.assetId,'Original/derived mapping missing');
    assert(Math.abs(clip.durationSeconds-before.durationSeconds*1.5)<.001,'Duration was not stretched');
    assert(Math.abs(clip.sourceStartSeconds-before.sourceStartSeconds*1.5)<.001,'Trim mapping incorrect');
    assert(session.loopRange.endSeconds===4.5,'Loop position was not adapted');
    window.__tempoDerived=structuredClone(clip);
    $('button-undo').click();await wait(async()=>(await stored()).tempo===123,'adapt undo');
    assert((await stored()).tracks[0].clips[0].assetId===before.assetId,'Undo did not restore original');
    $('button-redo').click();await wait(async()=>(await stored()).tempo===82,'adapt redo');
    const context=new AudioContext({sinkId:{type:'none'}});
    const decode=async id=>context.decodeAudioData(await (await fetch(window.prism.assetUrl(id))).arrayBuffer());
    const source=await decode(before.assetId), derived=await decode(clip.assetId);
    assert(Math.abs(derived.duration/source.duration-1.5)<.002,'Real sample duration did not change');
    const frequency=buffer=>{const values=buffer.getChannelData(buffer.numberOfChannels-1);
      let crossings=0;const lo=Math.floor(buffer.sampleRate*.05),hi=Math.min(values.length,Math.floor(buffer.sampleRate*.25));
      for(let i=lo+1;i<hi;i++)if(values[i-1]<=0&&values[i]>0)crossings++;
      return crossings/((hi-lo)/buffer.sampleRate);};
    assert(Math.abs(frequency(source)-frequency(derived))<8,'Stretch shifted pitch');
    await context.close();
    const bytes=Array.from(new Uint8Array(await (await fetch(window.prism.assetUrl(before.assetId))).arrayBuffer()));
    assert(JSON.stringify(bytes)===${JSON.stringify(JSON.stringify(original))},'Original source bytes changed');
    document.activeElement?.blur();
  `);
  await captureThemeScreenshot(window, directory, "tempo-adapted", 250);
  const picker = dialog.showSaveDialog, path = join(directory, "tempo-export.wav");
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  try {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "e", modifiers: ["control"] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "e", modifiers: ["control"] });
    for (let i = 0; i < 200; i++) {
      try {
        const wav = await readFile(path);
        if (wav.length <= 44 || wav.toString("ascii", 0, 4) !== "RIFF") throw new Error("Invalid tempo WAV export");
        let nonSilent = false;
        for (let sample = 44; sample+1 < wav.length; sample += 2) if (wav.readInt16LE(sample)) { nonSilent = true; break; }
        if (!nonSilent) throw new Error("Tempo export is silent");
        return ["exact BPM confirmation, cancel, tempo-only retains audio", "cancelled worker leaves saved session unchanged",
          "installed packaged WSOLA worker changes duration and retains measured pitch", "original bytes unchanged, trim and loop mapping",
          "tempo/adapt undo and redo", `real adapted-media WAV export (${wav.length} bytes)`];
      } catch (error) { if (i === 199) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error("Tempo export timed out");
  } finally { dialog.showSaveDialog = picker; }
}
