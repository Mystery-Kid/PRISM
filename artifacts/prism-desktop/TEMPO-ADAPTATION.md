# Tempo changes

Editing BPM then pressing Enter or leaving the field always asks:
“Do you want to change all media to match the new tempo?”

* **Change Tempo Only** changes the shared tempo. Audio positions, trims,
  duration and speed stay in seconds. MIDI stays in musical beats and follows BPM.
* **Change Tempo and Adapt Compatible Media** creates new, pitch-preserving WAV
  assets using original PRISM WSOLA waveform-similarity overlap-add processing.
  Audio timeline positions, fades, trims and loop positions scale with old/new BPM.
  MIDI beat positions and lengths are unchanged. The stopped/current playhead
  scales with the same ratio; an active transport restarts from that position.
* **Cancel** keeps tempo, clip references and original media unchanged. During
  processing it terminates the worker. Cancelling while derivatives are already
  being stored may leave unreferenced derivative files, never a mixed session.

There is no remembered default or suppressed confirmation.

## Scope and quality

This is genuine offline pitch-preserving stretching, not playback-rate adjustment,
clip resizing or a claim of commercial-quality transient processing. WSOLA can smear
transients, dense polyphony and reverberation. Use moderate changes and audition.
The implementation is original project code with no copied/vendor algorithm,
external service, native binary or additional third-party license requirement.

Mono/stereo sources up to 60 seconds each and cumulative length ratios 0.5–2 are
supported. Each transaction is limited to 128 MiB of encoded PCM16 derivatives
and 128 source files. Unavailable source decoding fails the whole operation.
Overlong/multichannel/out-of-range sources are explicitly reported and remain
unchanged; unknown track types remain unchanged. Sampler/drum samples are one-shots:
their MIDI triggers follow BPM, but their sample lengths are not stretched.
Delay seconds and modulation Hz currently remain free-running; this does not add
a tempo-sync mode or claim plugin tempo adaptation. No tempo map or autodetection.

The audio algorithm runs in a packaged worker, cancellable without blocking the
UI. All processing finishes before derivative files are staged. New file metadata
is published only after all new files exist; failures clean up new files/metadata.
One session/history update follows successful storage. Original files are never
overwritten. Undo/redo switches complete session snapshots, retaining derivatives
so redo does not require processing again. Repeated adaptations always process
the original source, not a previously quantized derivative. Original asset IDs,
original tempo provenance and cumulative length scale are saved per clip.

All time conversion retains PRISM's existing denominator-aware convention:
`seconds per beat = 60 / BPM * 4 / meter denominator`. For example at 120 BPM,
four beats of 6/8 occupy one second. Grid, MIDI, metronome, playback and export
continue using that same authority. Fractional BPM is preserved on save/reopen.

## Persistence

Library format 8 protects adaptation metadata from older builds which cannot
preserve it; formats 1–7 upgrade with the existing automatic pre-migration backup.
Portable `.prism` files include both original and derived assets and remap both
references on import. Do not open the upgraded library with an older executable.
The source disk bytes are immutable; derived assets are PCM16 WAV, so clipping/
quantization are possible on abnormal out-of-range source signals.

## Verification

`test:tempo` measures pitch and exact duration at multiple stretch ratios/sample
rates, stereo phase, source PCM immutability, denominator-aware beat conversion,
tempo-only preservation, trim/fade/loop mapping, repeated original references,
storage rollback and portable original/derivative round trips.

Windows CI installs the actual packaged executable and checks the exact prompt,
cancellation, tempo-only, real packaged-worker adaptation, measured source/derived
pitch, original file bytes, undo/redo, disk state, real WAV export and a subsequent
process restart. This is a silent-sink automated test, not proof of physical
microphone, driver, speaker or latency performance.
