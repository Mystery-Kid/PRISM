import type { BrowserWindow } from "electron";
import { captureThemeScreenshot } from "./theme-smoke";
export async function verifyInstalledNative(window: BrowserWindow, directory: string, reopen: boolean): Promise<string[]> {
  const checks = await window.webContents.executeJavaScript(`(async()=>{
    const wait=async(fn,label)=>{for(let i=0;i<300;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Native UI timeout: '+label)};
    await wait(()=>window.__prismNativeChecks && document.querySelector('.project-item'),'test module/library');
    const checks=await window.__prismNativeChecks(${JSON.stringify(reopen)});
    document.querySelector('.project-item').click();
    await wait(()=>document.querySelector('.workstation'),'workstation');
    document.querySelector('[data-testid="tab-native"]').click();
    await wait(()=>document.querySelector('[data-testid="native-plugin-manager"]'),'native panel');
    return checks;
  })()`, true);
  await captureThemeScreenshot(window,directory,reopen?"native-reopened":"native-connected");
  return checks;
}
