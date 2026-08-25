"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Loader2,
  BellRing,
  BellOff,
  Microscope,
  CircleSlash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, EmptyState, StatusChip, type ChipTone } from "@/components/ui-v2";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  haftalikAksiyonKapat,
  type AksiyonGorunum,
  type HaftalikPanel,
} from "@/app/actions/haftalik-aksiyon";

/**
 * HAFTALIK AKSİYON PANELİ — yönetici ekranı (084).
 *
 * ═══ TASARIM KARARI: KANIT HER SATIRDA, GİZLİ DEĞİL ═══
 *
 * "Ölçülen · eşik" çifti kalemin ALTINDA, açılır bir kutunun içinde değil.
 * Gerekçe ürünün kendisi: bu bir yapay zeka önerisi değil, bir KURAL çıktısı.
 * Kullanıcı sayıyı görmeden kalemi ciddiye almaz; tıklayarak açması gereken
 * bir gerekçe, olmayan bir gerekçeyle aynı işi görür.
 *
 * ═══ NEDEN "İLGİSİZ" SEBEP SORUYOR AMA ZORUNLU TUTMUYOR ═══
 *
 * Sebep, kuralın kalibrasyonu için tek geri bildirim kanalı ("bu araç yedek,
 * hep park hâlinde"). Zorunlu kılmak kapatmayı yavaşlatır ve kullanıcı boş
 * geçmek için anlamsız bir şey yazar — zorunlu alanın klasik bedeli.
 */

const DURUM_TONU: Record<string, ChipTone> = {
  acik: "warning",
  yapildi: "neutral",
  ilgisiz: "neutral",
};

