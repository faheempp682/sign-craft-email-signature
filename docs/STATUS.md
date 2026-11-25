# Project status

Last updated after Gmail push was built. Nothing below is marked verified until the real-account tests pass.

| Area | Status |
|---|---|
| **MVP (Phase 1)** | **Incomplete.** Built and tested in code, but the definition of done needs real Gmail and Outlook testing, which has not passed. See [client-testing.md](client-testing.md). |
| Template library (121 templates, 3 collections) | Built. Verified in Chrome only. |
| Access control, feature flags, AI limits, admin screens | Built and tested (including against a real Postgres). Not yet run against a live Supabase project. See [access-control.md](access-control.md). |
| Screenshot to signature | Built and tested with a fake model. Not run against the real model. See [screenshot-to-signature.md](screenshot-to-signature.md). |
| **Gmail push** | **Built, NOT verified.** Tested against a simulated Google only. Needs the real Workspace checklist in [gmail-push.md](gmail-push.md). |
| Outlook / Gmail rendering claims in the UI ("never break in Outlook") | Unverified. Revisit after real-client testing. |

## Next
- Waiting on real-account results (Gmail web and mobile for Gmail push; Gmail and Outlook for the MVP). No further architectural changes until those results are shared.
- Known future improvements: Gmail restore-previous-signature button, encryption key rotation ([gmail-push.md](gmail-push.md)).
