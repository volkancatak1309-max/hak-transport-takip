"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  MapPin,
  Clock,
  Timer,
  ShieldCheck,
  CheckCheck,
  Flag,
  SkipForward,
  Loader2,
  Navigation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip, type ChipTone } from "@/components/ui-v2";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getSoforDuraklari,
  durakIlerlet,
  type DurakGorunum,
  type DurakListesi,
} from "@/app/actions/duraklar";
import { TeslimatKanitiDialog } from "./TeslimatKanitiDialog";

/**
 * ŞOFÖRÜN DURAK LİSTESİ — /panel/seferler (migration 082).
 *
 * ═══ SIRADAKİ DURAK ÖNE ÇIKAR, LİSTE SIRASI BOZULMAZ ═══
 *
 * Satırlar 1..N sırasında duruyor ve sıradaki AÇIK durak vurgulanıyor. Sıradaki
 * durağı listenin başına taşımak daha "akıllı" görünürdü ama şoförün kafasındaki
 * sırayı bozardı: "3. durak" dediğimiz şey ekranda 1. satırda durursa, telefonla
 * konuşurken hangi durak olduğu karışır. Vurgu yeter.
 *
 * ═══ EYLEMLER DURUMA GÖRE ═══
 *
 * bekliyor → Vardım · Tamamlandı · Atla     (Tamamlandı doğrudan da basılabilir:
 *            şoför durakta "vardım"a basmadan işi bitirebilir ve o zaman varış
 *            damgası BOŞ kalır — ölçmediğimiz bir anı uydurmuyoruz.)
 * varildi  → Tamamlandı · Atla
 * kapalı   → eylem yok; damga ve sebep görünür.
 *
 * ⚠️ GERİ ALMA YOK. Yanlış basılan bir düğmeyi YÖNETİCİ düzeltir
 * (app/actions/duraklar.ts → durakDurumSifirla). Kendi damgasını silebilen bir
 * kayıt kanıt olmaktan çıkar.
 */

const DURUM_TONU: Record<string, ChipTone> = {
  bekliyor: "neutral",
  varildi: "info",
  tamamlandi: "neutral",
  atlandi: "warning",
};

