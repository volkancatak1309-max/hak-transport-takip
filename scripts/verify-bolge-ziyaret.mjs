#!/usr/bin/env node
/**
 * MÜŞTERİ BÖLGESİ ZİYARET MOTORU — CANLIDA KANIT (FAZ C, migration 064).
 *
 * İki bölüm:
 *
 *   A) SAF DAVRANIŞ — `ziyaretPlaniHesapla` / `gapTimeoutKapanislari` sentetik
 *      nokta dizileriyle sürülür. Burada aranan tek şey KARAR: ne açılıyor, ne
 *      kapanıyor, ne siliniyor, başlangıç anı hangi nokta.
 *
 *   B) GERÇEK VERİYLE TEKRAR OYNATMA — canlı `device_telemetry`den bir aracın
 *      bugünkü noktaları OKUNUR (salt okuma), en uzun durakladığı yere sentetik
 *      bir müşteri bölgesi konur ve noktalar CRON'UN GÖRDÜĞÜ GİBİ 2 dakikalık
 *      dilimler hâlinde motora verilir. Motorun yazacağı süre, aynı noktalardan
 *      BAĞIMSIZ hesaplanan gerçek kalış süresiyle karşılaştırılır.
 *
 * ── B NEDEN DİLİM DİLİM ───────────────────────────────────────────────────
 * Motorun ilk sürümü eşiği TUR İÇİNDE arıyordu ve cron 2 dakikada bir koştuğu
 * için 120 sn'lik eşik kıl payı, 180 sn'lik eşik ise ASLA dolmuyordu. Tüm
 * noktaları tek seferde vermek bu hatayı GİZLERDİ — canlının gerçeği dilimli
 * akıştır, ölçüm de öyle kurulmalı.
 *
 * ── ⚠️ CANLI VERİTABANI ───────────────────────────────────────────────────
 * HİÇBİR ŞEY YAZMAZ. Tek DB erişimi salt okuma `select`tir; motorun yazma
 * fonksiyonu (`ziyaretPlaniniYaz`) bu betikte HİÇ çağrılmaz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-bolge-ziyaret.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { ziyaretPlaniHesapla, gapTimeoutKapanislari } from "@/lib/zone-visits";

let hata = 0;
const ok = (ad, kosul, detay = "") => {
  if (kosul) console.log(`  ✓ ${ad}`);
  else {
    console.log(`  ✗ ${ad}${detay ? ` — ${detay}` : ""}`);
    hata++;
  }
};

const T0 = Date.parse("2026-08-19T08:00:00Z");
const an = (sn) => new Date(T0 + sn * 1000).toISOString();
/** Bölge merkezi (0 m) ve dışarısı (~1,3 km) — yarıçap 200 m. */
const ICERI = { latitude: 47.4, longitude: 9.7 };
const DISARI = { latitude: 47.4, longitude: 9.717 };
const nokta = (sn, yer) => ({ ...yer, recorded_at: an(sn) });

const BOLGE = {
  id: "z1",
  name: "Test müşteri",
  center_lat: 47.4,
  center_lng: 9.7,
  radius_m: 200,
  min_dwell_s: 120,
  customer_name: "Test GmbH",
};
const acikSatir = (baslangicSn, sonGorulenSn) => ({
  id: "v1",
  vehicle_id: "a1",
  zone_id: "z1",
  worker_id: "w1",
  started_at: an(baslangicSn),
  last_seen_at: an(sonGorulenSn),
});
const hesapla = (noktalar, acik = []) =>
  ziyaretPlaniHesapla("a1", "w1", noktalar, [BOLGE], acik);

console.log("\n── A) SAF DAVRANIŞ ─────────────────────────────────────────");

// A1 — yoldan geçiş: eşik dolmadan girip çıktı → HİÇBİR ŞEY yazılmaz.
{
  const p = hesapla([nokta(0, DISARI), nokta(30, ICERI), nokta(60, ICERI), nokta(90, DISARI)]);
  ok(
    "A1 yoldan geçiş (60 sn < 120) hiç yazılmaz",
    p.yeni.length === 0 && p.guncel.length === 0 && p.silinecek.length === 0,
    JSON.stringify(p)
  );
}

