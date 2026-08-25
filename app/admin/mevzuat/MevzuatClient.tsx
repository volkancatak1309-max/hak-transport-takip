"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Clock, Info, Loader2, ShieldAlert, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, StatusChip, type ChipTone } from "@/components/ui-v2";
import { formatDateTime } from "@/lib/format";
import { mevzuatAyarKaydet, type MevzuatGorunum } from "@/app/actions/mevzuat";
import type { Kademe, KuralDurumu, KuralSeti } from "@/lib/mevzuat";

/**
 * CANLI MEVZUAT EKRANI (086).
 *
 * ═══ EN ÜSTTEKİ UYARI KALDIRILAMAZ ═══
 *
 * Takograf yok. Çalışma süresi ÖLÇÜLÜR, sürüş süresi TAHMİN EDİLİR. Ekran
 * bunu söylemezse kullanıcı burada gördüğü sayıyla denetime girer. "Uyum
 * garantisi" cümlesi bu üründe yasak; doğru konumlandırma "erken uyarı".
 */

const KADEME_TON: Record<Kademe, ChipTone> = {
  ihlal: "critical",
  son: "critical",
  yaklasti: "warning",
  erken: "info",
};

export function MevzuatClient({
  pano,
  yonetici,
}: {
  pano: MevzuatGorunum;
  yonetici: boolean;
}) {
  const t = useTranslations("mevzuat");
  const [ayarAcik, setAyarAcik] = useState(false);

  if (pano.ayar.tabloYok) {
    return (
      <>
        <PageHeader title={t("title")} description={t("desc")} />
        <EmptyState kind="none" title={t("kapali_baslik")} hint={t("kapali_govde")} />
      </>
    );
  }

  const riskli = pano.satirlar.filter((s) => s.enKritik);

  return (
    <>
      <PageHeader title={t("title")} description={t("desc")} />

      {/* ── KALDIRILAMAZ UYARI ─────────────────────────────────────────── */}
      <div className="flex items-start gap-2 rounded-xl border border-accent-gold/40 bg-accent-gold/10 p-3 text-xs">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent-gold-text" />
        <div className="space-y-1">
          <p className="font-medium text-accent-gold-text">{t("takograf_yok_baslik")}</p>
          <p className="text-muted-foreground">{t("takograf_yok_govde")}</p>
        </div>
      </div>

      {/* ── KURAL SETİ KÜNYESİ ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground">
        <span>{t("kural_seti")}</span>
        <StatusChip tone="info">{t(`set_${pano.ayar.kuralSeti}`)}</StatusChip>
        <span>·</span>
        <span className="nums">
          {t("kademeler", {
            erken: pano.ayar.kademe.erken,
            yaklasti: pano.ayar.kademe.yaklasti,
            son: pano.ayar.kademe.son,
          })}
        </span>
        <span>·</span>
        <span className="nums">{t("olculdu_an", { an: formatDateTime(pano.olculduAn) })}</span>
        {yonetici && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAyarAcik((v) => !v)}>
            <Settings2 className="mr-1 size-3.5" />
            {t("ayar")}
          </Button>
        )}
      </div>

      {ayarAcik && yonetici && <AyarFormu pano={pano} kapat={() => setAyarAcik(false)} />}

      {/*
        SÜRÜŞ EKSENİ KAPALIYSA SESSİZ KALMAZ. EU_561 seçilip sürüş tahmini
        kapalı bırakılırsa ekran boş görünürdü ve kullanıcı "kural yok" sanardı.
      */}
      {pano.surusEkseniKapali && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("surus_kapali")}</span>
        </p>
      )}

      {/* ── SAHADAKİLER ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="nums">{t("sahada", { n: pano.satirlar.length })}</span>
        <span>·</span>
        <span className="nums">{t("riskli", { n: riskli.length })}</span>
        <span>·</span>
        <span className="nums">{t("vardiyasiz", { n: pano.vardiyasiz })}</span>
        {pano.bayatVardiya > 0 && (
          <>
            <span>·</span>
            {/*
              KAPANMAMIŞ KAYIT SAYISI GİZLENMEZ. Bu satırlara uyarı gitmiyor;
              kullanıcı "neden bu kişi listede sessiz" diye sormadan önce
              cevabı görmeli — ve asıl yapılacak iş vardiyayı kapatmak.
            */}
            <span className="nums text-accent-gold-text">
              {t("bayat_vardiya", { n: pano.bayatVardiya })}
            </span>
          </>
        )}
      </div>

      {pano.satirlar.length === 0 ? (
        <EmptyState kind="none" title={t("sahada_yok_baslik")} hint={t("sahada_yok_govde")} />
      ) : (
        <ul className="space-y-3">
          {pano.satirlar.map((s) => (
            <li key={s.workerId} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {s.ad}
                  {s.enKritik && (
                    <StatusChip tone={KADEME_TON[s.enKritik]}>{t(`kademe_${s.enKritik}`)}</StatusChip>
                  )}
                  {s.vardiyaBayat && <StatusChip tone="warning">{t("vardiya_bayat")}</StatusChip>}
                  {s.molaKaydiYok && <StatusChip tone="neutral">{t("mola_kaydi_yok")}</StatusChip>}
                </span>
                <span className="nums text-sm">
                  {s.enYakinKalanDk === null ? (
                    <span className="text-muted-foreground">{t("olculemedi")}</span>
                  ) : (
                    <>
                      <Clock className="mr-1 inline size-3.5" />
                      {t("kalan", { dk: s.enYakinKalanDk })}
                    </>
                  )}
                </span>
              </div>

              <ul className="mt-2 space-y-1">
                {s.kurallar.map((k) => (
                  <KuralSatiri key={k.kural} k={k} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {/* ── GÖNDERİLEN UYARILAR ────────────────────────────────────────── */}
      {!pano.gecmisTabloYok && pano.gecmis.length > 0 && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("gecmis", { n: pano.gecmis.length })}
          </summary>
          <ul className="mt-3 space-y-1 text-xs">
            {pano.gecmis.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{pano.adlar[g.workerId] ?? "—"}</span>
                  {" · "}
                  {t(`kural_${g.kural}`)}
                  {" · "}
                  <StatusChip tone={KADEME_TON[g.kademe]}>{t(`kademe_${g.kademe}`)}</StatusChip>
                </span>
                <span className="nums text-muted-foreground">
                  {/*
                    GÖNDERİM AKIBETİ SAYIYLA. "Uyarı verildi" demek yeterli
                    değil: kayıtlı cihaz yoksa hiçbir telefon çalmadı.
                  */}
                  {g.soforJeton === null
                    ? t("bildirim_denenmedi")
                    : t("bildirim", { sofor: g.soforJeton, yonetici: g.yoneticiJeton ?? 0 })}
                  {" · "}
                  {formatDateTime(g.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function KuralSatiri({ k }: { k: KuralDurumu }) {
  const t = useTranslations("mevzuat");

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        {t(`kural_${k.kural}`)}
        {" · "}
        <span className="opacity-70">{k.dayanak}</span>
        {/* TAHMİN ETİKETİ HER SATIRDA — sayfanın başındaki uyarı kaydırılıp
            geçilebilir, satırdaki etiket geçilemez. */}
        {k.temel === "surus_tahmini" && <StatusChip tone="warning">{t("tahmin")}</StatusChip>}
      </span>

      <span className="nums flex items-center gap-2">
        {k.olculenDk === null ? (
          <span className="text-muted-foreground">
            {t("olculemedi")} · {t(`sebep_${k.olculemediSebep}`)}
          </span>
        ) : (
          <>
            <span>{t("olculen", { dk: k.olculenDk, esik: k.esikDk })}</span>
            {k.molaKarsilandi === true ? (
              <StatusChip tone="info">{t("mola_verildi")}</StatusChip>
            ) : k.kalanDk !== null && k.kalanDk < 0 ? (
              <StatusChip tone="critical">{t("asildi", { dk: Math.abs(k.kalanDk) })}</StatusChip>
            ) : (
              <span className="text-muted-foreground">{t("kalan", { dk: k.kalanDk ?? 0 })}</span>
            )}
          </>
        )}
        {k.belirsizDk !== null && k.belirsizDk > 0 && (
          <span className="text-muted-foreground" title={t("belirsiz_aciklama")}>
            <AlertTriangle className="mr-1 inline size-3" />
            {t("belirsiz", { dk: k.belirsizDk })}
          </span>
        )}
      </span>
    </li>
  );
}

const SETLER: KuralSeti[] = ["AT_AZG", "DE_ARBZG", "EU_561"];

function AyarFormu({ pano, kapat }: { pano: MevzuatGorunum; kapat: () => void }) {
  const t = useTranslations("mevzuat");
  const [set, setSet] = useState<KuralSeti>(pano.ayar.kuralSeti);
  const [surus, setSurus] = useState(pano.ayar.surusTahmini);
  const [erken, setErken] = useState(String(pano.ayar.kademe.erken));
  const [yaklasti, setYaklasti] = useState(String(pano.ayar.kademe.yaklasti));
  const [son, setSon] = useState(String(pano.ayar.kademe.son));
  const [bekle, basla] = useTransition();

  const kaydet = () =>
    basla(async () => {
      const r = await mevzuatAyarKaydet({
        kuralSeti: set,
        surusTahmini: surus,
        kademe: { erken: Number(erken), yaklasti: Number(yaklasti), son: Number(son) },
      });
      if (!r.ok) {
        toast.error(r.hata === "kademe_sirasi" ? t("hata_kademe_sirasi") : t("hata_hata"));
        return;
      }
      toast.success(t("ayar_kaydedildi"));
      kapat();
    });

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">{t("kural_seti")}</span>
        <div className="flex flex-wrap gap-2">
          {SETLER.map((s) => (
            <Button key={s} size="sm" variant={set === s ? "default" : "outline"} onClick={() => setSet(s)}>
              {t(`set_${s}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`set_aciklama_${set}`)}</p>
      </div>

      {set === "EU_561" && (
        <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={surus}
            onChange={(e) => setSurus(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t("surus_tahmini")}</span>
            <br />
            <span className="text-muted-foreground">{t("surus_tahmini_aciklama")}</span>
          </span>
        </label>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("ayar_erken")}</span>
          <Input inputMode="numeric" value={erken} onChange={(e) => setErken(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("ayar_yaklasti")}</span>
          <Input inputMode="numeric" value={yaklasti} onChange={(e) => setYaklasti(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("ayar_son")}</span>
          <Input inputMode="numeric" value={son} onChange={(e) => setSon(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t("kademe_aciklama")}</p>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={kapat}>
          {t("vazgec")}
        </Button>
        <Button size="sm" onClick={kaydet} disabled={bekle}>
          {bekle && <Loader2 className="mr-1 size-3.5 animate-spin" />}
          {t("kaydet")}
        </Button>
      </div>
    </div>
  );
}
