#!/usr/bin/env node
/**
 * KM EKSENİ ADIM 5 — RAPOR KESİMİ. CANLI kanıt, **SALT OKUMA.**
 *
 * Tek söz: kesim tarihinden ÖNCEKİ raporlar DEĞİŞMEDİ (bayt-bayt), sonrası
 * yeni eksende ve dipnotlu. Betik üç dönemi karşılaştırır:
 *   Ağustos 2026  → tamamen kesim öncesi  → bayt-bayt aynı, dipnot YOK
 *   Eylül 2026    → tamamen kesim öncesi  → aynı, dipnot YOK
 *   Ekim 2026     → kesim sonrası         → yeni eksen + dipnot
 *
 * "ÖNCE" = kesim kuralı YOKKEN ne basılırdı: `end_km - start_km` (km_measured
 * kapısıyla). Bağımsız hesaplanır, ucun kendi kodundan değil.
 *
 * Kullanım:  ENV_FILE=.env.local npm run verify:km-rapor-kesim
 */
import { supabaseAdmin } from "@/lib/supabase";
import { markKmMeasured } from "@/lib/km-quality";
import { markKmKarar } from "@/lib/km-axis";
import { kmRaporDegeri, kmDipnotGerekli } from "@/lib/km-ui";
import { KM_EKSENI_KESIM_TARIHI } from "@/lib/tenant";
import { buildShiftReportRow, kmDipnotMetni, REPORT_EMPTY } from "@/lib/report-de";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptk") ? "HAK61" : url.includes("ftbaz") ? "Sendigo" : "galzura-demo";

let gecen = 0;
const dusen = [];
const ok = (b, k, kanit) => {
  if (k) { gecen++; console.log(`  ✓ ${b}${kanit ? `   [${kanit}]` : ""}`); }
  else { dusen.push({ b, kanit }); console.log(`  ✗ ${b}   [${kanit}]`); }
};

console.log(`\n═══ ${KIRACI} · kesim ${KM_EKSENI_KESIM_TARIHI} ═══`);

/** ESKİ davranışın birebir kopyası — kesim kuralı hiç yokmuş gibi. */
function eskiKm(e) {
  if (e.km_measured === false) return null;
  if (e.start_km === null || e.end_km === null) return null;
  return e.end_km - e.start_km;
}

const DONEMLER = [
  ["Ağustos 2026", "2026-08-01", "2026-08-31"],
  ["Eylül 2026", "2026-09-01", "2026-09-30"],
  ["Ekim 2026", "2026-10-01", "2026-10-31"],
];

