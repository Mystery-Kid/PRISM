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

PRISM stores its library and copied media in the operating system's Electron application-data directory, inside a `PRISM` folder. Use **Preferences → General → Open data folder** to locate it. Project metadata is versioned JSON; artwork and imported audio are copied to the app's local assets folder.

### Save, Save As, and Open

**Save Project** flushes the open song to the local library (also automatically
saved while editing). **Save Project As…** creates a separate, self-contained
`.prism` snapshot of the open song, including audio, sampler/drum samples,
artwork, MIDI clips/notes, effects, and routing. It does not change the original
song or redirect subsequent local autosaves to that snapshot. Open it again to
work on a separate imported copy. An album's other songs are not included.

Portable files support up to **128 MB of embedded media / 192 MB total file
size**. Larger projects can use the existing full-library backup. Missing media
causes Save As to fail explicitly, leaving any existing destination unchanged.
**Open Project** imports a portable file with fresh song, release, and media
identities, so it cannot overwrite an existing project. New/Open/Exit save the
current work and finish active recording first; a failed save aborts navigation.

### Arrangement and shortcuts

The themed File, Edit, Insert, View, Transport, and Help menus share the same
command handlers as shortcuts. There is no second native menu accelerator
dispatch. Use **Add Track (+)** to choose an audio, instrument, sampler, drum, or
bus. Single-click MIDI clips to select, drag the body to move, drag the right edge
to resize, and double-click or use Open MIDI Editor to edit. Single-clicking a
piano-roll note selects it; deletion uses Delete, right-click, or the explicit
Erase tool. The lower dock is resizable and its state is saved locally.

Default shortcuts use Ctrl on Windows/Linux and Command on macOS:
Space play/stop, R record, Home return to start, S split, Delete delete,
Mod+Z undo, Mod+Shift+Z redo, Mod+X/C/V cut/copy/paste, Mod+D duplicate,
Mod+A select all, Mod+S save, Mod+Shift+S Save As, Mod+E export,
N snap, L loop, K metronome, and F fit selection/project.
**Preferences → Shortcuts** shows contexts and supports rebinding, conflict
detection, import/export, and restoring defaults. Typing fields are protected.

## Offline themes

The Shop offers **Starry**, a free midnight-navy theme with the supplied moon
artwork and `#60C1C1` teal accents. Choose **Claim Free Theme**,
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

For the full isolated workstation renderer harness, run
`pnpm --filter @workspace/prism-desktop exec tsx scripts/test-workstation-ui-server.ts`
after building, then visit `http://localhost:5194`. File-picker selections and
IPC are substituted; theme, project-file, migration and disk persistence logic
remain real. This harness never reads normal PRISM user data.

The Windows workflow additionally installs the NSIS output and launches that
installed executable twice against isolated data. It checks real Electron
startup, the sandboxed preload/IPC, project and MIDI persistence, offline themes,
and workstation menu order. It does **not** establish physical sound output,
driver latency, microphone behavior, or interactive native file-picker behavior.

## Current scope and limitations

- The project library, local persistence, release/song navigation, artwork selection, and basic audio import/playback are implemented incrementally.
- Built-in instrument tracks, ordered native effect chains, reusable effect presets, recording, and WAV export are implemented with the local Web Audio engine. See [EFFECTS.md](./EFFECTS.md) for native processors, preset storage, import safety, and plug-in limits.
- The supplied official PRISM PNG is used unchanged in the interface; Windows and Linux app icons are generated from it at standard icon sizes without recoloring or cropping the source.
- Audio support depends on Chromium's local Web Audio engine. This is not a claim of ASIO, Core Audio, JACK, third-party native plug-in, or professional low-latency support; real device, latency, and installed-app behavior require verification on the target computer.
