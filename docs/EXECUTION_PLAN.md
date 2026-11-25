# Execution plan: finishing PROJECT.md (everything except billing and Google Console setup)

Approved scope: all remaining items in phases 1 to 5, except billing and payment integrations, and except tasks only the owner can do (Google Cloud setup, credentials, real-account testing, legal review, naming).

## Honest limits
| Item | What will be built | What stays unverified |
|---|---|---|
| "Real rendered" compatibility previews | Real renders in Chromium, WebKit (Apple Mail / iOS Mail) and Firefox (Thunderbird), plus labelled simulations of Outlook (Word engine) and Gmail's HTML clean-up and dark-mode inversion | Real Outlook desktop and real Gmail. Needs the owner's real-client tests |
| Directory sync (Google Workspace, Microsoft 365), bulk deploy, health monitor, CRM sync | Complete code, tested against fakes | Needs credentials the owner creates (Workspace domain-wide delegation, Azure app, HubSpot token) |
| Outlook deploy | Microsoft has no API for Outlook signatures: generates an Exchange transport-rule script for the admin to review and run | Running it against a real tenant |
| Legal pages | Drafts | Need legal review |
| Plans / credits | Plans as flag and limit presets, assigned by an admin, no payment | Billing is out of scope |
| Product name / domain / opening to outsiders | Configurable brand, public site OFF unless `PUBLIC_SITE_ENABLED=true` | Owner's decisions |

## Waves
| Wave | Agent | Scope | Migration |
|---|---|---|---|
| 0 | integrator | public-route list + middleware, feature flags, shared brief | 0005 (flags) |
| 1 | A1 | Headshot crop; animated-GIF maker | none |
| 1 | A2 | Accessibility checker; GIF lint rules; auto dark-mode variants | none |
| 1 | B | Rendered compatibility previews; render matrix | none |
| 1 | C | Campaigns, scheduling, A/B, click tracking, analytics; legal disclaimer templates; `track` on banners | 0006 |
| 1 | D | Public site, niche SEO pages, free generator, legal pages, public rate limits, pricing research | none |
| 1 | E | Digital business card, QR code, vCard | 0007 |
| 1 | G | Designer-polish workflow | 0008 |
| 2 | H1 | Team core: organization-scoped signatures, team dashboard, CSV import, brand lock, roles and approval workflow | 0009 |
| 2 | H2 | Deploy (Gmail adapter, Exchange script), rules (new vs reply, internal vs external, department), health monitor | 0010 |
| 2 | H3 | Directory sync (Google, Microsoft), CRM sync (HubSpot, generic) | 0011 |
| 3 | I | Agency mode, white-label, plans (no billing); docs; production build; browser verification | 0012 |

## Conflict rules
One shared working tree, strict path ownership, no agent commits. Only the integrator edits shared files (middleware, nav, flags, `package.json`, layouts, STATUS, PROJECT.md). The integrator commits each agent's work separately by path, then runs the full suite.

## Dependencies
Wave 1 agents are independent of each other. H1 needs nothing from wave 1 except the integrator having merged it. H2 and H3 need H1's people and organization tables. I needs H1.
