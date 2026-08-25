"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-v2";

/**
 * SATIR EYLEMLERİ — "Ekle varsa Düzenle ve Sil de var" kuralının tek yüzeyi.
 *
 * ═══ NEDEN ORTAK BİLEŞEN ═══
 *
 * Kural her ekranda elle uygulandığında biri unutuluyor: belge türleri
 * eklenebiliyor ama düzeltilemiyordu ve yanlış girilen bir uyarı eşiği
 * (90 yerine 30) geri alınamıyordu. Ortak bileşen hem tekrarı bitiriyor hem
 * de muhafızın (`scripts/check-crud-ekranlari.mjs`) arayacağı tek bir işaret
 * bırakıyor: liste üreten bir ekran bunu render etmiyorsa derleme kırılır.
 *
 * ═══ SİLME İKİ AŞAMALI ═══
 *
 * Önce SİL denenir. Satır başka kayıtlarca kullanılıyorsa veritabanı FK ile
 * durdurur ve ekran PASİFLEŞTİRMEYİ önerir (bkz. lib/silme-sonucu.ts). Böylece
 * kullanıcı her durumda bir şeyi geri alabilir: pasif satır listede kalır ve
 * yeniden açılabilir, silinen satır zaten hiç kullanılmamıştır.
 *
 * `onPasiflestir` verilmezse pasifleştirme düğmesi çıkmaz — iş emri gibi
 * "durum" ekseni zaten olan kayıtlarda ikinci bir pasiflik kavramı uydurmak
 * yanlış olurdu.
 */
export function CrudSatirEylemleri({
  adi,
  onDuzenle,
  onSil,
  onPasiflestir,
  pasifMi,
  pending,
  silmeAciklamasi,
}: {
  /** Kullanıcının gördüğü ad — onay cümlesi bunu yazar ("Fren hattı silinsin mi?"). */
  adi: string;
  onDuzenle: () => void;
  onSil: () => void | Promise<void>;
  /** Verilirse "Pasifleştir/Aktifleştir" düğmesi çıkar. */
  onPasiflestir?: () => void | Promise<void>;
  pasifMi?: boolean;
  pending?: boolean;
  /** Silmenin sonucunu anlatan ek cümle (geçmiş kayıtlara ne olur). */
  silmeAciklamasi?: string;
}) {
  const t = useTranslations("crud");
  const [onayAcik, setOnayAcik] = useState(false);

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={onDuzenle}
        aria-label={t("edit")}
        title={t("edit")}
      >
        <Pencil className="size-4" />
      </Button>

      {onPasiflestir && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={pending}
          onClick={() => void onPasiflestir()}
          aria-label={pasifMi ? t("activate") : t("deactivate")}
          title={pasifMi ? t("activate") : t("deactivate")}
        >
          <Power className={`size-4 ${pasifMi ? "text-accent-mint-text" : ""}`} />
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => setOnayAcik(true)}
        aria-label={t("delete")}
        title={t("delete")}
      >
        <Trash2 className="size-4" />
      </Button>

      <ConfirmDialog
        open={onayAcik}
        onOpenChange={setOnayAcik}
        title={t("delete_title", { name: adi })}
        description={silmeAciklamasi ?? t("delete_desc")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={onSil}
      />
    </span>
  );
}
