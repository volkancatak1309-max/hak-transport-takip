#!/usr/bin/env node
/**
 * DEMO TOHUMU — rota optimizasyonu için 10 duraklı, KASITLI KÖTÜ sıralanmış
 * bir sefer (Vorarlberg). Satış demosunda "önce/sonra" farkı gözle görülsün.
 *
 * ═══ VARSAYILAN KURU KOŞUM ═══
 *
 *   node scripts/seed-demo-rota.mjs
 *       → hiçbir veritabanına bağlanmaz; planı ve kuş uçuşu tahminini basar.
 *   node --env-file=<env> scripts/seed-demo-rota.mjs
 *       → env varsa YALNIZ OKUR (hangi şoför/araç seçilecek), YAZMAZ.
 *
 * ═══ YAZMA — İKİ ANAHTAR BİRDEN ═══
 *
 *   node --env-file=.env.galzura-demo scripts/seed-demo-rota.mjs --yaz --onay=<proje-ref>
 *
 * `--onay` hedef Supabase adresinin İLK etiketiyle (https://<proje-ref>.supabase.co)
 * BİREBİR aynı olmalı; yerel yığında (127.0.0.1/localhost) `--onay=yerel`.
 * Yani yanlış env dosyasıyla çalıştırmak tek başına yazamaz: hedefin adını
 * elle yazmak gerekir. Betik yazmadan önce hedef adresi basar.
 *
 * 🔴 HAK61 ve Sendigo CANLI MÜŞTERİDİR — bu betik yalnız galzura-demo ve yerel
 * yığın içindir (proje kuralı: test/örnek kayıt canlı müşteriye girmez).
 *
 * ═══ GERİ DÖNÜŞ ═══
 *
 *   ... --sil --onay=<proje-ref> [--tarih=YYYY-MM-DD]
 *       → bu betiğin işaretli seferlerini (notlar = İŞARET) siler; duraklar ve
 *         takip linkleri FK ile birlikte gider. Teslimat kanıtı bırakılmış bir
 *         seferi SİLMEZ (kanıt silinmez — 080); onu panelden iptal edin.
 *
 * Diğer: --tarih=YYYY-MM-DD (varsayılan: bugün, Viyana) · --sofor=<uuid>
 */
import { createClient } from "@supabase/supabase-js";

/**
 * Seferin `notlar` alanı — temizlik bu işaretle bulunur. Kısa tutuldu: şoför
 * uygulaması sefer notunu gösteriyor ve demo ekranında betik yolu görünmemeli.
 */
const ISARET = "Demo · rota optimizasyonu örneği [rota-tohum]";

/**
 * KASITLI KÖTÜ SIRA: kuzey (Bodensee kıyısı) ile güney (Walgau girişi)
 * arasında zikzak. Koordinatlar meydan/cadde merkezleri — işletme adı YOK.
 * Hepsi OSRM Avusturya verisinde yola ≤36 m oturuyor (ölçüldü, 03.10.2026).
 *
 * İKİ PENCERE, ÖLÇÜLEREK SEÇİLDİ: kötü sıra (08:00 hareket, gerçek OSRM
 * bacakları) Hard'a 09:40–10:06'da, Hohenems'e 11:08–11:34'te varıyor —
 * aşağıdaki pencerelerin İKİSİNİ de kaçırıyor; iyi sıra ikisine de yetişiyor.
 * Demo "geç kalınan durak 2 → 0"ı gösterir; uydurma değil, ölçülmüş bir fark.
 */
const DURAKLAR = [
  { ad: "Feldkirch · Bahnhof", adres: "Bahnhofstraße, 6800 Feldkirch", lat: 47.2408, lng: 9.6033, dk: 10 },
  { ad: "Bregenz · Hafen", adres: "Seestraße, 6900 Bregenz", lat: 47.5040, lng: 9.7430, dk: 15 },
  { ad: "Götzis · Zentrum", adres: "Hauptstraße, 6840 Götzis", lat: 47.3336, lng: 9.6403, dk: 5 },
  { ad: "Hard · Seestraße", adres: "Seestraße, 6971 Hard", lat: 47.4893, lng: 9.6869, dk: 10, bas: "08:30", bit: "09:30" },
  { ad: "Rankweil · Ringstraße", adres: "Ringstraße, 6830 Rankweil", lat: 47.2716, lng: 9.6420, dk: 10 },
  { ad: "Lauterach · Bahnhofstraße", adres: "Bahnhofstraße, 6923 Lauterach", lat: 47.4776, lng: 9.7314, dk: 5 },
  { ad: "Hohenems · Schweizer Straße", adres: "Schweizer Straße, 6845 Hohenems", lat: 47.3666, lng: 9.6886, dk: 10, bas: "09:30", bit: "11:00" },
  { ad: "Wolfurt · Kirchstraße", adres: "Kirchstraße, 6922 Wolfurt", lat: 47.4654, lng: 9.7495, dk: 5 },
  { ad: "Lustenau · Reichsstraße", adres: "Reichsstraße, 6890 Lustenau", lat: 47.4268, lng: 9.6589, dk: 10 },
  { ad: "Dornbirn · Marktplatz", adres: "Marktplatz, 6850 Dornbirn", lat: 47.4125, lng: 9.7417, dk: 15 },
];

