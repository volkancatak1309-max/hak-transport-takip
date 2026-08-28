#!/usr/bin/env node
/**
 * HAK61 SAĞLIK — UI-YOL KANITI. 🔴 SALT OKUMA, HİÇBİR ŞEY YAZMAZ.
 *
 * NİÇİN VAR: 28.08.2026'da HAK61 canlı müşteride bir kesinti yaşandı ve
 * "hangi sorgu kaynak yiyor" sorusu soruldu. `pg_stat_statements` bu projede
 * ERİŞİLEBİLİR DEĞİL (tek kanal PostgREST; pg_catalog görünümleri şemada yok),
 * o yüzden cevap TAHMİNLE değil, sayfaların GERÇEKTEN çalıştırdığı kod
 * yolunu koşturup ölçerek verildi. Tam rapor: docs/HAK61-SAGLIK.md.
 *
 * GÜVENLİK: `lib/reports.ts` içinde tek bir insert/update/upsert/delete YOK
 * (grep ile doğrulandı) ve çağrılan RPC'lerin hepsi `stable`. `getDashboardData`
 * ve `uyarilar()` de yalnız okur. `refresh_telemetry_lifetime` BİLEREK
 * çağrılmaz — o `volatile`, yani YAZAR.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-hak61-saglik.mjs
 */
import { buildFuelReport } from "@/lib/reports";
import { computeAnalyticsRange } from "@/lib/analytics";
import { getDashboardData } from "@/lib/admin-dashboard";
import { uyarilar } from "@/lib/saklama-db";
import { startOfTodayVienna, endOfTodayVienna } from "@/lib/format";

const sn = (ms) => `${(ms / 1000).toFixed(2)} sn`;

console.log(`\n╔══ HAK61 UI-YOL KANITI (salt okuma) ══════════════════════════════`);
console.log(`║ an ${new Date().toISOString()}`);

// ── 1 · /admin/raporlar/yakit — kullanıcının tetikleyebildiği EN AĞIR yol ───
console.log(`\n── /admin/raporlar/yakit → buildFuelReport ─────────────────────────`);
for (const key of ["hafta", "ay", "tumzaman"]) {
  const range = computeAnalyticsRange(key);
  const gun = Math.round((range.end - range.start) / 86_400_000);
  const t0 = performance.now();
  let ozet;
  try {
    const r = await buildFuelReport(range);
    ozet = `available=${r.available} · ölçülen L=${r.totalConsumedLiters?.toFixed?.(1) ?? "—"} · eksikPlaka=${r.failedPlates?.length ?? 0}${r.failedReason ? ` · sebep=${r.failedReason}` : ""}`;
  } catch (e) {
    ozet = `PATLADI: ${e.message}`;
  }
  console.log(`  aralık=${key.padEnd(9)} (${String(gun).padStart(2)} gün) → ${sn(performance.now() - t0).padStart(8)}   ${ozet}`);
}

// ── 2 · /admin — her yöneticinin her açılışta ödediği ───────────────────────
console.log(`\n── /admin → getDashboardData + SaklamaUyariSeridi ──────────────────`);
for (let i = 1; i <= 2; i++) {
  const t0 = performance.now();
  const d = await getDashboardData(startOfTodayVienna().toISOString(), endOfTodayVienna().toISOString());
  console.log(`  getDashboardData ${i}. çağrı : ${sn(performance.now() - t0).padStart(8)} · bölüm=${Object.keys(d).length}`);
}
for (let i = 1; i <= 2; i++) {
  const t0 = performance.now();
  const u = await uyarilar();
  console.log(`  uyarilar() ${i}. çağrı      : ${String(Math.round(performance.now() - t0)).padStart(5)} ms · uyarı=${u.uyarilar.length} · hata=${u.hata ?? "yok"}`);
}
console.log();