// A2 — içeri girdi ve tur içeride bitti → AÇIK satır, başlangıç = ilk içeri nokta.
{
  const p = hesapla([nokta(0, DISARI), nokta(30, ICERI), nokta(90, ICERI)]);
  ok(
    "A2 içeri girip kaldı → açık satır",
    p.yeni.length === 1 && p.yeni[0].ended_at === null,
    JSON.stringify(p.yeni)
  );
  ok(
    "A2 başlangıç = KAPIDAN GİRİŞ anı (eşiğin dolduğu an değil)",
    p.yeni[0]?.started_at === an(30),
    `beklenen ${an(30)}, gelen ${p.yeni[0]?.started_at}`
  );
}

// A3 — REGRESYON: eşik tur penceresinden UZUN. Eski kod burada asla açmıyordu.
{
  const uzunEsik = { ...BOLGE, min_dwell_s: 600 };
  const p = ziyaretPlaniHesapla(
    "a1",
    "w1",
    [nokta(0, ICERI), nokta(60, ICERI), nokta(115, ICERI)], // 2 dk'lık tur dilimi
    [uzunEsik],
    []
  );
  ok(
    "A3 eşik(600 sn) > tur penceresi(115 sn) → ziyaret YİNE de açılır",
    p.yeni.length === 1 && p.yeni[0].ended_at === null,
    JSON.stringify(p.yeni)
  );
}

// A4 — açık satır sürüyor → yalnız last_seen ilerler, ended_at null kalır.
{
  const p = hesapla([nokta(200, ICERI), nokta(260, ICERI)], [acikSatir(0, 150)]);
  ok(
    "A4 açık ziyaret sürüyor → last_seen ilerler, kapanmaz",
    p.guncel.length === 1 &&
      p.guncel[0].ended_at === null &&
      p.guncel[0].last_seen_at === an(260),
    JSON.stringify(p.guncel)
  );
}

// A5 — açık satır çıkışta kapanır (toplam süre eşiği geçmiş).
{
  const p = hesapla([nokta(200, ICERI), nokta(260, DISARI)], [acikSatir(0, 150)]);
  ok(
    "A5 çıkış → kapanır (end_reason=exit)",
    p.guncel.length === 1 &&
      p.guncel[0].ended_at === an(260) &&
      p.guncel[0].end_reason === "exit" &&
      p.silinecek.length === 0,
    JSON.stringify(p)
  );
  ok(
    "A5 kapanan satır TAM (last_seen NOT NULL kolonu null'a düşmüyor)",
    typeof p.guncel[0]?.last_seen_at === "string" &&
      typeof p.guncel[0]?.vehicle_id === "string" &&
      typeof p.guncel[0]?.started_at === "string",
    JSON.stringify(p.guncel[0])
  );
}

// A6 — açık satır eşiği dolduramadan çıktı → SİLİNİR, faturaya girmez.
{
  const p = hesapla([nokta(60, DISARI)], [acikSatir(30, 45)]);
  ok(
    "A6 eşiği dolduramadan çıkan açık satır SİLİNİR",
    p.silinecek.length === 1 && p.silinecek[0] === "v1" && p.guncel.length === 0,
    JSON.stringify(p)
  );
}

// A7 — aynı turda girip çıktı ama eşiği DOLDURDU → tek satırda tam ziyaret.
{
  const p = hesapla([nokta(0, ICERI), nokta(150, ICERI), nokta(200, DISARI)]);
  ok(
    "A7 aynı turda tamamlanan ziyaret tek satırda yazılır",
    p.yeni.length === 1 && p.yeni[0].started_at === an(0) && p.yeni[0].ended_at === an(200),
    JSON.stringify(p.yeni)
  );
}

// A8 — aynı turda ÇIKIP TEKRAR girdi: ikinci ziyaret de görülür (break yok).
{
  const p = hesapla([
    nokta(0, ICERI),
    nokta(150, ICERI),
    nokta(200, DISARI),
    nokta(300, ICERI),
    nokta(500, ICERI),
  ]);
  ok(
    "A8 aynı turda yeniden giriş → ikinci ziyaret de yakalanır",
    p.yeni.length === 2 &&
      p.yeni[0].ended_at === an(200) &&
      p.yeni[1].started_at === an(300) &&
      p.yeni[1].ended_at === null,
    JSON.stringify(p.yeni)
  );
}

