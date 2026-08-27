"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Download, Info } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-v2";
import { takografIndirmeBaglantisi, type TakografDetay } from "@/app/actions/takograf";
import {
  donemCelismesi,
  faaliyetToplami,
  muhurSebepKodu,
  muhurTonu,
  sureBicim,
  type FaaliyetTuru,
} from "@/lib/takograf";

/**
 * TEK DOSYANIN HAM VERİSİ (091).
 *
 * ═══ MOBBIN DESENLERİ ═══
 *   Fibery   — sol SATIR NUMARASI OLUĞU (uzun tabloda "kaçıncı satırdayım")
 *   Twenty   — ALT TOPLAM satırı
 *   Deel     — sessiz nokta+etiket faaliyet göstergesi (renkli hap DEĞİL)
 *   Twingate — boş durumda tablo iskeleti kalır
 *
 * ⚠️ İHLAL YORUMU YOK. Alt toplam yalnız SÜRE toplar; "9 saati aştı" gibi
 * bir cümle bu ekranda geçmez (Volkan kararı).
 */

const gun = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const saat = (iso: string | null) => (iso ? iso.slice(11, 16) : "—");

/** Faaliyet göstergesi: küçük nokta + etiket. Renkli hap yok. */
const NOKTA: Record<FaaliyetTuru, string> = {
  surus: "bg-sky-400",
  is: "bg-amber-400",
  hazir: "bg-slate-400",
  mola: "bg-emerald-400",
  bilinmiyor: "bg-muted-foreground/50",
};