// ── argümanlar ───────────────────────────────────────────────────────────
const arg = (ad) => {
  const a = process.argv.find((x) => x === `--${ad}` || x.startsWith(`--${ad}=`));
  return a === undefined ? undefined : a.includes("=") ? a.split("=").slice(1).join("=") : true;
};
const YAZ = arg("yaz") === true;
const SIL = arg("sil") === true;
const ONAY = typeof arg("onay") === "string" ? arg("onay") : null;
const viyanaBugun = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
const TARIH = typeof arg("tarih") === "string" ? arg("tarih") : viyanaBugun;
const SOFOR = typeof arg("sofor") === "string" ? arg("sofor") : null;

if (!/^\d{4}-\d{2}-\d{2}$/.test(TARIH)) {
  console.error(`✗ --tarih YYYY-MM-DD olmalı: ${TARIH}`);
  process.exit(2);
}
if (YAZ && SIL) {
  console.error("✗ --yaz ve --sil birlikte kullanılamaz.");
  process.exit(2);
}

// ── kuş uçuşu tahmini (motor olmadan "fark görünür mü" sorusu) ───────────
const hav = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const s =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(s)));
};
const toplam = (sira) => sira.slice(1).reduce((t, d, i) => t + hav(sira[i], d), 0);
function enYakinKomsu(liste) {
  const kalan = liste.slice(1);
  const out = [liste[0]];
  while (kalan.length) {
    const son = out[out.length - 1];
    let en = 0;
    kalan.forEach((d, i) => {
      if (hav(son, d) < hav(son, kalan[en])) en = i;
    });
    out.push(...kalan.splice(en, 1));
  }
  return out;
}

console.log(`\nDEMO ROTA TOHUMU — ${YAZ ? "YAZMA" : SIL ? "SİLME" : "KURU KOŞUM"} · tarih ${TARIH}`);
console.log("─".repeat(72));
DURAKLAR.forEach((d, i) =>
  console.log(
    `${String(i + 1).padStart(2)}. ${d.ad.padEnd(30)} ${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}  ${String(d.dk).padStart(2)} dk` +
      (d.bas ? `  pencere ${d.bas}–${d.bit}` : "")
  )
);
const kotu = toplam(DURAKLAR);
const iyi = toplam(enYakinKomsu(DURAKLAR));
console.log("─".repeat(72));
console.log(
  `Kuş uçuşu (yalnız TAHMİN, gerçek yol değil): kötü sıra ${(kotu / 1000).toFixed(1)} km · ` +
    `en yakın komşu ${(iyi / 1000).toFixed(1)} km · fark %${Math.round((1 - iyi / kotu) * 100)}`
);

// ── veritabanı ───────────────────────────────────────────────────────────
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANAHTAR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANAHTAR) {
  if (YAZ || SIL) {
    console.error("\n✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok — --env-file=<demo env> verin.");
    process.exit(2);
  }
  console.log("\nKURU KOŞUM bitti — veritabanına bağlanılmadı, hiçbir şey yazılmadı.");
  process.exit(0);
}

const host = new URL(URL_).hostname;
const yerel = ["127.0.0.1", "localhost", "::1"].includes(host);
const beklenenOnay = yerel ? "yerel" : host.split(".")[0];
console.log(`\nHedef: ${host}${yerel ? " (YEREL yığın)" : ""}`);

if ((YAZ || SIL) && ONAY !== beklenenOnay) {
  console.error(
    `✗ Onay tutmadı. Bu hedefe yazmak için --onay=${beklenenOnay} yazın ` +
      `(yanlış env dosyasıyla kazara yazmayı engelleyen ikinci anahtar).`
  );
  process.exit(3);
}

const db = createClient(URL_, ANAHTAR, { auth: { persistSession: false, autoRefreshToken: false } });
const ACIK = ["atandi", "kabul", "yolda"];

