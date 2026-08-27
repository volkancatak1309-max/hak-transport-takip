"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Check, CircleSlash, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resizeImage } from "@/lib/image-resize";
import { getGeoFix } from "../geo";
import { dvirFormGonder } from "@/app/actions/dvir";
import type { DvirMadde, DvirYanitDurum } from "@/lib/dvir-db";

/**
 * ARAÇ KONTROL FORMU — şoför yüzeyi (migration 081).
 *
 * ═══ ÜÇ DURUM, VARSAYILAN YOK ═══
 *
 * Hiçbir madde ÖNCEDEN "tamam" seçili gelmez. Gelseydi form "hepsini onayla"
 * düğmesine dönerdi ve imzalanan şey bir kontrol değil, bir alışkanlık olurdu.
 * Gönderim, her madde cevaplanana kadar kapalı.
 *
 * ═══ KUSURDA KANIT — İKİSİ BİRDEN ═══
 *
 * Kusurlu işaretlenen maddede fotoğraf VE not zorunlu. Kural üç katmanda
 * birden duruyor (bu ekran, sunucu eylemi, `dvir_kusur_kanit_sart` şema
 * kısıtı); ekrandaki hâli kullanıcıya cümle kurmak için, diğer ikisi kuralın
 * kendisi için.
 *
 * ═══ KM VE KONUM SORULMUYOR ═══
 *
 * Odometre telemetriden, saat sunucudan, konum tarayıcıdan (en iyi çaba)
 * alınır. Şoföre km yazdırmak, kanıt niteliğindeki bir beyanda en kolay
 * çarpıtılacak alanı ona bırakmak olurdu.
 */

type Secim = { durum: DvirYanitDurum | null; not: string; foto: File | null };

