#!/usr/bin/env node
/**
 * CO₂ PANOSU — KANIT (migration 089).
 *
 * Yığın: Docker Postgres 16 + PostgREST + proxy (docs/CO2-PANOSU.md §Prova).
 * Gerçek yakıt raporu, gerçek sunucu eylemleri, gerçek sefer km ölçümü.
 *
 * Kullanım:
 *   set -a; . <qa env>; set +a
 *   npm run verify:co2
 */
import { supabaseAdmin } from "@/lib/supabase";
import {
  CO2_KATSAYI_SURUM,
  CO2_TTW,
  CO2_WTT,
  co2Hesapla,
  gPerKm,
  hedefDurumu,
} from "@/lib/co2";
import { co2AyariYaz, co2Panosu } from "@/lib/co2-db";

const YONETICI = "a0000000-0000-4000-8000-00000000000a";
const ALPEN = "d1000000-0000-4000-8000-0000000000d1";
const NORD = "d2000000-0000-4000-8000-0000000000d2";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);
const n1 = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(1));

async function main() {
  const bit = new Date();
  const bas = new Date(bit.getTime() - 30 * 86_400_000);

  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · KATSAYILAR — ETİKET DOĞRU MU");

  iddia("dizel TTW 2,64 kg/L", CO2_TTW.diesel === 2.64, `${CO2_TTW.diesel}`);
  iddia(
    "🔑 WTW = TTW + WTT ve TTW'den BÜYÜK",
    CO2_TTW.diesel + CO2_WTT.diesel > CO2_TTW.diesel,
    `${CO2_TTW.diesel} + ${CO2_WTT.diesel} = ${(CO2_TTW.diesel + CO2_WTT.diesel).toFixed(2)} kg/L (+%${((CO2_WTT.diesel / CO2_TTW.diesel) * 100).toFixed(1)})`
  );
  iddia("katsayı kümesi sürümü var (PDF metodolojisine basılır)", Boolean(CO2_KATSAYI_SURUM), CO2_KATSAYI_SURUM);

  const ttw = co2Hesapla({ litre: 100, fuelType: "diesel", esas: "TTW" });
  const wtw = co2Hesapla({ litre: 100, fuelType: "diesel", esas: "WTW" });
  iddia("100 L dizel TTW = 264 kg", Math.abs(ttw.kg - 264) < 1e-9, `${ttw.kg} kg · katsayı ${ttw.katsayi}`);
  iddia("100 L dizel WTW = 325 kg", Math.abs(wtw.kg - 325) < 1e-9, `${wtw.kg} kg · katsayı ${wtw.katsayi.toFixed(2)}`);

  // ── ELEKTRİKLİ ARAÇ
  const elTtw = co2Hesapla({ litre: null, fuelType: "elektro", esas: "TTW" });
  iddia(
    "🔑 ELEKTRİKLİ ARAÇ TTW'de 0 — ve bu bir ÖLÇÜM (egzoz yok)",
    elTtw.kg === 0 && elTtw.sebep === null,
    `kg=${elTtw.kg} · sebep=${elTtw.sebep}`
  );
  const elWtwSebekesiz = co2Hesapla({ litre: null, fuelType: "elektro", esas: "WTW", sebekeGkWh: null });
  iddia(
    "🔑 ELEKTRİKLİ ARAÇ WTW'de ŞEBEKE YOKSA null — 0 DEĞİL",
    elWtwSebekesiz.kg === null && elWtwSebekesiz.sebep === "sebeke_yok",
    `kg=${elWtwSebekesiz.kg} · sebep=${elWtwSebekesiz.sebep}`
  );
  const elWtw = co2Hesapla({ litre: null, fuelType: "elektro", esas: "WTW", sebekeGkWh: 150, kWh: 200 });
  iddia("şebeke girilince WTW hesaplanıyor", Math.abs(elWtw.kg - 30) < 1e-9, `200 kWh × 150 g/kWh = ${elWtw.kg} kg`);
  const elWtwKwhsiz = co2Hesapla({ litre: null, fuelType: "elektro", esas: "WTW", sebekeGkWh: 150, kWh: null });
  iddia("  kWh ölçümü yoksa yine null", elWtwKwhsiz.kg === null && elWtwKwhsiz.sebep === "kwh_yok", `sebep=${elWtwKwhsiz.sebep}`);

  const litresiz = co2Hesapla({ litre: null, fuelType: "diesel", esas: "TTW" });
  iddia("🔑 LİTRESİ ÖLÇÜLEMEYEN ARAÇ null — 0 DEĞİL", litresiz.kg === null && litresiz.sebep === "litre_yok", `sebep=${litresiz.sebep}`);
  iddia("km yoksa g/km null", gPerKm(264, null) === null, String(gPerKm(264, null)));

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · PANO — GERÇEK TELEMETRİ LİTRESİNDEN");

  const p = await co2Panosu(bas, bit);
  iddia("089 okundu, esas geldi", !p.tabloYok && p.ayar.esas === "TTW", `esas=${p.ayar.esas} · tabloYok=${p.tabloYok}`);
  iddia("yakıt raporu çalıştı", p.yakitYok === null, p.yakitYok ?? "ok");

  const T = p.toplam;
  console.log(`  ── TOPLAM: ${n1(T.litre)} L · ${n1(T.km)} km · ${n1(T.kg)} kg · ${n1(T.gKm)} g/km`);
  console.log(`     kapsama ${T.olculenArac}/${T.toplamArac} · ölçülemeyen: ${T.olculemeyenPlakalar.join(" · ") || "yok"}`);
  iddia("toplam litre ölçüldü", (T.litre ?? 0) > 0, `${n1(T.litre)} L`);

  /**
   * HAM DOĞRULAMA — panonun kg'ı, litre × katsayı ile BİREBİR olmalı.
   * Dizel araçların litresi × 2,64; elektrikli aracın katkısı 0.
   */
  const dizelKg = p.araclar
    .filter((a) => a.fuelType === "diesel" && a.litre !== null)
    .reduce((s, a) => s + (a.litre ?? 0) * CO2_TTW.diesel, 0);
  iddia(
    "🔑 kg = litre × katsayı (ham doğrulama)",
    Math.abs((T.kg ?? 0) - dizelKg) < 0.01,
    `${n1(T.kg)} kg = ${n1(dizelKg)} kg (dizel litre × ${CO2_TTW.diesel})`
  );

  console.log("  ── ARAÇLAR");
  for (const a of p.araclar) {
    console.log(
      `     ${a.plate.padEnd(10)} ${a.fuelType.padEnd(8)} ${String(n1(a.litre)).padStart(7)} L · ${String(a.km ?? "—").padStart(5)} km · ${String(a.kg === null ? "ölçülemedi" : n1(a.kg)).padStart(10)} · ${a.sebep ?? ""}`
    );
  }

  const elektrik = p.araclar.find((a) => a.fuelType === "elektro");
  iddia("🔑 ELEKTRİKLİ ARAÇ TTW'de 0 kg (doğru)", elektrik?.kg === 0, `${elektrik?.plate} → ${elektrik?.kg} kg`);

  const telemetrisiz = p.araclar.find((a) => a.plate === "DO-204XX");
  iddia(
    "🔑 TELEMETRİSİ OLMAYAN ARAÇ 'ölçülemedi' — 0 kg DEĞİL",
    telemetrisiz?.kg === null && telemetrisiz?.sebep === "litre_yok",
    `${telemetrisiz?.plate} → kg=${telemetrisiz?.kg} · sebep=${telemetrisiz?.sebep}`
  );
  iddia(
    "  plakası kapsamada YAZILI (sessiz eksik yasak)",
    T.olculemeyenPlakalar.includes("DO-204XX"),
    T.olculemeyenPlakalar.join(" · ")
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · MÜŞTERİ KIRILIMI — İHALE FORMATI");

  console.log("  ── MÜŞTERİLER");
  for (const m of p.musteriler) {
    console.log(
      `     ${m.ad.padEnd(24)} ${m.seferSayisi} sefer · ${String(m.km ?? "—").padStart(5)} km · ${String(m.kg === null ? "ölçülemedi" : n1(m.kg)).padStart(10)} kg · ölçülemeyen ${m.olculemeyenSefer}`
    );
  }
  const alpen = p.musteriler.find((m) => m.musteriId === ALPEN);
  const nord = p.musteriler.find((m) => m.musteriId === NORD);
  iddia("🔑 MÜŞTERİ BAZLI CO₂ HESAPLANDI", (alpen?.kg ?? 0) > 0, `${alpen?.ad}: ${n1(alpen?.kg)} kg · ${alpen?.km} km`);
  iddia(
    "  yoğunluk aracın g/km'siyle tutarlı",
    alpen && alpen.gKm !== null && Math.abs(alpen.gKm - (p.araclar.find((a) => a.plate === "DO-201AA")?.gKm ?? 0)) < 1,
    `müşteri ${n1(alpen?.gKm)} g/km · araç ${n1(p.araclar.find((a) => a.plate === "DO-201AA")?.gKm)} g/km`
  );
  iddia(
    "🔑 KM'Sİ ÖLÇÜLEMEYEN SEFER TOPLAMA GİRMEDİ ama SAYILDI",
    nord?.kg === null && nord?.olculemeyenSefer === 1,
    `${nord?.ad}: kg=${nord?.kg} · ölçülemeyen ${nord?.olculemeyenSefer}/${nord?.seferSayisi} sefer`
  );

  console.log("  ── ŞOFÖRLER");
  for (const s of p.soforler) {
    console.log(`     ${s.ad.padEnd(20)} ${String(s.km ?? "—").padStart(6)} km · ${n1(s.kg)} kg · ${n1(s.gKm)} g/km`);
  }
  iddia("şoför kırılımı üretildi", p.soforler.length > 0 && (p.soforler[0].kg ?? 0) > 0, `${p.soforler.length} şoför`);

  console.log("  ── AYLIK TREND");
  for (const a of p.aylik) console.log(`     ${a.ay}: ${a.kg === null ? "—" : n1(a.kg) + " kg"} · ${n1(a.gKm)} g/km`);
  iddia("aylık seri 6 ay taşıyor", p.aylik.length === 6, `${p.aylik.length} ay`);
  iddia("  en az bir ayda sayı var", p.aylik.some((a) => a.kg !== null), p.aylik.filter((a) => a.kg !== null).map((a) => a.ay).join(" · "));

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · ESAS DEĞİŞİMİ — TÜM EKRAN AYNI CETVELE GEÇİYOR");

  const ttwKg = T.kg;
  await co2AyariYaz(
    { esas: "WTW", sebekeGkWh: null, sebekeKaynak: null, sebekeYil: null, hedefGKm: null, hedefYil: null },
    YONETICI
  );
  const pw = await co2Panosu(bas, bit);
  console.log(`  ── TTW ${n1(ttwKg)} kg → WTW ${n1(pw.toplam.kg)} kg`);
  iddia(
    "🔑 WTW'ye geçince TOPLAM ARTTI (yukarı akış eklendi)",
    (pw.toplam.kg ?? 0) > (ttwKg ?? 0),
    `+%${(((pw.toplam.kg ?? 0) / (ttwKg ?? 1) - 1) * 100).toFixed(1)}`
  );
  iddia(
    "  oran katsayı oranıyla birebir",
    Math.abs((pw.toplam.kg ?? 0) / (ttwKg ?? 1) - (CO2_TTW.diesel + CO2_WTT.diesel) / CO2_TTW.diesel) < 0.001,
    `${((pw.toplam.kg ?? 0) / (ttwKg ?? 1)).toFixed(4)} = ${((CO2_TTW.diesel + CO2_WTT.diesel) / CO2_TTW.diesel).toFixed(4)}`
  );

  const elWtwPano = pw.araclar.find((a) => a.fuelType === "elektro");
  iddia(
    "🔑 WTW'de ELEKTRİKLİ ARAÇ ARTIK 0 DEĞİL, 'ölçülemedi' (şebeke girilmemiş)",
    elWtwPano?.kg === null && elWtwPano?.sebep === "sebeke_yok",
    `${elWtwPano?.plate} → kg=${elWtwPano?.kg} · sebep=${elWtwPano?.sebep}`
  );

  /**
   * ⚠️ GERİYE DÖNÜK KIYAS: geçmiş dönemler de yeni esasla hesaplanır çünkü
   * CO₂ hiçbir yerde SAKLANMIYOR. Aylık seri de değişmeli — karışık esaslı
   * bir tablo oluşamaz.
   */
  const eskiAy = p.aylik.find((a) => a.kg !== null);
  const yeniAy = pw.aylik.find((a) => a.ay === eskiAy?.ay);
  iddia(
    "🔑 GEÇMİŞ AYLAR DA YENİ ESASLA — karışık esaslı tablo oluşmuyor",
    (yeniAy?.kg ?? 0) > (eskiAy?.kg ?? 0),
    `${eskiAy?.ay}: ${n1(eskiAy?.kg)} → ${n1(yeniAy?.kg)} kg`
  );

  await co2AyariYaz(
    { esas: "TTW", sebekeGkWh: null, sebekeKaynak: null, sebekeYil: null, hedefGKm: null, hedefYil: null },
    YONETICI
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · HEDEF");

  iddia("hedef yokken null", hedefDurumu(300, null) === null, "null");
  const tuttu = hedefDurumu(280, 300);
  const asildi = hedefDurumu(320, 300);
  iddia("hedefin altında → tuttu", tuttu?.tuttu === true, `280 vs 300 → fark ${tuttu?.fark}`);
  iddia("hedefin üstünde → aşıldı", asildi?.tuttu === false, `320 vs 300 → fark ${asildi?.fark}`);

  const hedefKm = Math.round((T.gKm ?? 0) * 0.9);
  await co2AyariYaz(
    { esas: "TTW", sebekeGkWh: null, sebekeKaynak: null, sebekeYil: null, hedefGKm: hedefKm, hedefYil: 2026 },
    YONETICI
  );
  const ph = await co2Panosu(bas, bit);
  iddia(
    "🔑 HEDEF PANODA DEĞERLENDİRİLİYOR",
    ph.hedef !== null && ph.hedef.tuttu === false,
    `gerçekleşen ${n1(ph.toplam.gKm)} g/km · hedef ${hedefKm} → aşıldı ${n1(ph.hedef?.fark)}`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · ARAÇ YAKIT TÜRÜ (089 kolonu)");

  const { data: turler } = await supabaseAdmin.from("vehicles").select("plate, fuel_type").order("plate");
  console.log("  ──", turler.map((v) => `${v.plate}=${v.fuel_type}`).join(" · "));
  iddia("kolon var ve okunuyor", turler.every((v) => v.fuel_type !== null), `${turler.length} araç`);
  iddia(
    "🔑 ELEKTRİKLİ ARAÇ DİZEL SAYILMIYOR",
    turler.some((v) => v.fuel_type === "elektro"),
    turler.filter((v) => v.fuel_type === "elektro").map((v) => v.plate).join(" · ")
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · i18n — tr.co2.report_title ALMANCA DEĞİL");

  const fs = await import("node:fs");
  const diller = ["tr", "de", "en"].map((d) => ({
    d,
    j: JSON.parse(fs.readFileSync(`messages/${d}.json`, "utf8")).co2,
  }));
  const tr = diller.find((x) => x.d === "tr").j;
  iddia(
    "🔑 tr.co2.report_title TÜRKÇE (önceden 'CO₂-Emissionsbericht' idi)",
    !/Emissionsbericht|Bericht erstellen|Monat/.test(JSON.stringify(tr)),
    tr.report_title
  );
  iddia(
    "üç dilde de metodoloji anahtarları var",
    diller.every((x) => x.j.metod_girdi && x.j.metod_olculemeyen && x.j.sebeke_aciklama),
    diller.map((x) => `${x.d}:${Object.keys(x.j).length}`).join(" · ")
  );

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
