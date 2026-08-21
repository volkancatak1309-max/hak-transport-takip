import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { buildShiftsCsv } from "@/lib/report-csv";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import { dilCoz, dilHataAlanlari } from "../../_rapor/dil";
import { csvYaniti, disaAktarimKapali } from "../../_rapor/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/shifts.csv?range=gun|hafta|ay|tumzaman|ozel&from=&to=
 *
 * Yönetici panosundaki "Excel" düğmesinin (AdminClient.tsx `exportCsv`) sunucu
 * karşılığı. Aynı sütunlar, aynı sıra, aynı kodlama: TAB ayraç + UTF-16LE BOM.
 * Biçim gerekçesi lib/report-csv.ts başlığında — dosyalar muhasebeye gidiyor
 * ve karşı taraftaki şablon değiştirilemez.
 *
 * ── PANELDEN TEK FARK: FİLTRE ─────────────────────────────────────────────
 * Panelin CSV'si ekrandaki şoför/durum süzgecini taşır; bu uç DÖNEMİN
 * TAMAMINI verir. İki dosyayı karşılaştırırken panel "tümü/tümü" olmalı.
 * Süzgeci buraya taşımak ayrı bir sözleşme kararıdır (hangi parametre, hangi
 * ad) ve bu turun kapsamında değil.
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * requireMobileAdmin. Panelde pano `requireFleetView()` ile şefe de açık ama
 * onun CSV'si kendi filosuyla SINIRLI; burada filo kapsamı uygulanmadığı için
 * şefe açmak karşı filoyu sızdırırdı. Şefin kendi filosunun dışa aktarımı ayrı
 * bir karar (farklı kapı, farklı kapsam).
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const kapali = disaAktarimKapali();
  if (kapali) return kapali;

  const url = new URL(req.url);

  const dilSonucu = dilCoz(url);
  if (!dilSonucu.ok) return mobileError(400, dilSonucu.kod, dilHataAlanlari());

  const cozum = aralikCoz(url);
  if (!cozum.ok) return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));

  return csvYaniti(await buildShiftsCsv(cozum.cozum.range, dilSonucu.dil));
}
