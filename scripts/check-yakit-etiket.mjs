#!/usr/bin/env node
/**
 * YAKIT SERİSİ ETİKETİ MUHAFIZI (migration 101, 16b).
 *
 * Bu turun tek sözü şu: **v2, v1'in AYNI SAYISINI daha az iş yaparak üretir.**
 * Söz iki yerden bozulabilir ve ikisi de sessizdir:
 *
 *   1. v2'nin içindeki eşikler (de-glitch 10 puan, dolum 5 puan, seri 15
 *      dakika, sifon "odometre 1 km'den az") v1'den AYRIŞIRSA — çıktı
 *      değişir ama hiçbir tip hatası, hiçbir test kırmızısı olmaz.
 *   2. Geri düşüş katmanları kalkarsa — 101 uygulanmamış bir kiracıda rapor
 *      yarım kalır.
 *
 * Bu yüzden denetimler İKİ SQL GÖVDESİNİ KARŞILAŞTIRIYOR, ayrı ayrı
 * "eşik doğru mu" diye bakmıyor: doğruluk ölçütü v1'in kendisi.
 *
 * Kullanım: npm run lint:yakit-etiket
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => readFileSync(join(KOK, p), "utf8");

let gecen = 0;
const dusen = [];
const kontrol = (ad, kosul, kanit = "") => {
  if (kosul) gecen++;
  else dusen.push({ ad, kanit });
};

const m052 = oku("db/migrations/052_shift_distance_and_refill_merge.sql");
const m101 = oku("db/migrations/101_yakit_seri_etiket.sql");
const m102 = oku("db/migrations/102_yakit_v2_pencere_duzeltme.sql");
const raporLib = oku("lib/reports.ts");
const tenantLib = oku("lib/tenant.ts");
const cron = oku("app/api/cron/yakit-etiket/route.ts");
const cronDoc = oku("docs/CRON-KAYITLARI.md");

/**
 * ⚠️ YORUMLARI SÖKER. Bu dosyadaki bazı denetimler bir kalıbın gövdede
 * BULUNMADIĞINI iddia ediyor; SQL yorumları da gövdenin içinde olduğu için
 * kalıbı ANLATAN bir yorum denetimi yanlış yere düşürüyordu (birebir bu
 * yaşandı: 102'nin "eskiden ... idi" açıklaması O(n²) denetimini tetikledi).
 */
const kodu = (x) =>
  x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*/g, " ");

/** Bir dosyadan adı verilen fonksiyonun gövdesini çıkarır. */
function govde(kaynak, ad) {
  const b = kaynak.indexOf(`create or replace function public.${ad}(`);
  if (b < 0) return null;
  const s = kaynak.indexOf("$$;", b);
  return s < 0 ? null : kaynak.slice(b, s);
}

const v1 = govde(m052, "report_fuel_stats_vehicle");
/**
 * ⚠️ YÜRÜRLÜKTEKİ v2 102'DEDİR. 101 onu yarattı, 102 `create or replace` ile
 * üzerine yazdı (O(n²) pencere çerçevesi düzeltmesi). Denetimler EN SON
 * tanımı okumalı, yoksa kiracıda koşan gövdeyi değil tarihi doğrularız.
 */
const v2 = govde(m102, "report_fuel_stats_vehicle_v2");
kontrol("052'de report_fuel_stats_vehicle duruyor", v1 !== null);
kontrol("102'de yürürlükteki report_fuel_stats_vehicle_v2 var", v2 !== null);
kontrol(
  "101 de v2'yi tanımlıyor (102 tek başına uygulanamaz)",
  govde(m101, "report_fuel_stats_vehicle_v2") !== null
);
/**
 * 🔑 O(n²) ÇERÇEVE GERİ GELMESİN. `max()` için ters geçiş fonksiyonu yok;
 * çerçevenin başı ilerlerse Postgres her satırda baştan tarar. PGlite ölçümü
 * (aynı veri, aynı makine): 10k satır 4.800 ms · 20k 19.619 ms · 40k 69.537 ms
 * — ikiye katlamada DÖRDE katlanıyor. desc-artımlı hâli: 21 · 35 · 68 ms.
 */
