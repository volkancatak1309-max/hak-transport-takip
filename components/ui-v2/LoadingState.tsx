"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * ORTAK YÜKLEME GÖSTERGESİ — tüm yavaş yüzeylerin TEK kaynağı.
 *
 * Sorun (Volkan, 09.08.2026): ağır sayfalar (Yakıt, Analiz, Raporlar, Harita,
 * Araç detayı) sunucuda 3-10 sn hesaplanırken ekran BOŞ duruyordu; kullanıcı
 * "açılmıyor" sanıp F5'liyor ve aynı ağır sorguyu bir kez daha başlatıyordu.
 * İskelet (Skeleton) tek başına yetmedi — gri kutular "yüklendi ama veri yok"
 * gibi de okunabiliyor. Bu yüzden iskeletin ÜSTÜNE dönen halka + açık metin.
 *
 * SABIR EŞİĞİ: SLOW_MS sonrası mesaj "hâlâ hesaplanıyor"a döner. Amaç dürüstlük
 * — 30 günlük yakıt raporu gerçekten 8+ sn sürüyor (ölçüldü) ve kullanıcı
 * beklemeye devam mı edeceğini bilmeli. Eşik 15 sn: ölçülen en yavaş normal
 * sayfa (Analiz, 6-10 sn) altında kalsın, yalnız GERÇEKTEN uzun olanlar
 * tetiklesin — yoksa mesaj her sayfada çıkıp anlamını yitirirdi.
 */
const SLOW_MS = 15_000;

export function LoadingState({
  label,
  slowLabel,
  className,
  /** İskeletin üstüne binen ince şerit yerine ortalanmış blok görünümü. */
  block = false,
}: {
  label?: string;
  slowLabel?: string;
  className?: string;
  block?: boolean;
}) {
  const t = useTranslations("common");
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(id);
  }, []);

  const text = slow ? (slowLabel ?? t("loading_slow")) : (label ?? t("loading"));

  return (
    <div
      // role=status + aria-live: ekran okuyucu metnin değiştiğini duyurur
      // (15 sn'de "hâlâ hesaplanıyor"a dönerken de).
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 text-sm text-muted-foreground",
        block ? "justify-center py-10" : "justify-center py-3",
        className
      )}
    >
      <Spinner />
      <span>{text}</span>
    </div>
  );
}

/**
 * Dönen halka. `motion-reduce:animate-none` ile hareket duyarlılığı olan
 * kullanıcıda dönme durur — halka statik kalır ama metin yine "yükleniyor"
 * dediği için bilgi kaybolmaz.
 */
function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 shrink-0 animate-spin rounded-full",
        "border-2 border-border border-t-primary motion-reduce:animate-none",
        className
      )}
    />
  );
}

export { Spinner };
