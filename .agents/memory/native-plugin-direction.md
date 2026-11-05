---
name: Approved native plugin architecture
description: Product approval for buffered VST3 hosting while preserving the current engine.
---

Preserve the working Web Audio engine as an explicit compatibility option.
The user subsequently approved a **staged native realtime engine alongside it**,
not a wholesale replacement or reinterpretation of saved instrument sounds.

**Why:** The original choice was “Buffered plugins (recommended).” After the
Web Audio/native-callback incompatibility and broader DSP scope were explained,
the user chose “Staged native engine (recommended).”

**How to apply:** Add native realtime processing incrementally while keeping
existing projects playable through the compatibility engine. Keep buffered VST3
and native realtime capabilities distinct. Freeze existing saved engine sounds;
use new versioned IDs where native sound parity cannot be guaranteed.
