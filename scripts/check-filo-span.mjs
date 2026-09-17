#!/usr/bin/env node
/**
 * MUHAFIZ — ODOMETRE AÇIKLIĞI: TEK ÇEKİRDEK, SESSİZ SAPMA YOK (105 / 16c).
 *
 * ═══ HANGİ HATAYI BEKLİYOR ════════════════════════════════════════════════
 * 17.09.2026'da ölçüldü: `fleet_odometer_spans` (097) ifade tavanını aşınca
 * `getFleetDistanceSpans` sessizce `null` dönüyor, çağıran araç-araç yola
 * düşüyordu — ve o yol BAŞKA BİR KURAL uyguluyordu (temizlik yok). Aynı araç,
 * aynı pencere, İKİ FARKLI SAYI; hangisinin çıkacağı YÜKE bağlıydı:
 *
 *   galzura-demo · W-GF-107 · 30 gün : 097 592 km · yedek null (ham ilk okuma 0)
 *   HAK61 · DO-512GT · 14 gün        : 097 692 km · yedek 751 km (+%8,5)
 *
 * Bu, `buildFuelReport.fleetLPer100Km`i demo'da 72,475250 ↔ 75,250365
 * arasında oynatıyordu (%3,8) — rapor "kararsız" görünüyordu ama sebep
 * yakıt motoru değil, PAYDAYDI.
 *
 * 105 kuralı `vehicle_odometer_span`a taşıdı; filo sürümü onu LATERAL ile
 * çağırıyor, uygulamadaki araç-araç yol da aynı fonksiyonu çağırıyor.
 * Bu muhafız o sözü donduruyor. Düşerse: ya kural ikinci bir yere kopyalandı,
 * ya da sessiz geri düşüş geri geldi.
 *
 * Kullanım:  npm run lint:filo-span
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const oku = (f) => readFileSync(join(KOK, f), "utf8");

/** SQL yorumlarını at — açıklama metni denetimi yanıltmasın (102'de yaşandı). */
const kodu = (x) => x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*/g, " ");

const M097 = oku("db/migrations/097_odometre_blok_ve_filo_span.sql");
const M105 = oku("db/migrations/105_filo_span_tek_cekirdek.sql");
const K105 = kodu(M105);
const ANALYTICS = oku("lib/analytics.ts");
const REPORTS = oku("lib/reports.ts");
const TR = oku("messages/tr.json");
const DE = oku("messages/de.json");
const EN = oku("messages/en.json");

let gecen = 0;
const dusen = [];
const kontrol = (ad, kosul, kanit = "") => {
  if (kosul) gecen++;
  else dusen.push({ ad, kanit });
};

/** Bir SQL kaynağından adı verilen fonksiyonun gövdesini çıkarır. */
function govde(kaynak, ad) {
  const b = kaynak.indexOf(`create or replace function public.${ad}(`);
  if (b < 0) return null;
  const s = kaynak.indexOf("$$;", b);
  return s < 0 ? null : kaynak.slice(b, s);
}

const cekirdek = govde(K105, "vehicle_odometer_span");
const filo105 = govde(K105, "fleet_odometer_spans");
const filo097 = govde(kodu(M097), "fleet_odometer_spans");

// ── 1 · KURAL TEK EVDE ─────────────────────────────────────────────────────
kontrol("105 `vehicle_odometer_span` tanımlıyor", cekirdek !== null);
kontrol("105 `fleet_odometer_spans`i yeniden tanımlıyor", filo105 !== null);
kontrol(
  "filo sürümü çekirdeği LATERAL ile ÇAĞIRIYOR",
  !!filo105 && /cross\s+join\s+lateral\s+public\.vehicle_odometer_span/i.test(filo105)
);
/**
 * 🔴 ASIL DENETİM: filo sürümü kuralın İKİNCİ BİR KOPYASINI taşımamalı.
 * Taşırsa 16c'nin çözdüğü ayrışma sessizce geri gelir.
 */
for (const [ad, kalip] of [
  ["monotonluk penceresi", /rows\s+between\s+unbounded\s+preceding\s+and\s+1\s+preceding/i],
  ["blok başı indirgemesi", /odometer_km\s*<>\s*onc_km/i],
  ["fiziksel atlama kapısı", /3600\.0\s*\*\s*200/],
]) {
  kontrol(
    `filo sürümünde ${ad} KOPYASI yok (kural yalnız çekirdekte)`,
    !!filo105 && !kalip.test(filo105) && !!cekirdek && kalip.test(cekirdek)
  );
}

// ── 2 · ÇEKİRDEK 097'NİN KURALINI BİREBİR TAŞIYOR ─────────────────────────
/**
 * Sabitler BURAYA YAZILMIYOR, 097'den okunuyor: eşik bir gün değişirse bu
 * muhafız kendi kopyasını değil, gerçek kaynağı karşılaştırmaya devam etsin.
 */
