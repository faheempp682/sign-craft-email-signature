// Uploads the built-in email icons (public/email-icons/v1/*.png) to Bunny Storage so every template reuses the same
// hosted files. Run `npm run icons:build` first if you changed the icon set.
//   npm run icons:upload        (reads BUNNY_* from .env.local)
// Afterwards set NEXT_PUBLIC_EMAIL_ICON_BASE=<BUNNY_CDN_URL>/email-icons/v1 so the editor and exports point at the CDN.
import { readdirSync, readFileSync } from "node:fs";

const zone = process.env.BUNNY_STORAGE_ZONE;
const key = process.env.BUNNY_STORAGE_ACCESS_KEY;
const cdn = process.env.BUNNY_CDN_URL?.replace(/\/+$/, "");
const host = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";
if (!zone || !key || !cdn) {
  console.error("Set BUNNY_STORAGE_ZONE, BUNNY_STORAGE_ACCESS_KEY and BUNNY_CDN_URL in .env.local first.");
  process.exit(1);
}

const dir = "public/email-icons/v1";
const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
if (!files.length) {
  console.error(`No icons in ${dir}. Run npm run icons:build first.`);
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  const res = await fetch(`https://${host}/${encodeURIComponent(zone)}/email-icons/v1/${f}`, {
    method: "PUT",
    headers: { AccessKey: key, "Content-Type": "application/octet-stream" },
    body: readFileSync(`${dir}/${f}`),
  });
  if (!res.ok) failed++;
  console.log(`${res.ok ? "ok  " : `FAIL ${res.status}`} ${cdn}/email-icons/v1/${f}`);
}
console.log(failed ? `${failed} of ${files.length} uploads failed.` : `Uploaded ${files.length} icons. Set NEXT_PUBLIC_EMAIL_ICON_BASE=${cdn}/email-icons/v1`);
process.exit(failed ? 1 : 0);
