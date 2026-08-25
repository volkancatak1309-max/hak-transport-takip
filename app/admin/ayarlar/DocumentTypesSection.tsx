"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusChip } from "@/components/ui-v2";
import { CrudSatirEylemleri } from "@/components/admin/CrudSatirEylemleri";
import {
  saveDocumentTypeAction,
  deleteDocumentTypeAction,
} from "@/app/actions/documents";
import type { DocumentType } from "@/lib/documents-db";

/**
 * BELGE TÜRLERİ — kiracının kendi sözlüğü (migration 078).
 *
 * ═══ NEDEN BURADA, /admin/ayarlar İÇİNDE ═══
 *
 * Bu bir KİRACI AYARI: "bizim filomuzda hangi belgeler takip edilir". Şoför
 * ekranına koysaydık her şoför sayfasında aynı sözlük tekrar tekrar
 * düzenlenebilir görünürdü. Ayarlar sayfası tam olarak bunun için bir kap
 * olarak açılmıştı.
 *
 * ═══ SABİT LİSTE YOK ═══
 *
 * Ürün hiçbir belge türünü dayatmıyor: TR'de SRC + psikoteknik, DACH'ta
 * Aufenthaltstitel, AB'de CPC, yüke göre ADR. Yeni kurulumlarda MAKUL BİR SET
 * hazır gelir (`db/install/seed-varsayilanlar.sql`) ve kiracı onu düzenler —
 * boş ekranla karşılaşmaz ama listeye de mahkûm değildir.
 *
 * ═══ EKLE VARSA DÜZENLE VE SİL DE VAR ═══
 *
 * Yanlış girilen bir uyarı eşiği (90 yerine 30) geri alınabilmeli. Tür
 * kullanımdaysa veritabanı silmeyi durdurur (FK restrict) ve ekran
 * PASİFLEŞTİRMEYİ önerir: tür yeni belgelerde seçilemez, mevcut belgeler
 * yerinde kalır.
 */
