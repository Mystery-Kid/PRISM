import type { BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const helpers = `
  const $ = id => document.querySelector('[data-testid="' + id + '"]');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (predicate, message) => {
    for(let i=0;i<100;i++) {
      const result=await predicate(); if(result) return result;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Theme check timeout: '+message);
  };
  const stored = async () => {
    const releases=await window.prism.listReleases();
    return window.prism.getSession(releases[0].songIds[0]);
  };
  const appearance = async () => {
    if(!$('settings-dialog')) {
      const librarySettings=document.querySelector('button[aria-label="Settings"]');
      if(librarySettings) librarySettings.click();
      else {
        $('menu-edit').click();
        const preferences=await wait(()=>Array.from(document.querySelectorAll('[role="menuitem"]'))
          .find(item=>item.textContent.startsWith('Preferences')), 'Preferences menu');
        preferences.click();
      }
    }
    await wait(()=>$('settings-dialog'), 'settings dialog');
    $('settings-tab-appearance').click();
    await wait(()=>$('appearance-section'), 'Appearance');
  };
  const choose = async id => {
    if(!$('theme-current-'+id)) {
      const button=$('theme-apply-'+id);
      assert(button && !button.disabled, 'Theme cannot be applied: '+id);
      button.click();
    }
    await wait(()=>document.documentElement.dataset.theme===id && $('theme-current-'+id), id);
  };
  const duration = () => {
    const value=getComputedStyle(document.documentElement).getPropertyValue('--theme-transition-duration').trim();
    return parseFloat(value)*(value.endsWith('ms')?1:1000);
  };
`;

function browser(window: BrowserWindow) {
  return <T = unknown>(code: string): Promise<T> => window.webContents.executeJavaScript(
    `(async()=>{${helpers}\n${code}})()`, true);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 430));
const capture = async (window: BrowserWindow, directory: string, name: string) =>
  writeFile(join(directory, `${name}.png`), (await window.webContents.capturePage()).toPNG());

export async function verifyInitialDay(window: BrowserWindow, directory: string): Promise<string[]> {
  const evaluate = browser(window);
  await evaluate(`
    const initial=await window.prism.getThemeState();
    assert(initial.availableThemeIds.includes('theme.day'), 'Day is not built in');
    assert(initial.claimedThemeIds.length===0, 'Fresh profile unexpectedly has claims');
    let protectedClaim=false;
    try { await window.prism.applyTheme('theme.starry'); } catch(error) { protectedClaim=String(error).includes('Claim Starry'); }
    assert(protectedClaim, 'Starry bypassed its claim requirement');
    await appearance();
    assert($('appearance-theme-theme.original') && $('appearance-theme-theme.day'), 'Built-in cards missing');
    assert(!$('appearance-theme-theme.starry'), 'Unclaimed Starry is exposed in Appearance');
    assert($('appearance-theme-theme.day').textContent.includes('Built-in'), 'Day mislabeled as claimable');
    await choose('theme.day');
    const next=await window.prism.getThemeState();
    assert(next.effectiveThemeId==='theme.day' && next.claimedThemeIds.length===0, 'Day required a claim');
  `);
  await settle();
  await evaluate(`
    const background=getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g).slice(0,3).map(Number);
    const text=getComputedStyle(document.documentElement).color.match(/[\\d.]+/g).slice(0,3).map(Number);
    assert(background.every(channel=>channel>220) && text.every(channel=>channel<100), 'Day palette is not light/charcoal');
    const rgb=color=>color.match(/[\\d.]+/g).map(Number);
    const luminance=channels=>channels.slice(0,3).map(channel=>{
      const value=channel/255; return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);
    }).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    for(const selector of ['.appearance-intro h3','.appearance-name','.settings-tabs .active','.theme-success']) {
      for(const node of document.querySelectorAll(selector)) {
        let parent=node, backdrop=[255,255,255];
        while(parent) {
          const channels=rgb(getComputedStyle(parent).backgroundColor);
          if(channels.length===3 || channels[3]>.99) { backdrop=channels; break; }
          parent=parent.parentElement;
        }
        const foreground=luminance(rgb(getComputedStyle(node).color)), surface=luminance(backdrop);
        const contrast=(Math.max(foreground,surface)+.05)/(Math.min(foreground,surface)+.05);
        assert(contrast>=4.5, 'Day text contrast below4.5: '+selector+' ('+contrast.toFixed(2)+')');
      }
    }
  `);
  await capture(window, directory, "theme-day-preferences");
  await evaluate(`$('settings-close').click();`);
  await capture(window, directory, "theme-day-library");
  return ["Day immediately available offline", "Day applies without claim or Shop", "unclaimed Starry remains protected",
    "Day library/preferences palette and heading/card/tab/success text contrast"];
}