// A9 — bekçi: sinyali kesilen ziyaret last_seen ile kapanır (uzun), kısası silinir.
{
  const simdi = T0 + 3 * 3600 * 1000;
  const uzun = { ...acikSatir(0, 900), id: "uzun" };
  const kisa = { ...acikSatir(0, 40), id: "kisa" };
  const p = gapTimeoutKapanislari([uzun, kisa], [BOLGE], simdi);
  ok(
    "A9 sinyali kesik UZUN ziyaret → gap_timeout, ended_at = last_seen",
    p.guncel.length === 1 &&
      p.guncel[0].id === "uzun" &&
      p.guncel[0].ended_at === an(900) &&
      p.guncel[0].end_reason === "gap_timeout",
    JSON.stringify(p.guncel)
  );
  ok(
    "A9 sinyali kesik KISA ziyaret → silinir (40 sn fatura satırı olmaz)",
    p.silinecek.length === 1 && p.silinecek[0] === "kisa",
    JSON.stringify(p.silinecek)
  );
  ok(
    "A9 GÖZLEMLENMEMİŞ SÜRE SAYILMAZ: ended_at 'şimdi' değil",
    p.guncel[0]?.ended_at !== new Date(simdi).toISOString(),
    p.guncel[0]?.ended_at
  );
}

console.log("\n── B) GERÇEK VERİYLE TEKRAR OYNATMA ────────────────────────");

const BASLANGIC = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

// En çok noktası olan aracı bul (salt okuma).
const { data: araclar, error: aracHata } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate")
  .not("flespi_device_id", "is", null)
  .limit(40);
if (aracHata) {
  console.log(`  ✗ araç listesi okunamadı: ${aracHata.message}`);
  hata++;
}

