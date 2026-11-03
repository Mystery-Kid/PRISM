# PRISM native pedalboard

All twelve processors use the existing shared effect catalog, ordered graph,
project/preset persistence and live/offline Web Audio implementation. No plugins,
third-party DSP libraries or commercial pedal artwork are bundled. New DSP is
original PRISM code using standard Web Audio nodes; no additional build dependency.

## Supported processing

- Existing single-band peaking EQ, deterministic stereo convolution reverb,
  feedback delay and native dynamics compressor retain their IDs, ranges and defaults.
- Distortion: symmetric tanh clipping. Overdrive: asymmetric soft clipping.
  Fuzz: asymmetric hard clipping. All have 2x oversampling, DC removal,
  low-pass tone, output trim and advanced wet/dry mix.
- Noise gate: full-wave envelope follower, smooth threshold transfer and smoothed
  gain control, with threshold, response and attenuation floor. This reduces quiet
  passages, **not** noise under speech or music; it is not spectral noise removal.
- Chorus: one LFO-modulated delayed voice plus dry signal.
- Flanger: short LFO delay and bounded positive feedback.
- Phaser: four LFO-swept all-pass filters plus dry signal.
- Peak Clip Limiter: input gain and hard sample-peak ceiling, with no lookahead.
  It can distort. It is **not** a true-peak/inter-sample or transparent mastering limiter.

Controls update actual parameters; bypass ramps wet/dry levels and reordering
crossfades chains for 25ms before retiring old nodes. Oscillators and pending
retirements are stopped/disconnected when a chain closes. This reduces avoidable
switching clicks; it does not promise inaudibility under every signal condition.
Modulation export gets 0.5s tail; existing delay/reverb export keeps its 4s tail.

## Editing and persistence

Drag a pedal's grip to reorder; focus its enclosure and use Left/Right, or use the
move buttons. Rotary controls accept vertical drag, Shift for fine movement,
arrows/PageUp/PageDown/Home/End, and double-click to reset. Values and units are
shown alongside the accessible slider. Advanced settings exposes remaining
parameters. Duplicate makes a new independent effect ID.

The same browser targets audio/instrument tracks, buses or master. Existing
global/project chain save, load, append, rename, duplicate, delete and version-1
JSON import/export stay intact. Unknown preset processors remain inert in the
saved preset and are explicitly skipped on application. Chain edits participate
in existing session undo/redo. Preset-library deletion is confirmed and not undoable.

Project schema 7 preserves schemas 1–6 and forces older builds to reject the new
schema rather than silently drop newly supported pedals. The existing loader
backs up a library before upgrading. Use a backup when returning to an older build.

## Acceptance

Unit checks cover defaults, all bounds, legacy settings and full chain/preset
round trips. Chromium renders all twelve effects, verifies finite/nonzero and
parameter-sensitive output, exact initial bypass, distinct drives, gate open/close,
limiter ceiling, order-sensitive audio, and repeated live graph disposal/LFO cleanup.
Windows CI installs the NSIS build and exercises real rotary pointer input,
fine keyboard control, drag reorder/undo/redo, bypass, advanced settings,
duplication/removal, saving/loading, bus/master targets, playback, actual WAV export,
theme screenshots and process-restart persistence.

Automated playback uses Chromium's silent audio sink. Native export picker choice
is supplied by the isolated acceptance harness, but rendering, IPC and WAV writing
are real. Physical speaker output, device latency and recording hardware are not
claimed as tested.

The separately supplied unified FX expansion (two-level tags, favorites, recents,
vocal starter chains, EQ response editor, pitch correction, de-esser and additional
processors) is not implemented in this pedalboard phase. There is no separate vocal
engine. All supported effects remain reusable through the same existing chain.
