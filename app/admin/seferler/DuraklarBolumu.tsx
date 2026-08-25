"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  ArrowUp,
  ArrowDown,
  MapPin,
  Clock,
  Timer,
  ShieldCheck,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip, EmptyState, type ChipTone } from "@/components/ui-v2";
import { CrudSatirEylemleri } from "@/components/admin/CrudSatirEylemleri";
import { formatTime } from "@/lib/format";
import {
  getSeferDuraklari,
  durakEkle,
  durakGuncelle,
  durakSil,
  duraklariSirala,
  durakDurumSifirla,
  type DurakGorunum,
  type DurakListesi,
} from "@/app/actions/duraklar";
import type { SeferSecenekleri } from "@/app/actions/seferler";

/**
 * SEFERİN DURAKLARI — yönetici/şef yüzeyi (migration 082).
 *
 * ═══ NEDEN SÜRÜKLE-BIRAK DEĞİL, YUKARI/AŞAĞI ═══
 *
 * Sıralama iki düğmeyle yapılıyor. Sürükle-bırak dokunmatikte kaydırma
 * hareketiyle çakışır (yöneticiler bu ekranı tablette de açıyor), klavye ve
 * ekran okuyucuyla erişilemez ve tek bir listede 80 satırda hedef bulmayı
 * zorlaştırır. İki düğme her girdi biçiminde çalışır ve her hareket TEK bir
 * sunucu çağrısı — kısmi bir sürükleme yarım sıralama bırakmaz.
 *
 * ═══ NEDEN İSTEK ÜZERİNE YÜKLENİYOR ═══
 *
 * Sefer listesindeki her satır için duraklarını peşinen çekmek, hiç
 * açılmayacak onlarca listeyi indirmek olurdu. Detay açılınca bir kez yükleniyor
 * (teslimat kanıtı bölümüyle aynı desen).
 */

const GeofencePickerMap = dynamic(
  () => import("@/components/GeofencePickerMap").then((m) => m.GeofencePickerMap),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);

const DURUM_TONU: Record<string, ChipTone> = {
  bekliyor: "neutral",
  varildi: "info",
  tamamlandi: "neutral",
  atlandi: "warning",
};

