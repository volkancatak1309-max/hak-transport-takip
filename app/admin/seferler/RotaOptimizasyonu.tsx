"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Route, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTime, localeTag, viennaDayKey } from "@/lib/format";
import { rotaOner, rotaUygula } from "@/app/actions/rota";
import type { DurakGorunum } from "@/app/actions/duraklar";
import type { SeferSecenek } from "@/app/actions/seferler";
import type {
  PlanDuragi,
  RotaAyari,
  RotaHataKodu,
  RotaOnerisi,
  RotaYetenegi,
} from "@/lib/rota/tipler";

/**
 * "DURAKLARI EN İYİ SIRAYA DİZ" — düğme + iki aşamalı kutu (ayar → sonuç).
 *
 * ═══ SATIŞ DEMOSUNUN KENDİSİ — NET VE SADE ═══
 *
 * Sonuç ekranı üç soruyu cevaplar ve başka bir şey söylemez: kaç km, kaç
 * dakika, kaç durak geç — şimdi ve önerilen. "Abartı yok": kazanç yoksa
 * "mevcut sıra zaten en iyisi" der, kötüleşme varsa açıkça yazar ve
 * Uygula'yı teşvik etmez. Animasyon/efekt eklenmedi.
 *
 * ═══ HİÇBİR ŞEY KENDİLİĞİNDEN DEĞİŞMEZ ═══
 *
 * Hesap sırayı yazmaz. Yalnız "Uygula" yazar; "Vazgeç" ya da kutuyu kapatmak
 * iz bırakmaz. Elle sıralama (yukarı/aşağı) olduğu gibi çalışmaya devam eder.
 */

const KarsilastirmaHaritasi = dynamic(
  () => import("@/components/RotaKarsilastirmaHaritasi").then((m) => m.RotaKarsilastirmaHaritasi),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);

type Asama = "ayar" | "sonuc";

/** Bugünse şimdiki saat (5 dk'ya yuvarlanmış), değilse 08:00. */
function varsayilanHareket(seferTarih: string): string {
  if (seferTarih !== viennaDayKey(new Date())) return "08:00";
  const [sa, dk] = formatTime(new Date().toISOString(), "tr").split(":").map(Number);
  const toplam = Math.min(23 * 60 + 55, Math.ceil((sa * 60 + dk) / 5) * 5);
  return `${String(Math.floor(toplam / 60)).padStart(2, "0")}:${String(toplam % 60).padStart(2, "0")}`;
}

