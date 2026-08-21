"use client";

import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PickableVehicle } from "@/lib/vehicles";

/**
 * ARAÇ SEÇİCİ LİSTESİ — şoförün "bugün hangi araçla çıkıyorum" ekranı.
 *
 * ── NEDEN AYRI BİLEŞEN (21.08.2026) ───────────────────────────────────────
 * Liste PanelClient'ın içinde düz bir <ul> olarak yaşıyordu ve 29 aracı
 * SIRF PLAKA SIRASINDA gösteriyordu: şoför listeye bakıp "hangisine
 * binebilirim" sorusunu cevaplayamıyordu. Meşgul araç yalnız sağdaki küçük
 * "kullanımda" rozetiyle belli oluyor, KİMİN kullandığı ise ancak araca
 * dokunduktan SONRA, uyarı diyaloğunda çıkıyordu. Yani bilgi, kararın
 * ARDINDAN geliyordu.
 *
 * ── KURAL: GRUPLAMA BİR ENGEL DEĞİL ───────────────────────────────────────
 * Meşgul araçlar listeden ÇIKARILMAZ ve tıklanabilir kalır. İki şoförün aynı
 * araca binmesi gerçek hayatta olur (devir teslim, arıza, ikinci sürücü) ve
 * panel bunu yasaklayacak yerde bilgilendirir — uyarı diyaloğu yerinde duruyor.
 * Değişen tek şey: bilgi artık karardan ÖNCE görünüyor.
 *
 * ── SUNUM KARARI, VERİ KARARI DEĞİL ───────────────────────────────────────
 * Gruplama ve sıralama BURADA yapılır; `listVehiclesForDriverPick` sözleşmesi
 * DEĞİŞMEDİ (sunucu hâlâ "kendi aracı önce, sonra plaka" sırasıyla döner ve
 * `.filter` kararlı olduğu için bu sıra grup içinde AYNEN korunur). Arama
 * kutusu da istemcide çalıştığı için gruplamanın istemcide olması doğru yer.
 */

/** Grup başlığı — etiket + sayaç. Sayaç "kaç araç boşta" sorusunu tek bakışta cevaplar. */
function GrupBasligi({ etiket, adet }: { etiket: string; adet: number }) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-1.5 pt-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {etiket}
      </h3>
      <span className="nums text-[11px] font-medium text-text-tertiary">{adet}</span>
    </div>
  );
}

/**
 * Tek araç satırı.
 *
 * `min-h-[56px]`: DESIGN.md §7 dokunma hedefi ≥44px — şoför paneli eldivenle
 * ve güneş altında kullanılıyor. İki satırlık içerik zaten 44'ü geçiyordu ama
 * kural artık ölçülebilir biçimde YAZILI: içerik kısalsa da satır küçülemez.
 *
 * Hizalama: solda plaka + marka/model (esneyen sütun), sağda kullanan kişi
 * (sabit sütun). İki sütun `justify-between` ile hizalandığı için isimler
 * satır satır aynı kenardan başlar — 29 satırlık listede göz taraması bunu
 * gerektirir.
 */
function AracSatiri({
  v,
  disabled,
  onPick,
  inUseLabel,
  ownLabel,
}: {
  v: PickableVehicle;
  disabled: boolean;
  onPick: (v: PickableVehicle) => void;
  inUseLabel: string;
  ownLabel: string;
}) {
  /**
   * İKİ ŞOFÖRLÜ ARAÇ — canlı HAK61 verisinde çıktı (21.08.2026, DO-282HF).
   * Adları virgülle birleştirmek 390px'de "Resul Demir, Musta…" gibi YARIM
   * bir isim üretiyordu; yarım isim, isim olmamasından kötüdür — okuyan onu
   * yanlış kişiye bağlar. Görünen: ilk isim + kalan sayı. Tamamı iki yerde
   * DURUYOR: ekran okuyucu metninde ve araca dokununca çıkan uyarı
   * diyaloğunda (v2VehicleBusyWarn zaten hepsini sayıyor).
   */
  const hepsi = v.inUseBy.join(", ");
  const kullanan =
    v.inUseBy.length > 1
      ? v.inUseBy[0] + " +" + (v.inUseBy.length - 1)
      : v.inUseBy[0] ?? "";
  const altSatir =
    ([v.make, v.model].filter(Boolean).join(" ") || "\u2014") +
    (v.isOwn ? " \u00b7 " + ownLabel : "");

  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(v)}
        disabled={disabled}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[10px] border border-border/70 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="nums block font-semibold leading-tight">{v.plate}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {altSatir}
          </span>
        </span>
        {kullanan && (
          /* Dolgu tonu ≠ metin tonu (DESIGN.md §8.3): zemin `accent-gold`in
             opak türevi, metin `accent-gold-text`. `accent-gold-soft` token'ı
             VAR ama @theme'e girmediği için Tailwind utility'si YOK — sınıf
             sessizce hiçbir şey yapardı (bkz. "claret-soft tuzağı"). */
          <span className="flex max-w-[48%] shrink-0 items-center gap-1.5 rounded-full bg-accent-gold/15 px-2.5 py-1 text-[11px] font-medium text-accent-gold-text">
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            {/* Grup başlığı ekranda "kullanımda" diyor, ama ekran okuyucu satırı
                başlıktan KOPUK okur — anlamın rengin/konumun üstünde de
                taşınması gerekiyor (DESIGN.md §7). */}
            <span className="sr-only">{inUseLabel}: {hepsi}. </span>
            <span className="truncate" aria-hidden>
              {kullanan}
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

export function VehiclePickerList({
  vehicles,
  disabled,
  onPick,
}: {
  vehicles: PickableVehicle[];
  disabled: boolean;
  onPick: (v: PickableVehicle) => void;
}) {
  const t = useTranslations("panel");
  const bosta = vehicles.filter((v) => v.inUseBy.length === 0);
  const kullanimda = vehicles.filter((v) => v.inUseBy.length > 0);

  const grup = (etiket: string, liste: PickableVehicle[]) =>
    liste.length === 0 ? null : (
      <div>
        <GrupBasligi etiket={etiket} adet={liste.length} />
        <ul className="space-y-1.5">
          {liste.map((v) => (
            <AracSatiri
              key={v.id}
              v={v}
              disabled={disabled}
              onPick={onPick}
              inUseLabel={t("v2VehicleInUse")}
              ownLabel={t("v2OwnVehicle")}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <div className="space-y-3">
      {/* BOŞTAKİLER ÜSTTE — şoförün varsayılan kararı burada. Boş grup başlığı
          hiç basılmaz; tek gruplu listede de başlık DURUR, çünkü "29 araç da
          boşta" bilgisinin kendisi bir cevaptır. */}
      {grup(t("v2VehicleGroupFree"), bosta)}
      {grup(t("v2VehicleGroupBusy"), kullanimda)}
    </div>
  );
}