export function DocumentTypesSection({
  types,
  tabloYok,
}: {
  types: DocumentType[];
  tabloYok: boolean;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("crud");
  const [pending, startTransition] = useTransition();
  const [acik, setAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<DocumentType | null>(null);
  const [hataliAlan, setHataliAlan] = useState<string | null>(null);

  function formuAc(d: DocumentType | null) {
    setDuzenlenen(d);
    setHataliAlan(null);
    setAcik(true);
  }

  async function kaydet(fd: FormData) {
    setHataliAlan(null);
    const r = await saveDocumentTypeAction(fd);
    if (r.ok) {
      toast.success(t("doc_type_saved"));
      setAcik(false);
      setDuzenlenen(null);
      return;
    }
    if (r.sebep === "gecersiz") {
      setHataliAlan(r.alan ?? null);
      toast.error(t("invalid"));
      return;
    }
    toast.error(
      r.sebep === "cakisma"
        ? t("doc_type_duplicate")
        : r.sebep === "tablo_yok"
          ? t("doc_migration_needed")
          : t("save_error")
    );
  }

  async function sil(d: DocumentType) {
    const r = await deleteDocumentTypeAction(d.id);
    if (r.ok) {
      toast.success(tc("deleted"));
      return;
    }
    // Kullanımdaki tür silinemez — kullanıcıyı çıkışsız bırakmamak için
    // pasifleştirmeyi ÖNERMEK yetmez, aynı tıklamada yapılabilir olmalı.
    if (r.sebep === "kullanimda") {
      toast.error(tc("in_use_deactivate"));
      return;
    }
    toast.error(t("save_error"));
  }

  /** Pasifleştirme = aynı upsert, yalnız `active` değişir. */
  async function pasifDegistir(d: DocumentType) {
    const fd = new FormData();
    fd.set("id", d.id);
    fd.set("code", d.code);
    fd.set("label", d.label);
    fd.set("warn_days", String(d.warnDays));
    fd.set("sort_order", String(d.sortOrder));
    if (d.requiresNumber) fd.set("requires_number", "on");
    fd.set("active", d.active ? "off" : "on");
    const r = await saveDocumentTypeAction(fd);
    toast[r.ok ? "success" : "error"](
      r.ok ? (d.active ? tc("deactivated") : tc("activated")) : t("save_error")
    );
  }

  return (
    <section className="surface-card space-y-4 rounded-[16px] p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold">{t("doc_types_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("doc_types_desc")}</p>
      </div>

      {tabloYok ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-xs font-medium text-accent-gold-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t("doc_migration_needed")}</span>
        </p>
      ) : (
        <>
          {types.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("doc_types_empty")}</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {types.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 pl-3 pr-1 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-medium text-foreground">{d.label}</span>
                    <span className="nums text-[11px] text-text-tertiary">{d.code}</span>
                    {!d.active && (
                      <StatusChip tone="neutral">{t("doc_type_inactive")}</StatusChip>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="nums text-xs text-muted-foreground">
                      {t("doc_type_warn", { days: d.warnDays })}
                    </span>
                    <CrudSatirEylemleri
                      adi={d.label}
                      pending={pending}
                      pasifMi={!d.active}
                      onDuzenle={() => formuAc(d)}
                      onSil={() => startTransition(async () => { await sil(d); })}
                      onPasiflestir={() =>
                        startTransition(async () => { await pasifDegistir(d); })
                      }
                      silmeAciklamasi={t("doc_type_delete_desc")}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* ⚠️ EHLİYET UYARISI — şema bunu yasaklayamaz, ekran söylemek
              zorunda. Ehliyet kendi ekseninde takip ediliyor
              (workers.license_expiry) ve burada "Ehliyet" adında bir tür
              açmak aynı gerçeği İKİ YERDE takip etmek, panoda da iki kalem
              üretmek demek. */}
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-text-tertiary">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            <span>{t("doc_types_license_note")}</span>
          </p>

          {acik ? (
            <form
              // `key` ZORUNLU: aynı form hem ekleme hem düzenleme için
              // kullanılıyor ve React 19 defaultValue'yu satır değişince
              // yeniden okumaz — düzenlenen kayıt değişse de eski değerler
              // ekranda kalırdı (gunde-tek-vardiya'daki form-reset tuzağı).
              key={duzenlenen?.id ?? "yeni"}
              action={(fd) => startTransition(async () => { await kaydet(fd); })}
              className="space-y-3 rounded-lg border border-border/60 p-3"
            >
              {duzenlenen && <input type="hidden" name="id" value={duzenlenen.id} />}
              {/* Pasiflik bu formdan YÖNETİLMİYOR ama kaybolmamalı: eylem
                  `active` alanını okumazsa varsayılan "aktif"tir ve pasif bir
                  türü düzenlemek onu sessizce geri açardı. */}
              {duzenlenen && !duzenlenen.active && (
                <input type="hidden" name="active" value="off" />
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="doc_label">{t("doc_field_label")}</Label>
                  <Input
                    id="doc_label"
                    name="label"
                    required
                    defaultValue={duzenlenen?.label ?? ""}
                    placeholder={t("doc_field_label_ph")}
                    aria-invalid={hataliAlan === "label" || undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc_code">{t("doc_field_code")}</Label>
                  <Input
                    id="doc_code"
                    name="code"
                    required
                    defaultValue={duzenlenen?.code ?? ""}
                    placeholder={t("doc_field_code_ph")}
                    aria-invalid={hataliAlan === "code" || undefined}
                  />
                  <p className="text-[11px] text-muted-foreground">{t("doc_field_code_hint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc_warn">{t("doc_field_warn")}</Label>
                  <Input
                    id="doc_warn"
                    name="warn_days"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={duzenlenen?.warnDays ?? 30}
                    aria-invalid={hataliAlan === "warn_days" || undefined}
                  />
                  <p className="text-[11px] text-muted-foreground">{t("doc_field_warn_hint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc_sort">{t("doc_field_sort")}</Label>
                  <Input
                    id="doc_sort"
                    name="sort_order"
                    type="number"
                    min={0}
                    max={999}
                    defaultValue={duzenlenen?.sortOrder ?? types.length * 10}
                  />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <Checkbox
                    id="doc_reqno"
                    name="requires_number"
                    defaultChecked={duzenlenen?.requiresNumber ?? false}
                  />
                  <Label htmlFor="doc_reqno" className="text-[13px] font-normal">
                    {t("doc_field_requires_no")}
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t("saving") : t("save")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAcik(false);
                    setDuzenlenen(null);
                  }}
                >
                  {t("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" onClick={() => formuAc(null)}>
              <Plus className="size-4" />
              {t("doc_type_add")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
