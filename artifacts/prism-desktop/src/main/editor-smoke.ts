import type { BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Exercises the installed renderer with native Electron pointer events and real IPC. */
export async function verifyInstalledEditor(window: BrowserWindow, directory: string): Promise<string[]> {
  const evaluate = <T = unknown>(body: string): Promise<T> => window.webContents.executeJavaScript(`(async () => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const $ = (id) => document.querySelector('[data-testid="' + id + '"]');
    const wait = async (predicate, message) => {
      for (let index = 0; index < 100; index++) {
        const result = await predicate(); if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      throw new Error('Editor timeout: ' + message);
    };
    const stored = async () => {
      const releases = await window.prism.listReleases();
      return window.prism.getSession(releases[0].songIds[0]);
    };
    ${body}
  })()`, true);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
  const point = (id: string) => evaluate<{ x: number; y: number }>(`
    const element = $(${JSON.stringify(id)}); assert(element, 'Missing ' + ${JSON.stringify(id)});
    const rect = element.getBoundingClientRect();
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  `);
  const pointer = async (position: { x: number; y: number }, double = false, alt = false) => {
    const x = Math.round(position.x), y = Math.round(position.y);
    window.webContents.sendInputEvent({ type: "mouseMove", x, y });
    for (let count = 1; count <= (double ? 2 : 1); count++) {
      window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: count,
        modifiers: alt ? ["alt"] : [] });
      window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: count,
        modifiers: alt ? ["alt"] : [] });
      await pause();
    }
  };
  const drag = async (id: string, dx: number, dy: number, rightEdge = false) => {
    const start = rightEdge ? await evaluate<{ x: number; y: number }>(`
      const rect = $(${JSON.stringify(id)}).getBoundingClientRect();
      return {x: rect.right - 2, y: rect.top + rect.height / 2};
    `) : await point(id);
    const x = Math.round(start.x), y = Math.round(start.y);
    window.webContents.sendInputEvent({ type: "mouseMove", x, y });
    window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    await pause();
    for (let step = 1; step <= 3; step++) {
      window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x + dx * step / 3),
        y: Math.round(y + dy * step / 3), button: "left", modifiers: ["leftbuttondown"] });
      await pause();
    }
    window.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(x + dx), y: Math.round(y + dy),
      button: "left", clickCount: 1 });
    await pause();
  };

  window.setContentSize(1440, 900);
  window.webContents.setZoomFactor(1);
  window.focus();
  window.webContents.focus();
  await evaluate(`
    window.__prismSmokePointerLog = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(type, event => {
        const log = window.__prismSmokePointerLog;
        log.push({type, x:event.clientX, y:event.clientY, buttons:event.buttons,
          target:event.target?.closest?.('[data-testid]')?.dataset.testid});
        if(log.length > 120) log.shift();
      }, true);
    }
    await wait(() => $('timeline-lane-smoke-instrument'), 'instrument lane');
    assert(!document.querySelector('[data-testid="button-add-midi-clip"]'), 'Old MIDI Clip toolbar remains');
    await wait(async () => {
      const session = await stored();
      return session.tracks.find(track => track.id === 'smoke-audio').clips.every(clip => clip.waveform.length > 0);
    }, 'decoded stereo peaks');
    const audio = (await stored()).tracks.find(track => track.id === 'smoke-audio');
    assert(Math.max(...audio.clips[0].waveform) > .7, 'Right-channel source audio was hidden by silent left channel');
  `);
  const baseline = await evaluate<string>(`return JSON.stringify((await stored()).tracks[0].notes);`);
  await pointer(await point("midi-clip-smoke-original-clip"), true);
  await evaluate(`
    await wait(() => $('select-song-key-root'), 'piano editor');
    const root = $('select-song-key-root');
    root.value = '0'; root.dispatchEvent(new Event('change', {bubbles:true}));
    await wait(() => $('text-scale-guide')?.textContent.includes('C Major'), 'C Major guide');
    assert($('piano-key-row-61').classList.contains('scale-outside'), 'C sharp must be out of C major');
    $('button-smart-view').click();
    await wait(() => !$('text-scale-guide'), 'Smart View disabled');
    $('button-smart-view').click();
    await wait(() => $('text-scale-guide'), 'Smart View enabled');
    $('button-scale-snap').click();
    await wait(async () => (await stored()).midiView.scaleSnap, 'Scale Snap persistence');
    assert(JSON.stringify((await stored()).tracks[0].notes) === ${JSON.stringify(baseline)},
      'Key/Scale Snap changed existing chromatic MIDI notes');
  `);
  // Create a clip by double-clicking genuinely empty arrangement space.
  const empty = await evaluate<{ x: number; y: number }>(`
    const lane = $('timeline-lane-smoke-instrument').getBoundingClientRect();
    return {x: lane.left + 240, y: lane.top + lane.height / 2};
  `);
  await pointer(empty, true);
  const createdId = await evaluate<string>(`
    const session = await wait(async () => {
      const current = await stored(); return current.tracks[0].midiClips.length === 2 ? current : null;
    }, 'double-click clip creation');
    const clip = session.tracks[0].midiClips.find(clip => clip.id !== 'smoke-original-clip');
    assert(clip.durationBeats === 4 && clip.startBeat > 4, 'New clip must be one bar at the clicked position');
    assert($('piano-roll'), 'New clip did not open the actual piano editor');
    return clip.id;
  `);
  // Double-clicking that same clip opens it but must not insert another one.
  await pointer(await point(`midi-clip-${createdId}`), true);
  await evaluate(`assert((await stored()).tracks[0].midiClips.length === 2, 'Existing clip double-click duplicated it');`);
  const audioEmpty = await evaluate<{ x: number; y: number }>(`
    const lane = $('timeline-lane-smoke-audio').getBoundingClientRect();
    return {x: lane.left + 300, y: lane.top + lane.height / 2};
  `);
  await pointer(audioEmpty, true);
  await evaluate(`assert(!(await stored()).tracks.find(track => track.id === 'smoke-audio').midiClips?.length,
    'Audio lane double-click created MIDI');`);
  await pointer(await point(`midi-clip-${createdId}`), true);

  // Explicitly position the separately scrolling note grid and create notes on C#.
  const notePoint = async (offset: number) => evaluate<{ x: number; y: number }>(`
    const session = await stored(), clip = session.tracks[0].midiClips.find(clip => clip.id === ${JSON.stringify(createdId)});
    const grid = $('piano-roll'), width = 60 / session.tempo * 54 * Number($('input-timeline-zoom').value);
    grid.scrollLeft = Math.max(0, clip.startBeat * width - 30);
    grid.scrollTop = (127 - 61) * 15 - 50;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const rect = grid.getBoundingClientRect();
    return {x: rect.left + (clip.startBeat + ${offset}) * width - grid.scrollLeft,
      y: rect.top + (127 - 61) * 15 - grid.scrollTop + 7};
  `);
  await pointer(await notePoint(.5), true);
  const createdNoteId = await evaluate<string>(`
    await wait(async () => (await stored()).tracks[0].notes.length === 2, 'scale-snapped note creation');
    const note = (await stored()).tracks[0].notes.find(note => note.id !== 'smoke-note');
    assert(note.pitch === 60, 'New C# must snap to C in C major');
    return note.id;
  `);
  await pointer(await notePoint(2), true, true);
  await evaluate(`
    await wait(async () => (await stored()).tracks[0].notes.length === 3, 'Alt chromatic note creation');
    const notes = (await stored()).tracks[0].notes;
    assert(notes.some(note => note.id !== 'smoke-note' && note.pitch === 61), 'Alt did not preserve chromatic pitch');
    assert(notes.find(note => note.id === 'smoke-note').pitch === 61, 'Original note changed');
  `);
  await writeFile(join(directory, "editor-before-drag.png"), (await window.webContents.capturePage()).toPNG());
  await drag(`piano-note-${createdNoteId}`, 0, -15);
  await evaluate(`
    await wait(async () => (await stored()).tracks[0].notes.find(note => note.id === ${JSON.stringify(createdNoteId)}).pitch === 62,
      'vertical scale-degree drag');
    $('input-snap').click();
  `);
  await drag(`piano-note-${createdNoteId}`, 5, 0);
  await evaluate(`
    const note = await wait(async () => {
      const current = (await stored()).tracks[0].notes.find(note => note.id === ${JSON.stringify(createdNoteId)});
      return Math.abs(current.startBeat * 4 - Math.round(current.startBeat * 4)) > .05 ? current : null;
    }, 'independent unsnapped horizontal movement');
    assert(note.pitch === 62, 'Horizontal movement changed pitch');
    $('input-snap').click();
  `);
  await drag(`piano-note-${createdNoteId}`, 26, 0, true);
  await evaluate(`
    await wait(async () => {
      const note = (await stored()).tracks[0].notes.find(note => note.id === ${JSON.stringify(createdNoteId)});
      assert(note.pitch === 62, 'Duration resize changed pitch');
      return note.durationBeats === 2;
    }, 'note duration resize');
    $('button-undo').click();
    await wait(async () => (await stored()).tracks[0].notes.find(note => note.id === ${JSON.stringify(createdNoteId)}).durationBeats === 1,
      'note resize undo');
    $('button-redo').click();
    await wait(async () => (await stored()).tracks[0].notes.find(note => note.id === ${JSON.stringify(createdNoteId)}).durationBeats === 2,
      'note resize redo');
  `);

  // Native pointer resize operations exercise the same geometry as rendering.
  await drag("track-header-resize", 42, 0);
  await drag("track-height-resize-smoke-instrument", 0, 24);
  for (const [width, height, zoom, timelineZoom] of [[1440, 900, 1, 1.35], [1000, 760, 1.25, .75], [1200, 800, .8, 2.05]]) {
    window.setContentSize(width, height);
    window.webContents.setZoomFactor(zoom);
    await pause();
    await evaluate(`
      const range = $('input-timeline-zoom');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, ${timelineZoom});
      range.dispatchEvent(new Event('input', {bubbles:true}));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const scroll = document.querySelector('.timeline-scroll');
      scroll.scrollLeft = 130;
      await new Promise(resolve => requestAnimationFrame(resolve));
      for (const controls of document.querySelectorAll('.track-controls[data-track-id]')) {
        const header = controls.getBoundingClientRect(), lane = $('timeline-lane-' + controls.dataset.trackId).getBoundingClientRect();
        assert(Math.abs(header.top - lane.top) < 2 && Math.abs(header.height - lane.height) < 2, 'Track rows are misaligned');
        const hit = document.elementFromPoint(header.left + header.width - 16, header.top + header.height / 2);
        assert(hit && !hit.closest('.audio-clip,.midi-clip,.playhead'), 'Timeline content overlaps the header');
      }
      const grid = $('piano-roll'), key = $('piano-key-row-61'), row = document.querySelector('.piano-time-content [data-pitch="61"]');
      assert(grid && key && row, 'Piano key/grid regions missing');
      assert(Math.abs(key.getBoundingClientRect().top - row.getBoundingClientRect().top) < 2, 'Piano row/keyboard vertical mismatch');
      const keyboard = $('piano-keyboard').getBoundingClientRect(), rect = grid.getBoundingClientRect();
      assert(rect.left >= keyboard.right - 1, 'Piano editing grid overlaps keyboard');
      const hit = document.elementFromPoint(keyboard.left + 15, rect.top + 30);
      assert(!hit?.closest('.piano-note'), 'MIDI note covers piano labels');
    `);
    await writeFile(join(directory, `editor-${width}-${zoom}.png`), (await window.webContents.capturePage()).toPNG());
  }
  window.webContents.setZoomFactor(1);
  await evaluate(`
    const root = $('select-song-key-root'); root.value = '7'; root.dispatchEvent(new Event('change', {bubbles:true}));
    $('button-scale-snap').click();
    await wait(async () => {
      const session = await stored();
      return session.songKey.root === 7 && !session.midiView.scaleSnap && session.tracks[0].notes.length === 3;
    }, 'final editor persistence');
    const clip = (await stored()).tracks[0].midiClips.find(clip => clip.id === ${JSON.stringify(createdId)});
    assert(clip && clip.durationBeats === 4, 'MIDI clip identity/duration lost');
  `);
  return ["empty-lane MIDI creation", "existing/audio double-click boundaries", "key changes preserve MIDI",
    "Scale Snap and Alt override", "native scale-degree/horizontal drag", "duration resize and undo/redo",
    "stereo-source waveforms", "header/row resizing",
    "installed geometry at three sizes/zoom factors", "note/clip persistence"];
}
