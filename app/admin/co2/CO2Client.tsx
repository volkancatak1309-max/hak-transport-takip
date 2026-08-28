"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Download, Info, Leaf, Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, StatusChip, SegmentedControl } from "@/components/ui-v2";
import { co2AyarKaydet } from "@/app/actions/co2";
import type { CO2Panosu } from "@/lib/co2-db";
import { CO2_KAYNAK, CO2_TTW, CO2_WTT, type CO2Esas } from "@/lib/co2";
import { downloadCO2Report, type PdfDil } from "@/components/pdf/CO2Report";

/**
 * CO₂ PANOSU (089).
 *
 * ═══ ÜÇ ŞEY KALDIRILAMAZ ═══
 *
 * 1. ESAS (TTW/WTW) HER EKRANDA YAZILI. Müşteri WTW isteyip TTW alırsa rakam
 *    ~%23 düşük görünür ve bu ihalede yanlış beyandır.
 * 2. ÖLÇÜLEMEYEN ARAÇLARIN PLAKASI görünür. "23/29 araç" demek yetmez.
 * 3. Ölçülemeyen değer "0 kg" değil "ölçülemedi · sebep" yazar.
 */

const kg = (n: number | null) =>
  n === null ? null : new Intl.NumberFormat("de-AT", { maximumFractionDigits: 0 }).format(n);
const say = (n: number | null, basamak = 1) =>
  n === null ? null : new Intl.NumberFormat("de-AT", { maximumFractionDigits: basamak }).format(n);