kontrol(
  "🔑 v2'de O(n²) çerçeve YOK (current row and unbounded following)",
  v2 !== null && !/rows between current row and unbounded following/.test(kodu(v2)),
  v2 && /rows between current row and unbounded following/.test(kodu(v2)) ? "O(n²) çerçeve GERİ GELMİŞ" : ""
);
kontrol(
  "🔑 ileri kenar düzeltmesi desc-artımlı çerçeveyle",
  v2 !== null && /order by n\.recorded_at desc rows between unbounded preceding and current row/.test(kodu(v2))
);

// ── 1 · MIGRATION ŞEKLİ ────────────────────────────────────────────────────
kontrol("101 tek transaction (begin/commit)", /^begin;/m.test(m101) && /^commit;/m.test(m101));
kontrol("101 şema yeniden yüklenmesini bildiriyor", /notify pgrst/.test(m101));
kontrol("101 additive: create table if not exists", /create table if not exists public\.fuel_seri/.test(m101));
kontrol(
  "101 ESKİ fonksiyonu DÜŞÜRMÜYOR (geri düşüş yolu duruyor)",
  !/drop\s+function[^;]*report_fuel_stats_vehicle\s*\(/i.test(m101)
);
kontrol(
  "101 device_telemetry'ye ALTER/UPDATE yapmıyor (sıcak tabloya dokunulmuyor)",
  !/alter table[^;]*device_telemetry/i.test(m101) && !/update\s+public\.device_telemetry/i.test(m101)
);
kontrol(
  "101 geri alma yolunu başlıkta yazıyor",
  /drop table if exists public\.fuel_seri/.test(m101)
);
for (const k of ["bwd_max", "fwd_max", "fuel", "odo"]) {
  kontrol(`fuel_seri ${k} kolonunu taşıyor`, new RegExp(`\\n\\s*${k}\\s`).test(m101), k);
}
kontrol(
  "fuel_seri anahtarı (vehicle_id, recorded_at)",
  /primary key \(vehicle_id, recorded_at\)/.test(m101)
);
kontrol("etiketleme upsert (tekrar çalıştırılabilir)", /on conflict \(vehicle_id, recorded_at\) do update/.test(m101));

// ── 2 · ETİKETLEME: 30 SATIRLIK ÖRTÜŞME ────────────────────────────────────
const etiketle = govde(m101, "yakit_seri_etiketle");
kontrol("yakit_seri_etiketle var", etiketle !== null);
if (etiketle) {
  /**
   * ⚠️ BU DENETİM TURUN KALBİ. Örtüşme kalkarsa gün gün etiketleme, 090'ın
   * ölçtüğü kenar kırpmasını (+%15,6) aynen üretir ve HİÇBİR ŞEY hata vermez.
   */
  const geri = (etiketle.match(/order by dt\.recorded_at desc\s*\n\s*limit 30/g) ?? []).length;
  const ileri = (etiketle.match(/order by dt\.recorded_at asc\s*\n\s*limit 30/g) ?? []).length;
  kontrol("🔑 etiketleme aralığın İKİ yanından 30'ar satır genişliyor", geri >= 1 && ileri >= 1, `geri ${geri} · ileri ${ileri}`);
  kontrol(
    "🔑 yazma YALNIZ aralık içine (örtüşme satırları yazılmıyor)",
    /where p\.recorded_at >= p_from\s*\n\s*and p\.recorded_at <= p_to/.test(etiketle)
  );
  /**
   * ⚠️ ÇERÇEVE GENİŞLİĞİ v1'DEN OKUNUYOR. Arıza enjeksiyonunda bulundu:
   * etiketleme çerçevesi 30'dan 5'e çekildiğinde muhafız susuyordu.
   * Etiket, v1'in kullandığı çerçevenin AYNISIYLA üretilmek zorunda.
   */
  const v1Cerceve = v1?.match(/rows between (\d+) preceding and current row/);
  const etCerceve = etiketle.match(/rows between (\d+) preceding and current row/);
  const v1Ileri = v1?.match(/rows between current row and (\d+) following/);
  const etIleri = etiketle.match(/rows between current row and (\d+) following/);
  kontrol(
    "🔑 etiketleme çerçevesi v1 ile AYNI (geri)",
    v1Cerceve !== null && etCerceve !== null && v1Cerceve[1] === etCerceve[1],
    `v1=${v1Cerceve?.[1] ?? "?"} · etiket=${etCerceve?.[1] ?? "?"}`
  );
  kontrol(
    "🔑 etiketleme çerçevesi v1 ile AYNI (ileri)",
    v1Ileri !== null && etIleri !== null && v1Ileri[1] === etIleri[1],
    `v1=${v1Ileri?.[1] ?? "?"} · etiket=${etIleri?.[1] ?? "?"}`
  );
  kontrol(
    "pencere ARAÇ BAZINDA bölünüyor (partition by vehicle_id)",
    /partition by m\.vehicle_id order by m\.recorded_at/.test(etiketle)
  );
}

// ── 3 · v2 = v1 · EŞİKLER BİREBİR ──────────────────────────────────────────
if (v1 && v2) {
  /**
   * Eşikler v1'den OKUNUP v2'de aranıyor; sabitler bu dosyaya yazılmıyor.
   * Böylece bir gün v1'in eşiği değişirse denetim onu da yakalar.
   */
  const ESIK_DESENLERI = [
    ["de-glitch · uç satır (ileri)", /rn = 1\s+then fwd_max - fuel >= (\d+)/],
    ["de-glitch · son satır (geri)", /rn = cnt then bwd_max - fuel >= (\d+)/],
    ["de-glitch · iç satır (iki yanlı)", /else bwd_max - fuel >= (\d+) and fwd_max - fuel >= \d+/],
    ["seri kopma süresi", /recorded_at - s\.prev_at > interval '(\d+ minutes)'/],
    ["dolum eşiği", /from rises where total_rise >= (\d+)/],
    ["sifon düşüş eşiği", /prev_fuel - fuel >= (\d+)/],
    ["sifon odometre kapısı", /odo - prev_odo < (\d+)/],
  ];
  for (const [ad, desen] of ESIK_DESENLERI) {
    const a = v1.match(desen);
    // v2'de kolon adları pencereye göre düzeltildiği için _w ekli olabilir.
    const v2n = v2.replace(/bwd_w/g, "bwd_max").replace(/fwd_w/g, "fwd_max");
    const b = v2n.match(desen);
    kontrol(
      `🔑 v2 eşiği v1 ile AYNI — ${ad}`,
      a !== null && b !== null && a[1] === b[1],
      `v1=${a?.[1] ?? "?"} · v2=${b?.[1] ?? "?"}`
    );
  }
  kontrol(
    "🔑 v2 aynı 11 kolonu döndürüyor",
    ["sample_count","avg_pct","min_pct","max_pct","first_pct","last_pct","refill_count","refill_pct","drop_count","drop_pct"]
      .every((k) => v2.includes(`${k} `) || v2.includes(`${k}\n`) || v2.includes(`as ${k}`))
  );
  kontrol(
    "🔑 v2 'hiç temiz satır yoksa SATIR DÖNDÜRME' kuralını taşıyor",
    /where exists \(select 1 from clean\)/.test(v2)
  );
  // Pencereye göre düzeltme olmadan çıktı BİREBİR olmaz (ilk/son 31 satır).
  kontrol(
    "🔑 v2 pencere KENARINI yeniden hesaplıyor (ilk/son 31 satır)",
    /rn <= 31/.test(v2) && /rn > n\.cnt - 31/.test(v2)
  );
  kontrol(
    "🔑 v2 etiketsiz KUYRUĞU canlı hesaplıyor (melez okuma)",
    /kuyruk_ham/.test(v2) && /kuyruk as \(/.test(v2)
  );
  kontrol(
    "🔑 kuyruğun örtüşme satırları base'e İKİNCİ KEZ girmiyor",
    /k\.recorded_at >= e\.t/.test(v2)
  );
}

// ── 4 · UYGULAMA: BAYRAK + GERİ DÜŞÜŞ ──────────────────────────────────────
kontrol("YAKIT_OZET_ENABLED bayrağı tek yerde", /export const YAKIT_OZET_ENABLED = envBool\(/.test(tenantLib));
kontrol("bayrak varsayılanı açık", /YAKIT_OZET_ENABLED = envBool\(process\.env\.YAKIT_OZET_ENABLED, true\)/.test(tenantLib));
kontrol("yakıt raporu bayrağa bakıyor", /YAKIT_OZET_ENABLED[\s\S]{0,120}report_fuel_stats_vehicle_v2/.test(raporLib));
kontrol(
  "🔑 v2 yoksa rapor KOMPLE eski yola dönüyor (yarım sonuç yok)",
  /missing_function[\s\S]{0,200}yuzdeCagir\("report_fuel_stats_vehicle"\)/.test(raporLib)
);
kontrol(
  "zaman aşımı tekrarı AYNI sürümle yapılıyor",
  /perVehicle\[i\] = await supabaseAdmin\.rpc\(yuzdeRpc,/.test(raporLib)
);

// ── 5 · CRON ───────────────────────────────────────────────────────────────
kontrol("cron CRON_SECRET istiyor", /process\.env\.CRON_SECRET/.test(cron));
kontrol("cron sırrı BAŞLIKTAN da kabul ediyor", /authorization[\s\S]{0,120}Bearer /.test(cron));
kontrol("cron zamanlama-güvenli karşılaştırma (safeEqual)", /safeEqual\(/.test(cron));
kontrol("cron maxDuration 300", /export const maxDuration = 300/.test(cron));
kontrol("cron ?gun= ile parçalı koşuyor", /gunParam/.test(cron) && /\.\./.test(cron));
kontrol("cron aralık tavanı var (maxDuration koruması)", /aralik_cok_genis/.test(cron));
kontrol("cron kuru mod sunuyor", /kuru/.test(cron));
kontrol(
  "🔑 cron device_telemetry'ye YAZMIYOR",
  !/from\("device_telemetry"\)[\s\S]{0,80}(insert|update|upsert|delete)/i.test(cron) &&
    !/\.(insert|update|upsert|delete)\(/.test(cron)
);
kontrol("cron 101 yoksa AÇIKÇA söylüyor", /migration_101_yok/.test(cron));
kontrol("cron düşen günü gizlemiyor", /dusenGun/.test(cron));

// ── 6 · BELGE ──────────────────────────────────────────────────────────────
kontrol("CRON-KAYITLARI'na 11 numaralı iş girdi", /\| 11 \|[^|]*yakit-etiket|\/api\/cron\/yakit-etiket/.test(cronDoc));
kontrol("belgede 03:15 Europe/Vienna yazıyor", /03:15/.test(cronDoc) && /Europe\/Vienna/.test(cronDoc));
kontrol("belgede kill-switch yazılı", /YAKIT_OZET_ENABLED/.test(cronDoc));

// ── SONUÇ ──────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(`✓ yakıt etiketi muhafızı: ${gecen} denetim geçti (101 + v2 eşikleri + geri düşüş + cron).`);
  process.exit(0);
}
console.log(`✗ YAKIT ETİKETİ MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.log(`  · ${d.ad}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.log(
  `\n  Bu denetimler turun SÖZÜDÜR:\n` +
    `    · v2'nin eşikleri v1'den AYRIŞAMAZ — doğruluk ölçütü v1'in kendisi\n` +
    `    · etiketleme örtüşmesi kalkarsa 090'ın +%15,6'sı geri gelir\n` +
    `    · geri düşüş katmanları kalkarsa 101 uygulanmamış kiracı yarım rapor görür`
);
process.exit(1);