async function soforSec() {
  if (SOFOR) {
    const { data, error } = await db.from("workers").select("id, name, is_active").eq("id", SOFOR).maybeSingle();
    if (error || !data?.is_active) throw new Error(`şoför bulunamadı/aktif değil: ${SOFOR}`);
    return data;
  }
  const { data: adaylar, error } = await db
    .from("workers")
    .select("id, name")
    .eq("is_active", true)
    .eq("is_admin", false)
    .not("is_test", "is", true)
    .order("name");
  if (error) throw new Error(`workers okunamadı: ${error.message}`);
  for (const w of adaylar ?? []) {
    // İK1 (066): aynı şoföre aynı gün ikinci AÇIK sefer olmaz.
    const { data: acik } = await db
      .from("seferler")
      .select("id")
      .eq("worker_id", w.id)
      .eq("tarih", TARIH)
      .in("durum", ACIK)
      .limit(1);
    if (!acik?.length) return w;
  }
  throw new Error(`${TARIH} için açık seferi olmayan aktif şoför yok`);
}

async function yaz() {
  const sofor = await soforSec();
  const { data: arac } = await db
    .from("vehicles")
    .select("id, plate")
    .eq("assigned_worker_id", sofor.id)
    .not("is_test", "is", true)
    .limit(1)
    .maybeSingle();
  const { data: yonetici } = await db
    .from("workers")
    .select("id, name")
    .eq("is_active", true)
    .eq("is_admin", true)
    .order("name")
    .limit(1)
    .maybeSingle();

  console.log(`Şoför: ${sofor.name} (${sofor.id})`);
  console.log(`Araç : ${arac ? `${arac.plate} (${arac.id})` : "— (atanmış araç yok; sefer araçsız açılır)"}`);
  if (!YAZ) {
    console.log("\nKURU KOŞUM bitti — yalnız okundu, hiçbir şey yazılmadı.");
    return;
  }

  const { data: sefer, error: e1 } = await db
    .from("seferler")
    .insert({
      tarih: TARIH,
      worker_id: sofor.id,
      vehicle_id: arac?.id ?? null,
      zone_id: null,
      notlar: ISARET,
      created_by: yonetici?.id ?? null,
    })
    .select("id")
    .single();
  if (e1 || !sefer) throw new Error(`sefer yazılamadı: ${e1?.message}`);

  const { error: e2 } = await db.from("sefer_duraklari").insert(
    DURAKLAR.map((d, i) => ({
      sefer_id: sefer.id,
      sira: i + 1,
      ad: d.ad,
      adres: d.adres,
      latitude: d.lat,
      longitude: d.lng,
      yaricap_m: 150,
      pencere_bas: d.bas ?? null,
      pencere_bit: d.bit ?? null,
      tahmini_sure_dk: d.dk,
      // Durak notu BOŞ: panel notu her kartta metin olarak basıyor (ölçüldü).
      notlar: null,
    }))
  );
  if (e2) {
    // Yarım tohum bırakma: duraklar yazılamadıysa sefer de geri alınır.
    await db.from("seferler").delete().eq("id", sefer.id);
    throw new Error(`duraklar yazılamadı, sefer geri alındı: ${e2.message}`);
  }
  console.log(`\n✓ Yazıldı: sefer ${sefer.id} · 10 durak (kasıtlı kötü sıra).`);
  console.log(`  Panel: Seferler › ${TARIH} › ${sofor.name} › Duraklar › "Durakları en iyi sıraya diz"`);
  console.log(`  Geri almak için: ... --sil --onay=${beklenenOnay} --tarih=${TARIH}`);
}

async function sil() {
  const { data: seferler, error } = await db.from("seferler").select("id, tarih").eq("notlar", ISARET).eq("tarih", TARIH);
  if (error) throw new Error(`seferler okunamadı: ${error.message}`);
  if (!seferler?.length) {
    console.log(`Silinecek işaretli sefer yok (${TARIH}).`);
    return;
  }
  for (const s of seferler) {
    const { count } = await db.from("teslimatlar").select("id", { count: "exact", head: true }).eq("sefer_id", s.id);
    if ((count ?? 0) > 0) {
      console.log(`  ✗ ${s.id}: ${count} teslimat kanıtı var — SİLİNMEDİ (kanıt silinmez). Panelden iptal edin.`);
      continue;
    }
    const { error: e } = await db.from("seferler").delete().eq("id", s.id).eq("notlar", ISARET);
    console.log(e ? `  ✗ ${s.id}: ${e.message}` : `  ✓ ${s.id} silindi (duraklar ve linkler FK ile birlikte).`);
  }
}

try {
  await (SIL ? sil() : yaz());
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
