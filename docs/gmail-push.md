# Gmail push (send a signature straight into Gmail)

**Status: built and tested against a simulated Google. NOT verified against a real Workspace account.** Do not describe it as working in Gmail until the checklist at the bottom has been run with a real account.

From the editor or the exporter, **Send to Gmail** connects a person's Google Workspace account once, then writes the current signature into one of their send-as addresses after they have reviewed it. It can change signature settings only. It cannot read or send mail.

## What a person sees

1. **Connect Google account** (once). Google's consent screen asks to "view and manage your basic Gmail settings".
2. **Choose address**: their primary address and any aliases. Aliases Gmail has not verified are shown but cannot be selected.
3. **Review before sending** shows the chosen address, the **new** signature, and the **current** one (marked "will be replaced"), plus how close the new one is to Gmail's size limit.
4. They tick a box confirming they have looked at both, then press **Replace signature on name@company.com**. Nothing is written before that.
5. **Disconnect** is always available. It cancels the grant with Google and deletes the stored token.

## Rules the code enforces (each has a test)

- **Never replaced without approval.** The request must carry `confirm: true` and the fingerprints of the new and the current signature that were previewed. The server renders the signature itself (it never accepts HTML from the browser), re-reads Gmail, and refuses with a 409 if either one differs from what the person saw ("changed" or "preview_stale"). So what was on screen when they clicked is what is written, byte for byte.
- **Workspace accounts only.** The id_token must carry a `hd` (hosted domain) claim in `GOOGLE_WORKSPACE_DOMAINS`. Personal Gmail and other companies are refused, and the grant just made is revoked. The server will not start the flow if no domain is configured.
- **Least privilege.** Scopes are `openid`, `email` and `gmail.settings.basic` only. If the person unticks signature access on the consent screen, the connection is refused and revoked.
- **Tokens stay on the server.** The refresh token is encrypted with AES-256-GCM (key in the server environment, never in the database) and bound to its owner, so a copied row will not decrypt for anyone else. The browser-facing database roles cannot read that column even for their own row (tested against a real Postgres). Access tokens are never stored; one is fetched per request.
- **Sign-in handshake.** PKCE (S256), a random `state`, and an encrypted HttpOnly cookie limited to `/api/google` and ten minutes. A callback that does not match, is expired, or belongs to a different signed-in person is rejected before Google is contacted.
- **Revoked or expired access.** If Google says the grant is gone, the stored connection is deleted and the screen goes back to "Connect". A temporary Google outage does not delete it.
- **Write routes refuse other sites** (Origin check) and are limited to people with the `gmail_push` feature. Disconnect is deliberately not behind that switch.
- **Undo information.** Every replacement stores the signature it replaced in `gmail_push_log` (readable only by its owner). There is no "Restore" button yet.

## Setup

### 1. Google Cloud (one time, by someone with access to your Workspace's Cloud organization)

