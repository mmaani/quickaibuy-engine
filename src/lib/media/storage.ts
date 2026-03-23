export type MediaStorageMode = "reference_only";

const DEFAULT_MEDIA_STORAGE_MODE: MediaStorageMode = "reference_only";
const MEDIA_LIKE_KEY_RE = /(image|img|photo|picture|gallery|thumb|thumbnail|video|media|asset|file)/i;
const BINARY_LIKE_KEY_RE = /(blob|binary|buffer|bytes|base64|data)/i;
const DATA_URL_RE = /^data:(image|video)\//i;
const HTTP_URL_RE = /^https?:\/\//i;

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeBinaryString(value: string): boolean {
  if (DATA_URL_RE.test(value)) return true;
  if (HTTP_URL_RE.test(value)) return false;
  return value.length >= 256 && /^[A-Za-z0-9+/=\s_-]+$/.test(value);
}

function shouldDropField(path: string[], value: unknown): boolean {
  const leaf = path[path.length - 1] ?? "";
  const pathText = path.join(".");
  const mediaContext = MEDIA_LIKE_KEY_RE.test(pathText) || BINARY_LIKE_KEY_RE.test(pathText);

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return true;
  }

  const str = stringOrNull(value);
  if (str && mediaContext && looksLikeBinaryString(str)) {
    return true;
  }

  if (BINARY_LIKE_KEY_RE.test(leaf) && mediaContext) {
    return true;
  }

  return false;
}

function sanitizeUnknown(value: unknown, path: string[]): unknown {
  if (shouldDropField(path, value)) return undefined;

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry, index) => sanitizeUnknown(entry, [...path, String(index)]))
      .filter((entry) => entry !== undefined);
    return sanitized;
  }

  const obj = objectOrNull(value);
  if (obj) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(obj)) {
      const sanitized = sanitizeUnknown(nested, [...path, key]);
      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }
    return out;
  }

  return value;
}

export function getMediaStorageMode(): MediaStorageMode {
  const raw = String(process.env.MEDIA_STORAGE_MODE ?? DEFAULT_MEDIA_STORAGE_MODE)
    .trim()
    .toLowerCase();

  if (raw && raw !== "reference_only") {
    throw new Error(
      `Unsupported MEDIA_STORAGE_MODE '${raw}'. Only 'reference_only' is supported in this runtime.`
    );
  }

  return "reference_only";
}

export function sanitizeForMediaStorageMode<T>(value: T): T {
  getMediaStorageMode();
  return sanitizeUnknown(value, []) as T;
}
