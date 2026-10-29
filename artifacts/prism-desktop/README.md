# PRISM Desktop

PRISM is being built as an offline-first Electron desktop music application. This package contains the secure Electron shell and the React interface it hosts; it is not a website wrapper.

## Requirements

- Node.js 24 or a compatible current LTS release
- pnpm 10

## Development and builds

From the repository root:

```sh
pnpm install
pnpm --filter @workspace/prism-desktop run dev
pnpm --filter @workspace/prism-desktop run typecheck
pnpm --filter @workspace/prism-desktop run build
pnpm --filter @workspace/prism-desktop run package:win
```

On a Windows build machine, the Windows command produces an NSIS installer with Start Menu and desktop shortcuts in `artifacts/prism-desktop/release/`. This Replit Linux environment can build the app files but does not include Wine, which electron-builder's Windows NSIS packaging step needs here. The repository includes `.github/workflows/prism-desktop-windows.yml` to build the installer on a Windows runner; run it from GitHub Actions and download the `PRISM-Windows-Installer` artifact.

Cross-platform packaging commands are included, but each target still needs to be built and tested on a compatible environment before it can be described as supported. An installer build alone does not count as a test of the installed application.

## Local data

PRISM stores its library and copied media in the operating system's Electron application-data directory, inside a `PRISM` folder. Use **File → Open PRISM data folder** to locate it. Project metadata is versioned JSON; artwork and imported audio are copied to the app's local assets folder.

## Offline themes

The Shop offers **Starry**, a free midnight-blue theme. Choose **Claim Free Theme**,
then **Apply Theme**, or open **Settings → Appearance**. Original remains available
at all times. Claims and selected appearance are saved separately in
`appearance.json` in PRISM's application-data folder, not inside songs or releases.
No login, payment, or online verification is involved.

If Starry's local package is missing or incompatible, PRISM uses Original while
keeping the claim and selection. **Repair Theme** reinstalls the bundled package
offline. Unreadable settings receive a visible warning; damaged settings are
preserved as a recovery copy before subsequent writes.

`pnpm --filter @workspace/prism-desktop run test:themes` checks the real local
settings store. For an isolated **browser-only** UI harness, build the app, then run
`pnpm --filter @workspace/prism-desktop exec tsx scripts/test-theme-ui-server.ts`
and visit `http://localhost:5193`. The harness uses temporary files and substitutes
HTTP for the IPC boundary; it does not verify Electron or installed Windows behavior.

## Current scope and limitations

- The project library, local persistence, release/song navigation, artwork selection, and basic audio import/playback are implemented incrementally.
- Built-in instrument tracks, ordered native effect chains, reusable effect presets, recording, and WAV export are implemented with the local Web Audio engine. See [EFFECTS.md](./EFFECTS.md) for native processors, preset storage, import safety, and plug-in limits.
- The supplied official PRISM PNG is used unchanged in the interface; Windows and Linux app icons are generated from it at standard icon sizes without recoloring or cropping the source.
- Audio support depends on Chromium's local Web Audio engine. This is not a claim of ASIO, Core Audio, JACK, third-party native plug-in, or professional low-latency support; real device, latency, and installed-app behavior require verification on the target computer.
