# Built-in instrument library

PRISM is still an offline Electron application. Open a MIDI track and choose
**Instruments** in the lower panel bar. Search by name/category, select a sound,
and use **Preview**. Audition follows the real track effects, gain, pan,
mute/solo, bus and master path; muted or solo-excluded tracks will remain silent.

## Included working engines

| Sound | Engine |
| --- | --- |
| Custom Oscillator | Original waveform + ADSR; legacy projects use this unchanged |
| FM Electric Piano | Original two-operator, velocity-sensitive FM synthesis; not an acoustic piano |
| Drawbar Organ | Original additive tonewheel-style partials and percussive harmonic |
| Analog Poly | Detuned dual-oscillator subtractive synthesis with resonant low-pass filter |
| Bright Stack Lead | Square/saw subtractive lead articulation |
| Drift Pad | Three detuned oscillators, low-pass filter and slow envelope |
| Glass Pluck | Harmonic pluck and decaying filter |
| Sub & Saw Bass | Fundamental/sub oscillator blend and low resonant cutoff |
| PRISM Electronic Kit | Actual WAV sampler: kick 36, snare 38, closed hat 42, open hat 46, clap 39, low tom 43, ride 51, crash 49 |

Only controls implemented by the selected engine are shown. Standard envelopes
are saved per track. New synth envelopes release after note-off; the legacy
oscillator retains its previous envelope timing and level exactly. Sound
generation is shared between live playback, audition and offline WAV export.

The eight factory drum recordings are generated deterministically on first kit
selection and registered in the normal managed media library. No download,
external bank, network connection or runtime dependency is required. The kit's
sample assignments and pad gains remain editable in **Drums**. Other GM pitches
are unassigned, explicitly reported, and are not a complete General MIDI bank.
Existing user samplers and drum sample assignments remain supported.

## Projects, presets and recovery

Replacing a sound preserves track identity, MIDI/clips, effects and routing.
Presets save concrete synth/sampler/drum settings in the local library; restoring
a preset copies its settings, never links tracks to a mutable shared instance.
Synth presets also retain their stable preset ID/name. Portable `.prism` files
contain the selected track's concrete instrument/parameter state and referenced
sample WAVs; unrelated global presets are not exported. Full library backups
include the global preset collection.

Library schema 6 accepts schemas 1–5. The existing library loader makes a backup
before writing migrated data. Older PRISM builds reject schema 6 instead of
silently stripping the new instrument information.

Unavailable instrument IDs are not substituted with a generic oscillator.
Their ID, original raw state and MIDI remain recoverable. Preview is disabled
and export fails with a replacement instruction. Choosing a supported replacement
keeps the original recovery data attached. Seek/loop/stop, replacement and
repeated preview cancel or bound all oscillator/modulator lifetimes.

## Provenance and licensing

All synthesis and procedural percussion recipes in this phase were authored
for PRISM. No third-party instrument engine, recorded sample, commercial sound
bank or downloaded asset was included. Factory drum PCM recordings are original
algorithmic output, dedicated under **CC0-1.0** (see `FACTORY-SOUNDS-LICENSE.txt`).
This dedication applies to factory sample audio, not the application source
license or user-imported recordings.

Acoustic piano, sampled acoustic/electric bass, strings, brass and choirs are
**not bundled**. Their absence is stated in the browser, not represented by
fake playable options. FM Electric Piano is an actual FM engine and Drawbar
Organ an actual additive engine; neither is advertised as a sampled acoustic bank.
Native VST hosting, pedalboards, stretching and tempo adaptation are separate phases.

## Verification

- `pnpm --filter @workspace/prism-desktop test:instruments`: state migration,
  raw recovery, preset validation, deterministic nonzero/distinct WAVs, factory
  installation, rollback and portable media round-trip.
- `test:audio-render`: actual Chromium Web Audio, every synth nonzero/distinct
  and velocity-sensitive, legacy sample-exact reference, decoded drum sampler,
  missing-instrument export rejection, simultaneous live instruments and cleanup.
- Windows workflow builds an NSIS installer, installs it, then runs five actual
  Electron processes. Instrument acceptance uses the installed UI, isolated real
  disk library, real IPC and media protocol; creates/restores/deletes presets,
  replaces sounds without losing MIDI, previews FM/drums, retains unknown raw
  state and verifies another process restores saved instruments/presets/assets.
  JSON reports and native screenshots are uploaded as installed-editor evidence.

Automated real-time audio checks use Chromium's silent sink. They do not prove
physical speaker output, driver latency, microphone hardware or interactive native
file dialogs. The initial library is deliberately small and is not a sampled
acoustic/orchestral collection.
