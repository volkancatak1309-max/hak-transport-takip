"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getShiftPhotosAction,
  type ShiftPhotoItem,
} from "@/app/actions/driver-panel";
import { formatTime } from "@/lib/format";

/**
 * İş 2 kapanışı — vardiya "FOTO ÇEK" fotoğraflarının admin görüntüleyicisi.
 * Fotoğraflar (imzalı URL'lerle) yalnız dialog açılınca getShiftPhotosAction ile
 * çekilir. Yalnız fotoğrafı olan vardiyalar için satırda gösterilir.
 */
export function ShiftPhotosButton({ entryId }: { entryId: string }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<ShiftPhotoItem[] | null>(null);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && photos === null) {
      setLoading(true);
      try {
        setPhotos(await getShiftPhotosAction(entryId));
      } catch {
        setPhotos([]);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onOpenChange(true)}
        aria-label={t("viewPhotos")}
        title={t("viewPhotos")}
        className="text-accent-sky-text hover:text-accent-sky-text"
      >
        <Camera className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="size-5 text-accent-sky-text" />
              {t("photosTitle")}
            </DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : !photos || photos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("photosEmpty")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p) => (
                <figure key={p.id} className="space-y-1">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.url}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded-md border bg-muted" />
                  )}
                  <figcaption className="nums flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                    <span>{formatTime(p.taken_at, locale)}</span>
                    {p.latitude !== null && p.longitude !== null && (
                      <a
                        href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-accent-sky-text hover:underline"
                        aria-label={t("reportMap")}
                      >
                        <MapPin className="size-3" />
                      </a>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