export function DuraklarSoforBolumu({
  seferId,
  seferAcik,
  yenile,
}: {
  seferId: string;
  seferAcik: boolean;
  yenile: () => void;
}) {
  const t = useTranslations("duraklar");
  const locale = useLocale();
  const [liste, setListe] = useState<DurakListesi | null>(null);
  const [calisan, setCalisan] = useState<string | null>(null);
  const [atlanacak, setAtlanacak] = useState<DurakGorunum | null>(null);
  const [kanitDuragi, setKanitDuragi] = useState<DurakGorunum | null>(null);

  async function yukle() {
    setListe(await getSoforDuraklari(seferId));
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
    getSoforDuraklari(seferId).then((r) => {
      if (alive) setListe(r);
    });
    return () => {
      alive = false;
    };
  }, [seferId]);

  async function ilerlet(d: DurakGorunum, hedef: "varildi" | "tamamlandi" | "atlandi", sebep?: string) {
    setCalisan(d.id);
    const r = await durakIlerlet(d.id, hedef, sebep ?? null);
    setCalisan(null);
    if (r.ok) {
      toast.success(t(`ilerledi_${hedef}`));
      await yukle();
      yenile();
    } else {
      toast.error(t(`hata_${r.hata}`));
    }
  }

  if (liste === null) return <Skeleton className="h-20 w-full rounded-lg" />;
  // 082 yoksa bölüm HİÇ çıkmaz: şoföre "kapalı özellik" cümlesi göstermek,
  // yapabileceği bir şey olmayan bir uyarı olurdu. Sefer eski hâliyle çalışır.
  if (liste.tabloYok || liste.duraklar.length === 0) return null;

  const o = liste.ozet;
  const sonrakiId = o.sonraki?.id ?? null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("baslik")}</span>
        <StatusChip tone={o.biten === o.toplam ? "neutral" : "info"}>
          {t("ilerleme", { biten: o.biten, toplam: o.toplam })}
        </StatusChip>
      </div>

      {/*
        İLERLEME ÇUBUĞU — sayı tek başına "ne kadar kaldı" hissini vermiyor.
        Atlanan duraklar da BİTMİŞ sayılır (şoför oraya bir daha gitmeyecek) ama
        ayrı renkte: "7 tamam, 2 atlandı" tek çubukta okunur.
      */}
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={t("ilerleme", { biten: o.biten, toplam: o.toplam })}
      >
        <span
          className="bg-accent-coral"
          style={{ width: `${(o.tamamlanan / Math.max(1, o.toplam)) * 100}%` }}
        />
        <span
          className="bg-accent-gold"
          style={{ width: `${(o.atlanan / Math.max(1, o.toplam)) * 100}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {liste.duraklar.map((d) => {
          const sonraki = d.id === sonrakiId;
          const acik = d.durum === "bekliyor" || d.durum === "varildi";
          return (
            <li
              key={d.id}
              className={cn(
                "rounded-lg border p-2.5",
                sonraki ? "border-accent-coral bg-accent-coral/5" : "border-border"
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    "nums mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                    sonraki ? "bg-accent-coral text-white" : "bg-surface-2"
                  )}
                >
                  {d.sira}
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{d.ad}</span>
                    {sonraki && (
                      <StatusChip tone="active">
                        <Navigation className="mr-1 inline size-3" />
                        {t("sonraki")}
                      </StatusChip>
                    )}
                    {!sonraki && (
                      <StatusChip tone={DURUM_TONU[d.durum] ?? "neutral"}>
                        {t(`durum_${d.durum}`)}
                      </StatusChip>
                    )}
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
                  </div>

                  {d.varildi_at && (
                    <p className="nums text-xs text-muted-foreground">
                      {t(d.varis_kaynak === "otomatik" ? "vardi_oto" : "vardi_elle", {
                        saat: formatTime(d.varildi_at, locale),
                      })}
                    </p>
                  )}
                  {d.tamamlandi_at && (
                    <p className="nums text-xs text-muted-foreground">
                      {t("tamamlandi_saat", { saat: formatTime(d.tamamlandi_at, locale) })}
                    </p>
                  )}
                  {d.atlama_sebep && (
                    <p className="text-xs text-status-critical-text">
                      {t("atlama_sebebi", { sebep: d.atlama_sebep })}
                    </p>
                  )}
                  {d.notlar && <p className="text-xs break-words">{d.notlar}</p>}

                  {seferAcik && acik && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {d.durum === "bekliyor" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          disabled={calisan === d.id}
                          onClick={() => void ilerlet(d, "varildi")}
                        >
                          {calisan === d.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Flag className="size-4" />
                          )}
                          {t("eylem_varildi")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={calisan === d.id}
                        onClick={() => void ilerlet(d, "tamamlandi")}
                      >
                        <CheckCheck className="size-4" />
                        {t("eylem_tamamlandi")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={calisan === d.id}
                        onClick={() => setAtlanacak(d)}
                      >
                        <SkipForward className="size-4" />
                        {t("eylem_atla")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={calisan === d.id}
                        onClick={() => setKanitDuragi(d)}
                      >
                        <ShieldCheck className="size-4" />
                        {t("eylem_kanit")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {atlanacak && (
        <AtlamaKutusu
          durak={atlanacak}
          kapat={() => setAtlanacak(null)}
          onay={async (sebep) => {
            const d = atlanacak;
            setAtlanacak(null);
            await ilerlet(d, "atlandi", sebep);
          }}
        />
      )}

      {kanitDuragi && (
        <TeslimatKanitiDialog
          seferId={seferId}
          durakId={kanitDuragi.id}
          durakAd={kanitDuragi.ad}
          acik
          kapat={() => setKanitDuragi(null)}
          tamamlandi={() => {
            setKanitDuragi(null);
            void yukle();
            yenile();
          }}
        />
      )}
    </div>
  );
}

/**
 * ATLAMA SEBEBİ — zorunlu ve serbest metin.
 *
 * Hazır sebep listesi ("kapalı", "alıcı yok") DENENMEDİ çünkü liste her
 * kiracıda farklı olur ve eksik bir liste şoförü "diğer"e iter — o da hiçbir
 * şey anlatmayan bir kayıt üretir. Kısa serbest metin en az üç karakter
 * istiyor (kural sunucuda da var: lib/sefer-duraklari.ts).
 */
function AtlamaKutusu({
  durak,
  kapat,
  onay,
}: {
  durak: DurakGorunum;
  kapat: () => void;
  onay: (sebep: string) => void | Promise<void>;
}) {
  const t = useTranslations("duraklar");
  const [sebep, setSebep] = useState("");
  const [bekliyor, setBekliyor] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && !bekliyor && kapat()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("atla_baslik", { ad: durak.ad })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("atla_aciklama")}</p>
          <Textarea
            value={sebep}
            onChange={(e) => setSebep(e.target.value)}
            rows={3}
            placeholder={t("atla_ipucu")}
            autoFocus
          />
          <Button
            className="w-full"
            disabled={sebep.trim().length < 3 || bekliyor}
            onClick={async () => {
              setBekliyor(true);
              await onay(sebep.trim());
            }}
          >
            {bekliyor ? <Loader2 className="size-4 animate-spin" /> : <SkipForward className="size-4" />}
            {t("atla_onayla")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
