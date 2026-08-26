"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Info, Loader2, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, StatusChip } from "@/components/ui-v2";
import {
  saklamaAyarKaydet,
  silmeOnIzleme,
  hazirlikYurut,
  araligiSil,
  type OnIzleme,
  type SaklamaPanosu,
} from "@/app/actions/saklama";
import {
  SIL_ONAY_METNI,
  SEBEP_MIN_UZUNLUK,
  UYARI_GUN_MAX,
  UYARI_GUN_MIN,
  VARSAYILAN_UYARI_GUN,
  uyariVarMi,
  type AralikTuru,
} from "@/lib/saklama";
import type { HamTablo } from "@/lib/saklama-db";

/**
 * SAKLAMA EKRANI (090).
 *
 * ═══ 🔴 OTOMATİK SİLME YOK — BU EKRAN TEK SİLME YOLU ═══
 *
 * Sistem yalnız UYARIR. Silmeye yönetici karar verir: aralığı kendisi seçer,
 * önce kuru modda sayıyı görür, sonra kutuya elle "SIL" yazar ve sebep
 * girer. Her silme denetim izine yazılır.
 *
 * ═══ DÖRT ŞEY KALDIRILAMAZ ═══
 *
 * 1. UYARI, yasal çıpa DOĞRULANMAMIŞSA SAYI YAZMAZ. "Doğrulanmadı" demek,
 *    uydurma bir gün sayısı yazmaktan iyidir — yanlış sayı DACH müşterisine
 *    giderse sorumluluk doğar.
 * 2. 'yasal_zorunlu' veri için SİLME SEÇENEĞİ RENDER EDİLMEZ. Reddetmek bir
 *    hatadır ve hata mesajı okunmayabilir; göstermemek bir tasarımdır.
 * 3. ÇİFT ONAY. Birinci ayak kuru modun sayısı, ikinci ayak elle yazılan
 *    "SIL". Tek tıkla geri alınamaz bir iş yapılmaz.
 * 4. DENETİM İZİ EKRANDA. "Kim ne zaman ne sildi" sorusunun cevabı ürünün
 *    içinde durmalı.
 */

const say = (n: number) => new Intl.NumberFormat("de-AT").format(n);
const gun = (iso: string) => iso.slice(0, 10);

