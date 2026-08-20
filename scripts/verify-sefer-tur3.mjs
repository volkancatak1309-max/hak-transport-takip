#!/usr/bin/env node
/**
 * SEFER TUR 3 · OTOMATİK KÖPRÜLER — CANLIDA KANIT.
 *
 * ── ⚠️ NE TÜR BİR KANIT ───────────────────────────────────────────────────
 * KÖPRÜ MANTIĞININ BİRİM KANITI, uçtan uca gerçek akış DEĞİL. `zone_visits`
 * satırı burada ELLE açılıyor, çünkü HAK61'de henüz `purpose='customer'`
 * bölge yok ve gerçek telemetri beklemek turu süresiz bekletirdi. Ziyaret
 * motoruna DOKUNULMUYOR — köprünün OKUDUĞU satır üretiliyor, motorun kendisi
 * değil. Gerçek uçtan uca test, HAK61'e müşteri bölgesi tanımlandığında
 * yapılacak → raporda "BEKLEYEN GERÇEK TEST".
 *
 * ── ⚠️ CANLI VERİTABANI: NEYE DOKUNUR ─────────────────────────────────────
 * Geçici test dokusu açar ve SONUNDA SİLER:
 *   · 1 geofence  (ZZ QA · purpose=customer · lat/lng 0,0 · 50 m)
 *     ⚠️ Konum bilerek Gine Körfezi: canlı senkron turu bu bölgeyi
 *        değerlendirse bile HİÇBİR araç içine düşemez.
 *   · 1 worker (is_test, girişi kapalı) · 2 time_entries · 4 sefer · 2 ziyaret
 * Gerçek şoföre/araca/bölgeye YAZILMAZ. Volkan'ın 19.08'de elle açtığı 4
 * sefer satırına DOKUNULMAZ (sayım başta alınır, sonda karşılaştırılır).
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-sefer-tur3.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { viennaDayKey } from "@/lib/format";
import { seferVarisKoprusu, seferePaketBagla, seferePaketBaglaVardiyadan } from "@/lib/sefer-bridge";
import { GET as SEFER_LISTE } from "@/app/api/mobile/sefer/route";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const bilgi = (s) => console.log(`     ${s}`);

const QA_BOLGE = "ZZ QA Sefer Hedef Bölgesi";
const QA_SOFOR = "ZZ QA Tur3 Şoförü";
const BUGUN = viennaDayKey(new Date());
const TEST_ARAC = "0d0d8175-b079-429f-a056-4bc8fb935143"; // migration 028 test aracı

let bolgeId = null;
let soforId = null;
let baslangicSefer = 0;
let baslangicZiyaret = 0;

const saat = (h, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

async function temizle() {
  if (soforId) {
    await supabaseAdmin.from("seferler").delete().eq("worker_id", soforId);
    await supabaseAdmin.from("time_entries").delete().eq("worker_id", soforId);
  }
  if (bolgeId) {
    await supabaseAdmin.from("zone_visits").delete().eq("zone_id", bolgeId);
    await supabaseAdmin.from("geofences").delete().eq("id", bolgeId);
  }
  if (soforId) await supabaseAdmin.from("workers").delete().eq("id", soforId);
}

console.log(`\n╔══ SEFER TUR 3 · OTOMATİK KÖPRÜLER · CANLIDA KANIT ═══════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ tarih  ${BUGUN}`);

try {
  // ── 0. HAZIRLIK ──────────────────────────────────────────────────────────
  {
    const { count: c1 } = await supabaseAdmin.from("seferler").select("id", { count: "exact", head: true });
    const { count: c2 } = await supabaseAdmin.from("zone_visits").select("id", { count: "exact", head: true });
    baslangicSefer = c1 ?? 0;
    baslangicZiyaret = c2 ?? 0;
    console.log(`║ başlangıç: seferler ${baslangicSefer} satır · zone_visits ${baslangicZiyaret} satır`);
  }
  // Önceki koşumun artığı varsa temizle.
  {
    const { data: eskiB } = await supabaseAdmin.from("geofences").select("id").eq("name", QA_BOLGE);
    const { data: eskiS } = await supabaseAdmin.from("workers").select("id").eq("name", QA_SOFOR);
    bolgeId = eskiB?.[0]?.id ?? null;
    soforId = eskiS?.[0]?.id ?? null;
    if (bolgeId || soforId) {
      await temizle();
      bilgi("önceki koşumun artığı temizlendi");
      bolgeId = null;
      soforId = null;
    }
  }

  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, token_version")
    .eq("is_admin", true).eq("is_active", true).neq("is_test", true)
    .order("name").limit(1).maybeSingle();

  // Test bölgesi — purpose=customer, motorun HİÇ tetikleyemeyeceği konumda.
  const { data: bolge, error: bHata } = await supabaseAdmin
    .from("geofences")
    .insert({
      name: QA_BOLGE, type: "circle", center_lat: 0, center_lng: 0, radius_m: 50,
      rule_kind: "allowed_only", active: true, purpose: "customer", category: "customer", min_dwell_s: 120,
    })
    .select("id, name, purpose, min_dwell_s").maybeSingle();
  if (bHata || !bolge) { console.error("✗ test bölgesi açılamadı:", bHata?.message); process.exit(1); }
  bolgeId = bolge.id;

  const { data: qa, error: sHata } = await supabaseAdmin
    .from("workers")
    .insert({
      name: QA_SOFOR, phone: "+43000000001", pin_hash: "QA_GIRIS_KAPALI_gecersiz_hash",
      is_active: true, is_test: true, is_admin: false,
    })
    .select("id, token_version").maybeSingle();
  if (sHata || !qa) { console.error("✗ QA şoförü açılamadı:", sHata?.message); process.exit(1); }
  soforId = qa.id;
  const qaToken = (await issueTokens(qa.id, false, qa.token_version ?? 0)).accessToken;

  console.log(`║ test bölgesi ${bolge.name} (purpose=${bolge.purpose}, min_dwell_s=${bolge.min_dwell_s})`);
  console.log(`║ test şoförü  ${QA_SOFOR} (is_test)\n`);

  // Vardiya: 07:00 → açık. Ziyaretler bu pencerenin İÇİNDE olacak.
  const { data: vardiya } = await supabaseAdmin
    .from("time_entries")
    .insert({ worker_id: soforId, vehicle_id: TEST_ARAC, started_at: saat(7), start_package_count: 100 })
    .select("id, started_at").maybeSingle();

  // ══ 1. KÖPRÜ 1 — OTOMATİK "VARDI" ═════════════════════════════════════
  console.log("── 1. KÖPRÜ 1 · OTOMATİK VARDI ──");

  const seferYap = async (g) => {
    const { data } = await supabaseAdmin
      .from("seferler")
      .insert({ tarih: BUGUN, worker_id: soforId, created_by: patron.id, ...g })
      .select("id, durum, vardi_at, atandi_at").maybeSingle();
    return data;
  };
  const oku = async (id) => {
    const { data } = await supabaseAdmin
      .from("seferler").select("id, durum, vardi_at, paket_gerceklesen").eq("id", id).maybeSingle();
    return data;
  };

  // Hedefi olan, kabul durumunda sefer.
  const s1 = await seferYap({ zone_id: bolgeId, vehicle_id: TEST_ARAC, durum: "kabul", kabul_at: saat(7, 30), atandi_at: saat(7, 5) });
  iddia("sefer açıldı, vardi_at başlangıçta NULL", s1 && s1.vardi_at === null, `durum=${s1?.durum}`);

  // Ziyaret YOKKEN köprü hiçbir şey yazmamalı.
  {
    const r = await seferVarisKoprusu();
    const g = await oku(s1.id);
    iddia("ziyaret yokken damga DÜŞMEZ", g.vardi_at === null && r.hata === null,
      `bakılan=${r.bakilan} yazılan=${r.yazilan} hata=${r.hata ?? "yok"}`);
  }

  // İLK ziyaret — elle açılıyor (motor değil, köprünün okuduğu satır).
  const ilkVaris = saat(9, 15);
  await supabaseAdmin.from("zone_visits").insert({
    vehicle_id: TEST_ARAC, zone_id: bolgeId, worker_id: null,
    started_at: ilkVaris, last_seen_at: saat(9, 40), ended_at: saat(9, 40), end_reason: "exit",
  });
  {
    const r = await seferVarisKoprusu();
    const g = await oku(s1.id);
    iddia("ziyaret açılınca vardi_at DÜŞTÜ", g.vardi_at !== null, `vardi_at=${g.vardi_at}`);
    iddia("damga ziyaretin started_at'i ile AYNI",
      g.vardi_at && Date.parse(g.vardi_at) === Date.parse(ilkVaris),
      `${g.vardi_at} ≟ ${ilkVaris}`);
    iddia("durum DEĞİŞMEDİ (yeni durum eklenmedi)", g.durum === "kabul", `durum=${g.durum}`);
    bilgi(`köprü özeti: bakılan=${r.bakilan} yazılan=${r.yazilan}`);
  }

  // İKİNCİ ziyaret — damga DEĞİŞMEMELİ.
  const ikinciVaris = saat(14, 20);
  await supabaseAdmin.from("zone_visits").insert({
    vehicle_id: TEST_ARAC, zone_id: bolgeId, worker_id: null,
    started_at: ikinciVaris, last_seen_at: saat(14, 45), ended_at: saat(14, 45), end_reason: "exit",
  });
  {
    const r = await seferVarisKoprusu();
    const g = await oku(s1.id);
    iddia("İKİNCİ ziyarette damga DEĞİŞMEDİ",
      g.vardi_at && Date.parse(g.vardi_at) === Date.parse(ilkVaris),
      `hâlâ ${g.vardi_at} (ikinci ziyaret ${ikinciVaris})`);
    iddia("ikinci turda hiçbir sefer yazılmadı (idempotent)", r.yazilan === 0, `yazılan=${r.yazilan}`);
  }

  // ── NEGATİF: VARDİYA KİMLİK KONTROLÜ ────────────────────────────────────
  // Aynı bölge, aynı araç, ziyaret VAR — ama seferin şoförü o araçta
  // vardiyada DEĞİL. Damga düşmemeli.
  {
    const { data: baskaSofor } = await supabaseAdmin
      .from("workers").select("id, name")
      .eq("is_admin", false).eq("is_active", true).neq("is_test", true)
      .order("name").limit(1).maybeSingle();
    const s2 = await seferYap({
      zone_id: bolgeId, vehicle_id: TEST_ARAC, durum: "kabul",
      kabul_at: saat(7, 30), atandi_at: saat(7, 5), worker_id: baskaSofor.id,
    });
    await seferVarisKoprusu();
    const g = await oku(s2.id);
    iddia("🔴 VARDİYA KİMLİK KONTROLÜ · o araçta vardiyası olmayan şoföre damga DÜŞMEZ",
      g.vardi_at === null, `${baskaSofor.name.slice(0, 4)}*** → vardi_at=${g.vardi_at ?? "NULL"}`);
    bilgi("(zone_visits.worker_id ATAMADAN geliyor — köprü ona güvenmiyor, vardiyaya bakıyor)");
    await supabaseAdmin.from("seferler").delete().eq("id", s2.id);
  }

  // ── NEGATİF: sefer AÇILMADAN ÖNCEKİ varış sayılmaz ──────────────────────
  {
    const s3 = await seferYap({
      zone_id: bolgeId, vehicle_id: TEST_ARAC, durum: "kabul",
      kabul_at: saat(20), atandi_at: saat(19, 55), // ziyaretlerden SONRA açıldı
    });
    await seferVarisKoprusu();
    const g = await oku(s3.id);
    iddia("sefer AÇILMADAN önceki ziyaret damga düşürmez", g.vardi_at === null, `vardi_at=${g.vardi_at ?? "NULL"}`);
    await supabaseAdmin.from("seferler").delete().eq("id", s3.id);
  }

  // ── NEGATİF: hedefi olmayan sefer ───────────────────────────────────────
  {
    const s4 = await seferYap({ durum: "kabul", kabul_at: saat(7, 30), atandi_at: saat(7, 5) });
    await seferVarisKoprusu();
    const g = await oku(s4.id);
    iddia("hedef bölgesi YOKKEN damga düşmez", g.vardi_at === null, `vardi_at=${g.vardi_at ?? "NULL"}`);
    await supabaseAdmin.from("seferler").delete().eq("id", s4.id);
  }

  // ══ 2. KÖPRÜ 2 — PAKET BAĞLAMA ════════════════════════════════════════
  console.log("\n── 2. KÖPRÜ 2 · PAKET BAĞLAMA ──");

  // s1 hâlâ açık (kabul). Önce AÇIK sefere bağlanmalı.
  await supabaseAdmin.from("time_entries").update({ cargo_count: 87 }).eq("id", vardiya.id);
  {
    const r = await seferePaketBaglaVardiyadan(vardiya.id);
    const g = await oku(s1.id);
    iddia("tamamlanmış sefer yokken AÇIK sefere bağlandı", g.paket_gerceklesen === 87,
      `paket_gerceklesen=${g.paket_gerceklesen} (bakılan=${r.bakilan} yazılan=${r.yazilan})`);
  }

  // s1'i tamamla, İKİNCİ bir sefer aç ve onu da tamamla → SON tamamlanan kazanmalı.
  await supabaseAdmin.from("seferler")
    .update({ durum: "tamamlandi", tamamlandi_at: saat(15) }).eq("id", s1.id);
  const s5 = await seferYap({ durum: "tamamlandi", atandi_at: saat(16), tamamlandi_at: saat(18) });
  {
    await supabaseAdmin.from("time_entries").update({ cargo_count: 91 }).eq("id", vardiya.id);
    const r = await seferePaketBaglaVardiyadan(vardiya.id);
    const g1 = await oku(s1.id);
    const g5 = await oku(s5.id);
    iddia("iki tamamlanmış sefer varsa SON tamamlanana bağlanır",
      g5.paket_gerceklesen === 91, `son sefer=${g5.paket_gerceklesen} · önceki=${g1.paket_gerceklesen}`);
    iddia("önceki seferin değeri EZİLMEDİ", g1.paket_gerceklesen === 87, `${g1.paket_gerceklesen}`);
    bilgi(`özet: bakılan=${r.bakilan} yazılan=${r.yazilan}`);
  }

  // Düzeltme: cargo_count değişirse bağlı sefer TAZELENİR.
  {
    await supabaseAdmin.from("time_entries").update({ cargo_count: 120 }).eq("id", vardiya.id);
    await seferePaketBaglaVardiyadan(vardiya.id);
    const g5 = await oku(s5.id);
    iddia("yönetici düzeltmesi seferi TAZELER", g5.paket_gerceklesen === 120, `${g5.paket_gerceklesen}`);
  }

  // Aynı değer ikinci kez → yazma YOK.
  {
    const r = await seferePaketBaglaVardiyadan(vardiya.id);
    iddia("aynı değer tekrar gelirse gereksiz UPDATE atılmaz", r.yazilan === 0, `yazılan=${r.yazilan}`);
  }

  // İPTAL edilmiş sefer hedef DEĞİL.
  {
    const gun = "2026-08-18";
    const si = await supabaseAdmin.from("seferler")
      .insert({ tarih: gun, worker_id: soforId, created_by: patron.id, durum: "iptal", iptal_at: saat(9) })
      .select("id").maybeSingle();
    const r = await seferePaketBagla(soforId, gun, 55);
    const { data: g } = await supabaseAdmin.from("seferler").select("paket_gerceklesen").eq("id", si.data.id).maybeSingle();
    iddia("İPTAL sefere paket bağlanmaz", g.paket_gerceklesen === null && r.yazilan === 0,
      `paket=${g.paket_gerceklesen ?? "NULL"} yazılan=${r.yazilan}`);
    await supabaseAdmin.from("seferler").delete().eq("id", si.data.id);
  }

  // SEFERSİZ gün → bağlama yok, hata yok.
  {
    const r = await seferePaketBagla(soforId, "2026-08-17", 42);
    iddia("sefersiz günde bağlama YOK (zorla eşleştirme yok)",
      r.yazilan === 0 && r.bakilan === 0 && r.hata === null, JSON.stringify(r));
  }

  // teslim null → bağlama yok.
  {
    const r = await seferePaketBagla(soforId, BUGUN, null);
    iddia("teslim sayısı NULL ise bağlama YOK", r.yazilan === 0 && r.hata === null, JSON.stringify(r));
  }

  // ══ 3. UÇ YANSIMASI ═══════════════════════════════════════════════════
  console.log("\n── 3. GET /api/mobile/sefer · YENİ ALANLAR ──");
  {
    const res = await SEFER_LISTE(
      new Request(`http://x/api/mobile/sefer?tarih=${BUGUN}`, {
        headers: { authorization: `Bearer ${qaToken}` },
      })
    );
    const j = await res.json();
    const satir = (j.seferler ?? []).find((s) => s.id === s1.id);
    iddia("uç 200 döndü", res.status === 200, `${res.status} · ${j.seferler?.length} sefer`);
    iddia("yanıtta vardiAt alanı VAR", satir && "vardiAt" in satir, `vardiAt=${satir?.vardiAt}`);
    iddia("yanıtta paketGerceklesen alanı VAR", satir && "paketGerceklesen" in satir, `paketGerceklesen=${satir?.paketGerceklesen}`);
    iddia("vardiAt damgalar bloğunun DIŞINDA (şoför damgası değil)",
      satir && !("vardi" in (satir.damgalar ?? {})), `damgalar=${Object.keys(satir?.damgalar ?? {}).join(",")}`);
    const eskiAlanlar = ["id", "tarih", "soforId", "aracId", "bolgeId", "paketHedef", "notlar", "durum", "sonrakiDurum", "acik", "damgalar", "olusturan", "olusturuldu"];
    const eksik = eskiAlanlar.filter((k) => !(k in (satir ?? {})));
    iddia("Tur 1'in alanlarının HİÇBİRİ kaybolmadı", eksik.length === 0, eksik.join(",") || `${eskiAlanlar.length} alan yerinde`);
    bilgi(`örnek satır: ${JSON.stringify({ durum: satir?.durum, vardiAt: satir?.vardiAt, paketGerceklesen: satir?.paketGerceklesen })}`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
} finally {
  // ══ 4. TEMİZLİK ═══════════════════════════════════════════════════════
  console.log("\n── 4. TEMİZLİK ──");
  await temizle();
  const { count: c1 } = await supabaseAdmin.from("seferler").select("id", { count: "exact", head: true });
  const { count: c2 } = await supabaseAdmin.from("zone_visits").select("id", { count: "exact", head: true });
  const { data: kalanB } = await supabaseAdmin.from("geofences").select("id, name").ilike("name", "ZZ QA%");
  const { data: kalanS } = await supabaseAdmin.from("workers").select("id, name").ilike("name", "ZZ QA%");
  const { data: kalanV } = await supabaseAdmin.from("geofences").select("id, name, purpose").eq("purpose", "customer");
  iddia(`seferler başlangıçtaki satır sayısına döndü (${baslangicSefer})`, (c1 ?? -1) === baslangicSefer, `${c1} satır`);
  iddia(`zone_visits başlangıçtaki satır sayısına döndü (${baslangicZiyaret})`, (c2 ?? -1) === baslangicZiyaret, `${c2} satır`);
  iddia("ZZ QA bölgesi silindi", (kalanB ?? []).length === 0, `${(kalanB ?? []).length} satır`);
  iddia("ZZ QA şoförü silindi", (kalanS ?? []).length === 0, `${(kalanS ?? []).length} satır`);
  iddia("canlıda purpose=customer bölge KALMADI", (kalanV ?? []).length === 0,
    `${(kalanV ?? []).length} satır ${JSON.stringify(kalanV ?? [])}`);
}

console.log(`\n╚══ düşen: ${dusen} ═══════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
