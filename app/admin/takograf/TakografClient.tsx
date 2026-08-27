"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Download, Info, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusChip } from "@/components/ui-v2";
import {
  takografYukle,
  takografYenidenOku,
  takografIndirmeBaglantisi,
  type TakografPanosu,
} from "@/app/actions/takograf";
import { EN_BUYUK_BAYT, muhurTonu, type MuhurDurumu } from "@/lib/takograf";
import type { TakografDosya, YuklemeHataKodu } from "@/lib/takograf-db";

/**
 * TAKOGRAF ARŞİVİ — dosya listesi + yükleme (091).
 *
 * ═══ MOBBIN DESENLERİ (Faz 2 §4'te hangisinden ne alındığı yazılı) ═══
 *
 *   Deel      — iki satırlı kimlik hücresi (ad + altında tür·nesil)
 *   Vapi      — sayaçlı hızlı süzgeç şeridi + monospace kısaltılmış kimlik
 *   Twenty    — kaldırılabilir süzgeç çipi
 *   Lindy     — kısıtı bırakma alanının İÇİNE yazma
 *   Revolut   — "tarih · durum" ikinci satır
 *   Whop      — satır içi sorun + altta toplu özet
 *   Twingate  — boş durumda TABLO İSKELETİ kalır
 *
 * ═══ 🔴 ÜÇ ŞEY KALDIRILAMAZ ═══
 *
 * 1. DOĞRULANAMAYAN DOSYA UYARISI. Satırın sol kenarında 2px amber çizgi +
 *    tablonun üstünde kalıcı şerit. Rozet çorbası YOK: 11 kırmızı rozet
 *    uyarıyı okunmaz yapar.
 * 2. SİLME YOK. Ne düğme, ne menü. Arşiv ürünün satış vaadi.
 * 3. İNDİRME HER ZAMAN AÇIK — dosya ayrıştırılamamış olsa bile.
 */

type Suzgec = "tumu" | "dogrulandi" | "dogrulanamadi" | "denenmedi" | "okunamadi";

const bicimBayt = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const gun = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/**
 * Hata kodu → çeviri anahtarı. AÇIK eşleme, şablon dizesi DEĞİL.
 *
 * `t(`err_${kod}`)` yazsaydık kod ile çeviri arasındaki bağ tip denetiminin
 * göremeyeceği bir dizge birleştirmesi olurdu ve çevirisi olmayan bir kod
 * kullanıcıya "err_okunamadi" diye görünürdü. Record<YuklemeHataKodu, …>
 * eksik kodu DERLEME ANINDA kırar.
 */
const HATA_METNI: Record<YuklemeHataKodu, string> = {
  dosya_yok: "err_dosya_yok",
  bos_dosya: "err_bos_dosya",
  cok_buyuk: "err_cok_buyuk",
  uzanti_yanlis: "err_uzanti_yanlis",
  zaten_yuklu: "err_duplicate",
  depo_yazilamadi: "err_depo_yazilamadi",
  kayit_yazilamadi: "err_kayit_yazilamadi",
  migration_091_yok: "err_migration_091_yok",
  okunamadi: "err_okunamadi",
};