export function SaklamaClient({ pano }: { pano: SaklamaPanosu }) {
  const t = useTranslations("retention");

  const [uyariGun, setUyariGun] = useState(pano.ayar.uyariGun);
  const [ulkeKodu, setUlkeKodu] = useState(pano.ayar.ulkeKodu);
  const [gerekce, setGerekce] = useState(pano.ayar.gerekce ?? "");
  const [kaydetBekle, kaydetBasla] = useTransition();

  const ilkTablo = pano.silinebilirTablolar[0]?.tablo ?? null;
  const [tablo, setTablo] = useState<HamTablo | null>(ilkTablo);
  const [tur, setTur] = useState<AralikTuru>("ay");
  const [referans, setReferans] = useState("");
  const [bas, setBas] = useState("");
  const [bit, setBit] = useState("");

  const [onIzleme, setOnIzleme] = useState<OnIzleme | null>(null);
  const [onizBekle, onizBasla] = useTransition();
  const [hazirlikBekle, hazirlikBasla] = useTransition();

  const [sebep, setSebep] = useState("");
  const [onay, setOnay] = useState("");
  const [silBekle, silBasla] = useTransition();

  const aralikGirdisi = { tur, referans: referans || undefined, bas: bas || undefined, bit: bit || undefined };

  const kaydet = () =>
    kaydetBasla(async () => {
      const r = await saklamaAyarKaydet({ uyariGun, ulkeKodu, gerekce: gerekce.trim() || null });
      if (r.ok) toast.success(t("saved"));
      else toast.error(t(`error_${r.hata}` as never));
    });

  const onizle = () =>
    onizBasla(async () => {
      if (!tablo) return;
      const r = await silmeOnIzleme({ tablo, ...aralikGirdisi });
      setOnIzleme(r);
      // Aralık değişti → önceki onay geçersiz. Yeniden yazılmalı.
      setOnay("");
      if (!r.ok) toast.error(t(`error_${r.hata}` as never));
    });

  const hazirla = () =>
    hazirlikBasla(async () => {
      const r = await hazirlikYurut(aralikGirdisi);
      if (!r.ok) {
        toast.error(r.hata ?? t("error_hata"));
        return;
      }
      toast.success(t("prep_done", { months: r.ozetYazilan.length, shifts: r.kmDondurulan }));
      if (tablo) setOnIzleme(await silmeOnIzleme({ tablo, ...aralikGirdisi }));
    });

  const sil = () =>
    silBasla(async () => {
      if (!tablo) return;
      const r = await araligiSil({ tablo, ...aralikGirdisi, sebep, onayMetni: onay });
      if (!r.ok) {
        toast.error(t(`blocked_${r.kapi.engel ?? "hata"}` as never));
        return;
      }
      toast.success(t("deleted", { rows: say(r.silinen) }));
      setOnIzleme(null);
      setOnay("");
      setSebep("");
    });

  if (pano.ayar.tabloYok) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <AlertTriangle className="mt-px size-4 shrink-0" />
          <span>{t("migration_missing")}</span>
        </p>
      </div>
    );
  }

  const kategoriGrubu = (k: string) => pano.kategoriler.filter((x) => x.kategori === k);
  // Yalnız GERÇEKTEN eşiği geçen satırı olan tablolar (bkz. §Uyarılar yorumu).
  const aktifUyarilar = pano.uyarilar.filter(uyariVarMi);
  const sebepEksik = sebep.trim().length < SEBEP_MIN_UZUNLUK;
  const onayEksik = onay.trim().toUpperCase() !== SIL_ONAY_METNI;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* ── SİSTEM SİLMEZ ────────────────────────────────────────────── */}
      <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>{t("no_auto_delete")}</span>
      </p>

      {/* ── UYARILAR ─────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-medium">{t("warnings_title")}</h2>
        {/**
         * 🔴 SIFIR SATIRLI TABLO UYARI DEĞİLDİR.
         *
         * `uyarilar()` KİŞİSEL kategorideki her ham tabloyu döndürüyor —
         * eşiği geçen satırı olmayanları da (driver_locations bugün 0 satır).
         * Süzmeden basmak "0 satır ham konum veriniz eşiği geçti" gibi kendi
         * içinde çelişkili bir uyarı üretir; QA render provası bunu yakaladı.
         */}
        {aktifUyarilar.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("no_warning")}</p>
        ) : (
          aktifUyarilar.map((u) => (
            <div
              key={u.tabloAdi}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                <span>
                  {t("warning_line", {
                    rows: say(u.satirSayisi),
                    days: u.uyariGun,
                    table: u.tabloAdi,
                  })}
                </span>
              </p>
              <p className="mt-1 pl-5">
                {u.enEskiGun !== null && t("warning_oldest", { days: u.enEskiGun })}
              </p>
              {/**
               * 🔴 YASAL ÇIPA DOĞRULANMAMIŞSA SAYI YAZILMAZ.
               *
               * `saklama_esikleri` bugün BOŞ ve bu bilinçli: eşikler ayrı bir
               * araştırma turuyla, kaynak linki ve doğrulanma tarihiyle
               * doldurulacak. Uydurma bir gün sayısı DACH müşterisine giderse
               * sorumluluk doğar.
               */}
              <p className="mt-1 pl-5">
                {u.yasalEsikGun === null
                  ? t("anchor_unverified", { country: u.ulkeKodu })
                  : t("anchor_verified", {
                      country: u.ulkeKodu,
                      days: u.yasalEsikGun,
                      basis: u.yasalDayanak ?? "—",
                    })}
              </p>
            </div>
          ))
        )}
      </section>

      {/* ── AYAR ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-medium">{t("settings_title")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="uyari-gun" className="text-sm font-medium">
              {t("days_label")}
            </label>
            <Input
              id="uyari-gun"
              type="number"
              min={UYARI_GUN_MIN}
              max={UYARI_GUN_MAX}
              value={uyariGun}
              onChange={(e) => setUyariGun(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              {t("days_hint", { min: UYARI_GUN_MIN, max: UYARI_GUN_MAX, def: VARSAYILAN_UYARI_GUN })}
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="ulke" className="text-sm font-medium">
              {t("country_label")}
            </label>
            <Input
              id="ulke"
              value={ulkeKodu}
              maxLength={2}
              onChange={(e) => setUlkeKodu(e.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">{t("country_hint")}</p>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="gerekce" className="text-sm font-medium">
            {t("reason_label")}
          </label>
          <textarea
            id="gerekce"
            value={gerekce}
            onChange={(e) => setGerekce(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            placeholder={t("reason_placeholder")}
          />
        </div>
        <Button onClick={kaydet} disabled={kaydetBekle}>
          {kaydetBekle ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}
          {t("save")}
        </Button>
      </section>

      {/* ── VERİ KATEGORİLERİ ────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-medium">{t("categories_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("categories_basis")}</p>
        {(["kisisel", "arac", "yasal_zorunlu"] as const).map((k) => (
          <div key={k} className="space-y-1">
            <div className="flex items-center gap-2">
              <StatusChip tone={k === "yasal_zorunlu" ? "critical" : k === "kisisel" ? "warning" : "neutral"}>
                {t(`cat_${k}` as never)}
              </StatusChip>
              {k === "yasal_zorunlu" && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3" />
                  {t("cat_locked")}
                </span>
              )}
            </div>
            <ul className="pl-1 text-xs text-muted-foreground">
              {kategoriGrubu(k).map((x) => (
                <li key={`${x.tabloAdi}:${x.kolonAdi ?? "*"}`} className="py-0.5">
                  <span className="font-mono">{x.tabloAdi}</span> — {x.gerekce}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ── SİLME ARACI ──────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-medium">{t("delete_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("delete_desc")}</p>

        {/**
         * ⚠️ Liste SUNUCUDA süzüldü: 'yasal_zorunlu' tablolar
         * `silinebilirTablolar` içinde HİÇ YOK. Seçenek üretilmezse
         * yanlışlıkla render edilemez.
         */}
        {pano.silinebilirTablolar.length === 0 ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-px size-3.5 shrink-0" />
            <span>{t("nothing_deletable")}</span>
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="tablo" className="text-sm font-medium">
                  {t("table_label")}
                </label>
                <select
                  id="tablo"
                  value={tablo ?? ""}
                  onChange={(e) => {
                    setTablo(e.target.value as HamTablo);
                    setOnIzleme(null);
                  }}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  {pano.silinebilirTablolar.map((x) => (
                    <option key={x.tablo} value={x.tablo}>
                      {x.tablo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="tur" className="text-sm font-medium">
                  {t("range_label")}
                </label>
                <select
                  id="tur"
                  value={tur}
                  onChange={(e) => {
                    setTur(e.target.value as AralikTuru);
                    setOnIzleme(null);
                  }}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  <option value="hafta">{t("range_week")}</option>
                  <option value="ay">{t("range_month")}</option>
                  <option value="ozel">{t("range_custom")}</option>
                </select>
              </div>
            </div>

            {tur === "ozel" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="bas" className="text-sm font-medium">
                    {t("from_label")}
                  </label>
                  <Input id="bas" type="date" value={bas} onChange={(e) => { setBas(e.target.value); setOnIzleme(null); }} />
                </div>
                <div className="space-y-1">
                  <label htmlFor="bit" className="text-sm font-medium">
                    {t("to_label")}
                  </label>
                  <Input id="bit" type="date" value={bit} onChange={(e) => { setBit(e.target.value); setOnIzleme(null); }} />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label htmlFor="ref" className="text-sm font-medium">
                  {tur === "hafta" ? t("week_ref_label") : t("month_ref_label")}
                </label>
                <Input id="ref" type="date" value={referans} onChange={(e) => { setReferans(e.target.value); setOnIzleme(null); }} />
                <p className="text-xs text-muted-foreground">{t("ref_hint")}</p>
              </div>
            )}

            {/* BİRİNCİ ONAY AYAĞI: kuru mod sayısı */}
            <Button variant="secondary" onClick={onizle} disabled={onizBekle || !tablo}>
              {onizBekle && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t("preview")}
            </Button>

            {onIzleme?.ok && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-sm">
                  {t("preview_result", {
                    rows: say(onIzleme.satir),
                    from: gun(onIzleme.aralikBas),
                    to: gun(onIzleme.aralikBit),
                  })}
                </p>

                {/* NEDEN SİLİNEMİYOR — cevap ekranda. */}
                {!onIzleme.kapi.izin && (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-px size-3.5 shrink-0" />
                    <span>
                      {t(`blocked_${onIzleme.kapi.engel ?? "hata"}` as never)}
                      {onIzleme.kapi.ayrinti ? ` — ${onIzleme.kapi.ayrinti}` : ""}
                    </span>
                  </p>
                )}

                {(onIzleme.hazirlik.eksikAylar.length > 0 || onIzleme.hazirlik.kmDonmamis > 0 || onIzleme.hazirlik.omurIzi === 0) && (
                  <Button variant="secondary" onClick={hazirla} disabled={hazirlikBekle}>
                    {hazirlikBekle && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t("prep_run")}
                  </Button>
                )}

                {onIzleme.satir > 0 && onIzleme.kapi.izin && (
                  <>
                    <div className="space-y-1">
                      <label htmlFor="sil-sebep" className="text-sm font-medium">
                        {t("delete_reason_label")}
                      </label>
                      <textarea
                        id="sil-sebep"
                        value={sebep}
                        onChange={(e) => setSebep(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                        placeholder={t("delete_reason_placeholder")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("delete_reason_hint", { min: SEBEP_MIN_UZUNLUK })}
                      </p>
                    </div>

                    {/* İKİNCİ ONAY AYAĞI: elle yazılan "SIL" */}
                    <div className="space-y-1">
                      <label htmlFor="sil-onay" className="text-sm font-medium">
                        {t("confirm_label", { word: SIL_ONAY_METNI })}
                      </label>
                      <Input
                        id="sil-onay"
                        value={onay}
                        onChange={(e) => setOnay(e.target.value)}
                        placeholder={SIL_ONAY_METNI}
                        className="max-w-40"
                      />
                    </div>

                    <Button
                      variant="destructive"
                      onClick={sil}
                      disabled={silBekle || sebepEksik || onayEksik}
                    >
                      {silBekle ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
                      {t("delete_run", { rows: say(onIzleme.satir) })}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t("delete_irreversible")}</p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── DENETİM İZİ ──────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-medium">{t("audit_title")}</h2>
        {pano.izi.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("audit_empty")}</p>
        ) : (
          <ul className="divide-y divide-border/60 text-xs">
            {pano.izi.map((x) => (
              <li key={x.id} className="py-2">
                <p>
                  <span className="font-medium">{x.silenAd ?? "—"}</span> · {gun(x.silindiAt)} ·{" "}
                  <span className="font-mono">{x.tabloAdi}</span> · {gun(x.aralikBas)} → {gun(x.aralikBit)} ·{" "}
                  {say(x.satirSayisi)} {t("rows")}
                </p>
                <p className="text-muted-foreground">{x.sebep}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
