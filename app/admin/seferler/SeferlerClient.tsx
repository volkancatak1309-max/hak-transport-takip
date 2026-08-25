"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Link2,
  Copy,
  Ban,
  Truck,
  MapPin,
  Package,
  ChevronRight,
  ExternalLink,
  TriangleAlert,
  ListOrdered,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, EmptyState, StatusChip, type ChipTone } from "@/components/ui-v2";
import { formatDate, formatTime, formatDateTime } from "@/lib/format";
import {
  seferOlustur,
  seferIptalEt,
  takipLinkiUret,
  takipLinkleriGetir,
  takipLinkiIptalEt,
  type SeferGunu,
  type SeferSecenekleri,
  type SeferSatir,
  type TakipLinkGorunum,
} from "@/app/actions/seferler";
import { getSeferTeslimatlari, teslimatIptalEt, type KanitGorunum } from "@/app/actions/teslimat";
import { DuraklarBolumu } from "./DuraklarBolumu";
import { ImzaGoster } from "@/components/teslimat/ImzaPad";

/**
 * GÜNÜN SEFERLERİ — yönetici/şef ekranı.
 *
 * ═══ TASARIM KARARI: ARAÇ VE HEDEF "ZORUNLU DEĞİL AMA GÖRÜNÜR EKSİK" ═══
 *
 * İkisi de opsiyonel (sabah atamasında araç belli olmayabilir). Ama ikisi
 * dolu değilse takip linki üretilemez ve bu, link düğmesi tıklanınca değil
 * SATIRDA söyleniyor: eksik alan bir rozetle görünür ve düğme baştan pasif.
 * "Tıkla, hata al" akışı yöneticiye neyi düzeltmesi gerektiğini bir tık geç
 * söylerdi.
 */

const DURUM_TONU: Record<string, ChipTone> = {
  atandi: "neutral",
  kabul: "info",
  // "tamamlandi" için yeşil bir ton YOK: bu palette başarı rengi bulunmuyor
  // (DESIGN.md §2.3 — bordo/mavi filo kimliği, altın uyarı, kritik kırmızı).
  // Kapanmış sefer nötr durur; vurgulanacak olan açık seferlerdir.
  tamamlandi: "neutral",
  yolda: "info",
  iptal: "critical",
};

