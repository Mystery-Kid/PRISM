import type { BrowserWindow } from "electron";
import { captureThemeScreenshot } from "./theme-smoke";

const helpers = `
  const $ = id => document.querySelector('[data-testid="' + id + '"]');
  const assert = (value,message) => { if(!value) throw new Error(message); };
  const wait = async (fn,label) => {
    for(let i=0;i<120;i++) { const result=await fn(); if(result) return result; await new Promise(r=>setTimeout(r,50)); }
    throw new Error('Workspace timeout: '+label);
  };
  const savedLayout = () => JSON.parse(localStorage.getItem('prism.workspace.v1') || 'null');
  const musical = session => {
    const {updatedAt,tracks,...music}=session;
    return JSON.stringify({...music,tracks:tracks.map(({color,...track})=>track)});
  };
  const readSong = async () => {
    const releases = await window.prism.listReleases();
    const release=releases.find(r=>r.title==='Installed app persistence check');
    assert(release,'Seed project missing');
    return window.prism.getSession(release.songIds[0]);
  };
  const openSong = async () => {
    const cards=await wait(()=>document.querySelectorAll('.project-item').length && Array.from(document.querySelectorAll('.project-item')), 'project cards');
    const card=cards.find(node=>node.textContent.includes('Installed app persistence check'));
    assert(card,'Seed project card missing'); card.click();
    await wait(()=>$('timeline-ruler'), 'workstation');
    await new Promise(r=>setTimeout(r,500));
  };
  const geometry = () => {
    const ruler=$('timeline-ruler').getBoundingClientRect();
    for(const row of document.querySelectorAll('.timeline-track-row')) {
      const header=row.querySelector('.track-controls').getBoundingClientRect();
      const lane=row.querySelector('.timeline-lane').getBoundingClientRect();
      assert(Math.abs(header.right-lane.left)<1.1,'Header overlaps/gaps lane');
      assert(Math.abs(lane.left-ruler.left)<1.1,'Timeline/header origin mismatch');
      assert(Math.abs(header.height-lane.height)<1.1,'Header/lane height mismatch');
    }
    const arrangement=document.querySelector('.arrangement').getBoundingClientRect();
    assert(arrangement.height>=190,'Dock obscures arrangement');
  };
`;

