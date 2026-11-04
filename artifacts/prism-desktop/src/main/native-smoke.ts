import type { BrowserWindow } from "electron";
import { captureThemeScreenshot } from "./theme-smoke";
export async function verifyInstalledNative(window: BrowserWindow, directory: string, reopen: boolean): Promise<string[]> {
  const checks = await window.webContents.executeJavaScript(`(async()=>{
    const wait=async(fn,label)=>{for(let i=0;i<300;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Native UI timeout: '+label)};
    await wait(()=>window.__prismNativeChecks && document.querySelector('.project-item'),'test module/library');
    const checks=await window.__prismNativeChecks(${JSON.stringify(reopen)});
    document.querySelector('.project-item').click();
    await wait(()=>document.querySelector('.workstation'),'workstation');
    for (const target of ['track','master']) {
      document.querySelector('[data-testid="tab-effects"]').click();
      await wait(()=>document.querySelector('[data-testid="input-effects-search"]'),'FX browser');
      const targetSelect=document.querySelector('[data-testid="select-effect-chain-target"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(targetSelect,target);
      targetSelect.dispatchEvent(new Event('change',{bubbles:true}));
      const search=document.querySelector('[data-testid="input-effects-search"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'vst3');
      search.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(()=>document.querySelectorAll('.effect-browser-card').length===1,'VST3 search result');
      const card=document.querySelector('[data-testid="native-format-vst3"]');
      if(!card || /unavailable/i.test(card.textContent))throw Error('FX browser still incorrectly labels VST3 unavailable');
      document.querySelector('[data-testid="button-manage-native-effects"]').click();
      const panel=await wait(()=>document.querySelector('[data-testid="native-plugin-manager"]'),'native panel');
      if(panel.querySelector('[role="tab"][aria-selected="true"]')?.textContent!=='Effects')throw Error('FX shortcut did not open native Effects');
      if(panel.querySelector('select[aria-label="Native effect destination"]')?.value!==target)throw Error('FX shortcut lost target '+target);
    }
    checks.push('FX browser VST3 search/navigation and track/master target preservation');
    return checks;
  })()`, true);
  await captureThemeScreenshot(window,directory,reopen?"native-reopened":"native-connected");
  return checks;
}