const katsayi097 = filo097?.match(/3600\.0\s*\*\s*(\d+)/)?.[1] ?? null;
const katsayiCekirdek = cekirdek?.match(/3600\.0\s*\*\s*(\d+)/)?.[1] ?? null;
kontrol(
  "kapı katsayısı 097 ile aynı",
  katsayi097 !== null && katsayi097 === katsayiCekirdek,
  `097 ${katsayi097} · 105 ${katsayiCekirdek}`
);
kontrol(
  "çekirdek zaman yüklemi `>= p_from` ve `< p_to`",
  !!cekirdek && /recorded_at\s*>=\s*p_from/i.test(cekirdek) && /recorded_at\s*<\s*p_to/i.test(cekirdek)
);
kontrol(
  "çekirdek uçları TEMİZ seriden alıyor (array_agg, min/max ham tablodan değil)",
  !!cekirdek && /array_agg\(t\.odometer_km order by t\.recorded_at asc\)/i.test(cekirdek)
);
kontrol(
  "105 hiçbir fonksiyonu DÜŞÜRMÜYOR (geri alınabilirlik)",
  !/drop\s+function/i.test(K105)
);
kontrol("105 şema yenileme bildirimi içeriyor", /notify\s+pgrst/i.test(M105));

// ── 3 · UYGULAMA: İKİ YOL AYNI ÇEKİRDEĞİ ÇAĞIRIYOR ────────────────────────
kontrol(
  "araç-araç yol `vehicle_odometer_span` RPC'sini çağırıyor",
  /rpc\("vehicle_odometer_span"/.test(ANALYTICS)
);
kontrol(
  "filo yolu `fleet_odometer_spans` RPC'sini çağırıyor",
  /rpc\("fleet_odometer_spans"/.test(ANALYTICS)
);
/**
 * 🔴 SESSİZ SAPMA YASAĞI: geçici hatada (ifade tavanı dâhil) ham uçlara
 * DÜŞÜLMEZ. Düşersek yanlış bir sayı gösteririz; doğrusu "ölçemedim".
 */
kontrol(
  "geçici hatada `olculmedi` dönüyor (ham uçlara düşülmüyor)",
  /reason:\s*"olculmedi"/.test(ANALYTICS)
);
kontrol(
  "`olculmedi` yalnız RPC hata dalında üretiliyor (veri kusuru sanılmasın)",
  (ANALYTICS.match(/reason:\s*"olculmedi"/g) ?? []).length === 1
);
kontrol(
  "RPC yoksa (105 uygulanmamış) eski ham-uç yolu duruyor",
  /function hamUclar\(/.test(ANALYTICS) && /aracSpanRpcVar = false/.test(ANALYTICS)
);
kontrol(
  "latch var: fonksiyon bir kez bulunamazsa tekrar denenmiyor",
  /let aracSpanRpcVar/.test(ANALYTICS)
);

// ── 4 · MAKULLÜK KAPISI TEK YERDE ──────────────────────────────────────────
/**
 * `MAX_PLAUSIBLE_KM_PER_DAY` span yollarında YALNIZ `uctanSpan` içinde
 * geçmeli. İkinci bir kopyası doğarsa iki yol yine ayrışabilir — bu sefer
 * SQL'de değil, uygulamada.
 */
const uctanBas = ANALYTICS.indexOf("function uctanSpan(");
const uctanSon = uctanBas < 0 ? -1 : ANALYTICS.indexOf("\n}", uctanBas);
const uctanGovde = uctanBas < 0 ? "" : ANALYTICS.slice(uctanBas, uctanSon);
kontrol("`uctanSpan` tek kapı fonksiyonu olarak var", uctanBas >= 0);
kontrol(
  "makullük kapısı `uctanSpan` içinde",
  /diff\s*>\s*spanDays\s*\*\s*MAX_PLAUSIBLE_KM_PER_DAY/.test(uctanGovde)
);
kontrol(
  "filo yolu da `uctanSpan`i çağırıyor (kapı kopyalanmadı)",
  /out\.set\(\s*String\(r\.vehicle_id\),\s*uctanSpan\(/.test(ANALYTICS.replace(/\s+/g, " ").replace(/ /g, " ")) ||
    /uctanSpan\(\s*r\.odometre_ilk/.test(ANALYTICS)
);

// ── 5 · SEBEP KÜMESİ VE EKRAN DİLİ ────────────────────────────────────────
kontrol('`DistanceUnavailableReason` "olculmedi" içeriyor', /"olculmedi"/.test(ANALYTICS));
kontrol('`RatioUnavailableReason` "olculmedi" içeriyor', /"olculmedi"/.test(REPORTS));
for (const [ad, kaynak] of [
  ["tr", TR],
  ["de", DE],
  ["en", EN],
]) {
  kontrol(
    `${ad}: üç sebep anahtarı da var`,
    /"ratio_reason_olculmedi"/.test(kaynak) &&
      /"fuel_reason_olculmedi"/.test(kaynak) &&
      /"fuel_reason_short_olculmedi"/.test(kaynak)
  );
}

// ── 6 · KURULUM SQL'İ ─────────────────────────────────────────────────────
kontrol(
  "105 kurulum sırasına (gen-install-sql ORDER) eklendi",
  /105_filo_span_tek_cekirdek\.sql/.test(oku("scripts/gen-install-sql.mjs"))
);

// ── SONUÇ ─────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(
    `✓ filo span muhafızı: ${gecen} denetim geçti (105 · tek çekirdek + sessiz sapma yasağı).`
  );
  process.exit(0);
}
console.log(`✗ FİLO SPAN MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.log(`  · ${d.ad}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.log(
  `\n  Bu denetimler turun SÖZÜDÜR:\n` +
    `    · kural TEK YERDE durur — ikinci kopya doğarsa iki yol yine ayrışır\n` +
    `    · tavan aşımında YANLIŞ SAYI değil "ölçülemedi" gösterilir\n` +
    `    · 105 uygulanmamış kiracıda eski yol aynen çalışmaya devam eder`
);
process.exit(1);
