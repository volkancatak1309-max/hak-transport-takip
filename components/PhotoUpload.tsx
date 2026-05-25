"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onFile: (file: File | null) => void;
};

/** Resize to max 1600px, JPEG q0.85, client-side. HEIC falls back to original. */
async function resizeImage(file: File): Promise<File> {
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
    return new File([blob], "receipt.jpg", { type: "image/jpeg" });
  } catch {
    return file; // e.g. HEIC the canvas can't decode — upload as-is
  }
}

export function PhotoUpload({ onFile }: Props) {
  const t = useTranslations("fuel");
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const resized = await resizeImage(f);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(resized));
      onFile(resized);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      {preview ? (
        <div className="relative w-full overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="receipt" className="max-h-64 w-full object-contain" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2"
            onClick={clear}
            aria-label="remove"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-24 w-full border-dashed"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="size-5" />
          {t("photo")}
        </Button>
      )}
      {preview && (
        <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
          {t("photo_change")}
        </Button>
      )}
    </div>
  );
}
