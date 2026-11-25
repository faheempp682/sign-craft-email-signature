// Builds the social network icon PNGs (brand-colour round badge, white glyph) and optionally uploads them to Bunny.
// Usage: node scripts/build-social-icons.mjs <simple-icons dir> <out dir> [--upload]
// Glyph paths come from simple-icons (CC0). Env for upload: BUNNY_STORAGE_ZONE, BUNNY_STORAGE_ACCESS_KEY, BUNNY_CDN_URL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const [siDir, outDir, flag] = process.argv.slice(2);
const VERSION = "v1";
const NETS = {
  linkedin: "#0A66C2",
  twitter: { file: "x", fill: "#000000" },
  facebook: "#1877F2",
  instagram: { fill: "url(#ig)" },
  youtube: "#FF0000",
  github: "#181717",
  tiktok: "#000000",
};
const SIZE = 96;
mkdirSync(outDir, { recursive: true });
const files = [];
for (const [net, spec] of Object.entries(NETS)) {
  const o = typeof spec === "string" ? { fill: spec } : spec;
  const svg = readFileSync(`${siDir}/${o.file ?? net}.svg`, "utf8");
  const d = svg.match(/ d="([^"]+)"/)[1];
  const g = 52; // glyph box inside the 96 badge
  const k = g / 24;
  const off = (SIZE - g) / 2;
  const grad = `<defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".3" stop-color="#FA7E1E"/><stop offset=".55" stop-color="#D62976"/><stop offset=".8" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs>`;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${grad}<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="${o.fill}"/><path transform="translate(${off} ${off}) scale(${k})" fill="#fff" d="${d}"/></svg>`;
  const png = await sharp(Buffer.from(out), { density: 300 }).resize(SIZE, SIZE).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(`${outDir}/${net}.png`, png);
  files.push([net, png]);
  // Theme-able variants, tinted by the cell's own background colour in the signature:
  //  glyph/ = white glyph on transparent (cell bg = solid colour); knock/ = 88% white tile with the glyph cut out (cell bg = the glyph colour).
  const gp = `<path transform="translate(${off} ${off}) scale(${k})" d="${d}"`;
  const shape = (svgInner) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${svgInner}</svg>`), { density: 300 }).resize(SIZE, SIZE).png({ compressionLevel: 9 }).toBuffer();
  mkdirSync(`${outDir}/glyph`, { recursive: true });
  mkdirSync(`${outDir}/knock`, { recursive: true });
  const glyph = await shape(`${gp} fill="#fff"/>`);
  const knock = await shape(`<mask id="m"><rect width="${SIZE}" height="${SIZE}" fill="#fff"/>${gp} fill="#000"/></mask><rect width="${SIZE}" height="${SIZE}" fill="#fff" fill-opacity=".88" mask="url(#m)"/>`);
  writeFileSync(`${outDir}/glyph/${net}.png`, glyph);
  writeFileSync(`${outDir}/knock/${net}.png`, knock);
  files.push([`glyph/${net}`, glyph], [`knock/${net}`, knock]);
}
console.log("built", files.map(([n, b]) => `${n}:${b.length}B`).join(" "));
if (flag === "--upload") {
  const { BUNNY_STORAGE_ZONE: zone, BUNNY_STORAGE_ACCESS_KEY: key, BUNNY_CDN_URL: cdn, BUNNY_STORAGE_HOST: host = "storage.bunnycdn.com" } = process.env;
  if (!zone || !key || !cdn) throw new Error("Bunny env missing");
  for (const [net, png] of files) {
    const path = `social-icons/${VERSION}/${net}.png`;
    const r = await fetch(`https://${host}/${encodeURIComponent(zone)}/${path}`, { method: "PUT", headers: { AccessKey: key, "Content-Type": "application/octet-stream" }, body: png });
    console.log(r.ok ? "uploaded" : `FAILED ${r.status}`, `${cdn.replace(/\/+$/, "")}/${path}`);
  }
}
