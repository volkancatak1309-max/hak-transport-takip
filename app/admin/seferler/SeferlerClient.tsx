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
import { formatDate, formatTime } from "@/lib/format";
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
                        {t(s.vehicle_id ? "eksik_bolge" : s.zone_id ? "eksik_arac" : "eksik_ikisi")}
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
  kapat,
  yenile,
}: {
  sefer: SeferSatir;
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
