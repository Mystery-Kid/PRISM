# Windows native audio: architectural gate

## Audited baseline

PRISM currently runs builtin instruments, effects, routing, live playback,
recording, and monitoring through Chromium Web Audio. The UI schedules
AudioBufferSourceNode/oscillator voices into an AudioContext, and an AudioWorklet
for capture forwards chunks to the main-process recording writer. Output device
selection uses AudioContext.setSinkId where Electron supports it. These APIs do
not expose an ASIO stream or explicit WASAPI shared/exclusive negotiation.

The existing C++ VST3 executable processes bounded, whole-session prepared
audio. Its process isolation and saved plugin-state contracts are valuable and
must remain intact, but it is not a continuously running device callback engine.
It cannot provide live native MIDI/recording merely by selecting another driver.

## Why a driver dropdown is insufficient

A native ASIO/WASAPI callback cannot call React, Electron IPC, Web Audio nodes,
the file system, or allocate an unbounded voice/effect graph. Reusing the current
DSP requires either:

1. Preparing PCM before native playback, retaining buffered behavior, or
2. A separately implemented realtime processing graph with a bounded event/audio
   bridge, explicit clock ownership, and verified sound compatibility.

Streaming renderer-produced PCM through asynchronous Electron messages does not
establish professional low latency. It adds another buffering/clock boundary and
must not be presented as a direct native realtime engine.

## Recommended staged coexistence

Keep the current Web Audio engine as the explicit compatibility path. Introduce
a native backend behind a versioned session/device transport contract rather
than deleting that path.

1. **Device host:** separate Windows x64 process, maintained PortAudio backend
   evaluated for WASAPI shared/exclusive and optionally licensed ASIO. Pin the
   dependency, retain notices, use static runtime linking, and limit IPC message
   size, child lifetime, authorized commands, and resource use.
2. **Capability negotiation:** enumerate real host APIs, stable device identity,
   direction/channel metadata and supported formats. Probe actual stream tuples,
   not independent guessed rate/buffer combinations; display requested versus
   negotiated settings. Driver-preferred ASIO buffers and WASAPI host buffering
   are not necessarily equal to an application callback block size.
3. **First transport milestone:** optional prepared PCM playback can preserve
   existing builtin/VST3 sound and routing without an engine rewrite. It remains
   buffered, with edits invalidating playback, and does not satisfy live MIDI/FX
   or complete low-latency workstation acceptance.
4. **Realtime processing milestone:** implement bounded native voices, routing,
   sample readers, effects and scheduled MIDI, with a native sample clock and
   render-ahead queues. Preserve existing instrument IDs and sounds; use new IDs
   if exact sound parity cannot be established. Realtime VST3 needs additional
   isolation, process-ahead buffering, latency compensation, and explicit
   crash/disconnection handling beyond the existing offline host.
5. **Duplex recording/monitoring:** callback performs only bounded PCM transfer,
   DSP, atomics and preallocated ring operations. A non-realtime worker writes
   recordings atomically; overflow must stop/preserve the take with an error,
   not silently discard input. Synchronize recording offsets with the output
   clock and account for measured input/output latency.
6. **Preferences and lifecycle:** only offer supported settings, stop active
   streams safely before reconfiguration, reject device changes during an
   unfinalized take, and retain the previous valid configuration on failure.
   Device loss stops sound/capture explicitly; recovery does not silently switch
   microphones or route feedback to speakers.
7. **Acceptance:** installed-app tests plus physical compatible driver/interface
   testing for playback, recording, monitoring, MIDI, FX, multiple tracks, rate/
   buffer changes, switching, loss/reconnection, clock drift and underruns.
   A virtual/silent CI device can verify contracts, not physical ASIO acceptance.

The user approved this staged parallel native-engine scope. That approval does
not authorize changing saved sounds or removing the compatibility engine. The
upgrade must not be marked fully complete while implementation or physical ASIO
acceptance remains unresolved.

## Licensing decision and distribution gate

The user chose preparation for Steinberg's **proprietary, royalty-free ASIO
agreement**, not a GPLv3 conversion. This is not evidence of a signed agreement.
Do not sign for the user, bundle proprietary device drivers, publish an ASIO
binary before the agreement is effective, or redistribute the SDK as a toolkit.

PortAudio's permissive license does not itself grant ASIO SDK/interface rights.
Any ASIO build option must default off and fail explicitly without the approved
SDK/license prerequisites; never enable an SDK auto-download behind the user's
back. Keep WASAPI-only distribution separate from the ASIO release gate.

### Primary sources checked

- https://www.steinberg.net/developers/asiosdk-open/
- https://forums.steinberg.net/t/asio-sdk-proprietary-license-frequently-asked-questions/1044024
- https://download.steinberg.net/sdk_downloads/Steinberg+ASIO+Licensing+Agreement.pdf
- https://raw.githubusercontent.com/PortAudio/portaudio/master/LICENSE.txt
- https://raw.githubusercontent.com/PortAudio/portaudio/master/CMakeLists.txt

This document records an architectural evaluation, not a claim that a native
device backend has already been implemented or verified.