let secilen = null;
let noktalar = [];
for (const v of araclar ?? []) {
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select("latitude, longitude, recorded_at")
    .eq("vehicle_id", v.id)
    .gte("recorded_at", BASLANGIC)
    .not("latitude", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(1000);
  const p = (data ?? []).filter((x) => x.latitude !== null && x.longitude !== null);
  if (p.length > noktalar.length) {
    noktalar = p;
    secilen = v;
  }
  if (noktalar.length >= 400) break;
}

if (!secilen || noktalar.length < 30) {
  console.log(`  ⚠ son 12 saatte yeterli nokta yok (${noktalar.length}) — B atlandı`);
} else {
  console.log(`  araç ${secilen.plate}, ${noktalar.length} nokta (son 12 saat)`);

  // ── EN UZUN DURAKLAMA: ardışık noktalar 150 m içinde kaldığı en uzun aralık.
  const metre = (a, b) => {
    const R = 6371000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
    const la = (a.latitude * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(la) ** 2 * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  let enIyi = null;
  for (let i = 0; i < noktalar.length; i++) {
    let j = i;
    while (j + 1 < noktalar.length && metre(noktalar[i], noktalar[j + 1]) < 150) j++;
    const sure =
      Date.parse(noktalar[j].recorded_at) - Date.parse(noktalar[i].recorded_at);
    if (!enIyi || sure > enIyi.sure) enIyi = { i, j, sure };
  }

  const merkez = noktalar[enIyi.i];
  const duraklamaDk = Math.round(enIyi.sure / 60000);
  console.log(
    `  en uzun duraklama: ${duraklamaDk} dk (${noktalar[enIyi.i].recorded_at} → ${noktalar[enIyi.j].recorded_at})`
  );

  if (enIyi.sure < 5 * 60000) {
    console.log("  ⚠ duraklama 5 dk'dan kısa — anlamlı kıyas kurulamaz, B atlandı");
  } else {
    const bolge = {
      id: "gercek-z",
      name: "Sentetik müşteri bölgesi",
      center_lat: merkez.latitude,
      center_lng: merkez.longitude,
      radius_m: 200,
      min_dwell_s: 180, // eski kodun ASLA dolduramadığı eşik
      customer_name: "Kanıt A.Ş.",
    };

    // BAĞIMSIZ GERÇEK: bölge içindeki ilk ve son noktanın arası (motoru
    // kullanmadan, doğrudan noktalardan).
    const icerdekiler = noktalar.filter(
      (p) => metre(p, { latitude: bolge.center_lat, longitude: bolge.center_lng }) <= bolge.radius_m
    );
    const gercekBas = icerdekiler[0]?.recorded_at;
    const gercekSon = icerdekiler[icerdekiler.length - 1]?.recorded_at;

    // ── CRON SİMÜLASYONU: 2 dakikalık dilimler, DB durumu bellekte tutulur.
    const DILIM_MS = 2 * 60 * 1000;
    const bas = Date.parse(noktalar[0].recorded_at);
    const son = Date.parse(noktalar[noktalar.length - 1].recorded_at);
    let acik = [];
    const kapanan = [];
    let silinen = 0;
    let sonrakiId = 1;

    for (let t = bas; t <= son; t += DILIM_MS) {
      const dilim = noktalar.filter((p) => {
        const x = Date.parse(p.recorded_at);
        return x >= t && x < t + DILIM_MS;
      });
      if (dilim.length === 0) continue;
      const plan = ziyaretPlaniHesapla("arac", "sofor", dilim, [bolge], acik);

      // Planı BELLEKTE uygula — DB'ye hiçbir şey yazılmıyor.
      for (const y of plan.yeni) {
        if (y.ended_at) kapanan.push(y);
        else
          acik.push({
            id: `m${sonrakiId++}`,
            vehicle_id: "arac",
            zone_id: bolge.id,
            worker_id: "sofor",
            started_at: y.started_at,
            last_seen_at: y.last_seen_at,
          });
      }
      for (const g of plan.guncel) {
        if (g.ended_at) {
          kapanan.push(g);
          acik = acik.filter((z) => z.id !== g.id);
        } else {
          const z = acik.find((x) => x.id === g.id);
          if (z) z.last_seen_at = g.last_seen_at;
        }
      }
      for (const id of plan.silinecek) {
        acik = acik.filter((z) => z.id !== id);
        silinen++;
      }
    }

    const tamamlanan = kapanan.filter((k) => k.ended_at);
    const enUzun = tamamlanan.sort(
      (a, b) =>
        Date.parse(b.ended_at) - Date.parse(b.started_at) - (Date.parse(a.ended_at) - Date.parse(a.started_at))
    )[0];
    const acikKalan = acik[0] ?? null;

    console.log(
      `  motor: ${tamamlanan.length} tamamlanmış ziyaret, ${acik.length} açık, ${silinen} kısa silindi`
    );

    ok(
      "B1 gerçek duraklama bir ziyaret olarak yakalandı",
      tamamlanan.length > 0 || acikKalan !== null,
      "hiç ziyaret üretilmedi"
    );

    const olculen = enUzun ?? acikKalan;
    if (olculen) {
      const motorBas = olculen.started_at;
      ok(
        "B2 ziyaretin başlangıcı, bölgeye giren İLK gerçek noktadır",
        motorBas === gercekBas,
        `bağımsız ${gercekBas} · motor ${motorBas}`
      );
      if (enUzun) {
        const motorSure = Date.parse(enUzun.ended_at) - Date.parse(enUzun.started_at);
        const gercekSure = Date.parse(gercekSon) - Date.parse(gercekBas);
        // Motor çıkışı, bölge DIŞINDAKİ ilk noktada kapatır; bağımsız hesap ise
        // içerideki SON noktayı alır. Aradaki fark tam olarak bir örnekleme
        // aralığıdır — 5 dakikayı aşmamalı.
        const fark = Math.abs(motorSure - gercekSure);
        ok(
          "B3 süre bağımsız hesapla örtüşüyor (fark ≤ 1 örnekleme aralığı)",
          fark <= 5 * 60000,
          `motor ${Math.round(motorSure / 60000)} dk · bağımsız ${Math.round(gercekSure / 60000)} dk`
        );
        console.log(
          `  motor süresi ${Math.round(motorSure / 60000)} dk · bağımsız ${Math.round(gercekSure / 60000)} dk`
        );
      } else {
        console.log(`  (araç hâlâ içeride — süre YOK, doğru davranış)`);
      }
    }

    ok(
      "B4 eşik(180 sn) tur penceresinden(120 sn) uzunken de ölçüm çalıştı",
      tamamlanan.length > 0 || acikKalan !== null
    );
  }
}

console.log(
  hata === 0 ? "\n✅ TÜM KONTROLLER GEÇTİ\n" : `\n❌ ${hata} KONTROL DÜŞTÜ\n`
);
process.exit(hata === 0 ? 0 : 1);
