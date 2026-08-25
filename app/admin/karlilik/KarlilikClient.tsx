"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, TrendingUp, TrendingDown, CircleSlash, Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, StatusChip, SegmentedControl, type ChipTone } from "@/components/ui-v2";
import {
  gelirDuzelt,
  gelirEkle,
  gelirSil,
  seferOlculenMiktar,
  type KarlilikGorunum,
} from "@/app/actions/karlilik";
import { CrudSatirEylemleri } from "@/components/admin/CrudSatirEylemleri";
import { GELIR_MODELLERI, type GelirModeli } from "@/lib/karlilik";
import type { GelirSatiri, KarlilikSatiri } from "@/lib/karlilik";
import type { SeferKarlilikSatiri } from "@/lib/karlilik-db";

/**
 * KÂRLILIK EKRANI (085).
 *
 * ═══ "KATKI PAYI", "NET KÂR" DEĞİL — VE EKRAN BUNU SÖYLER ═══
 *
 * Araç sabit gideri sefere atfedilemiyor (gerekçe migration 085 başlığında).
 * Bu yüzden başlıktaki sayı katkı payıdır ve atfedilemeyen sabit gider AYRI
 * bir kartta, dağıtılmadan durur. Bu kart kaldırılırsa ekran yalan söylemeye
 * başlar: kullanıcı katkı payını net kâr sanar.
 */

const eur = (n: number) =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const eur2 = (n: number) =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(n);
const yuzde = (n: number | null) => (n === null ? "—" : `%${(n * 100).toFixed(0)}`);

type Eksen = "musteri" | "arac" | "sofor";

export function KarlilikClient({
  pano,
  yazabilir,
}: {
  pano: KarlilikGorunum;
  yazabilir: boolean;
}) {
  const t = useTranslations("karlilik");
  const [eksen, setEksen] = useState<Eksen>("musteri");

  if (pano.tabloYok) {
    return (
      <>
        <PageHeader title={t("title")} description={t("desc")} />
        <EmptyState kind="none" title={t("kapali_baslik")} hint={t("kapali_govde")} />
      </>
    );
  }

  const satirlar = pano[eksen];

  return (
    <>
      <PageHeader title={t("title")} description={t("desc")} />

      {/* ── ÜST ÖZET: üç sayı + atfedilemeyen kalem AYRI ───────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OzetKart etiket={t("gelir")} deger={eur(pano.toplam.gelirEur)} />
        <OzetKart etiket={t("maliyet_atfedilen")} deger={eur(pano.toplam.maliyetEur)} />
        <OzetKart
          etiket={t("katki_payi")}
          deger={eur(pano.toplam.katkiPayiEur)}
          vurgu={pano.toplam.katkiPayiEur < 0 ? "kotu" : "iyi"}
        />
        {/*
          ATFEDİLEMEYEN SABİT GİDER — bu kart ekranın dürüstlük sigortası.
          Rakama dâhil DEĞİL, ama görünür: "katkı payı net kâr değildir"
          cümlesinin sayısal karşılığı.
        */}
        <OzetKart
          etiket={t("atfedilemez")}
          deger={
            pano.toplam.atfedilemezSabitEur === null
              ? t("olculemedi")
              : eur(pano.toplam.atfedilemezSabitEur)
          }
          alt={t("atfedilemez_alt", { gun: pano.toplam.atfedilemezAracGun })}
          soluk
        />
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>{t("katki_payi_aciklama")}</span>
      </p>

      {/* ── KAPSAMA: kaç seferin geliri girilmiş ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground">
        <span className="nums">{t("kapsama", { gelirli: pano.gelirliSefer, toplam: pano.seferSayisi })}</span>
        <span>·</span>
        <span className="nums">
          {t("oran_satiri", {
            lkm: pano.oranlar.lPer100Km.toFixed(1),
            yakit: pano.oranlar.fuelEurPerL.toFixed(3),
            isci: pano.oranlar.laborEurPerHour.toFixed(2),
          })}
        </span>
        {pano.ratesTableMissing && (
          <StatusChip tone="warning">{t("oran_tablosu_yok")}</StatusChip>
        )}
      </div>

      {pano.seferSayisi === 0 ? (
        <EmptyState kind="none" title={t("sefer_yok_baslik")} hint={t("sefer_yok_govde")} />
      ) : (
        <>
          {/* ── UÇLAR ───────────────────────────────────────────────────── */}
          {/*
            SIRALAMADAN DÜŞEN SATIRLAR GÖRÜNÜR OLMALI. Ölçümü eksik müşteri
            uç listelerine girmiyor (katkı payı şişik olurdu); kaç tanesinin
            düştüğü yazılmazsa liste "hepsi bu" gibi okunur.
          */}
          {pano.ucDisiOlcumsuz > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("uc_disi", { n: pano.ucDisiOlcumsuz })}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <UcListesi
              baslik={t("en_karli")}
              ikon={<TrendingUp className="size-4" />}
              satirlar={pano.enKarli}
              bos={t("uc_bos")}
            />
            <UcListesi
              baslik={t("en_zararli")}
              ikon={<TrendingDown className="size-4" />}
              satirlar={pano.enZararli}
              bos={t("zarar_yok")}
              kotu
            />
          </div>

          {/* ── EKSEN TABLOSU ───────────────────────────────────────────── */}
          <div className="space-y-3">
            <SegmentedControl
              options={[
                { value: "musteri", label: t("eksen_musteri") },
                { value: "arac", label: t("eksen_arac") },
                { value: "sofor", label: t("eksen_sofor") },
              ]}
              value={eksen}
              onChange={(v) => setEksen(v as Eksen)}
            />
            <EksenTablosu satirlar={satirlar} />
          </div>

          {/* ── SEFER SATIRLARI ─────────────────────────────────────────── */}
          <SeferListesi satirlar={pano.satirlar} yazabilir={yazabilir} />
        </>
      )}
    </>
  );
}

