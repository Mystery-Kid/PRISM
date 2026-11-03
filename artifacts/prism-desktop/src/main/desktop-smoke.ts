import { app, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyInstalledEditor } from "./editor-smoke";
import { captureThemeScreenshot, verifyInitialDay, verifyInstalledThemes } from "./theme-smoke";
import { verifyInstalledInstruments } from "./instrument-smoke";

/** Opt-in installed-app check. Always uses isolated userData supplied by CI. */
export async function runDesktopSmoke(window: BrowserWindow, directory: string, reopen: boolean): Promise<void> {
  const themeRestart = process.argv.includes("--prism-theme-reopen");
  const instrumentCreate = process.argv.includes("--prism-instrument-create");
  const instrumentRestart = process.argv.includes("--prism-instrument-reopen");
  const report = join(directory, instrumentCreate ? "instruments-create.json" : instrumentRestart ? "instruments-reopen.json" :
    themeRestart ? "theme-reopen.json" : reopen ? "reopen.json" : "first-launch.json");
  const timer = setTimeout(() => {
    void writeFile(report, JSON.stringify({ ok: false, error: "Installed app check timed out." }))
      .finally(() => app.exit(1));
  }, 100_000);
  try {
    if (instrumentCreate || instrumentRestart) {
      const checks = await verifyInstalledInstruments(window, directory, instrumentRestart);
      await writeFile(report, JSON.stringify({ ok: true, checks }, null, 2));
      clearTimeout(timer); app.exit(0); return;
    }
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
        track.midiClips = [{ id: 'smoke-original-clip', name: 'Original MIDI', startBeat: 0, durationBeats: 4 }];
        track.notes = [{ id: 'smoke-note', midiClipId: 'smoke-original-clip', pitch: 61, startBeat: 1, durationBeats: 2, velocity: 96 }];
        track.id = 'smoke-instrument';
        const audioTrack = { ...track, id: 'smoke-audio', type: 'audio', name: 'Right-channel fixture',
          instrument: null, clips: [], notes: [], midiClips: [], recordArmed: true };
        session.tracks.push(audioTrack);
        session.tempo = 123;
        session.songKey = { root: 7, scale: 'major' };
        session.midiView = { smartView: true, scaleSnap: false };
        await bridge.saveSession(session);
        // Use actual recording IPC to seed a stereo file; this is NOT a microphone/device test.
        const recordingId = await bridge.startRecording({
          sessionId: session.id, trackId: audioTrack.id, sampleRate: 48000, channels: 2, startSeconds: 0
        });
        const samples = new Float32Array(48000 * 2 * 2);
        for (let frame = 0; frame < 24000; frame++) samples[frame * 2 + 1] =
          Math.sin(frame * 440 * 2 * Math.PI / 48000) * .8;
        await bridge.appendRecordingChunk(recordingId, samples);
        await bridge.finishRecording({ recordingId, waveform: [] });
        const recorded = await bridge.getSession(session.id);
        const recordedTrack = recorded.tracks.find(item => item.id === audioTrack.id);
        const source = recordedTrack.clips[0];
        source.durationSeconds = .5;
        recordedTrack.clips.push({ ...source, id: 'smoke-silent-trim', name: 'Silent source window',
          startSeconds: 3, sourceStartSeconds: 1, durationSeconds: 1 });
        recordedTrack.recordArmed = false;
        await bridge.saveSession(recorded);
      }
      releases = await bridge.listReleases();
      assert(releases.length === 1, 'Isolated project was not preserved');
      const session = await bridge.getSession(releases[0].songIds[0]);
      assert(session.tempo === 123 && session.tracks[0].notes[0].pitch === 61, 'Saved MIDI or tempo was lost');
      assert(session.songKey && session.songKey.root === 7 && session.songKey.scale === 'major', 'Song Key was lost');
      assert(session.midiView && session.midiView.smartView, 'MIDI view settings were lost');
      const state = await bridge.getThemeState();
      assert(state.effectiveThemeId === ${JSON.stringify(themeRestart ? "theme.starry" : reopen ? "theme.day" : "theme.original")},
        'Theme selection did not persist');
      await wait(()=>document.documentElement.dataset.theme===state.effectiveThemeId, 'persisted renderer theme');
      ${reopen && !themeRestart ? `
      window.__prismSmokeAudioContexts=[];
      window.AudioContext=new Proxy(window.AudioContext,{construct(Target,args) {
        const context=Reflect.construct(Target,[{...args[0],sinkId:{type:'none'}}]);
        window.__prismSmokeAudioContexts.push(context); return context;
      }});
      const project = await wait(() => document.querySelector('.project-item'), 'persisted project card');
      project.click();
      await wait(() => document.querySelector('.workstation'), 'workstation');
      const menus = Array.from(document.querySelectorAll('.workstation-command-menus [data-menu]'))
        .map(item => item.textContent.trim());
      assert(JSON.stringify(menus) === JSON.stringify(['File','Edit','Insert','View','Transport','Help']),
        'Menu order incorrect: ' + menus.join(', '));
      ` : ""}
      return { ok: true, phase: ${JSON.stringify(themeRestart ? "theme-reopen" : reopen ? "reopen" : "first-launch")},
        checks: ['installed Electron startup', 'context-isolated IPC', 'song save/load', 'MIDI persistence', 'offline theme persistence'${reopen && !themeRestart ? ", 'workstation menu order'" : ""}],
        version: await bridge.getAppVersion() };
    })()`, true);
    if (themeRestart) {
      result.checks.push("Starry selection survives a second process restart");
      await captureThemeScreenshot(window, directory, "theme-starry-library-restarted", 450);
    } else if (reopen) {
      const editorChecks = await verifyInstalledEditor(window, directory);
      result.checks.push(...editorChecks);
      result.checks.push(...await verifyInstalledThemes(window, directory));
    } else {
      result.checks.push(...await verifyInitialDay(window, directory));
      await window.webContents.executeJavaScript(`window.prism.claimTheme('theme.starry')`, true);
    }
    await writeFile(report, JSON.stringify(result, null, 2));
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    clearTimeout(timer);
    const diagnostics = await window.webContents.executeJavaScript(`(async () => {
      const releases = await window.prism.listReleases();
      const session = await window.prism.getSession(releases[0].songIds[0]);
      return {notes:session.tracks[0].notes, songKey:session.songKey, midiView:session.midiView,
        pointerEvents:window.__prismSmokePointerLog,
        noteRects:Array.from(document.querySelectorAll('.piano-note')).map(element => {
          const rect=element.getBoundingClientRect();
          return {id:element.dataset.testid, rect:rect.toJSON(),
            centerTarget:document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.outerHTML.slice(0,200)};
        })};
    })()`).catch(() => null);
    await window.webContents.capturePage().then((image) =>
      writeFile(join(directory, "editor-failure.png"), image.toPNG())).catch(() => undefined);
    await writeFile(report, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error), diagnostics }, null, 2));
    app.exit(1);
  }
}
