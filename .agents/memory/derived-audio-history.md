---
name: Derived audio history
description: Why generated media must be decoded before its undo history transaction is finalized.
---

Finalize derived audio metadata from the saved, decoded representation before committing the user-visible transformation to undo history.

**Why:** WAV quantization changes waveform peaks from the original floating-point processing output. Later waveform hydration can otherwise create an extra same-tempo history entry, making Undo appear not to restore the previous tempo and potentially repeatedly replacing the restored entry.

**How to apply:** For generated or transformed audio, store the complete derivatives, decode them through the actual playback engine, and cache their authoritative duration/peaks before creating the single history snapshot. Cancellation before that snapshot must leave the session unchanged.
