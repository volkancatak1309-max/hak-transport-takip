"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Award, Info, Loader2, Trophy, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState, StatusChip, type ChipTone } from "@/components/ui-v2";
import { odulAyarKaydet, type OdulGorunum } from "@/app/actions/odul";
import { ROZET_SKOR_ESIK, type RozetKodu } from "@/lib/odul";

/**
 * ÖDÜL / LİDERLİK EKRANI (088).
 *
 * ═══ İKİ ŞEY KALDIRILAMAZ ═══
 *
 * 1. SKORSUZ ŞOFÖR AYRI BÖLÜMDE ve sebebiyle. Sıralamaya 0 puanla sokmak
 *    "en kötü sürücü" demek olurdu; oysa sayı yok, sürüş kötü değil.
 * 2. SERİ ROZETİ KAZANILAMIYORSA SEBEBİ YAZILIR. Boş göstermek şoföre
 *    "kazanamadın" dedirtir; oysa temiz veri henüz o kadar uzun değil
 *    (cihaz eşiği 23.07.2026'da değişti).
 */

const ROZET_TON: Record<RozetKodu, ChipTone> = {
  ay_iyi: "info",
  seri_iyi: "info",
  ay_ilk3: "idle",
  sifir_olay: "info",
  yukselen: "active",
};

const KAPI_TON: Record<string, ChipTone> = {
  km_yetersiz: "neutral",
  kapsama_dusuk: "warning",
  vardiya_yok: "neutral",
};

