# PRISM effects and reusable chains

## Audit of the existing processor path

Before this UI change, four Web Audio effects already existed: a peaking
equalizer, generated-impulse convolver reverb, feedback delay, and dynamics
compressor. Track and master graphs built arrays of these processors in order,
and WAV export used those same graphs. Track state was stored with the song.

The processing itself worked, but the interface only offered static add and
remove controls. Chains could not be reordered or duplicated, parameter ranges
and defaults were split between UI and DSP code, and presets/search/reset were
missing. Parameter updates already used AudioParam smoothing, but changing a
reverb decay replaced its impulse abruptly. Structural chain changes disposed
the old path immediately, which could click or momentarily drop audio. The
browser test harness had only tested a single equalizer case.

## Supported native effects

These four effects are implemented by the Web Audio graph and WAV renderer:

| Effect | Category | Parameters | Safe range and default |
| --- | --- | --- | --- |
| Equalizer | Tone | Frequency, gain, Q | 20–20,000 Hz (1,000 Hz); −24–24 dB (0 dB); 0.1–18 (1) |
| Reverb | Space | Decay, mix | 0.15–4 s (1.6 s); 0–1 (0.2) |
| Delay | Space | Time, feedback, mix | 0.01–1.5 s (0.25 s); 0–0.85 (0.25); 0–1 (0.2) |
| Compressor | Dynamics | Threshold, ratio, attack, release, knee | −60–0 dB (−18 dB); 1–20 (4); 0.001–1 s (0.003 s); 0.01–2 s (0.25 s); 0–40 dB (12 dB) |

The shared catalog drives browser labels, categories, descriptions, UI ranges,
defaults, reset, migration, and input normalization. DSP clamps at the same
boundaries. Continuous AudioParams use short target ramps; replacing a chain
crossfades the old and new paths; changing reverb decay crossfades its impulse
response. Parameter edits update the graph in place and do not reschedule note
voices.

Each audio/instrument track and the master output has a separate ordered chain.
Chain changes are stored in the session. The same graph factory is used by live
playback and WAV export; bypass routes dry audio while retaining the configured
effect in the chain.

## Effect browser

The browser searches the implemented native catalog by effect name, category,
description, and parameter keywords. It deliberately does not present
third-party plug-ins as working effects. “VST / VST3” is labeled unavailable,
not insertable; PRISM currently has no plug-in loader.

## Versioned presets and scope

Presets use the `prism-effect-chain` JSON format, version 1. Each file carries a
name and an ordered effect list. The app library stores presets alongside
project metadata using its existing write-queue plus temporary-file/rename
atomic persistence.

- **Global** presets have a null project ID and are visible from every release
  in this PRISM library.
- **This release** presets are keyed by release ID and are visible only while
  that release is open.

Users can save the current chain, load it over the selected chain, append it,
rename, duplicate, delete, import, and export. A preset file is bounded to
1 MiB and each chain to 64 effects. JSON data is parsed and validated; it is
never evaluated or loaded as code. Export writes a temporary file and renames
it into place.

Known effect types are normalized to safe native parameter ranges when they
are applied. Unknown effect types are retained as JSON payloads in the preset,
shown as unavailable, and reported when loading; no unknown data is passed to
the audio graph. This allows a preset to be re-exported without silently
discarding effects that this PRISM build cannot run.

## Native plug-in architecture recommendation

VST and VST3 are binary plug-in formats, not safe Web Audio nodes. PRISM must
not load arbitrary plug-in binaries or scripts in its privileged renderer.
Before any host is built, evaluate a separately supervised native audio-host
process with a narrow, versioned IPC/shared-memory audio contract, explicit
user-approved plug-in paths, crash isolation, and measured buffering/latency.
The format adapter, OS signing/trust policy, scanning, and project portability
should be decided before shipping a host. Until that evaluation and real
hardware tests are complete, keep VST/VST3 unavailable and make no native
plug-in or professional low-latency claim.

## Verification

`pnpm --filter @workspace/prism-desktop run test` checks effect catalog
normalization, defaults, preset schema/scope, unknown-payload preservation,
and persistence round-trips. `pnpm --filter @workspace/prism-desktop run
test:audio-render` checks rendered effect order, bypass, per-track isolation,
in-place live parameter edits, and chain reorder without restarting notes. The
Windows installer workflow runs both commands before packaging. These automated
checks do not replace installed-app testing with real Windows output hardware.