function OzetKart({
  etiket,
  deger,
  alt,
  vurgu,
  soluk,
}: {
  etiket: string;
  deger: string;
  alt?: string;
  vurgu?: "iyi" | "kotu";
  soluk?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border p-4 ${soluk ? "bg-muted/20" : ""}`}>
      <div className="text-xs text-muted-foreground">{etiket}</div>
      <div
        className={`nums mt-1 text-xl font-semibold ${
          vurgu === "kotu" ? "text-destructive" : vurgu === "iyi" ? "text-primary" : ""
        }`}
      >
        {deger}
      </div>
      {alt && <div className="mt-1 text-xs text-muted-foreground">{alt}</div>}
    </div>
  );
}

function UcListesi({
  baslik,
  ikon,
  satirlar,
  bos,
  kotu,
}: {
  baslik: string;
  ikon: React.ReactNode;
  satirlar: KarlilikSatiri[];
  bos: string;
  kotu?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        {ikon}
        {baslik}
      </div>
      {satirlar.length === 0 ? (
        <p className="text-xs text-muted-foreground">{bos}</p>
      ) : (
        <ul className="space-y-2">
          {satirlar.map((s) => (
            <li key={s.id ?? s.ad} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{s.ad}</span>
              <span className={`nums shrink-0 font-medium ${kotu ? "text-destructive" : ""}`}>
                {eur(s.katkiPayiEur)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EksenTablosu({ satirlar }: { satirlar: KarlilikSatiri[] }) {
  const t = useTranslations("karlilik");
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="p-3 text-left font-medium">{t("kolon_ad")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_sefer")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_gelir")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_maliyet")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_katki")}</th>
            <th className="p-3 text-right font-medium">{t("kolon_marj")}</th>
            <th className="p-3 text-left font-medium">{t("kolon_kapsama")}</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.map((s) => (
            <tr key={s.id ?? s.ad} className="border-b border-border/60 last:border-0">
              <td className="p-3">{s.ad}</td>
              <td className="nums p-3 text-right">{s.seferSayisi}</td>
              <td className="nums p-3 text-right">{eur2(s.gelirEur)}</td>
              <td className="nums p-3 text-right">{eur2(s.maliyetEur)}</td>
              <td
                className={`nums p-3 text-right font-medium ${s.katkiPayiEur < 0 ? "text-destructive" : ""}`}
              >
                {eur2(s.katkiPayiEur)}
              </td>
              <td className="nums p-3 text-right">{yuzde(s.marj)}</td>
              {/*
                KAPSAMA KOLONU KIRPILAMAZ. Maliyeti hiç ölçülemeyen sefer
                sayısı burada durmazsa, satırın katkı payı "ölçülmüş" sanılır.
              */}
              <td className="p-3 text-xs text-muted-foreground">
                {s.maliyetsizSefer > 0 && (
                  <span className="mr-2 whitespace-nowrap">
                    {t("maliyetsiz", { n: s.maliyetsizSefer })}
                  </span>
                )}
                {s.eksikMaliyetliSefer > 0 && (
                  <span className="whitespace-nowrap">{t("eksik", { n: s.eksikMaliyetliSefer })}</span>
                )}
                {s.maliyetsizSefer === 0 && s.eksikMaliyetliSefer === 0 && t("tam")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const KM_DURUM_TON: Record<string, ChipTone> = {
  olculdu: "info",
  arac_yok: "neutral",
  pencere_yok: "neutral",
  uc_okumasi_yok: "warning",
  kenar_bayat: "warning",
  fark_yok: "warning",
};

function SeferListesi({
  satirlar,
  yazabilir,
}: {
  satirlar: SeferKarlilikSatiri[];
  yazabilir: boolean;
}) {
  const t = useTranslations("karlilik");
  const [acik, setAcik] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{t("seferler")}</h2>
      <ul className="space-y-2">
        {satirlar.map((r) => (
          <li key={r.seferId} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {r.musteriAd ?? t("musteri_yok")}
                </div>
                <div className="nums text-xs text-muted-foreground">
                  {r.tarih} · {r.plaka ?? t("arac_yok")} · {r.soforAd ?? "—"}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`nums text-sm font-semibold ${
                    (r.karlilik.katkiPayiEur ?? 0) < 0 ? "text-destructive" : ""
                  }`}
                >
                  {r.karlilik.katkiPayiEur === null ? t("olculemedi") : eur2(r.karlilik.katkiPayiEur)}
                </div>
                <div className="nums text-xs text-muted-foreground">
                  {t("gelir_kisa")} {eur2(r.karlilik.gelirEur)}
                </div>
              </div>
            </div>

            {/* ── MALİYET KIRILIMI — HER KALEM AYRI, DURUMUYLA ──────────── */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Kalem
                etiket={t("yakit")}
                kalem={r.karlilik.maliyet.yakit}
                olcumEtiketi={
                  r.kmOlcum.km !== null ? t("km_olcum", { km: r.kmOlcum.km }) : t(`km_${r.kmOlcum.durum}`)
                }
                ton={KM_DURUM_TON[r.kmOlcum.durum] ?? "neutral"}
              />
              <Kalem
                etiket={t("iscilik")}
                kalem={r.karlilik.maliyet.iscilik}
                olcumEtiketi={
                  r.karlilik.maliyet.iscilik.olcum !== null
                    ? t("saat_olcum", { saat: r.karlilik.maliyet.iscilik.olcum.toFixed(1) })
                    : t("pencere_yok_kisa")
                }
                ton={r.karlilik.maliyet.iscilik.durum === "olculdu" ? "info" : "neutral"}
              />
              {/* SABİT GİDER HER SEFERDE GÖRÜNÜR ve her seferde "atfedilemez" der. */}
              <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-muted-foreground">
                <CircleSlash className="size-3" />
                {t("sabit_atfedilemez")}
              </span>
              {r.saatTavanUygulandi && <StatusChip tone="warning">{t("azg_tavan")}</StatusChip>}
              {r.karlilik.eksikMaliyet && <StatusChip tone="warning">{t("eksik_maliyet")}</StatusChip>}
            </div>

            {/* ── GELİR SATIRLARI — her biri düzeltilebilir ve silinebilir ── */}
            {r.gelirler.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border/60 pt-2">
                {r.gelirler.map((g) => (
                  <GelirSatiriGorunum key={g.id} g={g} yazabilir={yazabilir} />
                ))}
              </ul>
            )}

            {yazabilir && (
              <div className="mt-3">
                {acik === r.seferId ? (
                  <GelirFormu seferId={r.seferId} kapat={() => setAcik(null)} />
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setAcik(r.seferId)}>
                    <Plus className="mr-1 size-3.5" />
                    {t("gelir_ekle")}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * TEK GELİR SATIRI — düzelt + sil.
 *
 * `lint:crud` haklı olarak buldu: yazma eylemi olan bir ekranda satırın geri
 * alınabilir olması gerekiyor. Yanlış girilmiş bir birim fiyat düzeltilemezse
 * müşteri kârlılığını kalıcı olarak bozar.
 */
function GelirSatiriGorunum({ g, yazabilir }: { g: GelirSatiri; yazabilir: boolean }) {
  const t = useTranslations("karlilik");
  const router = useRouter();
  const [duzenle, setDuzenle] = useState(false);
  const [bekle, basla] = useTransition();

  if (duzenle) {
    return (
      <li>
        <GelirFormu seferId="" duzeltId={g.id} baslangic={g} kapat={() => setDuzenle(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        {t(`model_${g.model}`)}
        {g.model !== "sefer" && (
          <>
            {" · "}
            <span className="nums">
              {g.miktar} × {eur2(g.birimFiyat)}
            </span>
          </>
        )}
        {g.durakId && <> · {t("durak_geliri")}</>}
        {g.miktarKaynak === "olculdu" && <StatusChip tone="info">{t("miktar_olculdu")}</StatusChip>}
      </span>
      <span className="flex items-center gap-2">
        <span className="nums font-medium">{eur2(g.tutarEur)}</span>
        {yazabilir && (
          <CrudSatirEylemleri
            adi={`${t(`model_${g.model}`)} ${eur2(g.tutarEur)}`}
            pending={bekle}
            onDuzenle={() => setDuzenle(true)}
            silmeAciklamasi={t("gelir_silme_aciklamasi")}
            onSil={() =>
              basla(async () => {
                const r = await gelirSil(g.id);
                if (!r.ok) toast.error(t("hata_hata"));
                else {
                  toast.success(t("gelir_silindi"));
                  router.refresh();
                }
              })
            }
          />
        )}
      </span>
    </li>
  );
}

function Kalem({
  etiket,
  kalem,
  olcumEtiketi,
  ton,
}: {
  etiket: string;
  kalem: { eur: number | null; durum: string };
  olcumEtiketi: string;
  ton: ChipTone;
}) {
  const t = useTranslations("karlilik");
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1">
      <span className="text-muted-foreground">{etiket}</span>
      <span className="nums font-medium">{kalem.eur === null ? t("olculemedi") : eur2(kalem.eur)}</span>
      <StatusChip tone={ton}>{olcumEtiketi}</StatusChip>
    </span>
  );
}

/**
 * GELİR FORMU.
 *
 * Miktar ÖLÇÜLEBİLİYORSA butonla doldurulur ve kayıt `miktar_kaynak='olculdu'`
 * olur. Ölçülemiyorsa buton sayı YAZMAZ — kullanıcı elle girer ve kaynak
 * 'elle' kalır. Ölçülemeyeni 0 ile doldurmak, tahmini ölçüm kılığına sokardı.
 */
function GelirFormu({
  seferId,
  kapat,
  duzeltId,
  baslangic,
}: {
  seferId: string;
  kapat: () => void;
  /** Verilirse form DÜZELTME modundadır: yeni satır yazmaz, mevcudu günceller. */
  duzeltId?: string;
  baslangic?: GelirSatiri;
}) {
  const t = useTranslations("karlilik");
  const router = useRouter();
  const [model, setModel] = useState<GelirModeli>(baslangic?.model ?? "sefer");
  const [fiyat, setFiyat] = useState(baslangic ? String(baslangic.birimFiyat) : "");
  const [miktar, setMiktar] = useState(baslangic ? String(baslangic.miktar) : "1");
  const [kaynak, setKaynak] = useState<"elle" | "olculdu">(baslangic?.miktarKaynak ?? "elle");
  const [bekle, basla] = useTransition();

  const onizleme = useMemo(() => {
    const f = Number(fiyat.replace(",", "."));
    const m = model === "sefer" ? 1 : Number(miktar.replace(",", "."));
    if (!Number.isFinite(f) || !Number.isFinite(m) || f < 0 || m < 0) return null;
    return Math.round(f * m * 100) / 100;
  }, [fiyat, miktar, model]);

  const olc = () =>
    basla(async () => {
      const o = await seferOlculenMiktar(seferId);
      const deger = model === "km" ? o.km : model === "saat" ? o.saat : model === "paket" ? o.paket : null;
      if (deger === null) {
        // ÖLÇÜLEMEDİ → alan DEĞİŞMEZ, kaynak 'elle' kalır.
        toast.error(t("olculemedi_uyari"));
        return;
      }
      setMiktar(String(deger));
      setKaynak("olculdu");
    });

  const kaydet = () =>
    basla(async () => {
      const govde = {
        model,
        birimFiyat: Number(fiyat.replace(",", ".")),
        miktar: Number(miktar.replace(",", ".")),
        miktarKaynak: kaynak,
      };
      const r = duzeltId ? await gelirDuzelt(duzeltId, govde) : await gelirEkle({ seferId, ...govde });
      if (!r.ok) {
        /**
         * next-intl EKSİK ANAHTARDA FIRLATIR — "fallback" seçeneği yok.
         * Bilinen hata kodları burada beyaz listede; tanınmayan kod genel
         * mesaja düşer. Aksi hâlde sunucudan gelen yeni bir kod ekranı
         * çökertirdi.
         */
        const BILINEN = ["tablo_yok", "model_gecersiz", "fiyat_gecersiz", "miktar_gecersiz"];
        toast.error(BILINEN.includes(r.hata) ? t(`hata_${r.hata}` as never) : t("hata_hata"));
        return;
      }
      toast.success(
        t(duzeltId ? "gelir_duzeltildi" : "gelir_kaydedildi", { tutar: eur2(r.tutar ?? 0) })
      );
      kapat();
      router.refresh();
    });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap gap-2">
        {GELIR_MODELLERI.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={model === m ? "default" : "outline"}
            onClick={() => {
              setModel(m);
              setKaynak("elle");
              setMiktar(m === "sefer" ? "1" : "");
            }}
          >
            {t(`model_${m}`)}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t(`birim_${model}`)}</span>
          <Input
            inputMode="decimal"
            value={fiyat}
            onChange={(e) => setFiyat(e.target.value)}
            placeholder="0,00"
          />
        </label>
        {model !== "sefer" && (
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("miktar")}</span>
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                value={miktar}
                onChange={(e) => {
                  setMiktar(e.target.value);
                  setKaynak("elle");
                }}
                placeholder="0"
              />
              {/* Düzeltme modunda sefer kimliği taşınmıyor → ölçüm düğmesi yok. */}
              {!duzeltId && (
                <Button size="sm" variant="outline" onClick={olc} disabled={bekle}>
                  {t("olc")}
                </Button>
              )}
            </div>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="nums text-sm">
          {t("onizleme")}{" "}
          <strong>{onizleme === null ? "—" : eur2(onizleme)}</strong>
          {kaynak === "olculdu" && <StatusChip tone="info">{t("miktar_olculdu")}</StatusChip>}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={kapat}>
            {t("vazgec")}
          </Button>
          <Button size="sm" onClick={kaydet} disabled={bekle || onizleme === null}>
            {bekle && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            {t("kaydet")}
          </Button>
        </div>
      </div>
    </div>
  );
}