export function TakografDetayClient({ detay }: { detay: TakografDetay }) {
  const t = useTranslations("tacho");
  const d = detay.dosya!;
  const ton = muhurTonu(d.muhurDurumu);

  const toplam = useMemo(
    () => faaliyetToplami(detay.faaliyetler.map((f) => ({ faaliyet: f.faaliyet, sureDk: f.sureDk }))),
    [detay.faaliyetler]
  );

  /** Mühür sebebi: HAM METİN DEĞİL, kapalı koddan üretilen cümle. */
  const sebepKodu = muhurSebepKodu(d.muhurSebep);

  /**
   * ŞOFÖR SÜTUNU — 155 satır "—" basmaktansa bir kez AÇIKLA.
   *
   * Araç ünitesi indirmesinde faaliyet satırı şoför kimliği TAŞIMAZ; şoför
   * ancak kart takma/çıkarma kayıtlarıyla (cardIwData) zaman+slot eşleşmesinden
   * türetilir ve okuyucu servisi bugün bu bağı kurmuyor (27.08.2026 ölçümü).
   * Sütunu boş bırakmak "şoför yok" gibi okunuyordu — yanlış.
   */
  const soforVar = detay.faaliyetler.some((f) => f.workerAd || f.kartNo);

  /** Dosyanın bildirdiği dönem ile faaliyet günleri çelişiyor mu (ham veri). */
  const celiski = useMemo(
    () => donemCelismesi(d.donemBas, d.donemBit, detay.faaliyetler.map((f) => f.gun ?? f.baslangic)),
    [d.donemBas, d.donemBit, detay.faaliyetler]
  );

  const indir = async () => {
    const r = await takografIndirmeBaglantisi(d.id);
    if (!r.ok) {
      toast.error(t("err_download"));
      return;
    }
    window.open(r.url, "_blank", "noopener");
  };

  const ozne = d.tur === "kart" ? d.workerAd ?? d.kartNo : d.vehiclePlaka ?? d.aracPlaka ?? d.aracVin;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={d.dosyaAdi} description={`${t(`type_${d.tur}` as never)}${d.nesil ? ` · ${d.nesil}` : ""}`} />
        <div className="flex items-center gap-2">
          <Link href="/admin/takograf" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft className="mr-2 size-4" />
            {t("back")}
          </Link>
          {/* 🔴 İndirme her zaman açık — ORİJİNAL dosya. */}
          <Button onClick={indir}>
            <Download className="mr-2 size-4" />
            {t("download_original")}
          </Button>
        </div>
      </div>

      {/**
       * 🔴 DETAY SAYFASINDA ŞERİT HER ZAMAN GÖRÜNÜR (doğrulanamadıysa).
       * Listede küme bazlı, burada dosya bazlı — kullanıcı tek dosyaya
       * baktığında uyarıyı kaçıramaz.
       */}
      {ton === "uyari" && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          <AlertTriangle className="mt-px size-4 shrink-0" />
          <span>
            <strong>{t("seal_warning_single")}</strong>
            {/**
             * 🔴 HAM HATA METNİ BASILMAZ. Eskiden `d.muhurSebep` doğrudan
             * yazılıyordu ve müşteri şunu görüyordu (canlıda, 27.08.2026):
             * "failed to extract Gen2 certificates: expected exactly 1 MSCA
             *  certificate, got 0" — İngilizce, teknik, dört kez tekrarlı.
             * Ham metin veritabanında KAYIT olarak duruyor; ekranda kapalı
             * kodun üç dildeki karşılığı gösteriliyor.
             */}
            {sebepKodu ? (
              <span className="mt-0.5 block text-xs opacity-80">
                {t(`seal_reason_${sebepKodu}` as never)}
              </span>
            ) : null}
          </span>
        </p>
      )}

      {/* ⚠️ Ham `ayristirmaHata` da BASILMAZ — aynı gerekçe. Durumun üç
          dildeki uzun cümlesi kullanıcıya gerekeni zaten söylüyor. */}
      {d.ayristirmaDurumu !== "tamam" && (
        <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm">
          <Info className="mt-px size-4 shrink-0 text-muted-foreground" />
          <span>{t(`parse_${d.ayristirmaDurumu}_long` as never)}</span>
        </p>
      )}

      {/**
       * DÖNEM ↔ GÜN ÇELİŞKİSİ — veriyi DÜZELTMEZ, çeliştiğini SÖYLER.
       * Ölçüldü: çelişki dosyanın içinde (gün kayıtları sabit bir başlangıca
       * çekilmiş, genel bakış bloğu değil). Uydurmak yerine gösteriyoruz.
       */}
      {celiski && (
        <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>
            {t("period_mismatch", {
              donem: `${gun(d.donemBas)} → ${gun(d.donemBit)}`,
              gunler: celiski.ilk === celiski.son ? celiski.ilk : `${celiski.ilk} → ${celiski.son}`,
            })}
          </span>
        </p>
      )}

      {/* ── KÜNYE ────────────────────────────────────────────────────── */}
      <dl className="grid gap-3 rounded-xl border border-border/60 bg-card/60 p-4 text-sm sm:grid-cols-4">
        <Alan baslik={t("col_subject")} deger={ozne} mono={!d.workerAd && !d.vehiclePlaka} />
        <Alan baslik={t("col_period")} deger={d.donemBas ? `${gun(d.donemBas)} → ${gun(d.donemBit)}` : null} />
        <Alan baslik={t("col_seal")} deger={t(`seal_${d.muhurDurumu}` as never)} />
        <Alan baslik={t("uploaded_by")} deger={`${gun(d.yuklendiAt)} · ${d.yukleyenAd ?? "—"}`} />
      </dl>

      {/* ── HAM FAALİYET TABLOSU ─────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="sticky top-0 bg-card/95 text-xs text-muted-foreground backdrop-blur">
            <tr className="border-b border-border/60">
              {/* Fibery: satır numarası oluğu */}
              <th className="w-12 px-2 py-2 text-right font-medium">#</th>
              {/* Şoför sütunu YALNIZ dolduğunda kalır — 155 satır "—" bir
                  bilgi değil, gürültüdür. Yokluğu tablonun altında bir kez
                  açıklanıyor. */}
              {soforVar && <th className="px-3 py-2 text-left font-medium">{t("col_driver")}</th>}
              <th className="px-3 py-2 text-left font-medium">{t("col_date")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_activity")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col_start")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col_end")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col_duration")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_vehicle")}</th>
            </tr>
          </thead>
          <tbody>
            {detay.faaliyetler.length === 0 ? (
              <tr>
                <td colSpan={soforVar ? 8 : 7} className="px-3 py-10 text-center">
                  <p className="text-sm font-medium">{t("no_activity_title")}</p>
                  <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">{t("no_activity_body")}</p>
                </td>
              </tr>
            ) : (
              detay.faaliyetler.map((f, i) => (
                <tr key={f.id} className="border-b border-border/40 last:border-0">
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                  {soforVar && (
                    <td className="px-3 py-1.5">
                      {f.workerAd ?? (f.kartNo ? <span className="font-mono text-xs">{f.kartNo}</span> : "—")}
                    </td>
                  )}
                  <td className="px-3 py-1.5 text-xs tabular-nums">{gun(f.gun ?? f.baslangic)}</td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`size-1.5 rounded-full ${NOKTA[f.faaliyet ?? "bilinmiyor"]}`} />
                      {t(`act_${f.faaliyet ?? "bilinmiyor"}` as never)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{saat(f.baslangic)}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{saat(f.bitis)}</td>
                  {/* ⚠️ Süre ölçülemediyse "—", 0 DEĞİL. */}
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{sureBicim(f.sureDk) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{f.aracPlaka ?? d.aracPlaka ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          {/* Twenty: ALT TOPLAM — yorum YOK, yalnız toplam */}
          {detay.faaliyetler.length > 0 && (
            <tfoot className="border-t border-border/60 bg-card/60 text-xs">
              <tr>
                <td colSpan={soforVar ? 3 : 2} className="px-3 py-2 text-muted-foreground">
                  {t("total_rows", { n: detay.faaliyetler.length })}
                </td>
                <td colSpan={5} className="px-3 py-2">
                  <span className="tabular-nums">
                    {t("act_surus")} {sureBicim(toplam.kirilim.surus) ?? "—"} ·{" "}
                    {t("act_is")} {sureBicim(toplam.kirilim.is) ?? "—"} ·{" "}
                    {t("act_hazir")} {sureBicim(toplam.kirilim.hazir) ?? "—"} ·{" "}
                    {t("act_mola")} {sureBicim(toplam.kirilim.mola) ?? "—"}
                  </span>
                  {toplam.olculemeyen > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      {t("unmeasured", { n: toplam.olculemeyen })}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/**
       * ŞOFÖR YOKLUĞUNU BİR KEZ AÇIKLA — 155 kez "—" basma.
       * Ölçüldü (27.08.2026): araç ünitesi dosyasında faaliyet satırları kart
       * numarası taşımıyor; kimlik ayrı bir blokta (kart takma/çıkarma) ve
       * okuyucu bugün o bağı kurmuyor. "Şoför bilgisi yok" demek YANLIŞ
       * olurdu — bilgi dosyada var, biz çıkarmıyoruz.
       */}
      {detay.faaliyetler.length > 0 && !soforVar && (
        <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>{t(d.tur === "vu" ? "driver_none_vu" : "driver_none_card")}</span>
        </p>
      )}

      {/* ── OLAYLAR ──────────────────────────────────────────────────── */}
      {detay.olaylar.length > 0 && (
        <section className="space-y-2 rounded-xl border border-border/60 bg-card/60 p-4">
          <h2 className="text-sm font-medium">{t("events_title")}</h2>
          <p className="text-xs text-muted-foreground">{t("events_hint")}</p>
          <ul className="divide-y divide-border/40 text-xs">
            {detay.olaylar.slice(0, 200).map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="font-mono">{o.tur ?? "—"}</span>
                <span className="tabular-nums text-muted-foreground">
                  {gun(o.bas)} {saat(o.bas)}
                  {o.bit ? ` → ${saat(o.bit)}` : ""}
                </span>
                {o.ciddiyet && <span className="text-muted-foreground">{o.ciddiyet}</span>}
              </li>
            ))}
          </ul>
          {detay.olaylar.length > 200 && (
            <p className="text-xs text-muted-foreground">{t("events_more", { n: detay.olaylar.length - 200 })}</p>
          )}
        </section>
      )}
    </div>
  );
}

function Alan({ baslik, deger, mono }: { baslik: string; deger: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{baslik}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>{deger ?? "—"}</dd>
    </div>
  );
}
