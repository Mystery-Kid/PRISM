---
name: Instrument sound compatibility
description: Preserve audible compatibility and original recovery state when evolving PRISM instruments.
---

Treat a saved instrument-engine ID as a sound compatibility contract. Future
sonic redesigns should receive a new versioned ID rather than reinterpret saved
patches. In particular, preserve the legacy custom oscillator's envelope timing
and output level, not just its field names.

**Why:** The built-in instrument library must coexist with older projects without
changing their intended sound. A structurally successful migration alone cannot
establish audible compatibility.

**How to apply:** Keep live, audition and export synthesis consistent. Compare
legacy output against its original algorithm when changing shared synthesis.
Unavailable engines must retain the original raw state and MIDI even after a
supported replacement is chosen; do not silently render a generic substitute.