export function DuraklarBolumu({
  seferId,
  seferAcik,
  secenekler,
  yenile,
}: {
  seferId: string;
  /** Kapanmış seferde durak EKLENMEZ/DÜZENLENMEZ — plan bitmiş bir günü değiştiremez. */
  seferAcik: boolean;
  secenekler: SeferSecenekleri;
  yenile: () => void;
}) {
  const t = useTranslations("duraklar");
  const [liste, setListe] = useState<DurakListesi | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);
  const [formAcik, setFormAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<DurakGorunum | null>(null);
  const [, basla] = useTransition();

  async function yukle() {
    const r = await getSeferDuraklari(seferId);
    setListe(r);
  }

  /**
   * İLK YÜKLEME.
   *
   * ⚠️ `setState` EFEKT GÖVDESİNDE ÇAĞRILMIYOR, yalnız `.then` içinde —
   * `react-hooks/set-state-in-effect` kuralı senkron çağrıyı hata sayıyor ve bu
   * depoda o kuralın sayısı ARTIRILMAMALI (CLAUDE.md: ESLint tabanı).
   * `alive` bayrağı sökülmüş bileşene yazmayı da engelliyor
   * (components/admin/EditWorkerDialog.tsx ile aynı desen).
   */
  useEffect(() => {
    let alive = true;
    getSeferDuraklari(seferId).then((r) => {
      if (alive) setListe(r);
    });
    return () => {
      alive = false;
    };
  }, [seferId]);

  async function calistir(is: () => Promise<{ ok: boolean; hata?: string }>) {
    setCalisiyor(true);
    const r = await is();
    setCalisiyor(false);
    if (r.ok) {
      await yukle();
      basla(yenile);
    } else {
      toast.error(t(`hata_${r.hata ?? "hata"}`));
    }
    return r.ok;
  }

  async function tasi(i: number, yon: -1 | 1) {
    if (!liste) return;
    const sirali = liste.duraklar.map((d) => d.id);
    const hedef = i + yon;
    if (hedef < 0 || hedef >= sirali.length) return;
    [sirali[i], sirali[hedef]] = [sirali[hedef], sirali[i]];
    await calistir(() => duraklariSirala(seferId, sirali));
  }

  if (liste === null) {
    return (
      <div className="rounded-xl border border-border p-3">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (liste.tabloYok) {
    return (
      <div className="rounded-xl border border-border p-3">
        <span className="text-sm font-medium">{t("baslik")}</span>
        <p className="mt-1 text-xs text-muted-foreground">{t("kapali")}</p>
      </div>
    );
  }

  const o = liste.ozet;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("baslik")}</span>
        <div className="flex items-center gap-2">
          {o.toplam > 0 && (
            <StatusChip tone={o.biten === o.toplam ? "neutral" : "info"}>
              {t("ilerleme", { biten: o.biten, toplam: o.toplam })}
            </StatusChip>
          )}
          {seferAcik && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={calisiyor}
              onClick={() => {
                setDuzenlenen(null);
                setFormAcik(true);
              }}
            >
              <Plus className="size-3.5" />
              {t("ekle")}
            </Button>
          )}
        </div>
      </div>

      {/* Atlanan durak sayısı AYRI: "7/12 bitti" içinde saklı kalmasın. */}
      {o.atlanan > 0 && (
        <p className="text-xs text-status-critical-text">{t("atlanan_ozet", { n: o.atlanan })}</p>
      )}

      {liste.duraklar.length === 0 ? (
        <EmptyState kind="none" title={t("bos")} hint={seferAcik ? t("bos_ipucu") : undefined} />
      ) : (
        <ol className="space-y-2">
          {liste.duraklar.map((d, i) => (
            <li key={d.id} className="rounded-lg border border-border p-2.5">
              <div className="flex items-start gap-2">
                <span className="nums mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium">
                  {d.sira}
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{d.ad}</span>
                    <StatusChip tone={DURUM_TONU[d.durum] ?? "neutral"}>
                      {t(`durum_${d.durum}`)}
                    </StatusChip>
                    {d.kanitVar && (
                      <StatusChip tone="info">
                        <ShieldCheck className="mr-1 inline size-3" />
                        {t("kanit")}
                      </StatusChip>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {d.bolge_ad ?? d.adres ?? t("hedef_yok")}
                    </span>
                    {(d.pencere_bas || d.pencere_bit) && (
                      <span className="nums inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {(d.pencere_bas ?? "").slice(0, 5)}
                        {d.pencere_bit ? `–${d.pencere_bit.slice(0, 5)}` : "+"}
                      </span>
                    )}
                    {d.tahmini_sure_dk != null && (
                      <span className="nums inline-flex items-center gap-1">
                        <Timer className="size-3" />
                        {t("sure_dk", { n: d.tahmini_sure_dk })}
                      </span>
                    )}
                    {d.varildi_at && (
                      <span className="nums">
                        {t(d.varis_kaynak === "otomatik" ? "vardi_oto" : "vardi_elle", {
                          saat: formatTime(d.varildi_at),
                        })}
                      </span>
                    )}
                  </div>

                  {/*
                    OTOMATİK VARIŞ UYARISI — yalnız adı olan durakta.
                    Yönetici "neden damga düşmedi" diye sormadan ÖNCE bilsin;
                    sebep koordinatın olmaması ve bu düzeltilebilir bir eksik.
                  */}
                  {!d.zone_id && (d.latitude === null || d.longitude === null) && (
                    <p className="flex items-start gap-1 text-xs text-status-critical-text">
                      <TriangleAlert className="mt-px size-3 shrink-0" />
                      {t("oto_varis_yok")}
                    </p>
                  )}

                  {d.atlama_sebep && (
                    <p className="text-xs text-status-critical-text">
                      {t("atlama_sebebi", { sebep: d.atlama_sebep })}
                    </p>
                  )}
                  {d.notlar && <p className="text-xs break-words">{d.notlar}</p>}
                </div>

                {seferAcik && (
                  <span className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={calisiyor || i === 0}
                      onClick={() => void tasi(i, -1)}
                      aria-label={t("yukari")}
                      title={t("yukari")}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={calisiyor || i === liste.duraklar.length - 1}
                      onClick={() => void tasi(i, 1)}
                      aria-label={t("asagi")}
                      title={t("asagi")}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <CrudSatirEylemleri
                      adi={d.ad}
                      pending={calisiyor}
                      onDuzenle={() => {
                        setDuzenlenen(d);
                        setFormAcik(true);
                      }}
                      onSil={async () => {
                        await calistir(() => durakSil(d.id));
                      }}
                      silmeAciklamasi={d.kanitVar ? t("sil_kanitli") : t("sil_aciklama")}
                    />
                  </span>
                )}
              </div>

              {/*
                YÖNETİCİ DÜZELTMESİ — yalnız kapanmış durakta çıkar.
                Şoför ileri gider, yönetici düzeltir: yanlış basılmış bir
                "tamamlandı" kullanıcıyı kendi hatasına kilitlememeli.
              */}
              {seferAcik && d.durum !== "bekliyor" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-7 px-2 text-xs"
                  disabled={calisiyor}
                  onClick={() => void calistir(() => durakDurumSifirla(d.id))}
                >
                  <RotateCcw className="size-3.5" />
                  {t("sifirla")}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}

      {formAcik && (
        <DurakFormu
          acik
          mevcut={duzenlenen}
          secenekler={secenekler}
          kapat={() => setFormAcik(false)}
          kaydet={async (girdi) => {
            const ok = await calistir(() =>
              duzenlenen ? durakGuncelle(duzenlenen.id, girdi) : durakEkle(seferId, girdi)
            );
            if (ok) {
              toast.success(t(duzenlenen ? "guncellendi" : "eklendi"));
              setFormAcik(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ── DURAK FORMU ───────────────────────────────────────────────────────────

type Girdi = Parameters<typeof durakEkle>[1];

/**
 * HEDEF İKİ BİÇİMDEN BİRİ — Samsara'nın Address / singleUseLocation ayrımı.
 *
 * Aynı anda ikisi birden dolduralamaz: hangisinin gerçek hedef olduğu belirsiz
 * kalırdı. Sekme değiştirmek diğer biçimin alanlarını GÖRÜNMEZ yapıyor ve
 * kaydederken sunucu da (lib/sefer-duraklari.ts `satiraCevir`) diğerini
 * temizliyor — kural iki katmanda birden.
 */
function DurakFormu({
  acik,
  mevcut,
  secenekler,
  kapat,
  kaydet,
}: {
  acik: boolean;
  mevcut: DurakGorunum | null;
  secenekler: SeferSecenekleri;
  kapat: () => void;
  kaydet: (girdi: Girdi) => Promise<void>;
}) {
  const t = useTranslations("duraklar");
  const [bicim, setBicim] = useState<"bolge" | "serbest">(
    mevcut && !mevcut.zone_id ? "serbest" : "bolge"
  );
  const [ad, setAd] = useState(mevcut?.ad ?? "");
  const [bolge, setBolge] = useState(mevcut?.zone_id ?? "");
  const [adres, setAdres] = useState(mevcut?.adres ?? "");
  const [lat, setLat] = useState(mevcut?.latitude != null ? String(mevcut.latitude) : "");
  const [lng, setLng] = useState(mevcut?.longitude != null ? String(mevcut.longitude) : "");
  const [yaricap, setYaricap] = useState(String(mevcut?.yaricap_m ?? 150));
  const [pBas, setPBas] = useState((mevcut?.pencere_bas ?? "").slice(0, 5));
  const [pBit, setPBit] = useState((mevcut?.pencere_bit ?? "").slice(0, 5));
  const [sure, setSure] = useState(mevcut?.tahmini_sure_dk != null ? String(mevcut.tahmini_sure_dk) : "");
  const [not, setNot] = useState(mevcut?.notlar ?? "");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const konum: [number, number] | null =
    lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? [Number(lat), Number(lng)]
      : null;

  /** Bölge seçilince ad boşsa bölgenin adı yazılır — yazmayı kısaltır, kilitlemez. */
  function bolgeSec(id: string) {
    setBolge(id);
    const s = secenekler.bolgeler.find((b) => b.id === id);
    if (s && !ad.trim()) setAd(s.ad);
  }

  async function gonder() {
    if (!ad.trim()) return;
    setGonderiliyor(true);
    await kaydet({
      ad: ad.trim(),
      zoneId: bicim === "bolge" ? bolge || null : null,
      adres: bicim === "serbest" ? adres.trim() || null : null,
      latitude: bicim === "serbest" && lat ? Number(lat) : null,
      longitude: bicim === "serbest" && lng ? Number(lng) : null,
      yaricapM: bicim === "serbest" ? Number(yaricap) || 150 : null,
      pencereBas: pBas || null,
      pencereBit: pBit || null,
      tahminiSureDk: sure ? Number(sure) : null,
      notlar: not.trim() || null,
    });
    setGonderiliyor(false);
  }

  return (
    <Dialog open={acik} onOpenChange={(o) => !o && kapat()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(mevcut ? "duzenle_baslik" : "ekle_baslik")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="durak-ad" className="text-sm">
              {t("ad")}
              <span className="ml-1 text-accent-coral">*</span>
            </Label>
            <Input
              id="durak-ad"
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              placeholder={t("ad_ipucu")}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">{t("hedef")}</Label>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
              {(["bolge", "serbest"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBicim(b)}
                  className={`h-9 rounded-md text-sm transition-colors ${
                    bicim === b ? "bg-accent-coral text-white" : "hover:bg-surface-1"
                  }`}
                >
                  {t(`bicim_${b}`)}
                </button>
              ))}
            </div>

            {bicim === "bolge" ? (
              <Select value={bolge} onValueChange={(v) => v && bolgeSec(v)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={t("bolge_sec")}>
                    {secenekler.bolgeler.find((b) => b.id === bolge)?.ad ?? t("bolge_sec")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {secenekler.bolgeler.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.ad}
                      {b.ikincil && (
                        <span className="ml-2 text-xs text-muted-foreground">{b.ikincil}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-2">
                <Input
                  value={adres}
                  onChange={(e) => setAdres(e.target.value)}
                  placeholder={t("adres_ipucu")}
                  className="h-11"
                />
                {/*
                  ADRES JEOKODLANMAZ (082 başlığı §3). Koordinat haritadan
                  tıklanarak alınıyor — Samsara'nın singleUseLocation'ı da
                  koordinatı çağırandan ister. Metin bir ETİKET, koordinat
                  bir ÖLÇÜM.
                */}
                <p className="text-xs text-muted-foreground">{t("harita_ipucu")}</p>
                <div className="h-[220px] w-full overflow-hidden rounded-[12px] border border-border">
                  <GeofencePickerMap
                    key={mevcut?.id ?? "yeni"}
                    center={konum}
                    radius={Number(yaricap) || 0}
                    onPick={(la, ln) => {
                      setLat(la.toFixed(6));
                      setLng(ln.toFixed(6));
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    inputMode="decimal"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder={t("lat")}
                    className="h-10"
                  />
                  <Input
                    inputMode="decimal"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    placeholder={t("lng")}
                    className="h-10"
                  />
                  <Input
                    type="number"
                    min={50}
                    max={5000}
                    value={yaricap}
                    onChange={(e) => setYaricap(e.target.value)}
                    placeholder={t("yaricap")}
                    className="h-10"
                  />
                </div>
                {!konum && <p className="text-xs text-status-critical-text">{t("oto_varis_yok")}</p>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("pencere_bas")}</Label>
              <Input type="time" value={pBas} onChange={(e) => setPBas(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("pencere_bit")}</Label>
              <Input type="time" value={pBit} onChange={(e) => setPBit(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sure")}</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={sure}
                onChange={(e) => setSure(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">{t("not")}</Label>
            <Textarea value={not} onChange={(e) => setNot(e.target.value)} rows={2} />
          </div>

          <Button onClick={gonder} disabled={!ad.trim() || gonderiliyor} className="w-full">
            {gonderiliyor ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t(mevcut ? "guncelle" : "kaydet")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
