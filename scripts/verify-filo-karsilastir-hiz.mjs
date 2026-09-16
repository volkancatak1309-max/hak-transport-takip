#!/usr/bin/env node
/**
 * FİLO KARŞILAŞTIRMASI — HIZ TURUNUN DENKLİK KANITI (16. madde). SALT OKUMA.
 *
 * Tek söz: hız için yapılan hiçbir şey SAYIYI değiştirmedi.
 *
 * ── NEDEN KAPALI PENCERE ──────────────────────────────────────────────────
 * "hafta"/"ay" pencerelerinin SONU ŞİMDİ'dir: telemetri akıyor, açık vardiyanın
 * süresi `Date.now()` okuyor. O pencerede ucu iki kez çağırmak bile farklı çıktı
 * verir, yani önce/sonra kıyası ölçümün kendi rastlantısına bağlı kalır (aynı
 * ders CSV Tur 2'de ölçüldü). Bu yüzden denklik kıyası TAMAMI GEÇMİŞTE kalan
 * pencerelerde yapılır; SÜRE ise ayrı betikte (measure:filo-karsilastir) canlı
 * pencerelerde ölçülür.
 *
 * ── NASIL KULLANILIR ──────────────────────────────────────────────────────
 *   CIKTI=once.json  ENV_FILE=… npm run verify:filo-karsilastir-hiz   (git stash ile ESKİ kod)
 *   CIKTI=sonra.json ENV_FILE=… npm run verify:filo-karsilastir-hiz   (YENİ kod)
 *   node -e "…"  → iki dosyayı diff'le (betik kendisi de karşılaştırır: KIYAS=once.json)
 *
 * Çıktı KANONİK: diziler sabit anahtara göre sıralanır, nesne anahtarları
 * alfabetik. Böylece "sıra değişti" gürültüsü kıyasa karışmaz.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { supabaseAdmin } from "@/lib/supabase";
import { buildFleetComparison } from "@/lib/fleet-compare";
import { buildFuelReport } from "@/lib/reports";
import { startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";
import { UNRESTRICTED } from "@/lib/fleet-scope";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptk")
  ? "HAK61"
  : url.includes("ftbaz")
    ? "Sendigo"
    : "galzura-demo";

let gecen = 0;
const dusen = [];
const ok = (b, k, kanit) => {
  if (k) {
    gecen++;
    console.log(`  ✓ ${b}${kanit ? `   [${kanit}]` : ""}`);
  } else {
    dusen.push({ b, kanit });
    console.log(`  ✗ ${b}   [${kanit}]`);
  }
};

/** Anahtarları alfabetik sıraya sokan kanonik JSON. */
function kanonik(v) {
  if (Array.isArray(v)) return v.map(kanonik);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = kanonik(v[k]);
    return out;
  }
  // Kayan nokta gürültüsü kıyası bozmasın: aynı formül aynı sırada toplanmadığı
  // an son basamak oynayabilir. 1e-9 mertebesinde yuvarlanır — bu tur toplama
  // SIRASINI değiştirmiyor, yine de kıyas kırılgan olmasın.
  if (typeof v === "number" && Number.isFinite(v)) return Number(v.toPrecision(12));
  return v;
}

/** Kapalı pencereler — tamamı geçmişte. */
const PENCERELER = [
  ["01–10.08.2026", "2026-08-01", "2026-08-10"],
  ["01–07.09.2026", "2026-09-01", "2026-09-07"],
];

/** Kısıtlı (şef) kapsam — gerçek bir filo koduyla. */
async function sefKapsami() {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, fleet, assigned_worker_id");
  const rows = data ?? [];
  const kod = rows.map((v) => v.fleet).find((f) => f !== null && f !== undefined);
  if (!kod) return null;
  const vehicleIds = rows.filter((v) => v.fleet === kod).map((v) => v.id);
  const workerIds = rows
    .filter((v) => v.fleet === kod && v.assigned_worker_id)
    .map((v) => v.assigned_worker_id);
  return {
    fleet: kod,
    vehicleIds,
    workerIds,
    restricted: true,
    isFleetVehicle: (id) => vehicleIds.includes(id ?? ""),
    isFleetWorker: (id) => workerIds.includes(id ?? ""),
  };
}

console.log(`\n═══ ${KIRACI} · filo karşılaştırması denklik turu ═══`);

const sef = await sefKapsami();
const KAPSAMLAR = [["kısıtsız", UNRESTRICTED]];
if (sef) KAPSAMLAR.push([`şef(${sef.fleet})`, sef]);
else console.log("  (filo kodu olan araç yok — şef kapsamı denenmedi)");

