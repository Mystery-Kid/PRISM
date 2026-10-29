# PRISM audio-engine boundary

## Decision

PRISM will use a renderer-side audio service built on the Web Audio API, with
`AudioContext.currentTime` as the playback clock and AudioWorklet for input
capture and other work that must not run in React. React sends commands and
renders engine state; React renders and timers are never the source of musical
timing. Electron's main process remains responsible for safe dialogs, project
files, managed media, and persistence through the restricted preload bridge.

## Why this boundary

The workstation delegates scheduling, the playback clock, and node lifetime to
an audio service instead of React. Scheduled source nodes keep playing
independently of React renders. Live instrument voices and WAV export share
the same pitch and velocity-scaled envelope calculation, including partial-note
resumption and release. Track processing, pan, track level, and master
processing/level sit after instrument generation.

Electron embeds Chromium, so Web Audio and AudioWorklet provide a practical
cross-platform first engine without adding native modules that must be compiled
and packaged separately for each operating system. The engine service will own
decoding, scheduling, recording, monitoring, meters, effects routing, and
offline rendering. It will be testable independently of the React panels.

## Supported scope and limits

AudioContext scheduling and AudioWorklet capture are appropriate for PRISM's
initial imported-audio, recording, MIDI, effects, and WAV-rendering workflows.
Input and output device access depends on Chromium/Electron permissions and the
operating system. Device latency and monitoring delay vary by hardware and
driver.

This choice does **not** promise ASIO, VST/VST3, Audio Units, professional
low-latency performance, or glitch-free operation under arbitrary CPU load.
Those require a deliberately selected native backend and validation on the
target hardware. PRISM must report the actual device and engine state and
retain these limits in its user documentation.

Playback and capture use the same AudioContext clock, and the capture worklet
starts at a requested context frame. That provides a defined synchronization
path for overdubs, but no hardware-level drift or latency measurements have
been completed. Standalone recording is implemented; do not advertise
overdubbing as verified until it passes a real Windows-device test.

## Boundary rules

- The renderer's `AudioEngine` is the only owner of `AudioContext` and audio
  nodes. React calls engine methods and subscribes to snapshots.
- The AudioContext clock is authoritative for playback, loop boundaries,
  metronome scheduling, and recording timestamps.
- AudioWorklet receives microphone samples and posts bounded PCM chunks;
  persistence writes chunks to a temporary file rather than holding an entire
  take in React state.
- The main process validates session/track IDs, bounds incoming data, writes
  managed audio, uses atomic project metadata writes, and owns export dialogs.
- Playback and export use the same track/effect rules. A control is visible
  only when its behavior is implemented.
- The Web Audio renderer is the initial implementation boundary, not a claim
  that a browser timer is a DAW-grade audio engine. Installed Windows tests
  remain necessary before claiming device, latency, or recovery behavior.

## MIDI verification

See [MIDI_VERIFICATION.md](./MIDI_VERIFICATION.md) for the automated checks,
signal-path audit, and the separate physical Windows-device acceptance checklist.

## Effects verification

See [EFFECTS.md](./EFFECTS.md) for the native processor audit, chain behavior,
parameter limits, versioned presets, and unavailable plug-in formats.
