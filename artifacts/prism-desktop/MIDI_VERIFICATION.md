# Reliable MIDI track verification

## Signal path and changes

Piano-roll edits update the session's instrument-track notes. The existing save
bridge persists that session; migration restores notes and oscillator/ADSR
settings when the library reopens. Playback converts beats with the shared
transport tempo/meter, schedules one oscillator/envelope per note, and connects
each voice through the track's ordered processing, pan, fader, meter, master
processing/fader/meter, and output.

The audit found and corrected these problems:

- The attack peak ignored velocity. Velocity now scales the complete envelope,
  and live playback and offline rendering use the same envelope plan.
- Seek resumed every note at sustain level rather than its current envelope
  phase. Resumed notes now retain their remaining phase and end time.
- Muted/solo-excluded tracks skipped note scheduling, losing held notes on
  unmute/unsolo. Voices now stay scheduled behind the track's gated fader.
- Pending asynchronous Play/seek requests could restart after Stop or song
  disposal. A generation guard invalidates superseded playback work.
- Initial master volume was ignored and zero-level track exports could leak
  their initial default gain. New graphs now initialize their saved levels.
- Piano-roll dragging did not move pitch, creation ignored scroll offsets, and
  the grid hid notes outside its 49-key range. Editing now uses the full MIDI
  pitch range, scroll-aware coordinates, and saved pitch/timing/length updates.

Capture-worklet loading is restricted to recording, so it cannot prevent a
built-in instrument from playing. Instrument edits reschedule active playback;
internal playback errors are surfaced through the engine snapshot.

No native engine, ASIO, plug-in host, sampler, drum instrument, bus routing, or
effect-preset system is introduced by this change.

## Repeatable automated checks

```sh
pnpm --filter @workspace/prism-desktop run typecheck
pnpm --filter @workspace/prism-desktop run test
pnpm --filter @workspace/prism-desktop run test:audio-render
pnpm --filter @workspace/prism-desktop run build
```

`test` checks pitch/envelope plans, note-window boundaries, seeking/looping,
piano-roll drag/resize/snap behavior, serialized note/instrument migration,
existing audio timing, and WAV encoding.

`test:audio-render` requires Chrome/Chromium. Set `CHROMIUM_PATH` to its executable
when it is not named `chromium` on PATH. It serves the actual audio modules
locally, runs them in headless Chromium, inspects rendered PCM data, and checks:

- Non-silent 48 kHz, 16-bit stereo MIDI output, pitch, onset, duration, release,
  velocity scaling, and polyphonic rendering.
- Track/master level scaling, mute, track processing, and existing audio clips.
- Live track/master meters, held-note mute/solo recovery, seek, loop bounds,
  pause/stop, cancellation of a pending Play, and disposal during startup.

The live graph check uses Chromium's **silent sink**, which processes audio
without a physical output device. It does not assert that speakers played sound.
The Windows installer workflow runs typecheck, unit tests, the Chromium signal
checks, and packaging before uploading `PRISM-Windows-Installer`.

The project-library and Single-creation code is unchanged. Session serialization
is covered by automated migration tests; native dialog and IPC/device behavior
still belongs to the installed-app checklist below.

## Physical Windows-device acceptance — not verified in this container

1. Install the generated installer. Create a Single and add an instrument track.
2. Write overlapping notes, move them in pitch/time, resize, change velocity and
   oscillator/ADSR settings, then listen through a real Windows output device.
3. Check mute/solo/unmute, pause/stop, repeated seeks inside held notes, short
   loops, and switching songs while playing. Confirm no stuck notes or clicks.
4. Save, close PRISM, reopen it, and confirm notes/settings are intact.
5. Export WAV and listen in an independent player; compare it with playback.
6. Import an existing audio clip and confirm it stays synchronized with MIDI.
7. Check device selection, real output latency, recording, and monitoring on
   actual hardware. No latency or ASIO claim follows from automated results.