export function SeferlerClient({
  gun,
  secenekler,
}: {
  gun: SeferGunu;
  secenekler: SeferSecenekleri;
}) {
  const t = useTranslations("seferler");
  const router = useRouter();
  const [bekliyor, basla] = useTransition();
  const [formAcik, setFormAcik] = useState(false);
  const [acikSefer, setAcikSefer] = useState<SeferSatir | null>(null);

  function gunDegistir(yeni: string) {
    router.push(`/admin/seferler?tarih=${yeni}`);
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        description={
          gun.fleet ? t("desc_chief", { fleet: gun.fleet }) : t("desc")
        }
        action={
          <Button onClick={() => setFormAcik(true)} disabled={bekliyor}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <Label htmlFor="gun" className="text-sm text-muted-foreground">
          {t("day")}
        </Label>
        <Input
          id="gun"
          type="date"
          value={gun.tarih}
          onChange={(e) => e.target.value && gunDegistir(e.target.value)}
          className="h-10 w-44"
        />
        <span className="text-sm text-muted-foreground">
          {t("count", { n: gun.seferler.length })}
        </span>
      </div>

      {gun.seferler.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_desc")} />
      ) : (
        <ul className="space-y-2">
          {gun.seferler.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setAcikSefer(s)}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-surface-2/60"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.sofor_ad}</span>
                    <StatusChip tone={DURUM_TONU[s.durum] ?? "neutral"}>
                      {t(`durum_${s.durum}`)}
                    </StatusChip>
                    {!s.takip_uygun && s.durum !== "iptal" && s.durum !== "tamamlandi" && (
                      <StatusChip tone="warning">
                        <TriangleAlert className="mr-1 inline size-3" />
                        {t(s.vehicle_id ? "eksik_bolge" : s.hedef_var ? "eksik_arac" : "eksik_ikisi")}
                      </StatusChip>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Truck className="size-3.5" />
                      {s.arac_plaka ?? t("yok")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {s.bolge_ad ?? t("yok")}
                    </span>
                    <span className="inline-flex items-center gap-1 nums">
                      <Package className="size-3.5" />
                      {s.paket_gerceklesen ?? "—"}
                      {s.paket_hedef != null ? ` / ${s.paket_hedef}` : ""}
                    </span>
                    {s.vardi_at && (
                      <span className="nums">{t("vardi", { saat: formatTime(s.vardi_at) })}</span>
                    )}
                    {/*
                      DURAK İLERLEMESİ (082) — "7/12". Sıradaki durağın adı da
                      burada: yönetici listeyi açmadan "araç şu an nereye
                      gidiyor" sorusunu cevaplayabilsin.
                    */}
                    {s.ilerleme.toplam > 0 && (
                      <span className="nums inline-flex items-center gap-1">
                        <ListOrdered className="size-3.5" />
                        {t("durak_ilerleme", {
                          biten: s.ilerleme.biten,
                          toplam: s.ilerleme.toplam,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SeferFormu
        acik={formAcik}
        kapat={() => setFormAcik(false)}
        tarih={gun.tarih}
        secenekler={secenekler}
        onTamam={() => {
          setFormAcik(false);
          basla(() => router.refresh());
        }}
      />

      {acikSefer && (
        <SeferDetayi
          sefer={acikSefer}
          secenekler={secenekler}
          kapat={() => setAcikSefer(null)}
          yenile={() => basla(() => router.refresh())}
        />
      )}
    </>
  );
}

// ── YENİ SEFER ────────────────────────────────────────────────────────────

function SeferFormu({
  acik,
  kapat,
  tarih,
  secenekler,
  onTamam,
}: {
  acik: boolean;
  kapat: () => void;
  tarih: string;
  secenekler: SeferSecenekleri;
  onTamam: () => void;
}) {
  const t = useTranslations("seferler");
  const [sofor, setSofor] = useState("");
  const [arac, setArac] = useState("");
  const [bolge, setBolge] = useState("");
  const [hedef, setHedef] = useState("");
  const [not, setNot] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const takipHazir = Boolean(arac && bolge);

  async function gonder() {
    if (!sofor) return;
    setGonderiliyor(true);
    const r = await seferOlustur({
      tarih,
      worker_id: sofor,
      vehicle_id: arac || null,
      zone_id: bolge || null,
      paket_hedef: hedef ? Number(hedef) : null,
      notlar: not || null,
    });
    setGonderiliyor(false);
    if (r.ok) {
      toast.success(t("olusturuldu"));
      // Hedef seçildiği hâlde durak yazılamadıysa SESSİZ KALMA: sefer açıldı
      // ama hedefsiz kaldı ve yönetici bunu ancak listede fark ederdi.
      if (bolge && r.durakKuruldu === false) toast.warning(t("durak_kurulamadi"));
      setSofor("");
      setArac("");
      setBolge("");
      setHedef("");
      setNot("");
      onTamam();
    } else {
      toast.error(t(`hata_${r.hata}`));
    }
  }

  return (
    <Dialog open={acik} onOpenChange={(o) => !o && kapat()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("new_title", { tarih: formatDate(tarih) })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Alan etiket={t("sofor")} zorunlu>
            <Secici
              deger={sofor}
              setDeger={setSofor}
              secenekler={secenekler.soforler}
              yer={t("sofor_sec")}
            />
          </Alan>

          <Alan etiket={t("arac")}>
            <Secici
              deger={arac}
              setDeger={setArac}
              secenekler={secenekler.araclar}
              yer={t("arac_sec")}
            />
          </Alan>

          <Alan etiket={t("bolge")}>
            <Secici
              deger={bolge}
              setDeger={setBolge}
              secenekler={secenekler.bolgeler}
              yer={t("bolge_sec")}
            />
          </Alan>

          {/*
            TAKİP UYARISI — form doldurulurken, gönderildikten sonra değil.
            Yönetici "bu seferi müşteriye gösteremeyeceğim"i seçim anında
            bilmeli; sonradan söylemek ikinci bir düzenleme turu demek.
          */}
          <p
            className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
              takipHazir
                ? "bg-accent-gold/10 text-muted-foreground"
                : "bg-status-critical-soft text-status-critical-text"
            }`}
          >
            {takipHazir ? <Link2 className="mt-px size-3.5 shrink-0" /> : <TriangleAlert className="mt-px size-3.5 shrink-0" />}
            {takipHazir ? t("takip_hazir", { dk: secenekler.takipTtlDk }) : t("takip_eksik")}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Alan etiket={t("paket_hedef")}>
              <Input
                type="number"
                min={0}
                value={hedef}
                onChange={(e) => setHedef(e.target.value)}
                className="h-11"
              />
            </Alan>
          </div>

          <Alan etiket={t("notlar")}>
            <Textarea value={not} onChange={(e) => setNot(e.target.value)} rows={2} />
          </Alan>

          <Button onClick={gonder} disabled={!sofor || gonderiliyor} className="w-full">
            {gonderiliyor ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t("olustur")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Alan({
  etiket,
  zorunlu,
  children,
}: {
  etiket: string;
  zorunlu?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {etiket}
        {zorunlu && <span className="ml-1 text-accent-coral">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Secici({
  deger,
  setDeger,
  secenekler,
  yer,
}: {
  deger: string;
  setDeger: (v: string) => void;
  secenekler: { id: string; ad: string; ikincil?: string | null }[];
  yer: string;
}) {
  return (
    <Select value={deger} onValueChange={(v) => v && setDeger(v)}>
      <SelectTrigger className="h-11">
        <SelectValue placeholder={yer}>
          {secenekler.find((s) => s.id === deger)?.ad ?? yer}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {secenekler.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.ad}
            {s.ikincil && <span className="ml-2 text-xs text-muted-foreground">{s.ikincil}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── SEFER DETAYI + TAKİP LİNKLERİ ─────────────────────────────────────────

function SeferDetayi({
  sefer,
  secenekler,
  kapat,
  yenile,
}: {
  sefer: SeferSatir;
  secenekler: SeferSecenekleri;
  kapat: () => void;
  yenile: () => void;
}) {
  const t = useTranslations("seferler");
  const [linkler, setLinkler] = useState<TakipLinkGorunum[] | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  const acik = sefer.durum !== "tamamlandi" && sefer.durum !== "iptal";

  async function linkleriYukle() {
    const r = await takipLinkleriGetir(sefer.id);
    setLinkler(r.linkler);
  }

  async function uret() {
    setCalisiyor(true);
    const r = await takipLinkiUret(sefer.id, null);
    setCalisiyor(false);
    if (r.ok) {
      toast.success(t("link_uretildi"));
      await navigator.clipboard.writeText(r.link.url).catch(() => {});
      await linkleriYukle();
      yenile();
    } else {
      toast.error(t(`link_hata_${r.hata}`));
    }
  }

  async function linkIptal(id: string) {
    setCalisiyor(true);
    const r = await takipLinkiIptalEt(sefer.id, id);
    setCalisiyor(false);
    if (r.ok) {
      toast.success(t("link_iptal_edildi"));
      await linkleriYukle();
    } else toast.error(t("link_hata_hata"));
  }

  async function seferIptal() {
    setCalisiyor(true);
    const r = await seferIptalEt(sefer.id);
    setCalisiyor(false);
    if (r.ok) {
      toast.success(t("iptal_edildi"));
      kapat();
      yenile();
    } else toast.error(t(`hata_${r.hata}`));
  }

  // Durum çizgisi — damgasıyla. Sefer akışı 066'daki sıra.
  const cizgi: [string, string | null][] = [
    ["atandi", sefer.atandi_at],
    ["kabul", sefer.kabul_at],
    ["yolda", sefer.yolda_at],
    ["vardi", sefer.vardi_at],
    ["tamamlandi", sefer.tamamlandi_at],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && kapat()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sefer.sofor_ad}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <ol className="space-y-2">
            {cizgi.map(([ad, an]) => (
              <li key={ad} className="flex items-center gap-3 text-sm">
                <span
                  className={`size-2 shrink-0 rounded-full ${an ? "bg-accent-coral" : "bg-border"}`}
                />
                <span className={an ? "" : "text-muted-foreground"}>{t(`adim_${ad}`)}</span>
                <span className="ml-auto nums text-xs text-muted-foreground">
                  {an ? formatTime(an) : "—"}
                </span>
              </li>
            ))}
            {sefer.iptal_at && (
              <li className="flex items-center gap-3 text-sm text-status-critical-text">
                <span className="size-2 shrink-0 rounded-full bg-status-critical-text" />
                {t("adim_iptal")}
                <span className="ml-auto nums text-xs">{formatTime(sefer.iptal_at)}</span>
              </li>
            )}
          </ol>

          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{t("takip_linkleri")}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={uret}
                disabled={!acik || !sefer.takip_uygun || calisiyor}
              >
                <Link2 className="size-3.5" />
                {t("link_uret")}
              </Button>
            </div>

            {!sefer.takip_uygun && (
              <p className="text-xs text-status-critical-text">{t("takip_eksik")}</p>
            )}

            {linkler === null ? (
              <Button size="sm" variant="ghost" onClick={linkleriYukle} className="h-7 px-2 text-xs">
                {t("linkleri_goster")}
              </Button>
            ) : linkler.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("link_yok")}</p>
            ) : (
              <ul className="space-y-2">
                {linkler.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-xs">
                    <span className={l.iptalEdildi ? "text-muted-foreground line-through" : ""}>
                      {t("link_bitis", { saat: formatTime(l.bitis) })}
                    </span>
                    <span className="nums text-muted-foreground">
                      {t("link_acilma", { n: l.acilma })}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => {
                          void navigator.clipboard.writeText(l.url);
                          toast.success(t("kopyalandi"));
                        }}
                        disabled={l.iptalEdildi}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2"
                        aria-label={t("link_ac")}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => linkIptal(l.id)}
                        disabled={l.iptalEdildi || calisiyor}
                      >
                        <Ban className="size-3.5" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/*
            DURAKLAR — takip linklerinden ÖNCE. Sıra anlamlı: link üretmeden
            önce yöneticinin hedefi kurmuş olması gerekiyor ve "eksik hedef"
            uyarısının cevabı bu bölümde.
          */}
          <DuraklarBolumu
            seferId={sefer.id}
            seferAcik={acik}
            secenekler={secenekler}
            yenile={yenile}
          />

          <TeslimatKaniti seferId={sefer.id} />

          {acik && (
            <Button variant="outline" onClick={seferIptal} disabled={calisiyor} className="w-full">
              {calisiyor ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              {t("seferi_iptal_et")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── TESLİMAT KANITI (ePOD) ────────────────────────────────────────────────

/**
 * Seferin teslimat kanıtları — yönetici görünümü.
 *
 * ═══ NEDEN İSTEK ÜZERİNE YÜKLENİYOR ═══
 *
 * Kanıt okuması fotoğraflar için İMZALI URL üretiyor (Storage'a ayrı bir
 * çağrı). Sefer listesindeki her satır için peşinen yapmak, hiç açılmayacak
 * onlarca kanıt için imza üretmek olurdu. Detay açılınca bir kez yükleniyor.
 *
 * ═══ İPTAL — SİLME DEĞİL ═══
 *
 * Yanlış bir kanıt kayıttan çıkarılmaz, SEBEBİYLE geçersiz ilan edilir.
 * Veritabanı da aynı şeyi söylüyor: 080'deki tetikleyici kanıt satırının
 * güncellenmesine yalnız iptal alanları için izin veriyor.
 */
function TeslimatKaniti({ seferId }: { seferId: string }) {
  const t = useTranslations("teslimat");
  const [kanitlar, setKanitlar] = useState<KanitGorunum[] | null>(null);
  const [tabloYok, setTabloYok] = useState(false);
  const [calisiyor, setCalisiyor] = useState(false);

  async function yukle() {
    setCalisiyor(true);
    const r = await getSeferTeslimatlari(seferId);
    setKanitlar(r.kanitlar);
    setTabloYok(r.tabloYok);
    setCalisiyor(false);
  }

  async function iptal(id: string) {
    const sebep = window.prompt(t("iptal_sebep_sor"));
    if (!sebep || sebep.trim().length < 3) return;
    setCalisiyor(true);
    const r = await teslimatIptalEt(id, sebep);
    setCalisiyor(false);
    if (r.ok) {
      toast.success(t("iptal_edildi"));
      await yukle();
    } else toast.error(t("iptal_hata"));
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{t("baslik")}</span>
        {kanitlar === null && (
          <Button size="sm" variant="ghost" onClick={yukle} disabled={calisiyor} className="h-7 px-2 text-xs">
            {calisiyor ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("goster")}
          </Button>
        )}
      </div>

      {tabloYok && <p className="text-xs text-muted-foreground">{t("kapali")}</p>}

      {kanitlar !== null && kanitlar.length === 0 && !tabloYok && (
        <p className="text-xs text-muted-foreground">{t("kanit_yok")}</p>
      )}

      {kanitlar?.map((k) => (
        <div key={k.id} className="space-y-2 border-t border-border pt-2 first:border-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="nums font-medium">{formatDateTime(k.teslimAt)}</span>
            {k.iptalAt ? (
              <StatusChip tone="critical">{t("iptalli")}</StatusChip>
            ) : (
              <StatusChip tone="info">{t("gecerli")}</StatusChip>
            )}
            {k.latitude != null && k.longitude != null && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${k.latitude}&mlon=${k.longitude}#map=17/${k.latitude}/${k.longitude}`}
                target="_blank"
                rel="noreferrer noopener"
                className="nums inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:underline"
              >
                <MapPin className="size-3" />
                {k.latitude.toFixed(4)}, {k.longitude.toFixed(4)}
                {k.dogrulukM != null ? ` ±${Math.round(k.dogrulukM)} m` : ""}
              </a>
            )}
          </div>

          {k.iptalSebep && (
            <p className="text-xs text-status-critical-text">{t("iptal_sebebi", { sebep: k.iptalSebep })}</p>
          )}
          {k.aliciAd && <p className="text-sm">{t("alici_satir", { ad: k.aliciAd })}</p>}
          {k.notlar && <p className="text-sm break-words text-muted-foreground">{k.notlar}</p>}

          {k.imzaSvg && (
            <div className="rounded-lg border border-border bg-surface-2 p-2">
              <ImzaGoster d={k.imzaSvg} className="h-20 w-full text-foreground" />
            </div>
          )}

          {k.fotograflar.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {k.fotograflar.map((f, i) =>
                f.url ? (
                  <a
                    key={f.id}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block size-16 overflow-hidden rounded-lg border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- imzalı URL, Next optimizasyonu özel kovaya erişemez */}
                    <img src={f.url} alt={t("foto_no", { n: i + 1 })} className="size-full object-cover" />
                  </a>
                ) : null
              )}
            </div>
          )}

          {!k.iptalAt && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => iptal(k.id)}
              disabled={calisiyor}
              className="h-7 px-2 text-xs text-status-critical-text"
            >
              <Ban className="size-3.5" />
              {t("iptal_et")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
