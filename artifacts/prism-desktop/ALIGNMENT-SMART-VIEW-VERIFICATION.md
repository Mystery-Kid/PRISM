# Arrangement alignment and MIDI Smart View

This phase concerns the offline Electron editor. It does not add a web version,
an instrument library, native VST hosting, tempo stretching, or new themes.

## Verification status

The checks below describe the implemented verification. Final command results and
the installed Windows run are recorded here after verification completes.

| Acceptance requirement | Evidence |
| --- | --- |
| 1. Clips do not cover track headers | Installed editor checks header hit-testing after horizontal scrolling, resizing and zooming. Separate grid regions share one header-width model. |
| 2. Track controls remain aligned | Installed checks compare header/lane row bounds at three sizes and zoom factors after native pointer resizing. |
| 3. Waveforms stay within clips | Source-window waveform utility tests cover trim offsets and silence; clipped renderer uses decoded source data. |
| 4. Notes cannot cover piano keys | Installed checks compare region boundaries and hit-test the keyboard. |
| 5. Piano keys and rows stay aligned | Installed checks compare the same pitch row in separate scrolling regions. |
| 6. Correct note pitch/time hit-testing | Coordinate unit tests and native C-sharp row double-click with snapping and Alt override. |
| 7. Drag/resize preserve note properties | Gesture regressions plus native scale-degree drag, unsnapped horizontal drag and duration resizing. |
| 8. Correct root/scale guides | Scale tests iterate all 12 roots and both scales across all 128 MIDI pitches; installed C-major guide check. |
| 9. Key changes update guides immediately | Installed selector change checks the guide label and C-sharp row classification. |
| 10. Smart View never rewrites existing notes | Migration tests compare full tracks; installed key/toggle changes compare original serialized note events. |
| 11. Scale Snap affects only edited/new notes | Scale utility/gesture tests and installed snapped/chromatic creation; original chromatic note remains unchanged. |
| 12. Horizontal snap is independent | Installed horizontal drag with time snapping off retains scale-snapped pitch. |
| 13. Undo/redo | Existing history regressions and installed duration-resize undo/redo. |
| 14. Song Key persists | Migration/portable-file round trips and actual installed process close/reopen. |
| 15. Legacy sessions retain content | Existing migration/portable/MIDI arrangement tests and new legacy unrestricted-key regression. |
| 16. Installed Electron at multiple sizes/zoom | Windows workflow installs the NSIS executable and exercises 1440×900 at 100%, 1000×760 at 125%, and 1200×800 at 80% Chromium zoom, with fractional timeline zoom. |

## Reproduction

```sh
pnpm --filter @workspace/prism-desktop run typecheck
pnpm --filter @workspace/prism-desktop run test
pnpm --filter @workspace/prism-desktop run test:projects
pnpm --filter @workspace/prism-desktop run test:arrangement
pnpm --filter @workspace/prism-desktop run build
```

The Windows workflow also runs the existing audio-render checks, packages the
NSIS installer, and runs `scripts/test-installed-windows.ps1`. Its isolated test
profile seeds a stereo WAV through real recording IPC: the left channel is
silent and the right channel contains a short tone followed by silence. This
tests source-derived peaks without pretending a physical microphone was used.

The `PRISM-Installed-Editor-Evidence` workflow artifact contains JSON results
and editor captures; `PRISM-Windows-Installer` contains the installer.

## Boundaries

- Chromium zoom is tested; physical Windows display scaling, audio hardware,
  microphone permissions, drivers, audible output and interactive native file
  dialogs still require device testing.
- Smart View and Song Key changes do not retune or quantize existing notes.
- MIDI time snapping and scale snapping are independent; Alt preserves
  chromatic input during supported note gestures.
- The previously reported cross-type right-click stale-selection bug remains
  explicitly deferred at the user's request. It is not a regression fixed or
  claimed by this phase.
