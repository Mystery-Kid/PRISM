import { app, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Opt-in installed-app check. Always uses isolated userData supplied by CI. */
export async function runDesktopSmoke(window: BrowserWindow, directory: string, reopen: boolean): Promise<void> {
  const report = join(directory, reopen ? "reopen.json" : "first-launch.json");
  const timer = setTimeout(() => {
    void writeFile(report, JSON.stringify({ ok: false, error: "Installed app check timed out." }))
      .finally(() => app.exit(1));
  }, 45_000);
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const wait = async (predicate, label) => {
        for (let i = 0; i < 150; i++) {
          const result = await predicate();
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Timed out: ' + label);
      };
      await wait(() => document.querySelector('.library-page'), 'library renderer');
      const bridge = window.prism;
      assert(bridge && typeof bridge.saveSession === 'function', 'Sandboxed preload bridge unavailable');
      assert(await bridge.getAppVersion(), 'Version IPC failed');
      let releases = await bridge.listReleases();
      if (!${JSON.stringify(reopen)}) {
        const created = await bridge.createRelease({
          title: 'Installed app persistence check', artistName: '', releaseType: 'Single', description: ''
        });
        const session = created.session;
        const track = session.tracks[0];
        track.type = 'instrument';
        track.name = 'Smoke synth';
        track.instrument = { waveform: 'sine', attack: .01, decay: .1, sustain: .7, release: .1 };
        track.notes = [{ id: 'smoke-note', pitch: 60, startBeat: 1, durationBeats: 2, velocity: 96 }];
        session.tempo = 123;
        await bridge.saveSession(session);
        await bridge.claimTheme('theme.starry');
        await bridge.applyTheme('theme.starry');
      }
      releases = await bridge.listReleases();
      assert(releases.length === 1, 'Isolated project was not preserved');
      const session = await bridge.getSession(releases[0].songIds[0]);
      assert(session.tempo === 123 && session.tracks[0].notes[0].pitch === 60, 'Saved MIDI or tempo was lost');
      const state = await bridge.getThemeState();
      assert(state.effectiveThemeId === 'theme.starry', 'Theme selection did not persist');
      ${reopen ? `
      const project = await wait(() => document.querySelector('.project-item'), 'persisted project card');
      project.click();
      await wait(() => document.querySelector('.workstation'), 'workstation');
      const menus = Array.from(document.querySelectorAll('.workstation-command-menus [data-menu]'))
        .map(item => item.textContent.trim());
      assert(JSON.stringify(menus) === JSON.stringify(['File','Edit','Insert','View','Transport','Help']),
        'Menu order incorrect: ' + menus.join(', '));
      ` : ""}
      return { ok: true, phase: ${JSON.stringify(reopen ? "reopen" : "first-launch")},
        checks: ['installed Electron startup', 'context-isolated IPC', 'song save/load', 'MIDI persistence', 'offline theme persistence'${reopen ? ", 'workstation menu order'" : ""}],
        version: await bridge.getAppVersion() };
    })()`, true);
    await writeFile(report, JSON.stringify(result, null, 2));
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    clearTimeout(timer);
    await writeFile(report, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }, null, 2));
    app.exit(1);
  }
}
