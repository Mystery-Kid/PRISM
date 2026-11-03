# Buffered native VST3 hosting

Windows x64 only. This uses the genuine MIT-licensed Steinberg VST3 SDK in an
isolated native process; it is not a plugin-file catalog pretending to make sound.
The existing Web Audio engine and stable builtin sound identifiers are retained.
No third-party commercial plugin, SDK test instrument or fault probe is shipped.

## Use

1. Install the updated Windows build. Open a song and the **VST3** dock tab.
2. Add a trusted plugin folder. The permission prompt matters: VST3 plugins run
   native code with your computer's privileges. Never add untrusted downloads.
3. Scan. The browser shows progress, instruments/effects, search and individual
   failures. Windows x86/ARM, VST2, AU and AAX are unsupported.
4. Assign an instrument to an instrument track, or effects to a track, bus or
   master. Native effects are ordered **after** that owner's builtin FX chain.
   Use up/down, bypass, remove or replace without deleting source MIDI/audio.
5. Edit actual generic normalized parameters, or open the plugin's own Windows
   editor when it provides one. Playback pauses; closing the editor captures
   component/controller state and current parameters. Plugins without a native
   editor still have their generic controls.
6. Press Play to prepare the buffered mix. WAV export uses the same processing
   and routing, including track pan/faders, bus/master FX and pre/post sends.

Projects save plugin identities, parameters and opaque state—not plugin binaries
or executable paths. Trusted source permissions are separate local settings and
persist across restarts. Imported projects never grant plugin execution rights.
Schema 9 prevents older PRISM builds from silently discarding these assignments.
Builtin-only older projects remain compatible and their sound IDs are unchanged.

## Important limits

- This first buffered integration prepares the complete mix before playback, not
  low-latency per-block live processing. Preparation can take time. Changing audio
  settings pauses playback; press Play to prepare again. Pause/resume/seek reuse
  the unchanged buffer. Meters in this mode come from the prepared PCM.
- Live recording/monitoring and live native MIDI performance are not supported
  while native plugins are enabled. Bypass native processing to record with the
  existing engine. Instrument preview itself is buffered, not live audition.
- Loops repeat prepared processing; plugin history does not carry across the
  wrap. There is no claim of continuous native reverb/feedback across loop wraps.
- Native FX run after builtin FX, not interleaved. Builtin chain presets do not
  include the separately managed native stage; full projects do preserve it.
- Float32, one main stereo output and at most one main stereo input. No sidechains,
  multichannel output, plugin MIDI routing, dynamic bus/restart requests or advanced
  program lists. Program selection is through a plugin's editor where available.
- Declared plugin latency is compensated in the prepared mix, including parallel
  sends. Dynamic latency during processing fails explicitly rather than misaligning
  audio. Supported latency <=5 seconds, finite reported tails <=30 seconds.
  Native instruments additionally receive four seconds for unreported release;
  very long unreported releases may be cut. Infinite-tail plugins are rejected.
- Maximum ten minutes including tails/latency, 240 MiB per native audio message,
  512 MiB retained routing buffers, 16 MiB each component/controller state and
  64 MiB total opaque state per song. Reducing length/tracks can reduce memory.
- Scans are bounded to 16 source folders, six nested levels, 10,000 entries,
  128 modules and eight seconds per module. Individual incompatible/crashing
  modules are reported; the rest of the scan continues.
- Processing has a three-minute deadline and can be cancelled; editors close
  after fifteen minutes if left open. Previous saved state is kept on failure.
- A child process isolates accidental crashes, not malicious plugins. This is not
  an OS security sandbox. Trusted plugins retain their normal OS privileges.

Missing/crashing plugins keep the project's notes, source files and raw saved
state. Scan/reinstall a compatible trusted module or explicitly bypass, remove,
or replace it. Bypassing an instrument means silence; removing its assignment
restores the retained builtin sound. No automatic builtin substitution occurs.

## Build and licensing

Requires Windows x64, CMake >=3.25 and Visual Studio C++ desktop build tools /
Windows SDK. Native host is a standalone executable, not an Electron ABI addon.
The workflow compiles it and copies only `prism-vst-host.exe` plus original
SDK/component MIT notices to `generated-artifacts/prism-native-runtime/`.
Packaging refuses a missing executable or missing notices. Test fixture DLLs
stay outside that directory and are excluded by the resource whitelist.

SDK pin, license references, protocol/transport details and the architectural
decision are in `native/vst-host/ARCHITECTURE.md`. JUCE is not used.
Linux compilation is a development check, not a supported native release.

Automated acceptance uses external MIT MDA DX10 and Overdrive plus PRISM-authored
test-only gain/latency/editor/crash/wait plugins. Installed Windows checks cover
digital processing and source scheduling, not actual speakers, microphones,
professional driver latency or commercial-plugin compatibility.
