#!/usr/bin/env node
/**
 * VARDİYA YAKIT € — CANLIDA KANIT (yalnız galzura-demo).
 *
 * GET /api/mobile/shifts/[id] `yakit` bloğuna eklenen altı alanı GERÇEK route
 * handler + GERÇEK veritabanıyla ölçer.
 *
 * ⚠️ YALNIZ galzura-demo. HAK61 ve Sendigo CANLI MÜŞTERİ (Volkan kuralı).
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 * Tek yazma: "litre null → euro null" dalını kanıtlamak için bir aracın
 * `tank_capacity_l` alanı GEÇİCİ olarak null yapılır. Demo'da depo hacmi boş
 * olan tek araç (TEST-001) hiç vardiya taşımıyor, yani bu dal başka türlü
 * canlıda gözlenemiyordu. `finally` orijinal değeri geri yazar ve geri
 * yazmanın TUTTUĞU ölçülür.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-vardiya-yakit-euro-canli.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { FUEL_PRICE_EUR_PER_L, FUEL_PRICE_COUNTRY } from "@/lib/tenant";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede. Bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(DEMO_REF)) {
  console.error(
    `✗ DURDURULDU — hedef galzura-demo DEĞİL.\n  Gelen: ${url}\n` +
      `  HAK61 ve Sendigo CANLI MÜŞTERİ; bu betik oralarda ASLA koşmaz.`
  );
  process.exit(1);
}

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

const { GET } = await import("@/app/api/mobile/shifts/[id]/route.ts");

const cagir = async (id, token) => {
  const res = await GET(
    new Request(`https://demo.galzura.com/api/mobile/shifts/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ id }) }
  );
  return { kod: res.status, govde: await res.json() };
};

let geriAlinacak = null; // { vehicleId, cap }
let silinecekKaynak = null; // geçici fuel_price_reference satırlarının source_key'i

console.log(`\n╔══ VARDİYA YAKIT € · CANLIDA KANIT (galzura-demo) ═══════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);
console.log(`║ kod varsayılanı FUEL_PRICE_EUR_PER_L = ${FUEL_PRICE_EUR_PER_L}`);

try {
  // ── 0 · ZEMİN ──────────────────────────────────────────────────────────
  baslik("0 · ORAN ZİNCİRİNİN ZEMİNİ");
  const { data: cr, error: crErr } = await supabaseAdmin
    .from("tenant_cost_rates")
    .select("fuel_eur_per_l")
    .eq("id", "singleton")
    .maybeSingle();
  const { data: fp } = await supabaseAdmin
    .from("fuel_price_reference")
    .select("reference_date, price_eur")
    .eq("fuel_type", "diesel")
    .order("reference_date", { ascending: false })
    .limit(1);
  const panelVar = !crErr && cr?.fuel_eur_per_l != null;
  const refVar = (fp ?? []).length > 0;
  const envVar = !!process.env.FUEL_PRICE_EUR_PER_L;
  bilgi(`panel satırı (076)      : ${panelVar ? cr.fuel_eur_per_l : "YOK"}`);
  bilgi(`referans satırı (077)   : ${refVar ? `${fp[0].reference_date} · ${fp[0].price_eur}` : "YOK"}`);
  bilgi(`kurulum env'i           : ${envVar ? process.env.FUEL_PRICE_EUR_PER_L : "YOK"}`);
  const beklenenKaynak = panelVar
    ? "girildi"
    : refVar
      ? "referans"
      : envVar
        ? "girildi"
        : "varsayilan";
  bilgi(`→ zincirin beklediği oranKaynak: ${beklenenKaynak}`);

  // ── JETON ──────────────────────────────────────────────────────────────
  const { data: adm } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;
  bilgi(`yönetici jetonu: ${adm.name}`);

  // ── VARDİYA SEÇİMİ: tüketimi SIFIRDAN BÜYÜK olan kapalı vardiya ────────
  baslik("1 · TÜKETİMİ OLAN KAPALI VARDİYA");
  const { data: veh } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, tank_capacity_l");
  const capById = new Map((veh ?? []).map((v) => [v.id, v.tank_capacity_l]));

  const { data: te } = await supabaseAdmin
    .from("time_entries")
    .select("id, vehicle_id, started_at, ended_at")
    .not("ended_at", "is", null)
    .not("vehicle_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(400);

  let secilen = null;
  let tarandi = 0;
  for (const e of te ?? []) {
    if (tarandi >= 120) break;
    tarandi++;
    if (capById.get(e.vehicle_id) == null) continue;
    const { data: s, error } = await supabaseAdmin.rpc("report_fuel_stats_vehicle", {
      p_from: e.started_at,
      p_to: e.ended_at,
      p_vehicle_id: e.vehicle_id,
    });
    if (error) continue;
    const row = (s ?? [])[0];
    if (!row || Number(row.sample_count) <= 0) continue;
    const first = row.first_pct != null ? Number(row.first_pct) : 0;
    const last = row.last_pct != null ? Number(row.last_pct) : 0;
    if (first - last > 0.5) {
      secilen = e;
      break;
    }
  }
  if (!secilen) throw new Error(`tüketimi olan vardiya bulunamadı (${tarandi} tarandı)`);

  const r = await cagir(secilen.id, token);
  iddia("200 döndü", r.kod === 200, `kod=${r.kod}`);
  const y = r.govde.yakit;
  iddia("yakit bloğu dolu", y != null && typeof y === "object");
  bilgi(`vardiya: ${secilen.id}`);
  bilgi(JSON.stringify(y));

  const kap = capById.get(secilen.vehicle_id);
  iddia("euroLitre sayı", typeof y.euroLitre === "number", `euroLitre=${y.euroLitre}`);
  iddia(
    "euroLitre 3 ondalıktan fazla değil",
    Math.round(y.euroLitre * 1000) / 1000 === y.euroLitre,
    `${y.euroLitre}`
  );
  iddia(
    "oranKaynak zincirin beklediği değer",
    y.oranKaynak === beklenenKaynak,
    `oranKaynak=${y.oranKaynak} · beklenen=${beklenenKaynak}`
  );
  iddia(
    "fiyatBayat yalnız referansta anlamlı",
    typeof y.fiyatBayat === "boolean" &&
      (y.oranKaynak === "referans" || y.fiyatBayat === false),
    `fiyatBayat=${y.fiyatBayat}`
  );
  iddia(
    "fiyatTarihi referans değilse null",
    y.oranKaynak === "referans"
      ? /^\d{4}-\d{2}-\d{2}$/.test(y.fiyatTarihi ?? "")
      : y.fiyatTarihi === null,
    `fiyatTarihi=${y.fiyatTarihi}`
  );
  iddia("tuketimLitre > 0", y.tuketimLitre > 0, `${y.tuketimLitre} L (depo ${kap} L)`);
  const beklenenEuro = Math.round(y.tuketimLitre * y.euroLitre * 100) / 100;
  iddia(
    "euro = tuketimLitre × euroLitre (2 ondalık)",
    y.euro === beklenenEuro,
    `${y.tuketimLitre} × ${y.euroLitre} = ${y.euro} € (beklenen ${beklenenEuro})`
  );
  const beklenenDolum = Math.round(y.dolumLitre * y.euroLitre * 100) / 100;
  iddia(
    "dolumEuro = dolumLitre × euroLitre",
    y.dolumEuro === beklenenDolum,
    `${y.dolumLitre} × ${y.euroLitre} = ${y.dolumEuro} €`
  );
  iddia(
    "euro 2 ondalıktan fazla değil",
    Math.round(y.euro * 100) / 100 === y.euro,
    `${y.euro}`
  );

  // ── 2 · TARİH KURALI: BUGÜN DEĞİL, VARDİYA BİTİŞİ ─────────────────────
  //
  // AYIRT EDİCİ KURGU: vardiyanın bitişinden ÖNCEYE ve SONRAYA birer bülten
  // yazılır. Doğru davranış ÖNCEKİNİ seçmektir — sonraki satır o vardiya
  // yaşanırken HENÜZ YAYINLANMAMIŞTI. Kod tarihe bakmasaydı (ya da yalnız
  // `now`u geriye alsaydı) en yeni satırı, yani SONRAKİNİ alırdı. İki fiyat
  // bilerek çok farklı: hangisinin seçildiği tek bakışta görünsün.
  baslik("2 · TARİH KURALI — bülten vardiya BİTİŞİNE göre seçiliyor");
  {
    const bitis = new Date(secilen.ended_at);
    const gunEkle = (n) =>
      new Date(bitis.getTime() + n * 86400000).toISOString().slice(0, 10);
    const ONCE_TARIH = gunEkle(-2);
    const SONRA_TARIH = gunEkle(5);
    const ONCE_FIYAT = 1.111;
    const SONRA_FIYAT = 1.999;
    const ortak = {
      country_code: FUEL_PRICE_COUNTRY,
      fuel_type: "diesel",
      currency: "EUR",
      statistic: "mean",
      source_key: "qa_tarih_kurali",
      source_url: "https://example.invalid/qa",
      license_note: "QA — geçici satır",
      expected_period_days: 7,
    };
    const yaz = async (satirlar) => {
      const { error } = await supabaseAdmin.from("fuel_price_reference").insert(satirlar);
      if (error) throw new Error(`geçici bülten yazılamadı: ${error.message}`);
      silinecekKaynak = ortak.source_key;
    };
    const sil = async () => {
      await supabaseAdmin
        .from("fuel_price_reference")
        .delete()
        .eq("source_key", ortak.source_key);
    };

    bilgi(`vardiya bitişi: ${secilen.ended_at}`);
    bilgi(`bülten ÖNCE : ${ONCE_TARIH} = ${ONCE_FIYAT}  (seçilmeli)`);
    bilgi(`bülten SONRA: ${SONRA_TARIH} = ${SONRA_FIYAT}  (seçilmemeli — henüz yayınlanmamıştı)`);
    await yaz([
      { ...ortak, reference_date: ONCE_TARIH, price: ONCE_FIYAT, price_eur: ONCE_FIYAT },
      { ...ortak, reference_date: SONRA_TARIH, price: SONRA_FIYAT, price_eur: SONRA_FIYAT },
    ]);

    const rt = await cagir(secilen.id, token);
    const yt = rt.govde.yakit;
    iddia("oranKaynak referans oldu", yt.oranKaynak === "referans", `oranKaynak=${yt.oranKaynak}`);
    iddia(
      "ÖNCEKİ bültenin fiyatı seçildi (sonraki DEĞİL)",
      yt.euroLitre === ONCE_FIYAT,
      `euroLitre=${yt.euroLitre} · beklenen=${ONCE_FIYAT} · sonraki=${SONRA_FIYAT}`
    );
    iddia(
      "fiyatTarihi = önceki bültenin reference_date'i",
      yt.fiyatTarihi === ONCE_TARIH,
      `fiyatTarihi=${yt.fiyatTarihi} · beklenen=${ONCE_TARIH}`
    );
    iddia("2 gün önceki bülten TAZE (bayat değil)", yt.fiyatBayat === false, `fiyatBayat=${yt.fiyatBayat}`);
    iddia(
      "euro yeni orandan yeniden hesaplandı",
      yt.euro === Math.round(yt.tuketimLitre * ONCE_FIYAT * 100) / 100,
      `${yt.tuketimLitre} × ${ONCE_FIYAT} = ${yt.euro} €`
    );

    // ── 2b · BAYAT DALI ───────────────────────────────────────────────────
    // Haftalık bültende taze ≤ 10 gün, bayat ≤ 31 gün (lib/fuel-price-db).
    // 20 gün önceki tek satır → bayat=true, ama zincir onu YİNE DE kullanır.
    await sil();
    const BAYAT_TARIH = gunEkle(-20);
    await yaz([
      { ...ortak, reference_date: BAYAT_TARIH, price: 1.555, price_eur: 1.555 },
    ]);
    const rb = await cagir(secilen.id, token);
    const yb = rb.govde.yakit;
    iddia("20 günlük bülten BAYAT işaretlendi", yb.fiyatBayat === true, `fiyatBayat=${yb.fiyatBayat}`);
    iddia("bayat olsa da KULLANILDI", yb.euroLitre === 1.555, `euroLitre=${yb.euroLitre}`);
    iddia("oranKaynak hâlâ referans", yb.oranKaynak === "referans", `${yb.oranKaynak}`);

    // Zemini GERİ AL: 3. bölüm zincirin ÖZGÜN hâlini ölçmeli, bu bölümün
    // bıraktığı geçici bülteni değil. (İlk sürümde alınmamıştı ve 3. bölüm
    // `oranKaynak` kıyasını değişmiş bir dünyaya karşı yapıp düştü.)
    await sil();
    silinecekKaynak = null;
    bilgi("geçici bültenler silindi — zincir özgün hâline döndü.");
  }

  // ── 3 · LİTRE NULL → EURO NULL ────────────────────────────────────────
  baslik("3 · DEPO HACMİ YOK → litre null → euro null");
  const vid = secilen.vehicle_id;
  geriAlinacak = { vehicleId: vid, cap: kap };
  bilgi(`geçici: vehicles.tank_capacity_l ${kap} → null (araç ${vid})`);
  const { error: upErr } = await supabaseAdmin
    .from("vehicles")
    .update({ tank_capacity_l: null })
    .eq("id", vid);
  if (upErr) throw new Error(`geçici güncelleme başarısız: ${upErr.message}`);

  const r2 = await cagir(secilen.id, token);
  const y2 = r2.govde.yakit;
  iddia("200 döndü", r2.kod === 200, `kod=${r2.kod}`);
  iddia("depoLitre null", y2.depoLitre === null, `depoLitre=${y2.depoLitre}`);
  iddia("tuketimLitre null", y2.tuketimLitre === null, `tuketimLitre=${y2.tuketimLitre}`);
  iddia("euro NULL (uydurma çevrim yok)", y2.euro === null, `euro=${y2.euro}`);
  iddia("dolumEuro NULL", y2.dolumEuro === null, `dolumEuro=${y2.dolumEuro}`);
  iddia(
    "euroLitre YİNE DE dolu (oran bilinir, litre bilinmez)",
    typeof y2.euroLitre === "number",
    `euroLitre=${y2.euroLitre}`
  );
  iddia("oranKaynak değişmedi", y2.oranKaynak === y.oranKaynak, `${y2.oranKaynak}`);
  iddia("yüzde alanları korundu", y2.tuketimPct === y.tuketimPct, `${y2.tuketimPct}%`);
} catch (e) {
  console.error(`\n✗ KOŞUM HATASI: ${e?.message ?? e}`);
  dusen++;
} finally {
  baslik("GERİ ALMA");
  if (silinecekKaynak) {
    const { error } = await supabaseAdmin
      .from("fuel_price_reference")
      .delete()
      .eq("source_key", silinecekKaynak);
    const { count } = await supabaseAdmin
      .from("fuel_price_reference")
      .select("id", { count: "exact", head: true })
      .eq("source_key", silinecekKaynak);
    iddia(
      "geçici bülten satırları silindi",
      !error && (count ?? 0) === 0,
      `kalan=${count ?? "?"}`
    );
  }
  if (!geriAlinacak) {
    bilgi("geçici araç değişikliği yapılmadı — geri alınacak bir şey yok.");
  } else {
    const { error } = await supabaseAdmin
      .from("vehicles")
      .update({ tank_capacity_l: geriAlinacak.cap })
      .eq("id", geriAlinacak.vehicleId);
    const { data: kontrol } = await supabaseAdmin
      .from("vehicles")
      .select("tank_capacity_l")
      .eq("id", geriAlinacak.vehicleId)
      .maybeSingle();
    iddia(
      `tank_capacity_l geri yazıldı (${geriAlinacak.cap})`,
      !error && kontrol?.tank_capacity_l === geriAlinacak.cap,
      `canlı değer=${kontrol?.tank_capacity_l}`
    );
  }
  console.log(
    `\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ══════════════════════════════════\n`
  );
  process.exit(dusen === 0 ? 0 : 1);
}