1. In [Google Cloud Console](https://console.cloud.google.com), create or pick a project that belongs to your Workspace organization.
2. **APIs & Services > Library > Gmail API > Enable.** (If this is skipped, people see "The Gmail API is switched off".)
3. **APIs & Services > OAuth consent screen:**
   - User type **Internal**. This limits sign-in to your Workspace and means Google's app verification is not required. (Internal is only offered for projects inside a Workspace organization.)
   - App name, support email, developer contact.
   - Add the scope `https://www.googleapis.com/auth/gmail.settings.basic`.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID > Web application.**
   - Authorized redirect URIs, exactly: `http://localhost:3000/api/google/callback` (use your real dev port) and `https://YOUR-DOMAIN/api/google/callback` for production.
   - Copy the Client ID and Client secret.

### 2. Workspace Admin Console (only if your admin restricts third-party apps)

- **Security > Access and data control > API controls > App access control:** if access to Gmail is restricted, mark this OAuth client ID as **Trusted** (or allow it). Otherwise people get an "access blocked" message, which SignCraft shows as "Your Workspace admin has blocked this app".
- If your Workspace manages signatures centrally (Gmail settings such as appended footers or admin-managed signatures), check how that interacts with a signature a person sets themselves. This has not been checked.

### 3. Server settings (`.env.local`; never commit these)

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
# 32 random bytes, base64. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
GOOGLE_TOKEN_ENCRYPTION_KEY=...
GOOGLE_WORKSPACE_DOMAINS=kimp.xyz            # comma-separated; required
GOOGLE_REDIRECT_URI=https://YOUR-DOMAIN/api/google/callback   # set this in production (behind a proxy the default may be wrong)
SUPABASE_SERVICE_ROLE_KEY=...                # already needed for ADMIN_EMAILS; also used to store tokens
```

**Protect `GOOGLE_TOKEN_ENCRYPTION_KEY`.** Losing it makes every stored connection unreadable (people just reconnect). Changing it does the same. There is no key-rotation tool yet.

### 4. Database

Apply `supabase/migrations/0004_google_connections.sql` after 0001 to 0003.

### 5. Switch it on

`gmail_push` is on by default for everyone. Turn it off, or grant it per person, on **Admin > Features**.

## If something goes wrong

| Message | Meaning and fix |
|---|---|
| "Gmail push is not set up yet. Add to .env.local: ..." | The named settings are missing. |
| "Your Workspace admin has blocked this app" | Trust the OAuth client in Admin Console (step 2). |
| "That Google account is not in your company's Workspace" | They signed in with a personal or another company's account. |
| "Signature access was not allowed" | They unticked a permission. Connect again and tick everything. |
| "The Gmail API is switched off for this app's Google Cloud project" | Enable the Gmail API (step 1.2). |
| "Google access was removed or expired" | They revoked it (or a Workspace admin did). Connect again. |
| "The signature on X changed after you looked at it" | Someone edited it in Gmail meanwhile. Review again. |
| "...over Gmail's 10,000 limit" | Shorten the disclaimer or pick a simpler template. The largest built-in template is about 7,800 characters. |
| "Google refused the change" | Workspace policy, or the mailbox has no Gmail. Ask your admin. |

## Future improvements (not built yet)

- **Restore the previous signature.** Every replacement already saves the signature it replaced in `gmail_push_log` (owner-readable), but there is no button to put it back. Until there is, restoring means copying it from that table.
- **Encryption key rotation.** `GOOGLE_TOKEN_ENCRYPTION_KEY` has no rotation tool. Changing or losing it makes every stored connection unreadable, so everyone has to reconnect. A rotation path would accept a previous key for decryption and re-encrypt tokens under the new one.
- Personal Gmail support (needs Google's app verification), admin-managed team deployment, and checking how Workspace-managed signatures interact with one a person sets themselves.

## What the automated tests cover, and what they cannot

Covered (about 200 tests): encryption and owner binding, the sign-in cookie and PKCE, every callback failure (forged, replayed, wrong person, denied, admin-blocked, wrong domain, personal Gmail, missing permission, no refresh token), token refresh and revocation handling, Gmail error mapping, the preview-then-confirm rules, database access rules against a real Postgres, all routes, and the on-screen flow. Each safety rule was also checked by deliberately breaking it and confirming a test fails.

**Not covered: anything that depends on real Google.** The tests use a stand-in for Google's endpoints written from Google's documentation, so they cannot tell us whether Google behaves exactly that way.

## Verify with a real Workspace account before calling it done

Record results here. Use a test mailbox first.

- [ ] Connect: consent screen shows only the Gmail settings permission, and the app name is right.
- [ ] After connecting, the screen shows the right email.
- [ ] A **personal** Gmail account is refused, and nothing appears under myaccount.google.com/permissions for it.
- [ ] A Workspace account from **another company** (if you have one) is refused.
- [ ] Cancel on the consent screen: "sign-in was cancelled", nothing connected.
- [ ] Untick the permission on the consent screen: refused with the right message.
- [ ] Address list shows the primary address and any aliases; an unverified alias cannot be chosen.
- [ ] Review shows the **current** signature from Gmail correctly (including a mailbox with none).
- [ ] Replace: open Gmail, write a **new** email, a **reply** and a **forward**. The signature looks right in each, on web and in the mobile app. Compare with pasting the same signature by hand (Gmail may rewrite some HTML; this is the main unknown).
- [ ] Edit the signature in Gmail between Review and Replace: the push is refused ("changed").
- [ ] A near-limit signature works and an over-limit one is refused.
- [ ] Revoke access at myaccount.google.com/permissions, then try to push: it asks to reconnect.
- [ ] **Disconnect** in SignCraft: SignCraft disappears from myaccount.google.com/permissions, and the `google_connections` row is gone.
- [ ] Admin trusted vs. not trusted for the OAuth client: the blocked message appears when blocked.
- [ ] Gmail API disabled: the "switched off" message appears.
- [ ] Two different people connect on one SignCraft install; neither can see or use the other's connection.
- [ ] The Cloud project's OAuth client works from both localhost and production redirect URIs.
