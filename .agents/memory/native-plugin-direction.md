---
name: Approved native plugin architecture
description: Product approval for buffered VST3 hosting while preserving the current engine.
---

Use buffered native plugins and preserve the working Web Audio engine. Do not replace it with a native audio engine.

**Why:** The user explicitly chose “Buffered plugins (recommended)” after being told it preserves the current engine but adds buffering latency, whereas a native-engine migration would be broader and riskier.

**How to apply:** Connect genuine native processing to the existing workstation with explicit buffering/compatibility limits. Do not present this choice as approval for low-latency live MIDI or an engine rewrite.
