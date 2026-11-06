# Native audio — staged parallel engine

## Current stage: actual device host, not native project playback

Preferences > Audio Devices communicates with the packaged `prism-audio-host.exe`
through a context-isolated, sender-validated main-process bridge. The host uses a
pinned PortAudio Windows backend to query real devices and output format tuples.
WASAPI endpoints use their Windows endpoint identity, not a remembered list
index. No native stream opens automatically on launch or when preferences open.

Explicit diagnostic operations can open a WASAPI shared/exclusive stream, report
the negotiated sample rate and reported output latency, measure actual callback
block sizes and underflow counts, and schedule a short quiet sine test. The test
uses a bounded native sample clock/event queue and preallocated voices, not Web
Audio. Requested buffer length is distinct from observed host buffering. A
supported rate probe is not a guarantee that a requested buffer will open.

The diagnostic stream closes when its owning settings panel closes, including
when an asynchronous open finishes after that panel unmounts. Opening/testing
pauses compatibility playback and disables input monitoring; device changes are
rejected while a take is active. Missing devices fail rather than silently
opening another endpoint. Child exit/protocol errors/timeouts stop native audio;
reconnection requires an explicit refresh. Only a successful configuration is
atomically saved, and a save failure closes its newly opened stream.

**The workstation transport still uses Web Audio/buffered VST3.** This first
stage does not yet route projects, live MIDI, FX, recording, or monitoring through
the native host. It does not expose fake native transport/record controls. Saved
song data, instrument engine IDs and existing sound generation are unchanged.
The approved subsequent work is a parallel native graph/transport with explicit
per-session compatibility, not a wholesale engine replacement.

## Build

Public CI builds WASAPI support with **ASIO disabled**:

```
cmake -S native/audio-host -B ../../generated-artifacts/prism-audio-host-build -A x64 -DPRISM_ENABLE_ASIO=OFF
cmake --build ../../generated-artifacts/prism-audio-host-build --config Release
ctest --test-dir ../../generated-artifacts/prism-audio-host-build -C Release --output-on-failure
```

Run from the desktop artifact directory. Copy only `prism-audio-host.exe` and
its original `notices/*.txt` into the existing native-runtime staging directory.
The packaging assertion requires both this host and the existing VST3 host with
their notices. Dependencies are statically linked; no user-installed VC runtime
or proprietary device driver is bundled.

Portable callback-core tests need no PortAudio or hardware:

```
cmake -S native/audio-host -B ../../generated-artifacts/prism-audio-core-build -DPRISM_BUILD_AUDIO_DEVICE_HOST=OFF
cmake --build ../../generated-artifacts/prism-audio-core-build
ctest --test-dir ../../generated-artifacts/prism-audio-core-build --output-on-failure
```

## ASIO gate

The user selected Steinberg's proprietary route. That choice is **not** an
executed agreement. `PRISM_ENABLE_ASIO=ON` refuses configuration unless an
authorized owner separately verifies an effective proprietary agreement and
supplies the SDK locally with `PRISM_ASIO_SDK_ROOT`; the SDK is never
automatically downloaded. Do not enable or distribute this option before those
conditions hold. The code has guarded ASIO buffer-range and control-panel calls,
but this route is uncompiled and unverified without that SDK/license/hardware.

## Acceptance limits

Core tests verify sample-onset timing after silence, release to silence, bounded
event-queue overflow, channels, signal bounds, and the native frame clock.
Windows subprocess checks verify the real executable's protocol and explicit
failure for nonexistent devices. Installed Electron checks verify the packaged
host, preferences, and failed-open behavior with unchanged settings/song data.
None of those tests establishes physical WASAPI/ASIO sound, roundtrip latency,
recording reliability, or professional live MIDI performance.

Do not mark the overall workstation upgrade complete until native project
processing, duplex recording/monitoring, remaining lifecycle behavior, the ASIO
distribution gate, and actual compatible-interface acceptance are satisfied.
