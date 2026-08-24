"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Package, Truck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip, EmptyState, type ChipTone } from "@/components/ui-v2";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SoforSeferi } from "@/app/actions/seferler";

/**
 * ŞOFÖRÜN SEFER TAKVİMİ — /panel/seferler.
 *
 * ═══ NE DEĞİŞTİ ═══
 *
 * Bu ekran `assignments` (006) okuyordu ve o tablo canlıda BOŞ: şoför her
 * açtığında boş bir takvim görüyordu. Artık `seferler` (066) okunuyor.
 *
 * ═══ NEDEN TAKVİM KORUNDU ═══
 *
 * Eski ekranın AY IZGARASI iyi bir çözümdü ve şoför alışkanlığı orada: hangi
 * günlerde iş var, tek bakışta. Tabloyu değiştirmek görünümü değiştirmeyi
 * gerektirmiyordu — değişen VERİ KAYNAĞI, ekran dili değil.
 *
 * ═══ AY SUNUCUDAN GELİYOR ═══
 *
 * Ay değişince sunucuya yeni bir istek gidiyor (`?ay=YYYY-MM`). Tüm yılı
 * peşinen çekip istemcide süzmek, şoförün telefonunda kullanılmayacak yüzlerce
 * satır demekti; sefer verisi zaten aya göre okunuyor (listSeferByRange).
 */

const DURUM_TONU: Record<string, ChipTone> = {
  atandi: "neutral",
  kabul: "info",
  yolda: "active",
  tamamlandi: "neutral",
  iptal: "critical",
};

const pad = (n: number) => String(n).padStart(2, "0");

export function SeferTakvimiClient({
  ay,
  seferler,
  bugun,
}: {
  ay: string;
  seferler: SoforSeferi[];
  /** Sunucunun kiracı takvimindeki bugünü — istemci saatine güvenilmiyor. */
  bugun: string;
}) {
  const t = useTranslations("seferler");
  const locale = useLocale();
  const tag = locale === "de" ? "de-AT" : locale === "en" ? "en-GB" : "tr-TR";
  const router = useRouter();
  const [bekliyor, basla] = useTransition();

  const [yil, aySayi] = ay.split("-").map(Number);
  const [secili, setSecili] = useState(
    seferler.some((s) => s.tarih === bugun) ? bugun : (seferler[0]?.tarih ?? bugun)
  );

  const gunlere = useMemo(() => {
    const m = new Map<string, SoforSeferi[]>();
    for (const s of seferler) {
      const a = m.get(s.tarih) ?? [];
      a.push(s);
      m.set(s.tarih, a);
    }
    return m;
  }, [seferler]);

  // Pazartesi = 0 (Avusturya/Türkiye takvimi).
  const ilkGunSutun = (new Date(yil, aySayi - 1, 1).getDay() + 6) % 7;
  const gunSayisi = new Date(yil, aySayi, 0).getDate();

  const haftaGunleri = useMemo(() => {
    const pazartesi = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(tag, { weekday: "short" }).format(
        new Date(pazartesi.getFullYear(), pazartesi.getMonth(), pazartesi.getDate() + i)
      )
    );
  }, [tag]);

  const ayEtiketi = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(
    new Date(yil, aySayi - 1, 1)
  );

  function ayKaydir(delta: number) {
    const d = new Date(yil, aySayi - 1 + delta, 1);
    const yeni = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    basla(() => router.push(`/panel/seferler?ay=${yeni}`));
  }

  const seciliListe = gunlere.get(secili) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full"
          onClick={() => ayKaydir(-1)}
          disabled={bekliyor}
          aria-label={t("onceki_ay")}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <span className="font-semibold capitalize">{ayEtiketi}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full"
          onClick={() => ayKaydir(1)}
          disabled={bekliyor}
          aria-label={t("sonraki_ay")}
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {haftaGunleri.map((g) => (
          <span key={g} className="py-1 capitalize">
            {g}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: ilkGunSutun }, (_, i) => (
          <span key={`bos-${i}`} />
        ))}
        {Array.from({ length: gunSayisi }, (_, i) => {
          const gun = `${ay}-${pad(i + 1)}`;
          const adet = gunlere.get(gun)?.length ?? 0;
          const buGun = gun === bugun;
          return (
            <button
              key={gun}
              type="button"
              onClick={() => setSecili(gun)}
              className={cn(
                "relative flex h-11 flex-col items-center justify-center rounded-lg text-sm transition-colors",
                secili === gun ? "bg-accent-coral text-white" : "hover:bg-surface-2",
                buGun && secili !== gun && "ring-1 ring-accent-coral/50"
              )}
            >
              <span className="nums">{i + 1}</span>
              {/* Nokta = o gün sefer var. Sayı yazmak 11 hücrede okunmuyordu. */}
              {adet > 0 && (
                <span
                  className={cn(
                    "absolute bottom-1 size-1.5 rounded-full",
                    secili === gun ? "bg-white" : "bg-accent-coral"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {seciliListe.length === 0 ? (
        <EmptyState kind="none" title={t("sofor_bos_gun")} />
      ) : (
        <ul className="space-y-2">
          {seciliListe.map((s) => (
            <li key={s.id} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusChip tone={DURUM_TONU[s.durum] ?? "neutral"}>
                  {t(`durum_${s.durum}`)}
                </StatusChip>
                {s.vardi_at && (
                  <span className="nums text-xs text-muted-foreground">
                    {t("vardi", { saat: formatTime(s.vardi_at, locale) })}
                  </span>
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
                <span className="nums inline-flex items-center gap-1">
                  <Package className="size-3.5" />
                  {s.paket_gerceklesen ?? "—"}
                  {s.paket_hedef != null ? ` / ${s.paket_hedef}` : ""}
                </span>
              </div>
              {s.notlar && <p className="text-sm break-words">{s.notlar}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
