"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { addShiftPhotoAction } from "@/app/actions/driver-panel";
import { resizeImage } from "@/lib/image-resize";
import { getGeoFix } from "./geo";

/**
 * İş 2 — "FOTO ÇEK": kamera açılır, foto sıkıştırılır, o anki GPS konumu +
 * saat damgasıyla Supabase Storage'a yüklenir ve aktif vardiyaya bağlanır.
 * Tek genel akış — kategori sorulmaz. Foto yüklemesi çevrimiçi gerektirir
 * (dosyayı kuyruklamıyoruz); çevrimdışıysa açık bir uyarı verilir.
 */
export function ShiftPhotoButton() {
  const t = useTranslations("panel");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function openCamera() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error(t("v2PhotoOffline"));
      return;
    }
    inputRef.current?.click();
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Aynı foto arka arkaya tekrar seçilebilsin.
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const [resized, fix] = await Promise.all([
        resizeImage(file, "shift.jpg"),
        getGeoFix(),
      ]);
      const fd = new FormData();
      fd.set("photo", resized);
      if (fix.lat !== null && fix.lng !== null) {
        fd.set("lat", String(fix.lat));
        fd.set("lng", String(fix.lng));
        if (fix.accuracy !== null) fd.set("accuracy", String(fix.accuracy));
      }
      const r = await addShiftPhotoAction(fd);
      if (r.ok) {
        toast.success(t("v2PhotoSaved"));
      } else {
        toast.error(t("v2PhotoErr"));
      }
    } catch {
      toast.error(t("v2PhotoErr"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={openCamera}
        disabled={busy}
        className="glass-field flex h-24 w-full items-center justify-center gap-4 rounded-2xl text-xl font-bold tracking-wide text-foreground transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-white/[0.06] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="size-8 animate-spin text-accent-sky-text" aria-hidden />
            {t("v2PhotoSaving")}
          </>
        ) : (
          <>
            <Camera className="size-8 text-accent-sky-text" aria-hidden />
            {t("v2TakePhoto")}
          </>
        )}
      </button>
    </>
  );
}
