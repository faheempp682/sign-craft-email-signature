import { hasImageSignature, sniffImage } from "./image";
import { ImageProcessError, optimizeImage } from "./optimize";
import { LIMITS, assetWarnings, formatBytes, type AssetInfo, type AssetWarning, type UploadPurpose } from "./rules";

export class UploadError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ProcessedUpload = {
  data: Uint8Array;
  ext: "png" | "jpg" | "gif";
  info: AssetInfo;
  notes: string[];
  warnings: AssetWarning[];
};

/**
 * Everything that happens to an uploaded file before it is stored: size check, real-format check (never the
 * browser's claimed type), dimension and frame limits, then optimization. Throws UploadError with a user-safe message.
 */
export async function processUpload(bytes: Uint8Array, purpose: UploadPurpose): Promise<ProcessedUpload> {
  if (bytes.length === 0) throw new UploadError(400, "bad_request", "That file is empty.");
  if (bytes.length > LIMITS.uploadMaxBytes) {
    throw new UploadError(413, "too_large", `That image is ${formatBytes(bytes.length)}. The upload limit is ${formatBytes(LIMITS.uploadMaxBytes)}.`);
  }

  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    if (hasImageSignature(bytes)) throw new UploadError(422, "bad_dimensions", "That image has unusable dimensions. Width and height must each be between 1 and 10,000 px.");
    throw new UploadError(415, "bad_type", "Only PNG, JPG and GIF images work in email signatures.");
  }

  try {
    const { data, info, notes } = await optimizeImage(bytes, sniffed, purpose);
    return { data, ext: sniffed.ext, info, notes, warnings: assetWarnings(info, purpose) };
  } catch (e) {
    if (e instanceof ImageProcessError) throw new UploadError(e.code === "unreadable" ? 415 : 422, e.code, e.message);
    console.error("[upload] optimize failed:", e instanceof Error ? e.message : e);
    throw new UploadError(500, "optimize_failed", "Something went wrong while processing the image. Please try again.");
  }
}