export function OdulClient({ pano, yonetici }: { pano: OdulGorunum; yonetici: boolean }) {
  const t = useTranslations("odul");
  const [ayarAcik, setAyarAcik] = useState(false);

  if (pano.tabloYok) {
    return (
      <>
        <PageHeader title={t("title")} description={t("desc")} />
        <EmptyState kind="none" title={t("kapali_baslik")} hint={t("kapali_govde")} />
      </>
    );
  }

  if (!pano.donemBas) {
    return (
      <>
        <PageHeader title={t("title")} description={t("desc")} />
        <EmptyState kind="none" title={t("donem_yok_baslik")} hint={t("donem_yok_govde")} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("desc")} />

      {/* ── DÖNEM KÜNYESİ ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground">
        <span className="nums">{t("donem", { bas: pano.donemBas, bit: pano.donemBit ?? "—" })}</span>
        <span>·</span>
        <span className="nums">{t("skorlanan", { n: pano.siralı.length, skorsuz: pano.skorsuz.length })}</span>
        {pano.epokOncesi && <StatusChip tone="warning">{t("epok_uyari")}</StatusChip>}
        {yonetici && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAyarAcik((v) => !v)}>
            {t("ayar")}
          </Button>
        )}
      </div>

      {ayarAcik && yonetici && <AyarFormu pano={pano} kapat={() => setAyarAcik(false)} />}

      {/*
        SERİ ROZETİ KAZANILAMIYORSA SEBEBİ EKRANDA. Sessiz kalmak, kuralı
        kazanılamaz sanılan bir hedefe çevirirdi.
      */}
      {!pano.seri.olur && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t("seri_kilitli", {
              temiz: pano.seri.temizDonem,
              eksik: pano.seri.eksikDonem,
            })}
          </span>
        </p>
      )}

      {/* ── DÖNEM SONU ÖZETİ ───────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Trophy className="size-4 text-accent-gold-text" />
            {t("odullendir")}
          </div>
          {pano.ozet.odullendir.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("odullendir_bos")}</p>
          ) : (
            <ul className="space-y-2">
              {pano.ozet.odullendir.map((o) => (
                <li key={o.workerId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {o.ad}
                    {o.rozet.map((r) => (
                      <StatusChip key={r} tone={ROZET_TON[r] ?? "neutral"}>
                        {t(`rozet_${r}`)}
                      </StatusChip>
                    ))}
                  </span>
                  <span className="nums font-semibold">{o.skor}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <TrendingDown className="size-4 text-destructive" />
            {t("dususte")}
          </div>
          {pano.ozet.dususte.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("dususte_bos")}</p>
          ) : (
            <ul className="space-y-2">
              {pano.ozet.dususte.map((d) => (
                <li key={d.workerId} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{d.ad}</span>
                  <span className="nums">
                    {d.onceki} → <strong>{d.skor}</strong>{" "}
                    <span className="text-destructive">({d.fark})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── LİDERLİK ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">{t("liderlik")}</h2>
        <ul className="space-y-1">
          {pano.siralı.map((r) => (
            <li
              key={r.workerId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="nums w-6 text-muted-foreground">{r.sira}.</span>
                {r.ad}
                {r.yon === "yukari" && <TrendingUp className="size-3.5 text-primary" />}
                {r.yon === "asagi" && <TrendingDown className="size-3.5 text-destructive" />}
                {r.yon === "sabit" && <Minus className="size-3.5 text-muted-foreground" />}
              </span>
              <span className="nums flex items-center gap-2">
                {r.oncekiSkor !== null && (
                  <span className="text-xs text-muted-foreground">{r.oncekiSkor} →</span>
                )}
                <strong>{r.skor}</strong>
                {(r.skor ?? 0) >= ROZET_SKOR_ESIK && <Award className="size-3.5 text-accent-gold-text" />}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── SKORSUZLAR — SIRALAMADA DEĞİL, SEBEBİYLE ───────────────────── */}
      {pano.skorsuz.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t("skorsuz_baslik", { n: pano.skorsuz.length })}</h2>
          <p className="text-xs text-muted-foreground">{t("skorsuz_aciklama")}</p>
          <ul className="space-y-1">
            {pano.skorsuz.map((r) => (
              <li
                key={r.workerId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>{r.ad}</span>
                <span className="nums flex items-center gap-2 text-xs text-muted-foreground">
                  {/* SIFIR DEĞİL, SEBEP. Kapı nerede duruyordu — sayıyla. */}
                  <StatusChip tone={KAPI_TON[r.kapi ?? ""] ?? "neutral"}>
                    {t(`kapi_${r.kapi ?? "vardiya_yok"}`)}
                  </StatusChip>
                  {r.km !== null && r.esikKm !== null && (
                    <span>{t("kapi_olcum", { km: r.km, esik: r.esikKm })}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function AyarFormu({ pano, kapat }: { pano: OdulGorunum; kapat: () => void }) {
  const t = useTranslations("odul");
  // ⚠️ Formun başlangıcı SAKLANAN ayardan gelmeli. `pano.ayar.isimGorunur`
  // yönetici ekranı için true'ya sabitlendiği için burada kullanılamaz.
  const [isim, setIsim] = useState(pano.ayarKayitli.isimGorunur);
  const [rozet, setRozet] = useState(pano.ayarKayitli.rozetAcik);
  const [bekle, basla] = useTransition();

  const kaydet = () =>
    basla(async () => {
      const r = await odulAyarKaydet({ isimGorunur: isim, rozetAcik: rozet });
      if (!r.ok) {
        toast.error(t("hata_hata"));
        return;
      }
      toast.success(t("ayar_kaydedildi"));
      kapat();
    });

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={isim} onChange={(e) => setIsim(e.target.checked)} />
        <span>
          <span className="font-medium">{t("ayar_isim")}</span>
          <br />
          {/*
            HUKUKİ GEREKÇE FORMUN İÇİNDE. Bu kutuyu işaretleyen kişi neyi
            açtığını bilmeli: isimli kıyaslama DE'de işletme kurulu onayına
            tabidir (§ 87 Abs. 1 Nr. 6 BetrVG).
          */}
          <span className="text-xs text-muted-foreground">{t("ayar_isim_aciklama")}</span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={rozet} onChange={(e) => setRozet(e.target.checked)} />
        <span>
          <span className="font-medium">{t("ayar_rozet")}</span>
          <br />
          <span className="text-xs text-muted-foreground">{t("ayar_rozet_aciklama")}</span>
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={kapat}>
          {t("vazgec")}
        </Button>
        <Button size="sm" onClick={kaydet} disabled={bekle}>
          {bekle && <Loader2 className="mr-1 size-3.5 animate-spin" />}
          {t("kaydet")}
        </Button>
      </div>
    </div>
  );
}
