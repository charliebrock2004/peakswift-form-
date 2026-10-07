import { isSafeSvg, MAX_FILE_BYTES } from "@/lib/onboarding/files";

type Kind = "jpeg" | "png" | "webp" | "svg";

function classify(file: File): Kind | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
  if (type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg";
  if (type === "image/png" || name.endsWith(".png")) return "png";
  if (type === "image/webp" || name.endsWith(".webp")) return "webp";
  return null;
}

function rename(name: string, ext: string): string {
  const stem = (name.split(/[/\\]/).pop() ?? "image").replace(/\.[a-z0-9]+$/i, "") || "image";
  return `${stem.slice(0, 80)}.${ext}`;
}

async function compressRaster(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    let quality = 0.82;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) break;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_FILE_BYTES) break;
      scale *= 0.72;
      quality = 0.68;
    }
    if (!blob) throw new Error("compress");
    return new File([blob], rename(file.name, "jpg"), { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export async function prepareUpload(file: File): Promise<{ file: File } | { error: string }> {
  const kind = classify(file);
  if (!kind) {
    return {
      error: `${file.name} needs to be a JPG, PNG, WEBP or SVG. iPhone HEIC photos can be sent separately.`,
    };
  }
  if (kind === "svg") {
    if (file.size > 1_000_000) return { error: `${file.name} is too large. Try a PNG instead.` };
    const text = await file.text();
    if (!isSafeSvg(text)) return { error: `${file.name} couldn’t be used. Export the logo as a PNG.` };
    return { file: new File([text], rename(file.name, "svg"), { type: "image/svg+xml" }) };
  }
  if (file.size <= 1_400_000) {
    const type = kind === "jpeg" ? "image/jpeg" : kind === "png" ? "image/png" : "image/webp";
    return { file: new File([await file.arrayBuffer()], rename(file.name, kind === "jpeg" ? "jpg" : kind), { type }) };
  }
  try {
    const compressed = await compressRaster(file);
    if (compressed.size > MAX_FILE_BYTES) {
      return { error: `${file.name} is still too large after compressing. Try a smaller photo.` };
    }
    return { file: compressed };
  } catch {
    return { error: `${file.name} couldn’t be prepared. Try a different photo.` };
  }
}
