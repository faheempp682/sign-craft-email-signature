# Testing signatures in real Gmail and Outlook accounts

**Status: not yet verified.** Every check so far ran in desktop Chrome. The editor's Gmail / Outlook / Mobile preview modes are
approximations of each client's page colour, font and width. They do **not** use the clients' real rendering engines (classic
Outlook for Windows renders with Microsoft Word, which behaves very differently). Until the matrix below is filled in from real
accounts, do not claim "works in Gmail / Outlook" in the UI, marketing or docs.

Places that currently make a claim and should be reviewed once results are in:

- `app/(app)/signatures/page.tsx`: "Signatures that never break." and "Outlook-safe HTML"
- `app/layout.tsx`: metadata description "never break in Outlook"

## 1. Generate the pack

```bash
npm run client-pack      # writes client-pack/index.html (git-ignored)
```

Open `client-pack/index.html` in Chrome. It holds 25 signatures: the hand-built designs that lean hardest on client quirks, one
studio design per layout (studio-001 to studio-011), and three designs again with long text and with no photo. Each has a
**Copy signature** button that copies it as rich text.

> The sample photos are `placehold.co` placeholders. Email clients may block remote images until the reader allows them, so
> also test once with a real hosted image on a real domain.

## 2. Test procedure (repeat per client)

1. Paste the signature into the client's signature editor (see below).
2. Send a new email **to yourself**, and also to a second account on a different provider.
3. Look at it as the **sender** (compose window), as a **received** message, and in a **reply**.
4. Repeat in light and dark mode, and on a phone.
5. Fill in the matrix.

| Client | Where to paste |
| --- | --- |
| Gmail (web) | Settings (gear) → See all settings → General → Signature → Create new → paste |
| Gmail (iOS / Android) | Receive-only test: open the mail sent from the web client (the apps can't paste rich signatures reliably) |
| Outlook for Windows, classic (Word engine) | File → Options → Mail → Signatures → New → paste into the edit box |
| New Outlook / Outlook on the web | Settings → Accounts → Signatures → New signature → paste |
| Outlook mobile, Apple Mail | Receive-only test: open the mail sent from a desktop client |

If the paste loses formatting, use **Download .htm** in the app's exporter and the client's documented HTML-signature route
instead, and note it in the matrix.

## 3. What to check on every signature

- Overall layout intact: columns side by side, nothing stacked or overlapping that shouldn't be.
- Fixed width respected (no horizontal scrolling on a phone; very narrow screens may scale it).
- Photo: shown, correct size, not stretched. Note whether it is round, square or arched.
- Rounded corners: expected to be **square** in classic Outlook for Windows (that is a known degradation, not a failure).
- Colours: panel and band backgrounds present (these use `bgcolor` plus `background-color`).
- Text: name, title, company readable; no missing characters; sensible fonts (only web-safe fonts are used).
- Contact icons (the T / @ / W / A letter badges) and social badges: aligned with their text.
- Links: phone, email, website and social links are clickable and go to the right place.
- Spacing: no stray gaps or lines at the bottom or right edge.
- Dark mode: text still readable, panels not turned unreadable by automatic colour inversion.
- Reply and forward: the signature survives when quoted.
- Long text variants: names, titles and emails wrap rather than breaking the layout.
- No-photo variants: no empty hole where the photo would be.

## 4. Known limitations to expect (not yet confirmed in real clients)

These come from how the HTML is built, not from tests in the real clients:

- Rounded corners, circular photos and the arch photo shape depend on `border-radius`, which classic Outlook for Windows ignores.
- Gradients are approximated with strips of solid cells; patterns are drawn with table cells.
- Only web-safe fonts are used (Arial, Georgia, Verdana, Tahoma, Trebuchet MS, Times New Roman, Courier New, Helvetica).
- `overflow-wrap:anywhere` (used so long text wraps) is ignored by Outlook's Word engine, so very long unbroken strings may stretch a card there.
- Images may be hidden until the reader allows them; always set sensible `alt` text.
- Gmail clips messages over about 102 KB; signatures are small, but check long threads.

## 5. Results matrix

Mark each cell **OK**, **Minor** (cosmetic difference, usable), or **Broken**, and add a short note or screenshot name.

| Template | Gmail web | Gmail mobile | Outlook classic (Win) | New Outlook / OWA | Outlook mobile | Apple Mail | Dark mode | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| classic | | | | | | | | |
| minimal | | | | | | | | |
| editorial-arch | | | | | | | | |
| geometric | | | | | | | | |
| green-sidebar | | | | | | | | |
| dark-luxe | | | | | | | | |
| pastel-pill | | | | | | | | |
| listing-banner | | | | | | | | |
| studio-001 (Side photo) | | | | | | | | |
| studio-002 (Photo right) | | | | | | | | |
| studio-003 (Centered) | | | | | | | | |
| studio-004 (Two-tier) | | | | | | | | |
| studio-005 (Three-column) | | | | | | | | |
| studio-006 (Header row) | | | | | | | | |
| studio-007 (Colour panel) | | | | | | | | |
| studio-008 (Contact band) | | | | | | | | |
| studio-009 (Sidebar) | | | | | | | | |
| studio-010 (Stacked) | | | | | | | | |
| studio-011 (Header band) | | | | | | | | |
| studio-003 long text | | | | | | | | |
| studio-003 no photo | | | | | | | | |
| studio-007 long text | | | | | | | | |
| studio-007 no photo | | | | | | | | |
| studio-009 long text | | | | | | | | |
| studio-009 no photo | | | | | | | | |

## 6. Reporting back

For each client, share screenshots of the received message (light and dark) for any cell marked Minor or Broken, plus the client
name and version (Outlook: File → Office Account → About Outlook). With that, the layouts that fail in a given client can be
fixed or flagged, and the product copy can state exactly which clients were tested and how.
