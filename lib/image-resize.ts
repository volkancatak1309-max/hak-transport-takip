"use client";

/**
 * Client-side photo compression shared by PhotoUpload (fuel/expense receipts)
 * and the driver panel's FOTO ÇEK flow. Resize to max 1600px, JPEG q0.85.
 * HEIC (or any decode failure) falls back to the original file — the server
 * re-validates size/MIME (lib/storage.ts uploadReceipt).
 *
 * Keeping photos ≤~1600px matters beyond bandwidth: uploads travel through a
 * server action FormData body, and Next.js caps that at ~1 MB by default.
 */
export async function resizeImage(file: File, fileName = "photo.jpg"): Promise<File> {
  try {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const max = 1600;
    let { width, height } = img;
    if (width > max || height > max) {
      if (width >= height) {
        height = Math.round((height * max) / width);
        width = max;
      } else {
        width = Math.round((width * max) / height);
        height = max;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.85)
    );
    if (!blob) return file;
    return new File([blob], fileName, { type: "image/jpeg" });
  } catch {
    return file; // e.g. HEIC the canvas can't decode — upload as-is
  }
}