export function TakografClient({ pano }: { pano: TakografPanosu }) {
  const t = useTranslations("tacho");
  const [suzgec, setSuzgec] = useState<Suzgec>("tumu");
  const [yukleBekle, yukleBasla] = useTransition();
  const [okuBekle, okuBasla] = useTransition();
  const girdiRef = useRef<HTMLInputElement>(null);
  const [surukleniyor, setSurukleniyor] = useState(false);

  const satirlar = useMemo(() => {
    if (suzgec === "tumu") return pano.satirlar;
    if (suzgec === "okunamadi") return pano.satirlar.filter((d) => d.ayristirmaDurumu !== "tamam");
    return pano.satirlar.filter((d) => d.muhurDurumu === suzgec);
  }, [pano.satirlar, suzgec]);

  /** Görünen kümede doğrulanamayan var mı — şerit buna bakar. */
  const uyariSayisi = satirlar.filter((d) => d.muhurDurumu === "dogrulanamadi").length;

  const yukle = (dosyalar: FileList | null) => {
    if (!dosyalar?.length) return;
    yukleBasla(async () => {
      for (const f of Array.from(dosyalar)) {
        const fd = new FormData();
        fd.append("dosya", f);
        const r = await takografYukle(fd);
        if (r.ok) {
          /**
           * ⚠️ MESAJ SONUCU DÜRÜSTÇE SÖYLER. "Yüklendi" demek yetmez:
           * dosya arşive girdi ama okunamamış olabilir; kullanıcı bunu
           * hemen bilmeli.
           */
          if (r.ayristirmaDurumu === "tamam") {
            toast.success(t("uploaded_ok", { name: f.name, rows: r.faaliyet }));
          } else {
            toast.warning(t("uploaded_unread", { name: f.name }));
          }
        } else {
          toast.error(t(HATA_METNI[r.hata], { name: f.name }));
        }
      }
      if (girdiRef.current) girdiRef.current.value = "";
    });
  };

  const indir = async (d: TakografDosya) => {
    const r = await takografIndirmeBaglantisi(d.id);
    if (!r.ok) {
      toast.error(t("err_download"));
      return;
    }
    window.open(r.url, "_blank", "noopener");
  };

  const yenidenOku = (id: string) =>
    okuBasla(async () => {
      const r = await takografYenidenOku(id);
      if (r.ok) toast.success(t("reread_ok"));
      else toast.error(t(`err_${r.hata}` as never));
    });

  if (pano.tabloYok) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-px size-4 shrink-0" />
          <span>{t("migration_missing")}</span>
        </p>
      </div>
    );
  }

  const SUZGECLER: { k: Suzgec; n: number }[] = [
    { k: "tumu", n: pano.sayac.tumu },
    { k: "dogrulandi", n: pano.sayac.dogrulandi },
    { k: "dogrulanamadi", n: pano.sayac.dogrulanamadi },
    { k: "denenmedi", n: pano.sayac.denenmedi },
    { k: "okunamadi", n: pano.sayac.ayristirilamadi },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* ── ARŞİV SÖZÜ — ekranın ilk cümlesi ─────────────────────────── */}
      <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>{t("archive_promise")}</span>
      </p>

      {/* ── SERVİS DURUMU — yalnız SORUN varsa ───────────────────────── */}
      {!pano.servisAyakta && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t("service_down")}</span>
        </p>
      )}

      {/* ── YÜKLEME (Lindy: kısıt bırakma alanının İÇİNDE) ───────────── */}
      <section className="rounded-xl border border-border/60 bg-card/60 p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setSurukleniyor(true);
          }}
          onDragLeave={() => setSurukleniyor(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSurukleniyor(false);
            yukle(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
            surukleniyor ? "border-primary/60 bg-primary/5" : "border-border/60"
          }`}
        >
          <Upload className="mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">{t("drop_title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("drop_hint", { max: Math.round(EN_BUYUK_BAYT / 1048576) })}
          </p>
          <input
            ref={girdiRef}
            type="file"
            accept=".ddd"
            multiple
            className="hidden"
            onChange={(e) => yukle(e.target.files)}
          />
          <Button
            variant="secondary"
            className="mt-3"
            disabled={yukleBekle}
            onClick={() => girdiRef.current?.click()}
          >
            {yukleBekle && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t("choose_file")}
          </Button>
        </div>
      </section>

      {/* ── SÜZGEÇ ŞERİDİ, SAYAÇLARLA (Vapi) ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {SUZGECLER.map(({ k, n }) => (
          <button
            key={k}
            onClick={() => setSuzgec(k)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              suzgec === k
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`filter_${k}` as never)} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {/**
       * 🔴 KALICI UYARI ŞERİDİ (Whop: satır içi sorun + altta toplu özet).
       *
       * Görünen kümede doğrulanamayan varsa bu şerit HER ZAMAN durur.
       * Kullanıcı listeyi kaydırırken satır çizgisini kaçırabilir; şerit
       * kaçırılamaz.
       */}
      {uyariSayisi > 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t("seal_warning_strip", { count: uyariSayisi })}</span>
        </p>
      )}

      {/* ── TABLO ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full min-w-[64rem] text-sm">
          {/* Twingate: BOŞ DURUMDA BİLE başlıklar kalır — kullanıcı hangi
              kolonların geleceğini görür. */}
          <thead className="sticky top-0 bg-card/95 text-xs text-muted-foreground backdrop-blur">
            <tr className="border-b border-border/60">
              <th className="px-3 py-2 text-left font-medium">{t("col_file")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_subject")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_period")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col_rows")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col_size")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_seal")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_state")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("col_uploaded")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {satirlar.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center">
                  <p className="text-sm font-medium">{t("empty_title")}</p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                    {t("empty_body")}
                  </p>
                </td>
              </tr>
            ) : (
              satirlar.map((d) => <Satir key={d.id} d={d} t={t} indir={indir} yenidenOku={yenidenOku} okuBekle={okuBekle} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Satir({
  d,
  t,
  indir,
  yenidenOku,
  okuBekle,
}: {
  d: TakografDosya;
  t: ReturnType<typeof useTranslations<"tacho">>;
  indir: (d: TakografDosya) => void;
  yenidenOku: (id: string) => void;
  okuBekle: boolean;
}) {
  const ton = muhurTonu(d.muhurDurumu as MuhurDurumu);
  /** 🔴 2px amber sol kenar — yalnız doğrulanamayanda. */
  const kenar = ton === "uyari" ? "border-l-2 border-l-amber-500" : "border-l-2 border-l-transparent";

  const ozne =
    d.tur === "kart"
      ? d.workerAd ?? d.kartNo
      : d.vehiclePlaka ?? d.aracPlaka ?? d.aracVin;

  return (
    <tr className={`border-b border-border/40 last:border-0 ${kenar}`}>
      {/* Deel: iki satırlı kimlik hücresi */}
      <td className="px-3 py-2">
        <Link href={`/admin/takograf/${d.id}`} className="font-medium hover:underline">
          {d.dosyaAdi}
        </Link>
        <div className="text-xs text-muted-foreground">
          {t(`type_${d.tur}` as never)}
          {d.nesil ? ` · ${d.nesil}` : ""}
        </div>
      </td>
      {/* Vapi: çözülemeyen kimlik monospace */}
      <td className="px-3 py-2">
        {ozne ? (
          <span className={d.workerAd || d.vehiclePlaka ? "" : "font-mono text-xs"}>{ozne}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {d.donemBas ? `${gun(d.donemBas)} → ${gun(d.donemBit)}` : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{d.faaliyetSayisi.toLocaleString("de-AT")}</td>
      <td className="px-3 py-2 text-right tabular-nums text-xs">{bicimBayt(d.bayt)}</td>
      <td className="px-3 py-2">
        <span
          className={`text-xs ${
            ton === "uyari" ? "text-amber-800 dark:text-amber-300" : ton === "iyi" ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {t(`seal_${d.muhurDurumu}` as never)}
        </span>
      </td>
      <td className="px-3 py-2">
        <StatusChip tone={d.ayristirmaDurumu === "tamam" ? "info" : "neutral"}>
          {t(`parse_${d.ayristirmaDurumu}` as never)}
        </StatusChip>
        {/**
         * Whop deseni "satır içi sorun metni" der — ama metin BİZİM
         * cümlemiz olmalı, kütüphanenin ham İngilizce hatası değil.
         * 27.08.2026'da canlıda ham Go hatası müşteriye görünüyordu; ham
         * metin artık yalnız veritabanında (kayıt), ekranda durumun kendi
         * cümlesi var. Ayrıntı detay sayfasında.
         */}
        {d.ayristirmaDurumu === "basarisiz" && (
          <div className="mt-0.5 max-w-56 text-xs text-muted-foreground">{t("parse_basarisiz_hint")}</div>
        )}
      </td>
      {/* Revolut: "tarih · kişi" ikinci satır */}
      <td className="px-3 py-2 text-xs">
        {gun(d.yuklendiAt)}
        <div className="text-muted-foreground">{d.yukleyenAd ?? "—"}</div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          {/* 🔴 İNDİRME HER ZAMAN AÇIK — ayrıştırılamasa bile. */}
          <Button variant="ghost" size="sm" onClick={() => indir(d)} title={t("download")}>
            <Download className="size-4" />
          </Button>
          {d.ayristirmaDurumu !== "tamam" && (
            <Button variant="ghost" size="sm" disabled={okuBekle} onClick={() => yenidenOku(d.id)} title={t("reread")}>
              {okuBekle ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
