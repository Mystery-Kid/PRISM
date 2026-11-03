# Native VST3: buffered workstation integration

## Implementation and validation boundary

The workstation's VST3 dock and real IPC bridge connect native instruments and
track/bus/master effects to prepared playback and WAV export. Trusted local
folder permissions and cached scan results remain outside project files.
Project schema 9 stores class identities, parameter maps and opaque component/
controller state. Source notes and audio stay editable. Native Win32 editors,
generic parameters, ordered FX, bypass and explicit recovery are included.

See `../../NATIVE-VST3.md` for the full user workflow, supported I/O, ordering,
tail/memory/time limits, buffering and recording restrictions. This is a complete-
mix buffered bridge, not a native audio engine or low-latency live plugin host.
Audio edits pause native playback and invalidate the prepared mix.

The normal Windows installer workflow builds the native host with the static
MSVC runtime and original SDK notices, excluding every fixture plugin. Its
installed create/reopen checks exercise external MDA and PRISM test-only
gain/latency/editor/crash/wait modules, actual routed PCM, source scheduling,
state persistence and cancellation. The old standalone feasibility workflow
remains a manually runnable diagnostic. Neither validates physical audio devices,
professional driver latency, or arbitrary commercial plugins.

## SDK and licensing

Selected: Steinberg VST3 SDK 3.8.1, pinned to upstream commit
`20d1036bd50d5b67a1595e25b8aa3ef02d45bea8` and its pinned submodules.
The reviewed SDK is MIT-licensed, not the historical GPL/commercial SDK license.
CMake copies the original SDK/base/interfaces/public-SDK/CMake license notices
into the build's `notices` directory. Ship those with any future native host binary.
VST branding/usage guidelines are separate from the code license.

JUCE was evaluated but not selected: it has its own JUCE 8 licensing conditions,
independent of the VST3 SDK's MIT terms. No JUCE license was accepted or code added.
No VST2/AU/AAX support or commercial-plugin redistribution is included.

The optional test build uses the SDK MDA instrument/effect sources, whose headers
contain the MIT notice, Copyright (c) 2008 Paul Kellett. These are CI fixtures,
not PRISM's own instruments and **must not enter the production installer**.
Future users supply their own legally installed Windows x64 VST3 plugins and
licenses. Theme packages, portable-project media and ordinary imports must never
grant executable-plugin permission.

Authoritative references reviewed:
- https://github.com/steinbergmedia/vst3sdk/blob/20d1036bd50d5b67a1595e25b8aa3ef02d45bea8/LICENSE.txt
- https://steinbergmedia.github.io/vst3_dev_portal/pages/FAQ/Licensing.html
- https://juce.com/legal/juce-8-licence/

## Native component

An SDK-based C++17 executable loads modules/factories, initializes component and
controller, activates buses, applies parameters/state, supplies MIDI and stereo
PCM, calls the real `IAudioProcessor::process()`, and returns stereo PCM plus
component state. It runs outside React/Electron main. There is no Node/Electron
native-addon ABI dependency. The eventual parent must launch one disposable
process per scan or isolated processing job, bound output, enforce a deadline,
validate exit status/output, and discard partial outputs on failure.

A separate process contains accidental plugin crashes, but is **not a security
sandbox**: a deliberately selected plugin executes with the user's OS privileges.
No untrusted module loading from automatic project or theme import is allowed.
The current test runner enforces process timeouts; a production process manager,
recovery UI and persisted raw states are still required.

Production target: Windows x64 with Visual Studio 2022 C++ desktop build tools,
Windows SDK and CMake >=3.25. Offline CLI work uses the child thread, not React.
Native editor integration will additionally require a persistent STA UI thread,
Win32 window parenting, a message loop, resize callbacks and safe close/crash
handling. No native-editor support is claimed by this CLI. Non-ASCII Windows
path handling, x86/ARM plugins and plugin-specific installers remain unverified.
Linux builds are development checks only, not a supported desktop release.

## Feasibility protocol

Little-endian `PVST` version 1 requests specify sample rate, maximum block size,
total frames, audio channel count, tempo, meter, MIDI events and normalized
parameter IDs/values. The request is generated from PRISM's actual `SongSession`
and `Track` model. Output is `PVSO` version 1: stereo float PCM, sample rate,
frame count, plugin-reported latency and tail. Opaque component state is separate.
No plugin binaries are stored in the project or audio response.

- Float32, one main stereo output, at most one stereo input. Mono input can be
  duplicated; sidechains/multiple outputs require deliberate later support.
- 8–192 kHz, maximum block 32–2048 frames, <=30-second slices, bounded events/state.
- MIDI is split at exact sample boundaries using variable blocks not exceeding
  the declared maximum. This preserves sub-block note onset/off timing without
  relying on each plugin's positive-offset handling after silence.
- PRISM's denominator-aware beat times convert to sample frames. VST musical
  position and bar position are quarter-note units; tempo is quarter-note BPM.
- Offline processing supplies playing status, continuously advancing sample/
  musical position, BPM and time signature. Looping/seeking/discontinuity/reset
  contracts require integration work. Infinite tails are reported, not rendered
  indefinitely. Latency is reported, **not yet compensated** by PRISM.
- This does not yet preserve editor/controller-only state, automation gestures,
  program lists, MIDI CC mappings, dynamic buses or plugin-requested restarts.

## Approved integration choice

The Web Audio graph cannot call a native VST3 processor synchronously from its
audio thread. Native processing working in a command-line slice is insufficient.
Do not replace the central engine merely to make the demo appear integrated.

### Preserve Web Audio with an explicitly buffered plugin path

Keep existing builtins, scheduling, routing and project sound compatibility.
Add a process-managed block bridge, cancellable render-ahead for plugin MIDI,
buffered native FX insertion and latency compensation on parallel routes.
Actual instrument audio must enter the existing track input, while FX must
process at the correct ordered chain position, including bus/master and export.
Offline export must use the same plugin state/ordering, never silently bypass.
Parameter/editor changes must invalidate the correct prepared audio/state.

This adds buffering/startup/edit latency, which must be measured and disclosed;
it is not an acceptable basis for a claim of low-latency live MIDI/monitoring.
Fixed latency compensation, underrun recovery and graph transitions are substantial
work, but avoid silently replacing the working built-in engine.

### Deliberate native-engine migration

Move the processing clock, mixing/routing and device/output path to a native
engine. Preserve the legacy engine as an explicit compatibility mode; don't
reinterpret saved builtin sound identifiers. This is broader architectural work,
including builtin DSP equivalence, device handling, monitoring/recording,
transport, metering, exports and thorough installed-app regression checks.
It may offer a better real-time design but does not itself prove professional
driver latency. It needs explicit approval before implementation.

The user approved the buffered-plugin approach. Preserve the Web Audio engine;
do not undertake the native-engine migration. Existing builtin sound IDs are not
reinterpreted. Adding/removing native assignments does not convert source MIDI
to persisted audio or replace the builtin implementation.

## Reproduce

From the workspace root:

```
cmake -S artifacts/prism-desktop/native/vst-host -B generated-artifacts/prism-native-build -DPRISM_VST_TEST_FIXTURES=ON
cmake --build generated-artifacts/prism-native-build --config Release --target prism-vst-host mda-vst3
```

Then use `pnpm --filter @workspace/prism-desktop exec tsx scripts/test-native-vst.ts`
with the absolute host executable and test `.vst3` bundle paths. The Windows
workflow performs those steps. Production builds must leave test fixtures off.
Build output is excluded from Git/deployment; only diagnostics, not test-plugin
binaries, are uploaded by the feasibility workflow.
