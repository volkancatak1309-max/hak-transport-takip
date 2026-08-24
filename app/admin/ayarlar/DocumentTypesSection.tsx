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
import { saveDocumentTypeAction } from "@/app/actions/documents";
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
 * Ürün hiçbir belge türünü ÖNERMİYOR ve önermemeli: TR'de SRC + psikoteknik,
 * DACH'ta Aufenthaltstitel, AB'de CPC, yüke göre ADR. Hazır bir liste sunmak,
 * listede olmayan ülkeyi ikinci sınıf müşteri yapardı.
 */
export function DocumentTypesSection({
  types,
  tabloYok,
}: {
  types: DocumentType[];
  tabloYok: boolean;
}) {
  const t = useTranslations("settings");
  const [pending, startTransition] = useTransition();
  const [acik, setAcik] = useState(false);
  const [hataliAlan, setHataliAlan] = useState<string | null>(null);

  async function kaydet(fd: FormData) {
    setHataliAlan(null);
    const r = await saveDocumentTypeAction(fd);
    if (r.ok) {
      toast.success(t("doc_type_saved"));
      setAcik(false);
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
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{d.label}</span>
                    <span className="nums text-[11px] text-text-tertiary">{d.code}</span>
                    {!d.active && (
                      <StatusChip tone="neutral">{t("doc_type_inactive")}</StatusChip>
                    )}
                  </span>
                  <span className="nums text-xs text-muted-foreground">
                    {t("doc_type_warn", { days: d.warnDays })}
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
              action={(fd) => startTransition(() => void kaydet(fd))}
              className="space-y-3 rounded-lg border border-border/60 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="doc_label">{t("doc_field_label")}</Label>
                  <Input
                    id="doc_label"
                    name="label"
                    required
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
                    defaultValue={30}
                    aria-invalid={hataliAlan === "warn_days" || undefined}
                  />
                  <p className="text-[11px] text-muted-foreground">{t("doc_field_warn_hint")}</p>
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <Checkbox id="doc_reqno" name="requires_number" />
                  <Label htmlFor="doc_reqno" className="text-[13px] font-normal">
                    {t("doc_field_requires_no")}
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t("saving") : t("save")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAcik(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" onClick={() => setAcik(true)}>
              <Plus className="size-4" />
              {t("doc_type_add")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
