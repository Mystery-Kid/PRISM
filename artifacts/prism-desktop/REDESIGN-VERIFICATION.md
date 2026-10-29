# PRISM redesign verification

## Preservation and architecture audit

The existing application already supplied real Web Audio playback/recording,
source-derived waveforms, post-fader track/bus/master analysers, routing, native
effect chains, reusable presets, sampler/drum instruments, autosaving, backups,
and a local ThemeStore. These implementations were retained, not replaced by
mock controls. The project remains an offline Electron application with a
sandboxed preload and allowlisted IPC.

The editing gaps were primarily UI/model coordination: flat absolute-beat MIDI
notes had no independently movable arrangement grouping; selection and editor
opening were coupled; shortcut context followed the visible dock rather than the
active editor; menus exposed only part of the actual command surface. MIDI clip
metadata now groups the original absolute-beat notes, preserving the playback
and export signal path and backward compatibility. New main-process validation
rejects invalid clip identities/timing or lost saved arrangement metadata.

## Checks actually run

- TypeScript check and Electron main/preload/renderer production build.
- Core unit/persistence suite, portable-project suite, MIDI-arrangement suite,
  and the saved-shortcut-conflict regression test.
- Existing real Web Audio checks: MIDI/sampler/drum rendering, sequencing,
  effects, routing, independent live metering/preview, transport and recovery.
- Focused browser renderer editing journey using the isolated workstation
  harness: real UI, temporary disk persistence and real portable project logic,
  with HTTP substituted for Electron IPC and native file selection.
  This confirmed independent portable import identities and retained audio/MIDI,
  and that an injected disk-save error prevents New Project from navigating.
  The pass also found a missing Bus entry (corrected), unclear import feedback
  (a confirmation was added), and a stale save-error banner after recovery
  (successful Save now clears it). These small fixes were checked by build/type
  checks and source inspection rather than another full browser pass.
- A completion review caught note-paste clamping outside a selected MIDI clip
  and a seconds/beats mix-up in multi-note paste. The actual command now uses a
  shared renderer paste planner with regressions for pasting beyond a clip,
  preserving an eight-beat gap at 120 BPM, extending a clip without shortening
  notes, and retaining cross-track offsets. Paste identities are planned before
  scheduling state so deferred React updates do not lose copy selection.
- Windows GitHub Actions builds the NSIS installer, installs it, then starts that
  installed executable twice with isolated user data. Both launches exercise the
  real sandboxed preload and IPC; the second verifies persisted MIDI, tempo,
  offline theme selection, project opening and menu ordering.

## Acceptance checklist

| # | Requirement | Evidence and limits |
|---|---|---|
| 1 | Menu order and File/Edit contents | Renderer interactive inspection; installed Windows smoke checks top-level order. |
| 2 | Real commands | Shared handlers, enablement and focused editing checks; Save As/Open have disk tests. Native picker interaction and every menu permutation are not exhaustively automated. |
| 3 | Add Track choices | Audio, instrument, sampler, drums and real bus creation are implemented; bus omission found in the browser pass was corrected. Existing routing-engine tests verify bus processing. |
| 4 | Actual waveforms | Source decoding/peaks retained; clip windows and offsets have unit coverage. Missing media is surfaced, never replaced with arbitrary waveforms. |
| 5 | Independent meters | Real track/bus/master analysers retained; audio graph tests cover actual signals, mute/solo/gain/routing. UI adds peak hold, clipping and click-to-reset. |
| 6 | MIDI select/move without opening | Browser confirmed single-click does not open Piano; movement updates the clip and its notes. Persisted grouping has migration and portable-file round-trip tests. |
| 7 | Double-click opens correct editor | Confirmed in renderer interaction test. Dock close leaves project data intact. |
| 8 | Sound and synchronized MIDI playback | Nonzero rendered PCM and live graph/transport tests passed. Physical loudspeaker/headphone output and driver performance remain unverified. |
| 9 | Consistent, focus-safe shortcuts | Registry/default/conflict unit tests and browser checks with tempo input focused; native duplicate accelerators removed. |
| 10 | Undo/redo | Session history tests and interactive note/clip delete/undo/redo checks. |
| 11 | Exact Starry direction | Supplied moon artwork bundled unchanged; shared theme overrides use `#60C1C1`, navy surfaces and deliberate aspect-preserving crop. |
| 12 | Offline claim persistence | Real ThemeStore tests and two-launch installed Windows smoke. |
| 13 | Shop claimed/applied state | Existing real entitlement-driven states retained; new reference preview uses the same theme state and store. |
| 14 | Existing project compatibility | Version 1–5 migrations, original note preservation, instrument/effect/routing recovery, backup and portable-media tests. |
| 15 | Installed Windows app tested | NSIS installation plus two actual installed Electron launches in Windows CI, not merely a browser build. Physical devices and interactive system pickers are outside this automated smoke check. |

## Known limits

- Save As is a portable **snapshot of the open song** with embedded media, not
  a new default autosave destination or a full album/library archive. Its limit
  is 128 MB of media / 192 MB total file size. Full library backup remains
  available for larger or multi-song collections.
- Physical microphone recording, audio-device changes, audible playback,
  driver latency, and native file-picker interactions need a real Windows
  desktop acceptance session. No ASIO or other professional-driver claim is made.
- MIDI clip grouping is optional metadata over absolute-beat notes. Right-edge
  resizing is supported; trimming removes/truncates affected notes and can be
  undone. Left-edge trimming is not presented as implemented.
- The bus is a genuine separately modeled audio submix shown in Routing and
  Mixer, not a renamed MIDI/audio lane or a decorative folder.
- This report is a check of exercised behavior, not a claim that every editing
  combination or operating-system/device configuration has been tested.
