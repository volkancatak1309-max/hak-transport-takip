#!/usr/bin/env node
/**
 * UI-PATH PROOF — /admin/raporlar/performans sayfasının ÇALIŞTIRDIĞI
 * `buildPerformanceReport` aynen koşulur ve çıktısı basılır. HİÇBİR ŞEY YAZMAZ.
 *
 * Kullanım (ÖNCE/SONRA karşılaştırması için iki kez, arada `git stash`):
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-eksen-rapor.mjs [gun]
 */
import { buildPerformanceReport } from "@/lib/reports";
import { computeAnalyticsRange } from "@/lib/analytics";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

const GUN = Number(process.argv[2] ?? 24);
const range =
  GUN === 30
    ? computeAnalyticsRange("ay")
    : GUN === 7
      ? computeAnalyticsRange("hafta")
      : {
          start: addCalendarDaysVienna(startOfDayVienna(), -(GUN - 1)),
          end: computeAnalyticsRange("gun").end,
        };

const t0 = Date.now();
const r = await buildPerformanceReport(range);
const ms = Date.now() - t0;

const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 17) => String(s).slice(0, w).padEnd(w);

console.log(`\n══ buildPerformanceReport · ${GUN} gün · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)} ══`);
console.log(`   süre ${ms} ms`);
console.log(`   satır ${r.rows.length} · skorlanan ${r.scoredCount} · ort ${r.avgScore}`);
console.log(`   vardiya ${r.totalShifts} · çalışma ${Math.round(r.totalWorkedMs / 3600000)} sa · km ${Math.round(r.totalKm)}`);
console.log(`   km ölçülen ${r.kmMeasuredShifts} / ölçülemeyen ${r.kmUnmeasuredShifts} · günlük kova ${r.daily.length}`);
console.log(`\n   ${ad("şoför")} ${n("vard", 5)} ${n("km", 7)} ${n("teslim", 7)} ${n("olay", 6)} ${n("fren", 5)} ${n("hızl", 5)} ${n("hız", 5)} ${n("skor", 5)}`);
for (const x of r.rows) {
  console.log(
    `   ${ad(x.name)} ${n(x.shifts, 5)} ${n(x.km == null ? "—" : Math.round(x.km), 7)} ${n(x.delivered, 7)} ${n(x.events, 6)} ${n(x.harshBraking, 5)} ${n(x.harshAcceleration, 5)} ${n(x.overspeeding, 5)} ${n(x.safetyScore ?? "—", 5)}`
  );
}
console.log(``);