const cikti = {};
for (const [pAd, from, to] of PENCERELER) {
  const range = { start: startOfDayViennaFromYmd(from), end: endOfDayViennaFromYmd(to) };
  for (const [kAd, kapsam] of KAPSAMLAR) {
    const etiket = `${pAd} · ${kAd}`;
    console.log(`\n────────── ${etiket} ──────────`);
    const sonuc = await buildFleetComparison(range, kapsam);
    cikti[etiket] = kanonik(sonuc);

    // ── DENKLİK 5/5 ───────────────────────────────────────────────────────
    const d = sonuc.denklik;
    const adlar = ["km", "vardiya", "alarm", "yakitLitre", "rolantiSaat"];
    const esitSayisi = adlar.filter((a) => d[a].esit).length;
    for (const a of adlar) {
      ok(
        `denklik.${a} eşit`,
        d[a].esit,
        `Σ ${Number(d[a].filolarToplami).toFixed(3)} = ${Number(d[a].kaynakToplam).toFixed(3)}`
      );
    }
    console.log(
      `     filo ${sonuc.filolar.length} · sahipsiz ${sonuc.sahipsiz ? "var" : "yok"} · ` +
        `km ${Math.round(sonuc.toplam.km)} · vardiya ${sonuc.toplam.vardiyaSayisi} · ` +
        `alarm ${sonuc.toplam.alarm.toplam} · yakıt ${sonuc.toplam.yakitLitre === null ? "—" : Math.round(sonuc.toplam.yakitLitre)} L · ` +
        `denklik ${esitSayisi}/5`
    );
  }
}

/**
 * ── PANELİN YAKIT RAPORU DA KIYASA GİRER ──────────────────────────────────
 *
 * Bu turda `buildFuelReport` içinde de bir değişiklik var (litre RPC'si artık
 * yalnız yüzde okuması OLMAYAN araca soruluyor). O rapor karşılaştırma ucunun
 * DIŞINDA da kullanılıyor: panelin Raporlar › Yakıt sayfası, CO2 panosu, sefer
 * kârlılığı. Karşılaştırma ucu yalnız `consumedLiters`e bakıyor, yani onun
 * gövdesi eşit çıksa bile `lPer100Km`/`refillCount` sessizce kaymış olabilirdi.
 * Bu yüzden raporun TAMAMI ayrıca kıyaslanıyor.
 */
for (const [pAd, from, to] of PENCERELER) {
  const range = { start: startOfDayViennaFromYmd(from), end: endOfDayViennaFromYmd(to) };
  const y = await buildFuelReport(range);
  cikti[`YAKIT RAPORU · ${pAd}`] = kanonik(y);
  console.log(
    `
── yakıt raporu · ${pAd}: ${y.rows.length} araç · ölçülen ${y.measured} · ` +
      `${Math.round(y.totalConsumedLiters)} L · filo ${y.fleetLPer100Km === null ? "—" : y.fleetLPer100Km.toFixed(2)} L/100km`
  );
}

// ── Çıktıyı yaz / kıyasla ──────────────────────────────────────────────────
const ciktiYolu = process.env.CIKTI;
if (ciktiYolu) {
  writeFileSync(ciktiYolu, JSON.stringify(cikti, null, 2), "utf8");
  console.log(`\n→ gövde yazıldı: ${ciktiYolu}`);
}
const kiyasYolu = process.env.KIYAS;
if (kiyasYolu) {
  const once = JSON.parse(readFileSync(kiyasYolu, "utf8"));
  const a = JSON.stringify(once, null, 2);
  const b = JSON.stringify(cikti, null, 2);
  if (a === b) {
    ok("🔑 cevap gövdesi ÖNCE/SONRA BİREBİR aynı (kanonik JSON)", true, `${b.length} bayt`);
  } else {
    // Farkı SATIR SATIR göster — "değişti" demek yetmez, NE değişti yazılmalı.
    const al = a.split("\n");
    const bl = b.split("\n");
    const fark = [];
    for (let i = 0; i < Math.max(al.length, bl.length) && fark.length < 12; i++) {
      if (al[i] !== bl[i]) fark.push(`  satır ${i + 1}: ${al[i] ?? "—"}  →  ${bl[i] ?? "—"}`);
    }
    ok("🔑 cevap gövdesi ÖNCE/SONRA BİREBİR aynı (kanonik JSON)", false, `\n${fark.join("\n")}`);
  }
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} denklik turu: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.b}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
