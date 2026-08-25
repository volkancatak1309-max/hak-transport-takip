"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Navigation, MapPin, Clock, WifiOff, PackageCheck, ListOrdered, CalendarClock } from "lucide-react";
import type { TakipGorunum, TakipKapali } from "@/lib/takip-db";

const TakipMap = dynamic(() => import("@/components/takip/TakipMap").then((m) => m.TakipMap), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted" />,
});

/**
 * MÜŞTERİ TAKİP EKRANI — girişsiz.
 *
 * ═══ NEDEN YOKLAMA, CANLI BAĞLANTI DEĞİL ═══
 *
 * WebSocket/SSE tek bir aracın konumu için açık bir bağlantıyı dakikalarca
 * tutar; link paylaşılıp yayıldığında bu, eşzamanlı bağlantı sayısı demektir.
 * Yoklama ise durumsuzdur ve hız sınırıyla kesilebilir. Veri zaten 20-60
 * saniyede bir tazeleniyor (cihaz gönderim aralığı), yani canlı bağlantının
 * kazandıracağı bir tazelik YOK.
 *
 * ═══ ARALIK NEDEN 20 SANİYE ═══
 *
 * Cihazlar tipik olarak ~30-60 sn'de bir nokta gönderiyor (ölçüldü). 20 sn,
 * yeni noktayı en geç bir gönderim gecikmesiyle yakalar; daha sık yoklamak
 * aynı noktayı tekrar tekrar çekmek olurdu. Sekme arkaplandayken yoklama
 * DURUR: kimsenin bakmadığı bir sayfa sunucu meşgul etmemeli.
 */

const YOKLAMA_MS = 20_000;

type Durum = TakipGorunum["durum"];