export async function verifyInstalledThemes(window: BrowserWindow, directory: string): Promise<string[]> {
  const evaluate = browser(window);
  const hostReducedMotion = await evaluate<boolean>(`return matchMedia('(prefers-reduced-motion: reduce)').matches;`);
  const attached = window.webContents.debugger.isAttached();
  if (!attached) window.webContents.debugger.attach("1.3");
  // CI Windows may disable animations. Explicitly exercise both preferences, not the host default.
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await evaluate(`await wait(()=>!matchMedia('(prefers-reduced-motion: reduce)').matches, 'normal motion enabled');`);
  window.setContentSize(1440, 900);
  window.webContents.setZoomFactor(1);
  const original = await evaluate<string>(`
    window.__prismSmokeWorkstation=document.querySelector('.workstation');
    window.__prismSmokeTimeOrigin=performance.timeOrigin;
    const session=await stored();
    return JSON.stringify({tracks:session.tracks, buses:session.buses, masterEffects:session.masterEffects});
  `);
  await capture(window, directory, "theme-day-piano");
  for (const panel of ["mixer", "effects", "routing", "devices"]) {
    await evaluate(`$('tab-${panel}').click(); await new Promise(resolve=>requestAnimationFrame(resolve));`);
    await capture(window, directory, `theme-day-${panel}`);
  }
  await evaluate(`$('tab-piano').click(); await appearance(); await choose('theme.starry');`);
  await settle();
  await evaluate(`
    assert(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase()==='#60c1c1',
      'Starry accent changed');
    const art=$('theme-art-layer'), style=getComputedStyle(art);
    assert(style.backgroundImage.includes('starry-moon') && Number(style.opacity)>.1, 'Supplied moon artwork is hidden');
    assert(style.pointerEvents==='none' && style.backgroundSize!=='100% 100%', 'Artwork blocks input or stretches');
    assert(duration()>=300 && duration()<=450, 'Normal transition duration must be 300–450ms, got '+duration());
  `);
  await capture(window, directory, "theme-starry-preferences");
  await evaluate(`$('settings-close').click();`);
  await capture(window, directory, "theme-starry-workstation");

  // A real AudioEngine context uses a silent sink in this isolated fixture. No physical-output claim.
  await evaluate(`
    const contexts=window.__prismSmokeAudioContexts;
    assert(contexts?.length, 'Audio context was not observed');
    window.__prismSmokeContext=contexts[0];
    window.__prismSmokeContextCount=contexts.length;
    $('button-return-start').click(); $('button-play-pause').click();
    await wait(()=>$('button-play-pause').getAttribute('aria-label')==='Pause', 'transport playing');
    window.__prismSmokeAudioTime=contexts[0].currentTime;
    await appearance(); await choose('theme.day');
    $('settings-close').click();
    const volume=$('input-track-volume-smoke-instrument');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(volume,.72);
    volume.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(async()=>(await stored()).tracks[0].volume===.72, 'editing during transition');
    await wait(()=>window.__prismSmokeContext.currentTime>window.__prismSmokeAudioTime+.1, 'audio clock during transition');
    assert(contexts.length===window.__prismSmokeContextCount && contexts[0]===window.__prismSmokeContext &&
      contexts[0].state==='running', 'Theme switching replaced/interrupted the audio context');
    assert($('button-play-pause').getAttribute('aria-label')==='Pause', 'Theme switching stopped transport');
    $('button-stop').click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(volume,.85);
    volume.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(async()=>(await stored()).tracks[0].volume===.85, 'restore test volume');
    await appearance(); await choose('theme.starry');
    window.__prismSmokeThemeChanges=[];
    window.__prismSmokeThemeObserver=new MutationObserver(()=>{
      window.__prismSmokeThemeChanges.push(document.documentElement.dataset.theme);
    });
    window.__prismSmokeThemeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    $('theme-apply-theme.day').click(); $('theme-apply-theme.original').click();
    await wait(()=>document.documentElement.dataset.theme==='theme.original' && $('theme-current-theme.original'), 'rapid final theme');
    assert((await window.prism.getThemeState()).selectedThemeId==='theme.original', 'Rapid switch persisted stale theme');
    assert(window.__prismSmokeThemeChanges.every(id=>id), 'Theme attribute was removed between switches');
    assert(document.querySelector('.workstation')===window.__prismSmokeWorkstation &&
      performance.timeOrigin===window.__prismSmokeTimeOrigin, 'Theme switch reloaded/remounted the workstation');
    window.__prismSmokeThemeObserver.disconnect();
  `);
  await settle();
  await capture(window, directory, "theme-original-preferences");

  try {
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await evaluate(`
      await wait(()=>matchMedia('(prefers-reduced-motion: reduce)').matches, 'reduced motion');
      assert(duration()<50, 'Reduced motion ignored');
      await choose('theme.day');
    `);
    await capture(window, directory, "theme-day-reduced-motion");
  } finally {
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  }
  await evaluate(`
    await wait(()=>!matchMedia('(prefers-reduced-motion: reduce)').matches, 'normal motion restored');
    await choose('theme.starry');
    $('settings-close').click();
    const session=await stored();
    assert(JSON.stringify({tracks:session.tracks,buses:session.buses,masterEffects:session.masterEffects})===${JSON.stringify(original)},
      'Theme changes modified project data');
  `);
  await settle();
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  if (!attached) window.webContents.debugger.detach();
  return ["Day workstation/piano/mixer/effects/routing/devices", "supplied Starry artwork and exact accent",
    "central 380ms theme fade", "reduced-motion emulation", "rapid switching without stale state or remount",
    "silent-sink audio clock and editing remain responsive", "project data unchanged",
    `host reduced motion: ${hostReducedMotion}; both motion preferences explicitly exercised`];
}
