---
name: Desktop persistence verification
description: Avoid stale comparisons between immediate control changes and debounced saved project state.
---

Installed-app acceptance must wait for the saved value to match the latest UI
value before using it as a baseline. Compare duplicated objects with their
current source, not an earlier disk snapshot.

**Why:** A correct pedal duplication failed acceptance because a fine knob edit
had not reached disk when the assertion captured its reference value.

**How to apply:** For controls with immediate audio/UI updates and debounced
autosave, wait on the intended saved state rather than a short arbitrary sleep.
Keep live-control responsiveness and disk durability as separate assertions.