export function CO2Client({ pano, yonetici }: { pano: CO2Panosu; yonetici: boolean }) {
  const t = useTranslations("co2");
  const [ayarAcik, setAyarAcik] = useState(false);
  const [eksen, setEksen] = useState<"arac" | "sofor" | "musteri">("musteri");
  const [pdfBekle, pdfBasla] = useTransition();

  /**
   * PDF — panonun GÖSTERDİĞİ sayılarla aynı veriden üretilir.
   *
   * ⚠️ Ölçülemeyen araçlar tabloya GİRMEZ (0 kg yazmak yerine dışarıda kalır)
   * ama KAPSAMA bloğunda plakalarıyla listelenir. Belge "23/29 araç ölçüldü"
   * demeden beyan olarak kullanılamaz.
   */
  const indir = (dil: PdfDil) =>
    pdfBasla(async () => {
      const olculen = pano.araclar.filter((a) => a.kg !== null && a.km !== null);
      await downloadCO2Report(
        {
          monthLabel: `${pano.bas.slice(0, 10)} → ${pano.bit.slice(0, 10)}`,
          generatedAt: new Date().toISOString(),
          totalLiters: pano.toplam.litre ?? 0,
          totalCo2: pano.toplam.kg ?? 0,
          totalKm: pano.toplam.km ?? 0,
          avgGPerKm: pano.toplam.gKm,
          esas: pano.ayar.esas,
          katsayiSurum: pano.katsayiSurum,
          vehicles: olculen.map((a) => ({
            plate: a.plate,
            liters: a.litre ?? 0,
            km: a.km ?? 0,
            lPer100: a.km && a.litre ? (a.litre / a.km) * 100 : null,
            co2Kg: a.kg ?? 0,
            gPerKm: a.gKm,
          })),
        },
        t("title"),
        dil,
        {
          esas: pano.ayar.esas,
          olculenArac: pano.toplam.olculenArac,
          toplamArac: pano.toplam.toplamArac,
          olculemeyenPlakalar: pano.toplam.olculemeyenPlakalar,
        }
      );
    });

  if (pano.yakitYok) {
    return (
      <>
        <PageHeader title={t("title")} description={t("desc")} />
        <EmptyState kind="none" title={t("yakit_yok_baslik")} hint={t(`yakit_yok_${pano.yakitYok}`)} />
      </>
    );
  }

  const T = pano.toplam;
  const ttw = CO2_TTW.diesel;
  const wtw = CO2_TTW.diesel + CO2_WTT.diesel;

  return (
    <>
      <PageHeader title={t("title")} description={t("desc")} />

      {/* ── ESAS KÜNYESİ — KALDIRILAMAZ ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground">
        <Leaf className="size-3.5 text-primary" />
        <span>{t("esas")}</span>
        <StatusChip tone={pano.ayar.esas === "WTW" ? "info" : "neutral"}>
          {t(`esas_${pano.ayar.esas}`)}
        </StatusChip>
        <span className="nums">
          {t("katsayi", { katsayi: say(pano.ayar.esas === "WTW" ? wtw : ttw, 2)!, surum: pano.katsayiSurum })}
        </span>
        <span>·</span>
        <span className="nums">{t("aralik", { bas: pano.bas.slice(0, 10), bit: pano.bit.slice(0, 10) })}</span>
        <span className="ml-auto flex items-center gap-1">
          {/*
            PDF DİLİ SORULUYOR, ARAYÜZDEN TÜRETİLMİYOR. Belge müşteriye
            gidiyor: Avusturya'da Almanca, Türkiye'de Türkçe, uluslararası
            ihalede İngilizce. AZG raporunda aynı karar verilmişti.
          */}
          {(["tr", "de", "en"] as PdfDil[]).map((d) => (
            <Button key={d} size="sm" variant="outline" onClick={() => indir(d)} disabled={pdfBekle}>
              {pdfBekle ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {d.toUpperCase()}
            </Button>
          ))}
          {yonetici && (
            <Button size="sm" variant="ghost" onClick={() => setAyarAcik((v) => !v)}>
              {t("ayar")}
            </Button>
          )}
        </span>
      </div>

      {pano.tabloYok && (
        <p className="flex items-start gap-2 rounded-xl border border-accent-gold/40 bg-accent-gold/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent-gold-text" />
          <span>{t("migration_yok")}</span>
        </p>
      )}

      {ayarAcik && yonetici && <AyarFormu pano={pano} kapat={() => setAyarAcik(false)} />}

      {/* ── ÜST SAYILAR ────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kart etiket={t("toplam_kg")} deger={kg(T.kg)} birim="kg CO₂e" bos={t("olculemedi")} />
        <Kart etiket={t("yogunluk")} deger={say(T.gKm, 1)} birim="g/km" bos={t("olculemedi")} />
        <Kart etiket={t("litre")} deger={say(T.litre, 1)} birim="L" bos={t("olculemedi")} />
        <Kart etiket={t("mesafe")} deger={say(T.km, 0)} birim="km" bos={t("olculemedi")} />
      </div>

      {/* ── HEDEF ──────────────────────────────────────────────────────── */}
      {pano.hedef && (
        <div
          className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${
            pano.hedef.tuttu ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <Target className="size-4" />
          <span className="nums">
            {t(pano.hedef.tuttu ? "hedef_tuttu" : "hedef_asildi", {
              hedef: say(pano.ayar.hedefGKm, 1)!,
              fark: say(Math.abs(pano.hedef.fark), 1)!,
              yuzde: say(Math.abs(pano.hedef.yuzde), 0)!,
            })}
          </span>
        </div>
      )}

      {/* ── KAPSAMA — SESSİZ EKSİK YASAK ───────────────────────────────── */}
      <div className="space-y-1 rounded-xl border border-border p-3 text-xs text-muted-foreground">
        <span className="nums">{t("kapsama", { olculen: T.olculenArac, toplam: T.toplamArac })}</span>
        {T.olculemeyenPlakalar.length > 0 && (
          <p>
            {/*
              PLAKALAR YAZILI: "23/29 araç ölçüldü" demek denetimde yetmez —
              müfettiş hangi altı aracın dışarıda kaldığını sorar.
            */}
            {t("olculemeyen_plakalar", { plakalar: T.olculemeyenPlakalar.join(" · ") })}
          </p>
        )}
      </div>

      {/* ── AYLIK TREND ────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">{t("trend")}</h2>
        <ul className="grid gap-1 sm:grid-cols-3 lg:grid-cols-6">
          {pano.aylik.map((a) => (
            <li key={a.ay} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="nums text-muted-foreground">{a.ay}</div>
              {/*
                🔴 "ölçülemedi" ile "hesaplanmadı" AYNI ŞEY DEĞİL (S4).
                İlki bir ÖLÇÜM YARGISI: ay hesaplandı, o ayda hiçbir aracın
                tüketimi ölçülemedi. İkincisi bir EKSİKLİK: o ayın özeti hiç
                üretilmemiş (gece cron'u kurulmamış ya da henüz koşmamış).
                İkisini aynı göstermek, bilinmeyeni ölçülmüş gibi sunardı.
              */}
              <div className="nums font-medium">
                {a.kg !== null ? (
                  `${kg(a.kg)} kg`
                ) : a.kaynak === "hesaplanmadi" ? (
                  <span className="text-muted-foreground italic">{t("hesaplanmadi")}</span>
                ) : (
                  <span className="text-muted-foreground">{t("olculemedi")}</span>
                )}
              </div>
              {a.gKm !== null && <div className="nums text-muted-foreground">{say(a.gKm, 0)} g/km</div>}
            </li>
          ))}
        </ul>
      </div>

      {/* ── KIRILIMLAR ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <SegmentedControl
          options={[
            { value: "musteri", label: t("eksen_musteri") },
            { value: "arac", label: t("eksen_arac") },
            { value: "sofor", label: t("eksen_sofor") },
          ]}
          value={eksen}
          onChange={(v) => setEksen(v as typeof eksen)}
        />

        {eksen === "musteri" && <MusteriTablosu pano={pano} />}
        {eksen === "arac" && <AracTablosu pano={pano} />}
        {eksen === "sofor" && <SoforTablosu pano={pano} />}
      </div>

      {/* ── METODOLOJİ ─────────────────────────────────────────────────── */}
      <details className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">{t("metodoloji")}</summary>
        <ul className="mt-2 space-y-1">
          <li>{t("metod_girdi")}</li>
          <li>{t(`metod_esas_${pano.ayar.esas}`)}</li>
          <li>{CO2_KAYNAK.ttw}</li>
          {pano.ayar.esas === "WTW" && <li>{CO2_KAYNAK.wtt}</li>}
          <li>{CO2_KAYNAK.standart}</li>
          <li>{t("metod_musteri")}</li>
          <li>{t("metod_sofor")}</li>
          <li>{t("metod_olculemeyen")}</li>
          {pano.ayar.sebekeGkWh !== null && (
            <li className="nums">
              {t("metod_sebeke", {
                deger: say(pano.ayar.sebekeGkWh, 0)!,
                kaynak: pano.ayar.sebekeKaynak ?? CO2_KAYNAK.sebeke,
                yil: pano.ayar.sebekeYil ?? "—",
              })}
            </li>
          )}
        </ul>
      </details>
    </>
  );
}