export function RotaOptimizasyonu({
  seferId,
  seferTarih,
  duraklar,
  rota,
  bolgeler,
  mesgul,
  onUygulandi,
}: {
  seferId: string;
  seferTarih: string;
  duraklar: DurakGorunum[];
  rota: RotaYetenegi;
  bolgeler: SeferSecenek[];
  /** Üstteki liste bir işlem yürütüyorsa düğme beklesin. */
  mesgul: boolean;
  onUygulandi: () => Promise<void> | void;
}) {
  const t = useTranslations("rota");
  const locale = useLocale();
  const azId = useId();

  const bekleyen = useMemo(() => duraklar.filter((d) => d.durum === "bekliyor"), [duraklar]);
  const sonraki = useMemo(() => [...bekleyen].sort((a, b) => a.sira - b.sira)[0] ?? null, [bekleyen]);
  const aktif = bekleyen.length >= 3;

  const [acik, setAcik] = useState(false);
  const [asama, setAsama] = useState<Asama>("ayar");
  const [baslangic, setBaslangic] = useState("sonraki");
  const [bitis, setBitis] = useState<RotaAyari["bitis"]>("acik");
  const [hareket, setHareket] = useState(() => varsayilanHareket(seferTarih));
  const [calisiyor, setCalisiyor] = useState(false);
  const [oneri, setOneri] = useState<RotaOnerisi | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  // Depolar önce (rotalar tipik olarak depodan başlar), sonra diğer bölgeler.
  const depolar = bolgeler.filter((b) => b.ikincil === "depot");
  const digerleri = bolgeler.filter((b) => b.ikincil !== "depot");

  const hataMetni = (h: RotaHataKodu, ek?: { duraklar?: string[]; limit?: number }) => {
    const liste = ek?.duraklar ?? [];
    const adlar =
      liste.slice(0, 3).join(", ") + (liste.length > 3 ? ` ${t("ve_daha", { n: liste.length - 3 })}` : "");
    return t(`hata_${h}`, { adlar, limit: ek?.limit ?? 0 });
  };

  function kapat() {
    setAcik(false);
    setAsama("ayar");
    setOneri(null);
    setHata(null);
  }

  async function hesapla() {
    setCalisiyor(true);
    setHata(null);
    const r = await rotaOner(seferId, { baslangic, bitis, hareket });
    setCalisiyor(false);
    if (r.ok) {
      setOneri(r.oneri);
      setAsama("sonuc");
    } else {
      setHata(hataMetni(r.hata, { duraklar: r.duraklar, limit: r.limit }));
    }
  }

  async function uygula() {
    if (!oneri) return;
    setCalisiyor(true);
    const r = await rotaUygula(seferId, oneri.yeniSira, oneri.parmakIzi);
    setCalisiyor(false);
    if (r.ok) {
      toast.success(t("uygulandi"));
      kapat();
      await onUygulandi();
      return;
    }
    const metin = hataMetni(r.hata);
    if (r.hata === "degisti") {
      setOneri(null);
      setAsama("ayar");
    }
    setHata(metin);
    toast.error(metin);
  }

  const pencereli = bekleyen.filter((d) => d.pencere_bas || d.pencere_bit).length;
  const sabitSayisi = duraklar.length - bekleyen.length;
  const siralanacak = baslangic === "sonraki" ? bekleyen.length - 1 : bekleyen.length;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!aktif || mesgul}
        onClick={() => setAcik(true)}
        aria-describedby={!aktif ? azId : undefined}
      >
        <Route className="size-3.5" aria-hidden />
        {t("dugme")}
      </Button>
      {!aktif && (
        <span id={azId} className="text-xs text-muted-foreground">
          {t("dugme_az")}
        </span>
      )}

      <Dialog open={acik} onOpenChange={(o) => !o && kapat()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("baslik")}</DialogTitle>
            <DialogDescription>{t("aciklama")}</DialogDescription>
          </DialogHeader>

          {rota.test && (
            <p className="rounded-lg bg-accent-gold/10 p-2.5 text-xs text-foreground">
              {t("test_saglayici")}
            </p>
          )}

          {asama === "ayar" || !oneri ? (
            <div className="space-y-4">
              {!rota.servisHazir && (
                <div role="status" className="rounded-lg bg-status-critical-soft p-3 text-sm text-status-critical-text">
                  <p className="font-medium">{t("servis_yok")}</p>
                  <p className="mt-1 text-xs">{t("servis_yok_ipucu")}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor={`${azId}-bas`} className="text-sm">
                  {t("baslangic")}
                </Label>
                <Select value={baslangic} onValueChange={(v) => v && setBaslangic(v)}>
                  <SelectTrigger id={`${azId}-bas`} className="h-11">
                    <SelectValue>
                      {baslangic === "sonraki"
                        ? t("bas_sonraki", { ad: sonraki?.ad ?? "—" })
                        : (() => {
                            const b = bolgeler.find((x) => x.id === baslangic);
                            return b
                              ? t(b.ikincil === "depot" ? "bas_depo" : "bas_bolge", { ad: b.ad })
                              : "—";
                          })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sonraki">{t("bas_sonraki", { ad: sonraki?.ad ?? "—" })}</SelectItem>
                    {depolar.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {t("bas_depo", { ad: b.ad })}
                      </SelectItem>
                    ))}
                    {digerleri.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {t("bas_bolge", { ad: b.ad })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t("bitis")}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {(["acik", "donus"] as const).map((b) => (
                    <label key={b} className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${azId}-bitis`}
                        value={b}
                        checked={bitis === b}
                        onChange={() => setBitis(b)}
                        className="size-4 accent-[var(--accent-coral)]"
                      />
                      {t(b === "acik" ? "bitis_acik" : "bitis_donus")}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor={`${azId}-hareket`} className="text-sm">
                  {t("hareket")}
                </Label>
                <Input
                  id={`${azId}-hareket`}
                  type="time"
                  value={hareket}
                  onChange={(e) => setHareket(e.target.value)}
                  className="h-11 w-36"
                />
              </div>

              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li>{t("girdi_ozet", { n: Math.max(0, siralanacak) })}</li>
                {sabitSayisi > 0 && <li>{t("girdi_sabit", { n: sabitSayisi })}</li>}
                {pencereli > 0 && <li>{t("girdi_pencere", { n: pencereli })}</li>}
                <li>{t("girdi_sure", { dk: rota.varsayilanServisDk })}</li>
              </ul>

              {hata && (
                <p role="alert" className="flex items-start gap-2 text-sm text-status-critical-text">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {hata}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={kapat} disabled={calisiyor}>
                  {t("vazgec")}
                </Button>
                <Button onClick={hesapla} disabled={calisiyor || !rota.servisHazir || !hareket}>
                  {calisiyor ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Route className="size-4" aria-hidden />}
                  {calisiyor ? t("hesaplaniyor") : t("hesapla")}
                </Button>
              </div>
            </div>
          ) : (
            <Sonuc
              oneri={oneri}
              locale={locale}
              hata={hata}
              calisiyor={calisiyor}
              uygula={uygula}
              vazgec={kapat}
              ayarlaraDon={() => {
                setAsama("ayar");
                setHata(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── SONUÇ ─────────────────────────────────────────────────────────────────

function Sonuc({
  oneri,
  locale,
  hata,
  calisiyor,
  uygula,
  vazgec,
  ayarlaraDon,
}: {
  oneri: RotaOnerisi;
  locale: string;
  hata: string | null;
  calisiyor: boolean;
  uygula: () => void;
  vazgec: () => void;
  ayarlaraDon: () => void;
}) {
  const t = useTranslations("rota");

  // EN için en-GB: paylaşılan formatNumber yalnız tr/de biliyor ve EN'de
  // "199,8" basıyordu (ölçüldü, yerel E2E). Genel yardımcıya dokunulmadı.
  const sayiBicimi = new Intl.NumberFormat(locale === "en" ? "en-GB" : localeTag(locale), {
    maximumFractionDigits: 1,
  });
  // Sayı ile birimi BÖLÜNMEZ boşlukla bağla: 360 px'te "199,8 / km" ayrı satıra
  // düşüyordu (ölçüldü). Süre yalnız "2 sa | 58 dk" arasından kırılabilir.
  const NBSP = "\u00a0";
  const bitistir = (metin: string) => metin.replace(/(\d) (?=\D)/g, `$1${NBSP}`);
  const km = (m: number) => `${sayiBicimi.format(m / 1000)}${NBSP}km`;
  const sure = (sn: number) => {
    const dk = Math.round(Math.abs(sn) / 60);
    return bitistir(
      dk >= 60 ? t("sure_sa_dk", { sa: Math.floor(dk / 60), dk: dk % 60 }) : t("sure_dk", { dk })
    );
  };
  /** Kazanç hücresi — pozitif kazanç düz, sıfır "—", kayıp "−" ile ve kırmızı. */
  const kazanc = (deger: number, bicim: (n: number) => string, esik: number) => {
    if (Math.abs(deger) < esik) return <span className="text-muted-foreground">—</span>;
    if (deger > 0) return <span className="font-medium">{bicim(deger)}</span>;
    return <span className="text-status-critical-text">−{bicim(Math.abs(deger))}</span>;
  };

  const o = oneri.once.ozet;
  const s = oneri.sonra.ozet;
  const kotu =
    oneri.degisti && oneri.fark.mesafeM <= 0 && oneri.fark.toplamSn <= 0 && oneri.fark.gecikenDurak <= 0;

  return (
    <div className="space-y-4">
      {oneri.saglayici.yedekKullanildi && (
        <p className="text-xs text-muted-foreground">{t("yedek_kullanildi")}</p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="py-1 text-left font-normal">
              <span className="sr-only">{t("baslik")}</span>
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">{t("once")}</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">{t("sonra")}</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">{t("kazanc")}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <th scope="row" className="py-2 pr-2 text-left font-normal">{t("olcu_km")}</th>
            <td className="nums py-2 pl-3 text-right text-muted-foreground">{km(o.mesafeM)}</td>
            <td className="nums py-2 pl-3 text-right">{km(s.mesafeM)}</td>
            <td className="nums py-2 pl-3 text-right">{kazanc(oneri.fark.mesafeM, km, 50)}</td>
          </tr>
          {/*
            SÜRÜŞ ayrı satır: toplam süre pencere beklemesini de içeriyor ve
            pencereli bir turda km kazancı büyükken süre kazancı küçük görünür
            (ölçüldü: yerel E2E, 153 km / 49 dk). Sürüş satırı km ile aynı
            ölçüyü konuşur; toplam satırı günün gerçek uzunluğunu.
          */}
          <tr className="border-t border-border">
            <th scope="row" className="py-2 pr-2 text-left font-normal">{t("olcu_surus")}</th>
            <td className="nums py-2 pl-3 text-right text-muted-foreground">{sure(o.surusSn)}</td>
            <td className="nums py-2 pl-3 text-right">{sure(s.surusSn)}</td>
            <td className="nums py-2 pl-3 text-right">{kazanc(o.surusSn - s.surusSn, sure, 30)}</td>
          </tr>
          <tr className="border-t border-border">
            <th scope="row" className="py-2 pr-2 text-left font-normal">{t("olcu_sure")}</th>
            <td className="nums py-2 pl-3 text-right text-muted-foreground">{sure(o.toplamSn)}</td>
            <td className="nums py-2 pl-3 text-right">{sure(s.toplamSn)}</td>
            <td className="nums py-2 pl-3 text-right">{kazanc(oneri.fark.toplamSn, sure, 30)}</td>
          </tr>
          <tr className="border-t border-border">
            <th scope="row" className="py-2 pr-2 text-left font-normal">{t("olcu_gec")}</th>
            <td className="nums py-2 pl-3 text-right text-muted-foreground">{o.gecikenDurak}</td>
            <td className="nums py-2 pl-3 text-right">{s.gecikenDurak}</td>
            <td className="nums py-2 pl-3 text-right">{kazanc(oneri.fark.gecikenDurak, (n) => String(n), 1)}</td>
          </tr>
        </tbody>
      </table>

      {!oneri.degisti && <p className="text-sm">{t("ayni_sira")}</p>}
      {kotu && <p className="text-sm text-status-critical-text">{t("kotu_sonuc")}</p>}

      {oneri.harita ? (
        <figure className="space-y-1.5">
          <div className="h-[300px] w-full overflow-hidden rounded-[12px] border border-border">
            <KarsilastirmaHaritasi veri={oneri.harita} baslangicEtiketi={oneri.ayar.baslangicAd} />
          </div>
          <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="sr-only">{t("harita_baslik")}</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0 w-5 border-t-2 border-dashed border-muted-foreground" />
              {t("harita_once")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0 w-5 border-t-[3px] border-accent-coral" />
              {t("harita_sonra")}
            </span>
          </figcaption>
        </figure>
      ) : (
        <p className="text-xs text-muted-foreground">{t("harita_kosul")}</p>
      )}

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{t("liste_baslik")}</h3>
        {oneri.sabitDurak > 0 && (
          <p className="text-xs text-muted-foreground">{t("girdi_sabit", { n: oneri.sabitDurak })}</p>
        )}
        <ol className="space-y-1.5">
          {oneri.sonra.duraklar.map((d, i) => (
            <DurakSatiri key={d.id} d={d} no={oneri.sabitDurak + i + 1} locale={locale} />
          ))}
        </ol>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("kaynak", { ad: oneri.saglayici.ad })}
        {" · "}
        {oneri.saglayici.kod === "google" ? (
          // Google atıf kuralı: metin "Google Maps", çevrilmez, tek satır.
          <span translate="no" className="whitespace-nowrap">Google Maps</span>
        ) : (
          t("kaynak_osm")
        )}
      </p>

      {hata && (
        <p role="alert" className="flex items-start gap-2 text-sm text-status-critical-text">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {hata}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={ayarlaraDon} disabled={calisiyor}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("ayarlara_don")}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={vazgec} disabled={calisiyor}>
            {t("vazgec")}
          </Button>
          <Button onClick={uygula} disabled={calisiyor || !oneri.degisti}>
            {calisiyor && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("uygula")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DurakSatiri({ d, no, locale }: { d: PlanDuragi; no: number; locale: string }) {
  const t = useTranslations("rota");
  const pencere = d.pencere ? `${d.pencere.bas ?? "…"}–${d.pencere.bit ?? "…"}` : null;
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border p-2">
      <span className="nums mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium">
        {no}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium break-words">{d.ad}</span>
          {d.baslangicDuragi && <span className="text-xs text-muted-foreground">{t("baslangic_duragi")}</span>}
          {d.eskiSira !== no && (
            <span className="nums text-xs text-muted-foreground">{t("eski_sira", { n: d.eskiSira })}</span>
          )}
        </div>
        <div className="nums flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{t("varis", { saat: formatTime(new Date(d.varisMs).toISOString(), locale) })}</span>
          {pencere && <span>{t("pencere", { aralik: pencere })}</span>}
          {d.beklemeSn >= 60 && <span>{t("bekleme", { dk: Math.round(d.beklemeSn / 60) })}</span>}
          {d.gecikmeSn > 0 && (
            <span className="font-medium text-status-critical-text">
              {t("gec", { dk: Math.max(1, Math.round(d.gecikmeSn / 60)) })}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