export function KontrolFormClient({
  tur,
  araclar,
  maddeler,
}: {
  tur: "once" | "sonra";
  araclar: { id: string; plate: string }[];
  maddeler: DvirMadde[];
}) {
  const t = useTranslations("dvir");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [aracId, setAracId] = useState(araclar[0]?.id ?? "");
  const [secimler, setSecimler] = useState<Record<string, Secim>>({});

  function secimAl(id: string): Secim {
    return secimler[id] ?? { durum: null, not: "", foto: null };
  }

  function guncelle(id: string, yama: Partial<Secim>) {
    setSecimler((o) => ({ ...o, [id]: { ...secimAl(id), ...yama } }));
  }

  const cevaplanan = maddeler.filter((m) => secimAl(m.id).durum !== null).length;
  const kusurlu = maddeler.filter((m) => secimAl(m.id).durum === "kusurlu");
  const kanitiEksik = kusurlu.filter((m) => {
    const s = secimAl(m.id);
    return !s.foto || s.not.trim().length === 0;
  });
  const hazir =
    aracId !== "" && cevaplanan === maddeler.length && kanitiEksik.length === 0;

  async function gonder() {
    const fd = new FormData();
    fd.set("vehicleId", aracId);
    fd.set("tur", tur);

    const yanitlar = maddeler.map((m) => {
      const s = secimAl(m.id);
      return {
        maddeId: m.id,
        durum: s.durum as DvirYanitDurum,
        notlar: s.not.trim() || null,
      };
    });
    fd.set("yanitlar", JSON.stringify(yanitlar));

    // Kusur fotoğrafları — madde kimliğiyle anahtarlanır; sunucu her kusurlu
    // maddenin dosyasını ADIYLA arar, sıraya güvenmez.
    for (const m of kusurlu) {
      const s = secimAl(m.id);
      if (!s.foto) continue;
      const kucuk = await resizeImage(s.foto, `dvir-${m.kod}.jpg`);
      fd.set(`foto_${m.id}`, kucuk);
    }

    const fix = await getGeoFix();
    if (fix.lat !== null && fix.lng !== null) {
      fd.set("lat", String(fix.lat));
      fd.set("lng", String(fix.lng));
      if (fix.accuracy !== null) fd.set("accuracy", String(fix.accuracy));
    }

    const r = await dvirFormGonder(fd);
    if (!r.ok) {
      toast.error(
        r.hata === "arac_senin_degil"
          ? t("err_not_your_vehicle")
          : r.hata === "kanit_yok"
            ? t("err_evidence")
            : r.hata === "tablo_yok"
              ? t("err_migration")
              : t("err_generic")
      );
      return;
    }
    toast.success(
      r.isEmri > 0 ? t("saved_with_orders", { count: r.isEmri }) : t("saved_clean")
    );
    router.push("/panel");
  }

  if (maddeler.length === 0) {
    return (
      <p className="rounded-lg border border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
        {t("no_items")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* ARAÇ — tek araçlı şoförde seçim yok, satır bilgi olarak durur. */}
      <div className="space-y-1.5">
        <Label htmlFor="dvir_arac">{t("vehicle")}</Label>
        {araclar.length <= 1 ? (
          <p className="nums rounded-lg border border-border/60 px-3 py-2 text-sm font-medium">
            {araclar[0]?.plate ?? t("no_vehicle")}
          </p>
        ) : (
          <select
            id="dvir_arac"
            value={aracId}
            onChange={(e) => setAracId(e.target.value)}
            className="h-11 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
          >
            {araclar.map((a) => (
              <option key={a.id} value={a.id}>
                {a.plate}
              </option>
            ))}
          </select>
        )}
      </div>

      <ul className="space-y-3">
        {maddeler.map((m) => {
          const s = secimAl(m.id);
          return (
            <li
              key={m.id}
              className="space-y-3 rounded-[14px] border border-border/60 p-3"
            >
              <div className="space-y-0.5">
                {/* ⚠️ Etiket KİRACININ verisi — t() içinden geçmez. */}
                <p className="text-sm font-medium">{m.etiket}</p>
                {m.aciklama && (
                  <p className="text-xs text-muted-foreground">{m.aciklama}</p>
                )}
              </div>

              {/* Üç durum, 44px dokunma hedefi (sarsılan araçta eldivenli el). */}
              <div className="grid grid-cols-3 gap-2">
                <DurumDugmesi
                  aktif={s.durum === "tamam"}
                  onClick={() => guncelle(m.id, { durum: "tamam" })}
                  ton="ok"
                  icon={Check}
                  label={t("state_ok")}
                />
                <DurumDugmesi
                  aktif={s.durum === "kusurlu"}
                  onClick={() => guncelle(m.id, { durum: "kusurlu" })}
                  ton="bad"
                  icon={TriangleAlert}
                  label={t("state_defect")}
                />
                <DurumDugmesi
                  aktif={s.durum === "uygulanamaz"}
                  onClick={() =>
                    guncelle(m.id, { durum: "uygulanamaz", not: "", foto: null })
                  }
                  ton="na"
                  icon={CircleSlash}
                  label={t("state_na")}
                />
              </div>

              {s.durum === "kusurlu" && (
                <div className="space-y-2 rounded-lg bg-accent-coral-soft/40 p-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor={`not_${m.id}`} className="text-xs">
                      {t("defect_note")}
                    </Label>
                    <Textarea
                      id={`not_${m.id}`}
                      value={s.not}
                      onChange={(e) => guncelle(m.id, { not: e.target.value })}
                      rows={2}
                      maxLength={500}
                      placeholder={t("defect_note_ph")}
                    />
                  </div>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 text-sm font-medium">
                    <Camera className="size-4 shrink-0" />
                    <span className="truncate">
                      {s.foto ? s.foto.name : t("defect_photo")}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={(e) =>
                        guncelle(m.id, { foto: e.target.files?.[0] ?? null })
                      }
                    />
                  </label>
                  {(!s.foto || s.not.trim().length === 0) && (
                    <p className="text-[11px] font-medium text-accent-coral-text">
                      {t("defect_required")}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 space-y-2 bg-background/90 py-3 backdrop-blur">
        <p className="nums text-center text-xs text-muted-foreground">
          {t("progress", { done: cevaplanan, total: maddeler.length })}
        </p>
        <Button
          type="button"
          className="h-12 w-full"
          disabled={!hazir || pending}
          onClick={() => startTransition(async () => { await gonder(); })}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </div>
  );
}

function DurumDugmesi({
  aktif,
  onClick,
  ton,
  icon: Icon,
  label,
}: {
  aktif: boolean;
  onClick: () => void;
  ton: "ok" | "bad" | "na";
  icon: typeof Check;
  label: string;
}) {
  const secili =
    ton === "ok"
      ? // accent-mint ailesi globals.css'te TANIMLI DEĞİL — üç sınıf da ölüydü
        // ve "uygun" seçeneği renksiz kalıyordu (27.08.2026 muhafız bulgusu).
        // accent-green tanımlı ve iki temada ayrı ayrı ayarlı.
        "border-accent-green bg-accent-green/10 text-accent-green-text"
      : ton === "bad"
        ? "border-accent-coral bg-accent-coral-soft text-accent-coral-text"
        : "border-border bg-surface-panel text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktif}
      className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] font-medium transition-colors ${
        aktif ? secili : "border-border/60 text-muted-foreground"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
