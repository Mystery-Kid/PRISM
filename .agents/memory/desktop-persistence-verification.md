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

Compare persisted musical content semantically, not by unsorted JSON text.
Preserve array ordering and every musical value; ignore only explicitly
presentation-only fields and save timestamps.

**Why:** Reload migration can reconstruct object keys in a different insertion
order without changing any values. A raw JSON-text comparison then falsely
reports song changes after an otherwise correct process restart.

**How to apply:** Canonicalize object keys for restart assertions while retaining
strict checks for note/clip timing, asset associations, routing, effects, track
ordering, and engine identity.