export async function verifyInstalledWorkspace(window: BrowserWindow, directory: string, reopen: boolean): Promise<string[]> {
  const evaluate = <T = unknown>(code: string): Promise<T> =>
    window.webContents.executeJavaScript(`(async()=>{${helpers}\n${code}})()`, true);
  await evaluate(`await openSong();`);
  if (reopen) {
    await evaluate(`
      assert(document.documentElement.dataset.theme==='theme.prism','PRISM theme not restored');
      const layout=savedLayout();
      assert(layout.headerWidth===312 && layout.trackHeights['smoke-instrument']===160,'Resized layout not restored');
      assert(layout.panel==='effects' && layout.dockVisible===false,'Panel/collapse not restored');
      assert($('show-dock'),'Dock was not restored collapsed');
      $('show-dock').click(); await wait(()=>$('tab-effects')?.classList.contains('active'),'active panel');
      geometry();
      assert(musical(await readSong())===localStorage.getItem('prism.smoke.music'),'Resize/restart changed musical content');
      const track=(await readSong()).tracks.find(t=>t.id==='smoke-instrument');
      assert(track.color==='#00c9b0','Independent color not persisted');
      $('menu-view').click();
      const reset=await wait(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(n=>n.textContent.includes('Restore Default Workspace')),'restore menu');
      reset.click();
      await wait(()=>savedLayout().headerWidth===240 && Object.keys(savedLayout().trackHeights).length===0 && savedLayout().panel==='mixer' && savedLayout().dockVisible,'default workspace');
      geometry();
      assert(musical(await readSong())===localStorage.getItem('prism.smoke.music'),'Restore defaults changed musical content');
      assert((await readSong()).tracks.find(t=>t.id==='smoke-instrument').color==='#00c9b0','Reset erased track color');
    `);
    await captureThemeScreenshot(window, directory, "workspace-prism-defaults", 500);
    return ["actual Electron process-restart layout/theme/color persistence", "panel and collapsed state restoration", "Restore Default Workspace preserves musical content and colors", "restored alignment"];
  }
  await evaluate(`
    $('menu-view').click();
    Array.from(document.querySelectorAll('[role="menuitem"]')).find(n=>n.textContent.includes('Restore Default Workspace')).click();
    await wait(()=>savedLayout()?.headerWidth===240,'defaults');
    localStorage.setItem('prism.smoke.music',musical(await readSong()));
    $('tab-mixer').click();
  `);
  // Exercise real captured pointers in the installed app, not synthetic DOM-only events.
  const drag = async (id: string, dx: number, dy: number) => {
    const point = await evaluate<{ x: number; y: number }>(`
      const bounds=$(${JSON.stringify(id)}).getBoundingClientRect();
      return {x:Math.round(bounds.left+bounds.width/2),y:Math.round(bounds.top+bounds.height/2)};
    `);
    window.webContents.sendInputEvent({ type: "mouseMove", ...point });
    window.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseMove", x: point.x + dx, y: point.y + dy, button: "left" });
    window.webContents.sendInputEvent({ type: "mouseUp", x: point.x + dx, y: point.y + dy, button: "left", clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 150));
  };
  await drag("track-header-resize", 72, 0);
  await drag("track-height-resize-smoke-instrument", 0, 48);
  await drag("dock-resize", 0, -24);
  await evaluate(`
    await wait(()=>savedLayout().headerWidth===312 && savedLayout().trackHeights['smoke-instrument']===160,'captured pointer sizes');
    assert(!savedLayout().trackHeights['smoke-audio'],'Resizing one row changed another');
    geometry();
    const grip=$('track-height-resize-smoke-audio'); grip.focus();
    grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    await wait(()=>savedLayout().trackHeights['smoke-audio']===124,'keyboard track resize');
    geometry();
    const color=document.querySelector('[data-track-id="smoke-instrument"] .track-color-picker');
    color.open=true;
    color.querySelector('button[aria-label="Teal track color"]').click();
    await wait(async()=>(await readSong()).tracks.find(t=>t.id==='smoke-instrument').color==='#00c9b0','saved track color');
    assert((await readSong()).tracks.find(t=>t.id==='smoke-audio').color!=='#00c9b0','Color leaked into another track');
    assert(musical(await readSong())===localStorage.getItem('prism.smoke.music'),'Workspace change affected musical content');
    $('menu-edit').click();
    Array.from(document.querySelectorAll('[role="menuitem"]')).find(n=>n.textContent.includes('Preferences')).click();
    await wait(()=>$('settings-tab-appearance'),'preferences');
    $('settings-tab-appearance').click();
    const apply=await wait(()=>$('theme-apply-theme.prism'),'PRISM theme apply');
    apply.click();
    await wait(()=>document.documentElement.dataset.theme==='theme.prism' && $('theme-current-theme.prism'),'PRISM active');
    $('settings-close').click();
    $('tab-effects').click();
    await wait(()=>savedLayout().panel==='effects','saved active panel');
    geometry();
  `);
  await captureThemeScreenshot(window, directory, "workspace-prism-resized", 500);
  await evaluate(`
    $('menu-view').click();
    Array.from(document.querySelectorAll('[role="menuitemcheckbox"]')).find(n=>n.textContent.includes('Track Inspector')).click();
    await wait(()=>savedLayout().dockVisible===false && $('show-dock'),'saved collapse');
  `);
  return ["captured pointer track/header/dock resizing in installed Electron", "keyboard resizing", "shared header/lane/ruler coordinates", "independent track colors saved", "PRISM theme applies without restart", "layout changes preserve source music"];
}
