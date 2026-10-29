---
name: Desktop theme verification
description: Native Windows motion preferences and compositor timing can invalidate theme-test assumptions and captures.
---

Installed Windows CI can report `prefers-reduced-motion: reduce` by default.
Explicitly emulate both normal and reduced motion when testing transition
duration, then restore the host preference.

**Why:** A correct reduced-motion implementation failed a test that assumed
normal animation was the runner's default.

**How to apply:** Read the actual media preference before asserting a normal
duration. Keep the real reduced-motion behavior; do not weaken it for CI.

Electron `capturePage()` can return the previous compositor frame immediately
after a React action or startup theme restoration, even though DOM state is
already correct.

**Why:** A closed Settings dialog and the original startup palette remained in
captures whose DOM already reflected the requested state.

**How to apply:** Focus/show the isolated test window, wait for animation frames
and any relevant fade before capture, and inspect the resulting image instead
of treating a passing DOM assertion as visual proof.