export function HaftalikClient({ panel }: { panel: HaftalikPanel }) {
  const t = useTranslations("haftalik");
  const router = useRouter();
  const [bekliyor, basla] = useTransition();
  const [calisan, setCalisan] = useState<string | null>(null);
  const [ilgisizKalem, setIlgisizKalem] = useState<AksiyonGorunum | null>(null);
  const [taramaAcik, setTaramaAcik] = useState(false);

  async function kapat(a: AksiyonGorunum, durum: "yapildi" | "ilgisiz", not?: string) {
    setCalisan(a.id);
    const r = await haftalikAksiyonKapat(a.id, durum, not ?? null);
    setCalisan(null);
    if (r.ok) {
      toast.success(t(durum === "yapildi" ? "kapatildi_yapildi" : "kapatildi_ilgisiz"));
      basla(() => router.refresh());
    } else {
      toast.error(t(`hata_${r.hata}`));
    }
  }

  if (panel.tabloYok) {
    return (
      <>
        <PageHeader title={t("title")} description={t("desc")} />
        <EmptyState kind="none" title={t("kapali_baslik")} hint={t("kapali_govde")} />
      </>
    );
  }

  const tur = panel.tur;
  const acik = panel.aksiyonlar.filter((a) => a.durum === "acik");
  const kapali = panel.aksiyonlar.filter((a) => a.durum !== "acik");

  // Hafta gezinmesi — liste yeniden eskiye sıralı geliyor.
  const idx = tur ? panel.haftalar.findIndex((h) => h.haftaBasi === tur.haftaBasi) : -1;
  const oncekiHafta = idx >= 0 ? panel.haftalar[idx + 1]?.haftaBasi : panel.haftalar[0]?.haftaBasi;
  const sonrakiHafta = idx > 0 ? panel.haftalar[idx - 1]?.haftaBasi : undefined;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={panel.fleet ? t("desc_chief", { fleet: panel.fleet }) : t("desc")}
      />

      {/* HAFTA GEZİNMESİ — geçmiş, özelliğin vaadinin parçası. */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!oncekiHafta || bekliyor}
          onClick={() => oncekiHafta && router.push(`/admin/haftalik?hafta=${oncekiHafta}`)}
        >
          <ChevronLeft className="size-4" />
          {t("onceki_hafta")}
        </Button>
        <span className="text-sm font-medium">
          {tur ? t("hafta_basligi", { tarih: formatDate(tur.haftaBasi) }) : t("hafta_yok")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!sonrakiHafta || bekliyor}
          onClick={() => sonrakiHafta && router.push(`/admin/haftalik?hafta=${sonrakiHafta}`)}
        >
          {t("sonraki_hafta")}
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {!tur ? (
        <EmptyState kind="none" title={t("tur_yok_baslik")} hint={t("tur_yok_govde")} />
      ) : (
        <>
          {/* TUR KÜNYESİ — üretim anı ve bildirim akıbeti. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground">
            <span className="nums">{t("uretildi", { an: formatDateTime(tur.uretildiAt) })}</span>
            <span>·</span>
            <span className="nums">
              {t("kalem_sayisi", { n: tur.aksiyonSayisi, tavan: panel.tavan })}
            </span>
            {tur.elenenSayisi > 0 && (
              <>
                <span>·</span>
                <span className="nums">{t("elenen", { n: tur.elenenSayisi })}</span>
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-1">
              {/*
                BİLDİRİM AKIBETİ AÇIKÇA YAZILIYOR. Ölçüldü ki HAK61'de kayıtlı
                push jetonu SIFIR — "gönderildi" demek yalan olurdu. Panel kaç
                yöneticiye, kaç CİHAZA gittiğini söylüyor.
              */}
              {/*
                ÜÇ DURUM, İKİ DEĞİL. NULL = gönderim hiç DENENMEDİ (turu cron
                dışı bir yol üretti). Bunu "kayıtlı cihaz yok" diye göstermek
                denenmemiş işi başarısız iş gibi okutuyordu — QA'da yakalandı.
              */}
              {tur.bildirimAlici === null ? (
                <>
                  <BellOff className="size-3.5" />
                  {t("bildirim_denenmedi")}
                </>
              ) : (tur.bildirimJeton ?? 0) > 0 ? (
                <>
                  <BellRing className="size-3.5" />
                  {t("bildirim_gitti", { alici: tur.bildirimAlici, jeton: tur.bildirimJeton ?? 0 })}
                </>
              ) : (
                <>
                  <BellOff className="size-3.5" />
                  {t("bildirim_gitmedi", { alici: tur.bildirimAlici })}
                </>
              )}
            </span>
          </div>

          {acik.length === 0 && kapali.length === 0 ? (
            <EmptyState kind="none" title={t("temiz_baslik")} hint={t("temiz_govde")} />
          ) : (
            <ul className="space-y-3">
              {acik.map((a) => (
                <AksiyonSatiri
                  key={a.id}
                  a={a}
                  calisiyor={calisan === a.id}
                  onYapildi={() => void kapat(a, "yapildi")}
                  onIlgisiz={() => setIlgisizKalem(a)}
                />
              ))}
            </ul>
          )}

          {kapali.length > 0 && (
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("kapananlar", { n: kapali.length })}
              </summary>
              <ul className="mt-3 space-y-3">
                {kapali.map((a) => (
                  <AksiyonSatiri key={a.id} a={a} calisiyor={false} />
                ))}
              </ul>
            </details>
          )}

          {/* TARAMA — "kural çalışmadı" ile "eşiği geçen yok" ayrımı. */}
          <div className="rounded-xl border border-border p-3">
            <button
              type="button"
              onClick={() => setTaramaAcik((o) => !o)}
              className="flex w-full items-center gap-2 text-sm font-medium"
            >
              <Microscope className="size-4" />
              {t("tarama_baslik")}
              <ChevronRight
                className={`ml-auto size-4 transition-transform ${taramaAcik ? "rotate-90" : ""}`}
              />
            </button>
            {taramaAcik && (
              <>
                <p className="mt-2 text-xs text-muted-foreground">{t("tarama_aciklama")}</p>
                <ul className="mt-2 space-y-1.5 text-xs">
                  {Object.entries(tur.tarama).map(([kural, v]) => (
                    <li key={kural} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t(`kural_${kural}`)}</span>
                      {v?.atlandi ? (
                        <StatusChip tone="critical">
                          <CircleSlash className="mr-1 inline size-3" />
                          {t("tarama_atlandi", { sebep: v.atlandi })}
                        </StatusChip>
                      ) : (
                        <span className="nums text-muted-foreground">
                          {t("tarama_satir", { aday: v?.aday ?? 0, gecen: v?.gecen ?? 0, esik: v?.esik ?? "" })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      {ilgisizKalem && (
        <IlgisizKutusu
          kalem={ilgisizKalem}
          susturmaGun={panel.susturmaGun}
          kapat={() => setIlgisizKalem(null)}
          onay={async (not) => {
            const k = ilgisizKalem;
            setIlgisizKalem(null);
            await kapat(k, "ilgisiz", not);
          }}
        />
      )}
    </>
  );
}

// ── SATIR ─────────────────────────────────────────────────────────────────

function AksiyonSatiri({
  a,
  calisiyor,
  onYapildi,
  onIlgisiz,
}: {
  a: AksiyonGorunum;
  calisiyor: boolean;
  onYapildi?: () => void;
  onIlgisiz?: () => void;
}) {
  const t = useTranslations("haftalik");
  const kanit = a.kanit as { olculen?: unknown; esik?: unknown; birim?: unknown };
  const acik = a.durum === "acik";

  return (
    <li className={`space-y-2 rounded-xl border p-3 ${acik ? "border-border" : "border-border/60 opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={DURUM_TONU[a.durum] ?? "neutral"}>{t(`durum_${a.durum}`)}</StatusChip>
        <StatusChip tone="info">{t(`kural_${a.kural}`)}</StatusChip>
        <span className="nums ml-auto text-xs text-muted-foreground">
          {t("oncelik", { n: a.oncelik })}
        </span>
      </div>

      <p className="font-medium break-words">{a.baslik}</p>
      <p className="text-sm text-muted-foreground break-words">{a.gerekce}</p>

      {/*
        KANIT ŞERİDİ — "16,3 ölçüldü · eşik 14,2 L/100km".
        Açıklanabilirliğin ekrandaki karşılığı; gizlenmiyor (bileşen başlığı).
      */}
      {kanit.olculen !== undefined && kanit.esik !== undefined && (
        <p className="nums inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs">
          {t("kanit", {
            olculen: String(kanit.olculen),
            esik: String(kanit.esik),
            birim: String(kanit.birim ?? ""),
          })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {a.hedefYol && (
          <Link
            href={a.hedefYol}
            className="btn-outline-ring inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm transition-colors hover:bg-surface-2"
          >
            {a.ozneAd ? t("hedefe_git_ad", { ad: a.ozneAd }) : t("hedefe_git")}
            <ChevronRight className="size-4" />
          </Link>
        )}
        {acik && onYapildi && (
          <Button size="sm" className="h-9" disabled={calisiyor} onClick={onYapildi}>
            {calisiyor ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t("yaptim")}
          </Button>
        )}
        {acik && onIlgisiz && (
          <Button size="sm" variant="outline" className="h-9" disabled={calisiyor} onClick={onIlgisiz}>
            <X className="size-4" />
            {t("ilgisiz")}
          </Button>
        )}
      </div>

      {!acik && a.kapatildiAt && (
        <p className="text-xs text-muted-foreground">
          {t("kapatma_izi", { an: formatDateTime(a.kapatildiAt) })}
          {a.kapatmaNotu ? ` — ${a.kapatmaNotu}` : ""}
          {a.susturmaBitis ? ` · ${t("susturma_bitis", { an: formatDateTime(a.susturmaBitis) })}` : ""}
        </p>
      )}
    </li>
  );
}

// ── "İLGİSİZ" KUTUSU ──────────────────────────────────────────────────────

function IlgisizKutusu({
  kalem,
  susturmaGun,
  kapat,
  onay,
}: {
  kalem: AksiyonGorunum;
  susturmaGun: number;
  kapat: () => void;
  onay: (not: string) => void | Promise<void>;
}) {
  const t = useTranslations("haftalik");
  const [not, setNot] = useState("");
  const [bekliyor, setBekliyor] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && !bekliyor && kapat()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("ilgisiz_baslik")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("ilgisiz_aciklama", { gun: susturmaGun })}
          </p>
          <p className="rounded-lg bg-surface-2 p-2.5 text-xs">{kalem.baslik}</p>
          <Textarea
            value={not}
            onChange={(e) => setNot(e.target.value)}
            rows={3}
            placeholder={t("ilgisiz_ipucu")}
            autoFocus
          />
          <Button
            className="w-full"
            disabled={bekliyor}
            onClick={async () => {
              setBekliyor(true);
              await onay(not.trim());
            }}
          >
            {bekliyor ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            {t("ilgisiz_onayla")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
