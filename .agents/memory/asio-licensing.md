---
name: ASIO licensing direction
description: User choice of ASIO licensing and the release gate it does not satisfy.
---

Prepare ASIO using the proprietary Steinberg agreement, not a GPLv3 product conversion.
The user explicitly confirmed that the agreement is **not signed yet**.

**Why:** The user selected “Proprietary agreement (recommended)” and subsequently answered “Not signed yet” when asked whether the agreement was effective.

**How to apply:** Do not treat this choice as evidence of an executed agreement or permission to sign for the user. Verify the license status before distributing an ASIO-enabled build; actual physical-driver/interface testing remains a separate acceptance requirement.
Keep ASIO disabled unless the user later confirms an effective agreement and
supplies the licensed SDK. This gate does not prohibit independent WASAPI or
Web Audio work, and does not satisfy native project-engine acceptance.
