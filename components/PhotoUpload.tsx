"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resizeImage } from "@/lib/image-resize";

type Props = {
  onFile: (file: File | null) => void;
};

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
      const resized = await resizeImage(f, "receipt.jpg");
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
