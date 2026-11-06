---
name: ASIO licensing direction
description: User choice of ASIO licensing and the release gate it does not satisfy.
---

Do not pursue the proprietary Steinberg agreement. After confirming it was not signed, the user declined because they do not want to provide personal information. Keep ASIO disabled. No GPLv3 product conversion has been authorized.

**Why:** The user said, “Nevermind, i don't want to have to give up any personal information...”

**How to apply:** Do not treat this choice as evidence of an executed agreement or permission to sign for the user. Verify the license status before distributing an ASIO-enabled build; actual physical-driver/interface testing remains a separate acceptance requirement.
Do not ask the user to submit agreement details unless they reopen this choice.
Keep ASIO disabled unless the user later confirms an effective agreement and
supplies the licensed SDK. This gate does not prohibit independent WASAPI or
Web Audio work, and does not satisfy native project-engine acceptance.