export function TakipClient({
  token,
  ilk,
}: {
  token: string;
  ilk: TakipGorunum;
}) {
  const t = useTranslations("takip");
  const [gorunum, setGorunum] = useState<TakipGorunum>(ilk);
  const [kapali, setKapali] = useState<TakipKapali | null>(null);
  const [sonTazeleme, setSonTazeleme] = useState<number>(() => Date.now());
  const bekleyenRef = useRef(false);

  const yokla = useCallback(async () => {
    if (bekleyenRef.current || document.visibilityState !== "visible") return;
    bekleyenRef.current = true;
    try {
      const r = await fetch(`/api/takip/${token}`, { cache: "no-store" });
      if (r.status === 429) return; // Sınır: bu turu atla, sonraki turda dene.
      const j = (await r.json()) as
        | ({ ok: true } & TakipGorunum)
        | { ok: false; sebep: TakipKapali };
      if (!j.ok) {
        setKapali(j.sebep);
        return;
      }
      // `ok` bayrağı taşıma katmanına ait; görünüm nesnesine girmez.
      const veri: TakipGorunum = {
        durum: j.durum,
        konum: j.konum,
        hedef: j.hedef,
        eta: j.eta,
        etaKaba: j.etaKaba,
        linkBitisISO: j.linkBitisISO,
        soforAdi: j.soforAdi,
        durakBagli: j.durakBagli,
        onunuzdeDurak: j.onunuzdeDurak,
        pencere: j.pencere,
      };
      setGorunum(veri);
      setSonTazeleme(Date.now());
    } catch {
      // Ağ hatası sayfayı bozmaz: eldeki son görünüm ekranda kalır.
    } finally {
      bekleyenRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (kapali) return;
    const id = setInterval(yokla, YOKLAMA_MS);
    const gorunurluk = () => {
      if (document.visibilityState === "visible") void yokla();
    };
    document.addEventListener("visibilitychange", gorunurluk);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", gorunurluk);
    };
  }, [yokla, kapali]);

  if (kapali) return <Kapandi sebep={kapali} />;

  const { durum, konum, hedef, eta, etaKaba, soforAdi, durakBagli, onunuzdeDurak, pencere } =
    gorunum;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <DurumBasligi durum={durum} eta={eta} durakBagli={durakBagli} />

      <div className="h-[46dvh] min-h-[260px] overflow-hidden rounded-2xl border border-border">
        <TakipMap
          arac={konum ? { lat: konum.lat, lng: konum.lng } : null}
          hedef={hedef}
          bayat={konum?.bayat ?? true}
        />
      </div>

      <dl className="grid gap-2 rounded-2xl border border-border p-4 text-sm">
        {eta && !eta.vardi && (
          <Satir
            ikon={<Clock className="size-4" />}
            etiket={t("eta_etiket")}
            deger={
              eta.ustSinirAsildi
                ? t("eta_uzun", { dk: eta.ustSinirDk })
                : t("eta_dakika", { dk: eta.dakika })
            }
          />
        )}
        {/*
          "ÖNÜNÜZDE N DURAK VAR" — Onfleet'in aynı öğesi. Sunucu eşiği (
          TAKIP_SIRA_ESIGI) geçmeyen değerde null gönderir; istemci gizlemez,
          alan HİÇ GELMEZ. Sıra numarası ve toplam durak sayısı ASLA yollanmıyor.
        */}
        {onunuzdeDurak !== null && (
          <Satir
            ikon={<ListOrdered className="size-4" />}
            etiket={t("sira_etiket")}
            deger={
              onunuzdeDurak === 0
                ? t("sira_siradaki")
                : t("sira_onunuzde", { n: onunuzdeDurak })
            }
          />
        )}
        {/* Müşterinin KENDİ durağının zaman penceresi — kendi kısıtı. */}
        {pencere && (pencere.bas || pencere.bit) && (
          <Satir
            ikon={<CalendarClock className="size-4" />}
            etiket={t("pencere_etiket")}
            deger={
              pencere.bas && pencere.bit
                ? t("pencere_arasi", { bas: pencere.bas.slice(0, 5), bit: pencere.bit.slice(0, 5) })
                : pencere.bit
                  ? t("pencere_once", { saat: pencere.bit.slice(0, 5) })
                  : t("pencere_sonra", { saat: pencere.bas!.slice(0, 5) })
            }
          />
        )}
        {konum && (
          <Satir
            ikon={konum.bayat ? <WifiOff className="size-4" /> : <Navigation className="size-4" />}
            etiket={t("guncelleme_etiket")}
            deger={konum.bayat ? t("konum_bayat") : t("konum_taze")}
          />
        )}
        {!konum && (
          <Satir
            ikon={<WifiOff className="size-4" />}
            etiket={t("guncelleme_etiket")}
            deger={t("konum_yok")}
          />
        )}
        {/* Şoför adı YALNIZ kiracı açtıysa sunucudan gelir (AT DSG §10). */}
        {soforAdi && (
          <Satir ikon={<MapPin className="size-4" />} etiket={t("sofor_etiket")} deger={soforAdi} />
        )}
      </dl>

      {/*
        KABA TAHMİN UYARISI — zincirde koordinatsız durak varsa. Sessiz kalmak,
        aynı güvende olmayan bir sayıyı aynı dille sunmak olurdu.
      */}
      {etaKaba && eta && !eta.vardi && (
        <p className="text-center text-xs text-muted-foreground">{t("eta_kaba")}</p>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {t("link_notu")}
        <span className="mx-1">·</span>
        <span className="nums">{new Date(sonTazeleme).toLocaleTimeString()}</span>
      </p>
    </div>
  );
}

function Satir({
  ikon,
  etiket,
  deger,
}: {
  ikon: React.ReactNode;
  etiket: string;
  deger: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {ikon}
        {etiket}
      </dt>
      <dd className="font-medium">{deger}</dd>
    </div>
  );
}

function DurumBasligi({
  durum,
  eta,
  durakBagli,
}: {
  durum: Durum;
  eta: TakipGorunum["eta"];
  /** Durak bazlı linkte başlık "sizin durağınız" dilini kullanır (083). */
  durakBagli: boolean;
}) {
  const t = useTranslations("takip");
  const vardi = durum === "vardi";
  return (
    <header className="flex flex-col gap-1 pt-2 text-center">
      <span
        className={`mx-auto flex size-11 items-center justify-center rounded-full ${
          vardi ? "bg-status-critical-soft text-status-critical-text" : "bg-accent-gold/15 text-accent-gold-text"
        }`}
      >
        {vardi ? <PackageCheck className="size-5" /> : <Navigation className="size-5" />}
      </span>
      <h1 className="text-xl font-semibold">
        {durakBagli && vardi ? t("durum_vardi_durak") : t(`durum_${durum}`)}
      </h1>
      <p className="text-sm text-muted-foreground">
        {vardi
          ? t(durakBagli ? "alt_vardi_durak" : "alt_vardi")
          : eta && !eta.ustSinirAsildi
            ? t("alt_eta", { dk: eta.dakika })
            : t("alt_yolda")}
      </p>
    </header>
  );
}

/**
 * ÖLÜ LİNK EKRANI.
 *
 * Dört sebep AYRI cümle: "yanlış kopyaladım" ile "süresi dolmuş" farklı
 * eylemler gerektirir (birinde linki tekrar iste, diğerinde yeni link iste).
 * Tek bir "geçersiz link" cümlesi müşteriyi kime ne soracağını bilmez hâlde
 * bırakırdı.
 */
export function Kapandi({ sebep }: { sebep: TakipKapali }) {
  const t = useTranslations("takip");
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WifiOff className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">{t(`kapali_${sebep}_baslik`)}</h1>
      <p className="text-sm text-muted-foreground">{t(`kapali_${sebep}_govde`)}</p>
    </div>
  );
}
