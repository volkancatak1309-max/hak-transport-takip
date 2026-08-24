"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/ui-v2";
import { dvirMaddeKaydet } from "@/app/actions/dvir";
import type { DvirMadde } from "@/lib/dvir-db";

/**
 * ARAÇ KONTROL MADDELERİ — kiracının kendi sözlüğü (migration 081).
 *
 * ═══ SABİT LİSTE YOK — BELGE TÜRLERİYLE AYNI GEREKÇE ═══
 *
 * Ürün hiçbir kontrol maddesi ÖNERMİYOR: TIR'da fren hattı ve dorse bağlantısı
 * var, panelvanda yok; AB'de takograf, ABD'de farklı bir DVIR listesi. Hazır
 * bir liste sunmak, listede olmayan araç tipini ikinci sınıf yapardı.
 *
 * ═══ TÜR: ÖNCE / SONRA / İKİSİ ═══
 *
 * Bir madde sefer öncesine, sonrasına ya da ikisine birden ait olabilir. Lastik
 * sefer öncesi kontrol edilir; hasar sefer sonrası da bakılır. "İkisi" ayrı bir
 * madde açmak zorunda bırakmamak için var — aynı gerçek iki satıra bölünmesin.
 */
export function DvirMaddeleriSection({
  maddeler,
  tabloYok,
}: {
  maddeler: DvirMadde[];
  tabloYok: boolean;
}) {
  const t = useTranslations("settings");
  const [pending, startTransition] = useTransition();
  const [acik, setAcik] = useState(false);

  async function kaydet(fd: FormData) {
    const r = await dvirMaddeKaydet({
      kod: String(fd.get("kod") ?? ""),
      etiket: String(fd.get("etiket") ?? ""),
      aciklama: (fd.get("aciklama") as string) || null,
      tur: (String(fd.get("tur") ?? "ikisi") as DvirMadde["tur"]) ?? "ikisi",
      aracTipi: (fd.get("aracTipi") as string) || null,
      sira: Number(fd.get("sira") ?? 0),
      aktif: true,
    });
    if (r.ok) {
      toast.success(t("dvir_item_saved"));
      setAcik(false);
      return;
    }
    toast.error(
      r.hata === "cakisma"
        ? t("dvir_item_duplicate")
        : r.hata === "tablo_yok"
          ? t("dvir_migration_needed")
          : t("save_error")
    );
  }

  return (
    <section className="surface-card space-y-4 rounded-[16px] p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold">{t("dvir_items_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("dvir_items_desc")}</p>
      </div>

      {tabloYok ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-xs font-medium text-accent-gold-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t("dvir_migration_needed")}</span>
        </p>
      ) : (
        <>
          {maddeler.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("dvir_items_empty")}</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {maddeler.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {/* Etiket KİRACININ verisi — çevrilmez. */}
                    <span className="font-medium text-foreground">{m.etiket}</span>
                    <span className="nums text-[11px] text-text-tertiary">{m.kod}</span>
                    {!m.aktif && (
                      <StatusChip tone="neutral">{t("dvir_item_inactive")}</StatusChip>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`dvir_kind_${m.tur}`)}
                    {m.aracTipi ? ` · ${m.aracTipi}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {acik ? (
            <form
              action={(fd) => startTransition(async () => { await kaydet(fd); })}
              className="space-y-3 rounded-lg border border-border/60 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dvir_label">{t("dvir_field_label")}</Label>
                  <Input
                    id="dvir_label"
                    name="etiket"
                    required
                    placeholder={t("dvir_field_label_ph")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dvir_code">{t("dvir_field_code")}</Label>
                  <Input
                    id="dvir_code"
                    name="kod"
                    required
                    placeholder={t("dvir_field_code_ph")}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("dvir_field_code_hint")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dvir_kind">{t("dvir_field_kind")}</Label>
                  <select
                    id="dvir_kind"
                    name="tur"
                    defaultValue="ikisi"
                    className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
                  >
                    <option value="once">{t("dvir_kind_once")}</option>
                    <option value="sonra">{t("dvir_kind_sonra")}</option>
                    <option value="ikisi">{t("dvir_kind_ikisi")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dvir_order">{t("dvir_field_order")}</Label>
                  <Input
                    id="dvir_order"
                    name="sira"
                    type="number"
                    min={0}
                    max={999}
                    defaultValue={maddeler.length * 10}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="dvir_desc">{t("dvir_field_desc")}</Label>
                  <Input
                    id="dvir_desc"
                    name="aciklama"
                    placeholder={t("dvir_field_desc_ph")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dvir_vtype">{t("dvir_field_vtype")}</Label>
                  <Input
                    id="dvir_vtype"
                    name="aracTipi"
                    placeholder={t("dvir_field_vtype_ph")}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("dvir_field_vtype_hint")}
                  </p>
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
              {t("dvir_item_add")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
