---
name: Native MIDI block compatibility
description: A measured compatibility issue in the SDK MDA native feasibility fixtures.
---

Native instrument checks must include note-on after an initially silent interval and at non-block-aligned project positions.

**Why:** In the Linux SDK feasibility run, MDA JX10 and DX10 produced sound for frame-zero notes but silence for positive-offset note-on after preceding silent blocks, despite correctly queued events. Splitting processing at MIDI boundaries, within the declared maximum block size, produced the expected delayed audio. A frame-zero-only test would have falsely passed.

**How to apply:** Preserve sample-accurate MIDI-boundary subdivision and the delayed-note assertion when changing the host. This observation is specific to the measured offline fixtures; do not generalize it to all plugins or claim Windows/hardware verification from it.