for (const [ad, bas, bit] of DONEMLER) {
  const basISO = `${bas}T00:00:00.000Z`;
  const bitISO = `${bit}T23:59:59.999Z`;
  console.log(`\n────────── ${ad} (${bas} → ${bit}) ──────────`);

  const { data: ham } = await supabaseAdmin
    .from("time_entries")
    .select("*")
    .gte("started_at", basISO)
    .lte("started_at", bitISO)
    .order("started_at");
  const isaretli = await markKmMeasured(ham ?? []);
  const kararli = await markKmKarar(isaretli);
  console.log(`  vardiya: ${kararli.length}`);

  // ── PDF satırları: önce/sonra ────────────────────────────────────────────
  let farkli = 0;
  const ornek = [];
  for (const e of kararli) {
    const eski = eskiKm(e);
    const eskiHucre = eski !== null ? String(eski) : REPORT_EMPTY;
    const satir = buildShiftReportRow(e, "X", "de");
    if (satir.km !== eskiHucre) {
      farkli++;
      if (ornek.length < 4) ornek.push(`${e.id.slice(0, 8)} ${eskiHucre}→${satir.km}`);
    }
  }
  const kesimSonrasi = kmDipnotGerekli(bitISO, KM_EKSENI_KESIM_TARIHI);
  if (kesimSonrasi) {
    console.log(`  PDF km hücresi değişen satır: ${farkli}/${kararli.length}`);
    if (ornek.length) console.log(`  örnek: ${ornek.join(" · ")}`);
  } else {
    ok(
      `🔑 ${ad} PDF km hücreleri BAYT-BAYT aynı`,
      farkli === 0,
      farkli ? ornek.join(" · ") : `${kararli.length}/${kararli.length} satır`
    );
  }

  // ── Dipnot ───────────────────────────────────────────────────────────────
  const dipnot = kmDipnotMetni(bitISO, "de");
  if (kesimSonrasi) {
    ok(`${ad} dipnot BASILIYOR`, dipnot !== null, dipnot ?? "null");
  } else {
    ok(`🔑 ${ad} dipnot BASILMIYOR`, dipnot === null, String(dipnot));
  }

  // ── CSV km_kaynak kolonu ─────────────────────────────────────────────────
  const kaynaklar = {};
  for (const e of kararli) {
    const { kaynak } = kmRaporDegeri(e, KM_EKSENI_KESIM_TARIHI);
    kaynaklar[kaynak] = (kaynaklar[kaynak] ?? 0) + 1;
  }
  console.log(`  km_kaynak dağılımı: ${JSON.stringify(kaynaklar)}`);
  if (!kesimSonrasi && kararli.length > 0) {
    ok(
      `🔑 ${ad} km_kaynak TAMAMI "sayac_eski"`,
      Object.keys(kaynaklar).length === 1 && kaynaklar.sayac_eski === kararli.length,
      JSON.stringify(kaynaklar)
    );
  }
  if (kesimSonrasi && kararli.length > 0) {
    ok(
      `${ad} km_kaynak "sayac_eski" İÇERMİYOR`,
      !("sayac_eski" in kaynaklar),
      JSON.stringify(kaynaklar)
    );
  }
}

// ── Sınır davranışı: kesim GÜNÜ dâhil mi ───────────────────────────────────
console.log(`\n────────── sınır (kesim günü DÂHİL) ──────────`);
const sinir = [
  [`${KM_EKSENI_KESIM_TARIHI}T00:00:00.000Z`, true, "kesim günü 00:00 → YENİ"],
  [`${KM_EKSENI_KESIM_TARIHI}T23:59:59.000Z`, true, "kesim günü 23:59 → YENİ"],
];
const oncekiGun = new Date(Date.parse(`${KM_EKSENI_KESIM_TARIHI}T00:00:00.000Z`) - 86400000)
  .toISOString()
  .slice(0, 10);
sinir.push([`${oncekiGun}T23:59:59.000Z`, false, "bir gün önce 23:59 → ESKİ"]);
for (const [iso, bekle, ad] of sinir) {
  const { kaynak } = kmRaporDegeri(
    { started_at: iso, start_km: 100, end_km: 150, km_measured: true, km_karar: { km: 42, kaynak: "cihaz" } },
    KM_EKSENI_KESIM_TARIHI
  );
  const yeni = kaynak !== "sayac_eski";
  ok(ad, yeni === bekle, `kaynak=${kaynak}`);
}

// ── AZG PDF'te km YOK (dokunulmadı) ────────────────────────────────────────
console.log(`\n────────── AZG PDF ──────────`);
const { readFileSync } = await import("node:fs");
const azg = readFileSync("app/api/mobile/reports/azg.pdf/route.ts", "utf8");
ok("AZG rotasında km/Kilometer geçmiyor", !/\bkm\b|Kilometer/i.test(azg));

// ══ SENTETİK KESİM SONRASI SATIR ═══════════════════════════════════════════
/**
 * Ekim 2026'da henüz vardiya YOK (bugün 16.09), yani "yeni eksen" gerçek
 * veriyle sınanamıyor. Boş bırakmak yerine GERÇEK bir Eylül satırı alınıp
 * BELLEKTE tarihi kesim sonrasına taşınıyor — veritabanına hiçbir şey
 * yazılmıyor. Ölçülen şey kuralın kendisi: aynı satır, yalnız tarihi değişince
 * hangi ekseni seçiyor.
 */