function Kart({
  etiket,
  deger,
  birim,
  bos,
}: {
  etiket: string;
  deger: string | null;
  birim: string;
  bos: string;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs text-muted-foreground">{etiket}</div>
      <div className="nums mt-1 text-xl font-semibold">
        {deger === null ? <span className="text-base text-muted-foreground">{bos}</span> : `${deger} ${birim}`}
      </div>
    </div>
  );
}

function AracTablosu({ pano }: { pano: CO2Panosu }) {
  const t = useTranslations("co2");
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="p-3 text-left font-medium">{t("kolon_arac")}</th>
            <th className="p-3 text-left font-medium">{t("kolon_yakit")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_litre")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_km")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_kg")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_gkm")}</th>
          </tr>
        </thead>
        <tbody>
          {pano.araclar.map((a) => (
            <tr key={a.vehicleId} className="border-b border-border/60 last:border-0">
              <td className="nums p-3 uppercase">{a.plate}</td>
              <td className="p-3 text-xs text-muted-foreground">{t(`yakit_${a.fuelType}`)}</td>
              <td className="nums p-3 text-right">{say(a.litre, 1) ?? "—"}</td>
              <td className="nums p-3 text-right">{say(a.km, 0) ?? "—"}</td>
              <td className="nums p-3 text-right">
                {/* 0 DEĞİL: ölçülemeyen araç sebebiyle yazılır. */}
                {a.kg === null ? (
                  <span className="text-xs text-muted-foreground">
                    {t("olculemedi")} · {t(`sebep_${a.sebep ?? "litre_yok"}`)}
                  </span>
                ) : (
                  kg(a.kg)
                )}
              </td>
              <td className="nums p-3 text-right">{say(a.gKm, 0) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SoforTablosu({ pano }: { pano: CO2Panosu }) {
  const t = useTranslations("co2");
  if (pano.soforler.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("sofor_bos")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="p-3 text-left font-medium">{t("kolon_sofor")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_km")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_kg")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_gkm")}</th>
            <th className="p-3 text-left font-medium">{t("kolon_kapsama")}</th>
          </tr>
        </thead>
        <tbody>
          {pano.soforler.map((s) => (
            <tr key={s.workerId} className="border-b border-border/60 last:border-0">
              <td className="p-3">{s.ad}</td>
              <td className="nums p-3 text-right">{say(s.km, 0) ?? "—"}</td>
              <td className="nums p-3 text-right">{kg(s.kg) ?? t("olculemedi")}</td>
              <td className="nums p-3 text-right">{say(s.gKm, 0) ?? "—"}</td>
              <td className="p-3 text-xs text-muted-foreground">
                {s.olculemeyenKm > 0 ? t("olculemeyen_km", { km: s.olculemeyenKm }) : t("tam")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MusteriTablosu({ pano }: { pano: CO2Panosu }) {
  const t = useTranslations("co2");
  if (pano.musteriler.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("musteri_bos")}</p>;
  }
  return (
    <>
      {/* İHALE FORMATI: müşteri satırı dışarıya verilecek olan. */}
      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>{t("musteri_aciklama")}</span>
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-left font-medium">{t("kolon_musteri")}</th>
              <th className="p-3 text-right font-medium">{t("kolon_sefer")}</th>
              <th className="p-3 text-right font-medium">{t("kolon_km")}</th>
              <th className="p-3 text-right font-medium">{t("kolon_kg")}</th>
              <th className="p-3 text-right font-medium">{t("kolon_gkm")}</th>
              <th className="p-3 text-left font-medium">{t("kolon_kapsama")}</th>
            </tr>
          </thead>
          <tbody>
            {pano.musteriler.map((m) => (
              <tr key={m.musteriId ?? "yok"} className="border-b border-border/60 last:border-0">
                <td className="p-3">{m.ad}</td>
                <td className="nums p-3 text-right">{m.seferSayisi}</td>
                <td className="nums p-3 text-right">{say(m.km, 0) ?? "—"}</td>
                <td className="nums p-3 text-right">{kg(m.kg) ?? t("olculemedi")}</td>
                <td className="nums p-3 text-right">{say(m.gKm, 0) ?? "—"}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {m.olculemeyenSefer > 0 ? t("olculemeyen_sefer", { n: m.olculemeyenSefer }) : t("tam")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const ESASLAR: CO2Esas[] = ["TTW", "WTW"];

function AyarFormu({ pano, kapat }: { pano: CO2Panosu; kapat: () => void }) {
  const t = useTranslations("co2");
  const [esas, setEsas] = useState<CO2Esas>(pano.ayar.esas);
  const [sebeke, setSebeke] = useState(pano.ayar.sebekeGkWh?.toString() ?? "");
  const [sebekeKaynak, setSebekeKaynak] = useState(pano.ayar.sebekeKaynak ?? "");
  const [sebekeYil, setSebekeYil] = useState(pano.ayar.sebekeYil?.toString() ?? "");
  const [hedef, setHedef] = useState(pano.ayar.hedefGKm?.toString() ?? "");
  const [hedefYil, setHedefYil] = useState(pano.ayar.hedefYil?.toString() ?? "");
  const [bekle, basla] = useTransition();

  const sayi = (s: string) => {
    const v = Number(s.replace(",", "."));
    return s.trim() === "" || !Number.isFinite(v) ? null : v;
  };

  const kaydet = () =>
    basla(async () => {
      const r = await co2AyarKaydet({
        esas,
        sebekeGkWh: sayi(sebeke),
        sebekeKaynak: sebekeKaynak.trim() || null,
        sebekeYil: sayi(sebekeYil),
        hedefGKm: sayi(hedef),
        hedefYil: sayi(hedefYil),
      });
      if (!r.ok) {
        toast.error(t("hata_hata"));
        return;
      }
      toast.success(t("ayar_kaydedildi"));
      kapat();
    });

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">{t("esas")}</span>
        <div className="flex flex-wrap gap-2">
          {ESASLAR.map((e) => (
            <Button key={e} size="sm" variant={esas === e ? "default" : "outline"} onClick={() => setEsas(e)}>
              {t(`esas_${e}`)}
            </Button>
          ))}
        </div>
        {/*
          ESAS DEĞİŞİMİNİN SONUCU FORMDA YAZILI: kullanıcı neyi değiştirdiğini
          bilmeli. Geçmiş sayılar da yeniden hesaplanır — CO₂ hiçbir yerde
          saklanmıyor, yani karışık esaslı bir tablo oluşmaz.
        */}
        <p className="text-xs text-muted-foreground">{t(`esas_aciklama_${esas}`)}</p>
      </div>

      {esas === "WTW" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("sebeke")}</span>
            <Input inputMode="decimal" value={sebeke} onChange={(e) => setSebeke(e.target.value)} placeholder="0" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("sebeke_kaynak")}</span>
            <Input value={sebekeKaynak} onChange={(e) => setSebekeKaynak(e.target.value)} placeholder="EEA" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("sebeke_yil")}</span>
            <Input inputMode="numeric" value={sebekeYil} onChange={(e) => setSebekeYil(e.target.value)} />
          </label>
        </div>
      )}
      {esas === "WTW" && <p className="text-xs text-muted-foreground">{t("sebeke_aciklama")}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("hedef")}</span>
          <Input inputMode="decimal" value={hedef} onChange={(e) => setHedef(e.target.value)} placeholder="—" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("hedef_yil")}</span>
          <Input inputMode="numeric" value={hedefYil} onChange={(e) => setHedefYil(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t("hedef_aciklama")}</p>

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
