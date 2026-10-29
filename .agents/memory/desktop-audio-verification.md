---
name: Desktop audio verification
description: How to interpret Web Audio results in the hardware-less development container
---

A Chromium AudioContext can report `running` while its clock barely advances
when this container cannot supply physical output callbacks. Do not diagnose
that observation alone as a PRISM scheduling failure.

**Why:** Headless live-meter checks initially saw silence with a running context
whose clock was stalled. Selecting Chromium's silent sink allowed the real
graph and clock to run and the transport checks to pass.

**How to apply:** Use silent-sink signal tests for automated graph/timing checks.
Keep those results separate from audible output, device latency, driver, and
installed Windows-app verification, which require actual hardware.

Renderer tests using a substitute desktop bridge validate UI interactions, not
Electron file dialogs or the installed application's IPC boundary.

**Why:** A browser can exercise preset controls and audio processing without
running Electron. Treating that as installed-app verification would overstate
what was tested.

**How to apply:** Report browser/UI, storage, packaging, and physical-device
checks separately; retain a real installed-app acceptance check for file-dialog
and device behavior.
