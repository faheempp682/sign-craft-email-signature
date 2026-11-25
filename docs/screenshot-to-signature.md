# Screenshot to signature

On **Create**, click **From a screenshot** (or drop or paste a picture onto the box). The AI reads a picture of an email signature and rebuilds it as an editable signature in the same block format as every template. Anything typed in the box is sent along as a note, for example "make it navy".

## What it does and does not copy

| Copied from the picture | Not copied (you add these) |
|---|---|
| Layout and block order | The real photo, logo or banner image (a grey placeholder is used) |
| Name, title, company, phone, email, website, address, disclaimer, exactly as written | Real social profile addresses (each icon points at the network's home page) |
| Accent colour (darkened if it would be unreadable on white) | Banner links |
| Nearest safe font (Arial, Georgia, Verdana...) | Anything not visible in the picture |

If the picture is not a signature, the AI says what it sees and nothing is created.

## How it works

`POST /api/ai/vision` (multipart: `file`, optional `note` up to 500 characters)

1. **Gate:** sign-in, the `ai_vision` feature flag and the per-user limits (`/admin/limits`). Defaults: members 3 per minute and 10 per day, designers 6 and 40, admins unlimited.
2. **Image:** the real file type is checked from its bytes (PNG, JPG, GIF; 5 MB maximum; absurd dimensions refused). It is straightened, shrunk to at most 1568 px, flattened onto white, reduced to its first frame and stripped of metadata.
3. **Model:** Claude Sonnet reads it (`ANTHROPIC_VISION_MODEL` to change). The answer must be valid against the signature schema; if not, it is asked once to fix it.
4. **Clean-up:** images become placeholders, social links become home pages, banner links are dropped.
5. Tokens are recorded against the user. A request that fails before the model is used, or a repeat answered from cache, is given back to the quota.

## Privacy

The screenshot is processed in memory and sent to the Anthropic API. It is **not stored** by the app. The rebuilt document is cached in memory for an hour, keyed by a hash of the picture and note, so repeating the same upload costs nothing. Text inside the picture is treated as content to read, never as instructions.

## Try it with the real model

The automated tests use a fake model, so they cannot tell you how well the AI reads real pictures. To check:

```bash
npm run client-pack          # sample signatures
# .env.local: ANTHROPIC_API_KEY=...   (leave Supabase unset so the route runs in local mode)
npm run dev
npm run vision:smoke         # VISION_SMOKE_COUNT=10 for more; VISION_SMOKE_NOTE="..." to add a note
```

It screenshots each sample, sends it through the route, and prints the layout, font, accent, blocks and name it found. Results and screenshots land in `vision-smoke/` (git-ignored). Compare the reported layout and text with the original by eye.
