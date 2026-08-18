import type { NextRequest } from "next/server";
import { createElement } from "react";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { loadRangeShifts } from "@/lib/report-shifts";
import { registerServerPdfFont, renderPdfToBuffer } from "@/lib/pdf-server";
import { SchichtberichtDoc } from "@/components/pdf/server/SchichtberichtDoc";
import {
  SHIFT_REPORT_DE,
  buildShiftReportRow,
  reportPeriodDe,
  REPORT_EMPTY,
  FILE_PREFIX_LOWER,
} from "@/lib/report-de";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import {
  disaAktarimKapali,
  isaretUret,
  pdfIziYaz,
  pdfYaniti,
  uretimAniDamgasi,
} from "../../_rapor/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/schichtbericht.pdf?range=gun|hafta|ay|tumzaman|ozel&from=&to=
 *
 * Schichtbericht — AZG kapsamında ibraz edilen çalışma süresi kaydı. Panelin
 * `/admin` panosundaki PDF düğmesinin (`components/pdf/ShiftReport.tsx`)
 * sunucu karşılığı; metin katmanı karşılaştırmalı doğrulandı.
 *
 * ── VERİ: TEK KAYNAK ──────────────────────────────────────────────────────
 * Satırlar `buildShiftReportRow` (lib/report-de.ts) — panelin kullandığı
 * fonksiyonun ta kendisi, 13 kolonun tek kaynağı. Sorgu ve elemeler
 * `loadRangeShifts` (lib/report-shifts.ts) — `shifts.csv` ile AYNI yükleyici,
 * çünkü iki resmî çıktı aynı satırlardan beslenmezse zamanla ayrışır.
 * Yeni mantık YAZILMADI.
 *
 * ── AZG'DEN FARKLI OLARAK ARALIK KABUL EDER ───────────────────────────────
 * Bu belge bir TAKVİM AYINA bağlı değil: "seçili dönemin çalışma kaydı"dır ve
 * panelde de aralık seçicisiyle üretiliyor. Bu yüzden `_rapor/aralik.ts`in
 * ortak pencere dilini konuşur — CSV ve Analiz ile aynı pencere.
 * (`azg.pdf` konuşamaz; gerekçesi o dosyanın başlığında.)
 *
 * ── ANTETTEKİ DÖNEM YAZISI ────────────────────────────────────────────────
 * Panel `reportPeriodDe(range)` ile "Heute / Diese Woche / Dieser Monat /
 * Benutzerdefinierter Zeitraum" basıyor ve bu ANAHTARA bağlı, tarihe değil.
 * Aynı sözlük burada da kullanılıyor; mobil anahtarları (`gun/hafta/ay/…`)
 * panelinkine (`today/week/month/custom`) eşleniyor ki iki belgede aynı
 * Almanca cümle çıksın. `tumzaman` panelde YOK — o pencereye özel bir Almanca
 * karşılık uydurmak yerine "Benutzerdefinierter Zeitraum" kullanılıyor ve
 * gerçek sınırlar zaten satırlarda görünüyor.
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * requireMobileAdmin; şoför ve şef 403 (gerekçe azg.pdf başlığındakiyle aynı:
 * filo kapsamı uygulanmıyor).
 */

/** Mobil pencere anahtarı → panelin `reportPeriodDe` anahtarı. */
const DONEM_ANAHTARI: Record<string, string> = {
  gun: "today",
  hafta: "week",
  ay: "month",
  ozel: "custom",
  // Panelde karşılığı yok; en yakın dürüst ifade "özel aralık".
  tumzaman: "custom",
};

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const kapali = disaAktarimKapali();
  if (kapali) return kapali;

  const cozum = aralikCoz(new URL(req.url));
  if (!cozum.ok) return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));
  const { range, tur } = cozum.cozum;

  const { entries, workerMap } = await loadRangeShifts(range);

  try {
    registerServerPdfFont();
  } catch {
    return mobileError(500, "pdf_font_missing");
  }

  const isaret = await isaretUret(guard.actor.worker.id, "shift");
  const simdi = new Date();
  const damga = uretimAniDamgasi(simdi);

  const buf = await renderPdfToBuffer(
    createElement(SchichtberichtDoc, {
      title: SHIFT_REPORT_DE.title,
      company: SHIFT_REPORT_DE.company,
      address: SHIFT_REPORT_DE.address,
      uid: SHIFT_REPORT_DE.uid,
      period: `${SHIFT_REPORT_DE.period}: ${reportPeriodDe(DONEM_ANAHTARI[tur] ?? "custom")}`,
      generatedAt: `${SHIFT_REPORT_DE.generatedAt}: ${damga}`,
      footer: SHIFT_REPORT_DE.footer,
      headers: SHIFT_REPORT_DE.headers,
      rows: entries.map((e) =>
        buildShiftReportRow(e, workerMap.get(e.worker_id)?.name ?? REPORT_EMPTY)
      ),
      kullanici: guard.actor.worker.name,
      damga,
      isaret,
    })
  );

  await pdfIziYaz(guard.actor.worker.id, "shift", {
    donem: tur,
    baslangic: range.start.toISOString(),
    bitis: range.end.toISOString(),
    satir: entries.length,
  });

  return pdfYaniti(
    buf,
    `${FILE_PREFIX_LOWER}-schichtbericht-${tur}-${simdi.toISOString().slice(0, 10)}.pdf`,
    { "x-rapor-satir": String(entries.length) }
  );
}
