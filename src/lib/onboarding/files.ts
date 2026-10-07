import type { FileKind } from "@/lib/onboarding/model";

export const MAX_FILE_BYTES = 3.4 * 1024 * 1024;
export const MAX_FILES = 24;
export const MAX_TOTAL_BYTES = 36 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function isSafeSvg(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20 || trimmed.length > 1_000_000) return false;
  if (!/<svg[\s>]/i.test(trimmed)) return false;
  if (/<script|javascript:|data:\s*text\/html|<foreignObject|<iframe|<embed|<object|on[a-z]+\s*=/i.test(trimmed)) {
    return false;
  }
  return true;
}

export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 400)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

export function safeFilename(name: string, mime: string): string {
  const base = (name.split(/[/\\]/).pop() ?? "image").replace(/[^\w.\- ()]/g, "_").slice(0, 80);
  const ext = EXT[mime] ?? "img";
  const stem = base.replace(/\.[a-z0-9]+$/i, "") || "image";
  return `${stem}.${ext}`;
}

export function isFileKind(value: string): value is FileKind {
  return value === "logo" || value === "work" || value === "team" || value === "other" || value === "review";
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
