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

A working system Chromium does not establish that the bundled Electron runtime
can launch in this container.

**Why:** The Electron binary encountered missing shared libraries and incompatible
host C-library versions even though Chromium browser tests ran successfully.

**How to apply:** Verify Electron startup separately. When unavailable, report
browser renderer checks and disk-store tests as such, not as desktop acceptance.

Treat voice lifetime and mixer gating as separate from scheduling continuity.

**Why:** A naturally completed voice or a correctly muted preview can look like
a routing restart or missing audio in live graph assertions. These observations
alone do not establish an engine regression.

**How to apply:** Before changing production audio code for a failed live check,
establish that the tested voice is still within its playback lifetime and its
intended route is audible. Keep preview checks on the same mixer path as playback.