console.log(`\n────────── sentetik kesim sonrası (DB'ye yazma YOK) ──────────`);
const { data: eylulHam } = await supabaseAdmin
  .from("time_entries")
  .select("*")
  .gte("started_at", "2026-09-01T00:00:00.000Z")
  .lte("started_at", "2026-09-30T23:59:59.999Z")
  .not("ended_at", "is", null)
  .limit(40);
const eylulK = await markKmKarar(await markKmMeasured(eylulHam ?? []));
/**
 * Denek SEÇİMİ önemli: iki eksenin TESADÜFEN aynı çıktığı bir satır kuralı
 * ölçmez. Önce ayrışan bir satır aranır; yoksa denetim atlanır ve SEBEBİ
 * yazılır (sessizce "geçti" demek yerine).
 */
const ayrisan = eylulK.filter(
  (e) =>
    e.km_karar.kaynak === "cihaz" &&
    e.km_karar.km !== null &&
    eskiKm(e) !== e.km_karar.km
);
const denek = ayrisan[0];
if (!denek) {
  console.log(
    "  (iki eksenin AYRIŞTIĞI cihaz kaynaklı vardiya yok — denetim atlandı; " +
      "bu kiracıda sayaç ve cihaz bu dönemde aynı değeri veriyor)"
  );
} else {
  const eskiSatir = buildShiftReportRow(denek, "X", "de");
  const tasinmis = {
    ...denek,
    started_at: `${KM_EKSENI_KESIM_TARIHI}T08:00:00.000Z`,
  };
  const yeniSatir = buildShiftReportRow(tasinmis, "X", "de");
  const eski = eskiKm(denek);
  console.log(
    `  denek ${denek.id.slice(0, 8)} · sayaç ${eski ?? "—"} · çekirdek ${denek.km_karar.km}`
  );
  ok(
    "🔑 kesim ÖNCESİ tarihte satır SAYAÇ değerini basıyor",
    eskiSatir.km === (eski !== null ? String(eski) : REPORT_EMPTY),
    `${eskiSatir.km} vs ${eski}`
  );
  ok(
    "🔑 kesim SONRASI tarihte satır ÇEKİRDEK değerini basıyor",
    yeniSatir.km === String(denek.km_karar.km),
    `${yeniSatir.km} vs ${denek.km_karar.km}`
  );
  ok(
    "iki değer gerçekten FARKLI (kural ölçülebilir)",
    eskiSatir.km !== yeniSatir.km,
    `${eskiSatir.km} → ${yeniSatir.km}`
  );
}

// ══ CSV ÇIKTISI — üç dönem, gerçek dosya ═══════════════════════════════════
console.log(`\n────────── CSV çıktısı ──────────`);
const { buildShiftsCsv } = await import("@/lib/report-csv");
for (const [ad, bas, bit] of DONEMLER) {
  const range = { start: new Date(`${bas}T00:00:00.000Z`), end: new Date(`${bit}T23:59:59.999Z`) };
  const csv = await buildShiftsCsv(range, "tr");
  const metin = csv.govde.toString("utf16le").replace(/^﻿/, "");
  const satirlar = metin.split(/\r?\n/).filter(Boolean);
  const baslik = satirlar[0] ?? "";
  ok(`${ad} CSV km_kaynak kolonu VAR`, baslik.includes("km_kaynak"), baslik.split("\t").length + " kolon");
  const kaynakIdx = baslik.split("\t").indexOf("km_kaynak");
  const degerler = {};
  for (const s of satirlar.slice(1)) {
    const v = s.split("\t")[kaynakIdx];
    if (v !== undefined) degerler[v] = (degerler[v] ?? 0) + 1;
  }
  console.log(`  ${ad}: ${satirlar.length - 1} satır · ${JSON.stringify(degerler)}`);
  if (satirlar.length > 1 && !kmDipnotGerekli(`${bit}T23:59:59.999Z`, KM_EKSENI_KESIM_TARIHI)) {
    ok(
      `🔑 ${ad} CSV km_kaynak TAMAMI "sayac_eski"`,
      Object.keys(degerler).length === 1 && "sayac_eski" in degerler,
      JSON.stringify(degerler)
    );
  }
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} km rapor kesimi: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.b}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
