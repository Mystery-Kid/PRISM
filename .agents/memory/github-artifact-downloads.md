---
name: GitHub artifact downloads
description: Download workflow evidence when the authenticated GitHub proxy and direct archive URL behave differently.
---

An authenticated repository does not guarantee that `gh run download` can use
the absolute artifact archive URL returned in GitHub metadata. In this environment
that command can return HTTP 401 while relative `gh api` requests work.

**Why:** Repository metadata uses the authenticated Replit GitHub proxy, but the
absolute archive URL can point to a different host. This is not evidence that
GitHub needs reconnecting or that the repository is unavailable.

**How to apply:** Request the archive with
`gh api repos/OWNER/REPO/actions/artifacts/ARTIFACT_ID/zip > /tmp/evidence.zip`,
then inspect/extract the ZIP in a temporary directory. Keep authentication inside
the CLI; never inspect credentials or store downloaded evidence in Git history.
