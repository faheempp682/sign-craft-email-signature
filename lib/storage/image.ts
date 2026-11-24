export type ImageInfo = { type: "image/png" | "image/jpeg" | "image/gif"; ext: "png" | "jpg" | "gif"; width: number; height: number };

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB. Email signatures should be far smaller; this is a hard ceiling.

/**
 * Identifies an image from its first bytes and reads its pixel size. The browser-supplied MIME type is never trusted:
 * PROJECT.md section 12 allows PNG / JPG / GIF only (no SVG, WebP or base64), so anything else returns null.
 */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  // PNG: 8-byte signature, then the IHDR chunk holds width/height as big-endian u32 at offsets 16 and 20.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return dims({ type: "image/png", ext: "png", width: dv.getUint32(16), height: dv.getUint32(20) });
  }
  // GIF87a / GIF89a: logical screen size as little-endian u16 at offsets 6 and 8.
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return dims({ type: "image/gif", ext: "gif", width: dv.getUint16(6, true), height: dv.getUint16(8, true) });
  }
  // JPEG: walk the marker segments until a start-of-frame (SOFn) holds the size.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // standalone markers carry no length
        continue;
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return dims({ type: "image/jpeg", ext: "jpg", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] });
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

function dims(info: ImageInfo): ImageInfo | null {
  return info.width > 0 && info.height > 0 && info.width <= 10_000 && info.height <= 10_000 ? info : null;
}
