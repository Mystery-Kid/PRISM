# Day, Starry and theme transitions

## Scope and local checks

Day is built in and does not require a claim, Shop visit, account or network.
Starry continues to require its existing local entitlement and compatible package.
The supplied moon image and official PRISM logo are unchanged.

Local typecheck, production build and all 103 tests passed: 89 core, 3
portable-project, and 11 arrangement/scale/waveform tests. Theme-store tests
include immediate Day availability without Starry's package, rapid serialized
requests, restart persistence, claim protection, invalid selection fallback,
repair and project-data isolation.

## Acceptance evidence

The installed Windows workflow performs these checks with the packaged NSIS
application, not a browser bridge. JSON results and PNG captures are uploaded
in `PRISM-Installed-Editor-Evidence`.

| Supplied acceptance case | Automated evidence |
| --- | --- |
| 1. Day immediately available | Fresh-profile actual IPC and Appearance show built-in Day with no claims; applying Starry still rejects before a claim. |
| 2. Day across the app | Installed library/preferences and workstation/piano/mixer/effects/routing/devices captures; existing native editing and geometry checks run in Day. |
| 3. Supplied moon/stars visible | Installed Starry artwork-layer check and library/workstation captures; original image used with aspect-preserving sizing. |
| 4. Exact Starry accent | Computed `--accent` must equal `#60c1c1`. |
| 5. Smooth theme switching | Central 380ms color/background/border and artwork transitions; installed switching between all three themes and duration checks. |
| 6. Reduced motion | Installed Chromium media emulation verifies reduced motion and a transition duration below 50ms. |
| 7. Rapid repeated switches | Installed rapid Appearance changes must leave UI and persisted state on the final selection, without removing the theme attribute or remounting the workstation. |
| 8. Restart persistence | First installed process saves Day; second process verifies Day. Second saves Starry; third process verifies Starry and captures its library. |
| 9. Starry claim rules | Fresh installed profile cannot apply Starry or select it in Appearance; existing unit checks cover package repair/missing/incompatible states. |
| 10. Audio/edit responsiveness | During a real theme switch, the installed AudioEngine's silent-sink clock advances, transport remains playing and an actual track-volume edit saves; context identity and original project data are preserved. |

## Reproduction

```sh
pnpm --filter @workspace/prism-desktop run typecheck
pnpm --filter @workspace/prism-desktop run test
pnpm --filter @workspace/prism-desktop run test:projects
pnpm --filter @workspace/prism-desktop run test:arrangement
pnpm --filter @workspace/prism-desktop run build
```

On Windows, package with `pnpm run package:win`, then run
`scripts/test-installed-windows.ps1`. Each test process uses an isolated profile;
the script does not modify a user's normal projects or appearance settings.

## Limits

- Silent-sink clock/graph continuity is not a physical audio-output, driver,
  latency or microphone test.
- Both normal and reduced motion are explicitly emulated because Windows CI
  can prefer reduced motion by default. The host preference is restored.
- Native captures wait for compositor frames after UI actions; DOM state alone
  is not treated as visual evidence.
- Captures and computed-color checks do not replace exhaustive assistive-
  technology or display-hardware testing.
- The deferred cross-type right-click selection bug remains unchanged.
- No new Shop products, payments, instrument/audio-engine features or unrelated
  artwork are added in this phase.
