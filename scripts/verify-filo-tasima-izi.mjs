#!/usr/bin/env node
/**
 * FİLO TAŞIMA İZİ + GERİ ALMA — CANLI uçtan uca kanıt (migration 099).
 *
 * ⚠️ BU BETİK **YAZAR**. Gerçek araçların filosunu değiştirir, iz satırı
 * üretir ve sonunda hepsini geri alır. Bu yüzden YALNIZ galzura-demo'da koşar;
 * HAK61 ve Sendigo CANLI MÜŞTERİ olduğu için betik orada kendini durdurur.
 * (Volkan kuralı: test verisi yalnız galzura-demo.)
 *
 * ── NEDEN UÇLARI ÇAĞIRIYOR, SORGU YAZMIYOR ────────────────────────────────
 * "Sayı değişti" demek yetmez; DEĞİŞTİREN ŞEY ucun kendisi olmalı. Doğrudan
 * SQL yazsaydık uçların kapısını, ayıklamasını ve yanıt sözleşmesini hiç
 * ölçmemiş olurduk — yalnız veritabanının çalıştığını görürdük.
 *
 * ── TEMİZLİK ──────────────────────────────────────────────────────────────
 * Sonda araçların filosu BAŞLANGIÇTAKİ hâline döndürülür ve bu koşumun ürettiği
 * iz satırları silinir. İz tablosu normalde silinmez (geri alma damga basar);
 * burada silinen şey ÜRÜN VERİSİ değil, bu betiğin kendi çöpü.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo npm run verify:filo-tasima-izi
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptkmetpfsxmgcijbb")
  ? "HAK61"
  : url.includes("ftbazsyiolkeqivwzmlh")
    ? "Sendigo"
    : url.includes("omgnkvoulndbglmxlvzc")
      ? "galzura-demo"
      : "BİLİNMEYEN";

if (KIRACI !== "galzura-demo") {
  console.error(
    `✗ DURDURULDU — bu betik YAZAR ve yalnız galzura-demo'da koşar.\n` +
      `  Bulunan kiracı: ${KIRACI}. HAK61/Sendigo canlı müşteri; orada yazma denemesi yapılmaz.`
  );
  process.exit(1);
}

let gecen = 0;
const dusen = [];
function ok(baslik, kosul, kanit) {
  if (kosul) {
    gecen++;
    console.log(`  ✓ ${baslik}${kanit ? `   [${kanit}]` : ""}`);
  } else {
    dusen.push({ baslik, kanit });
    console.log(`  ✗ ${baslik}   [${kanit}]`);
  }
}

const { POST: TASI } = await import("@/app/api/mobile/fleets/[id]/atamalar/route.ts");
const { POST: GERI_AL } = await import(
  "@/app/api/mobile/fleets/atamalar/[batchId]/geri-al/route.ts"
);
const { GET: GECMIS } = await import("@/app/api/mobile/fleets/[id]/gecmis/route.ts");

// ── Yönetici jetonu ─────────────────────────────────────────────────────────
const { data: adm } = await supabaseAdmin
  .from("workers")
  .select("id, name, token_version")
  .eq("is_admin", true)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();
if (!adm) {
  console.error("✗ yönetici bulunamadı");
  process.exit(1);
}
const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const tasi = async (kod, aracIdleri) => {
  const res = await TASI(
    new Request("https://x.invalid/api/mobile/fleets/" + kod + "/atamalar", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ aracIdleri }),
    }),
    { params: Promise.resolve({ id: kod }) }
  );
  return { kod: res.status, govde: await res.json() };
};
const geriAl = async (batchId) => {
  const res = await GERI_AL(
    new Request(
      "https://x.invalid/api/mobile/fleets/atamalar/" + batchId + "/geri-al",
      { method: "POST", headers: H }
    ),
    { params: Promise.resolve({ batchId }) }
  );
  return { kod: res.status, govde: await res.json() };
};
const gecmis = async (kod, limit) => {
  const u = new URL("https://x.invalid/api/mobile/fleets/" + kod + "/gecmis");
  if (limit != null) u.searchParams.set("limit", String(limit));
  const res = await GECMIS(new Request(u.toString(), { headers: H }), {
    params: Promise.resolve({ id: kod }),
  });
  return { kod: res.status, govde: await res.json() };
};

const filoOku = async (idler) => {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, fleet, updated_at")
    .in("id", idler);
  return new Map((data ?? []).map((v) => [v.id, v]));
};
const sayim = async () => {
  const { data } = await supabaseAdmin.from("vehicles").select("fleet");
  const m = {};
  for (const v of data ?? []) m[v.fleet] = (m[v.fleet] ?? 0) + 1;
  return m;
};

// ── 099 var mı ──────────────────────────────────────────────────────────────
console.log(`\n═══ kiracı: ${KIRACI} · yönetici: ${adm.name} ═══`);
const { error: izErr } = await supabaseAdmin
  .from("fleet_move_log")
  .select("id")
  .limit(1);
if (izErr) {
  console.error(
    `\n✗ migration 099 BU KİRACIDA ÇALIŞTIRILMAMIŞ (fleet_move_log okunamadı: ${izErr.code ?? ""} ${izErr.message ?? ""}).\n` +
      `  db/migrations/099_filo_tasima_izi.sql SQL Editor'da çalıştırıldıktan sonra tekrar koş.`
  );
  process.exit(2);
}

// ── Denek seç: aynı filoda iki araç + farklı bir hedef filo ────────────────
const { data: filolar } = await supabaseAdmin
  .from("fleets")
  .select("code")
  .order("sort_order");
const { data: tumArac } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, fleet")
  .order("plate");
const kodlar = (filolar ?? []).map((f) => f.code);
const kaynak = kodlar.find((k) => (tumArac ?? []).filter((v) => v.fleet === k).length >= 2);
const hedef = kodlar.find((k) => k !== kaynak);
if (!kaynak || !hedef) {
  console.error("✗ denek bulunamadı: aynı filoda en az 2 araç ve ikinci bir filo gerekiyor.");
  process.exit(1);
}
const denek = (tumArac ?? []).filter((v) => v.fleet === kaynak).slice(0, 2);
const [D1, D2] = denek;
const BASLANGIC = new Map(denek.map((v) => [v.id, v.fleet]));
console.log(
  `denek: ${D1.plate} + ${D2.plate}  ·  ${kaynak} → ${hedef}\n` +
    `ÖNCE dağılım: ${JSON.stringify(await sayim())}`
);

let batch1 = null;
let batch2 = null;
try {
  // ══ 1 · TAŞI ═════════════════════════════════════════════════════════════
  console.log("\n── 1 · taşıma ──");
  const t1 = await tasi(hedef, [D1.id, D2.id]);
  ok("taşıma 200", t1.kod === 200, String(t1.kod));
  batch1 = t1.govde.batchId;
  ok("yanıt batchId taşıyor", typeof batch1 === "string" && batch1.length === 36, batch1);
  ok("2 araç taşındı", (t1.govde.arac?.tasindi ?? []).length === 2, JSON.stringify(t1.govde.arac?.tasindi?.map((a) => a.plaka)));
  ok(
    "önceki filo yanıtta doğru",
    (t1.govde.arac?.tasindi ?? []).every((a) => a.oncekiFilo === kaynak),
    kaynak
  );

  const { data: log1 } = await supabaseAdmin
    .from("fleet_move_log")
    .select("*")
    .eq("batch_id", batch1);
  ok("iz tablosunda 2 satır, AYNI batch", (log1 ?? []).length === 2, `satir=${(log1 ?? []).length}`);
  ok("izde from/to doğru", (log1 ?? []).every((r) => r.from_fleet === kaynak && r.to_fleet === hedef));
  ok("izde taşıyan yazılı", (log1 ?? []).every((r) => r.moved_by === adm.id));
  ok("izde undone_at boş", (log1 ?? []).every((r) => r.undone_at === null));

  const v1 = await filoOku([D1.id, D2.id]);
  ok("araçlar hedef filoda", [...v1.values()].every((v) => v.fleet === hedef), hedef);
  ok("updated_at damgası basıldı", [...v1.values()].every((v) => v.updated_at !== null));
  console.log(`   SONRA dağılım: ${JSON.stringify(await sayim())}`);

  // ══ 2 · GEÇMİŞ ═══════════════════════════════════════════════════════════
  console.log("\n── 2 · geçmiş ucu ──");
  const g = await gecmis(hedef, 50);
  ok("geçmiş 200", g.kod === 200, String(g.kod));
  const bizimkiler = (g.govde.hareketler ?? []).filter((h) => h.batchId === batch1);
  ok("geçmişte bu taşıma görünüyor (2 satır)", bizimkiler.length === 2, `satir=${bizimkiler.length}`);
  ok("yön 'geldi' (hedef filo açısından)", bizimkiler.every((h) => h.yon === "geldi"));
  ok("taşıyanın adı çözülmüş", bizimkiler.every((h) => h.tasiyan?.ad));
  ok("plaka çözülmüş", bizimkiler.every((h) => h.plaka));
  const gKaynak = await gecmis(kaynak, 50);
  ok(
    "kaynak filoda aynı satırlar 'gitti' yönünde",
    (gKaynak.govde.hareketler ?? [])
      .filter((h) => h.batchId === batch1)
      .every((h) => h.yon === "gitti")
  );
  ok("geçmiş UYGULANAN limiti söylüyor", g.govde.limit === 50, String(g.govde.limit));
  const gTavan = await gecmis(hedef, 9999);
  ok("tavanı aşan limit sessizce indirildi", gTavan.govde.limit === gTavan.govde.enFazlaLimit, `${gTavan.govde.limit}/${gTavan.govde.enFazlaLimit}`);

  // ══ 3 · GERİ AL ══════════════════════════════════════════════════════════
  console.log("\n── 3 · geri alma ──");
  const r1 = await geriAl(batch1);
  ok("geri alma 200", r1.kod === 200, String(r1.kod));
  ok("2 araç geri alındı", (r1.govde.geriAlindi ?? []).length === 2, JSON.stringify((r1.govde.geriAlindi ?? []).map((a) => a.plaka)));
  ok("atlanan yok", (r1.govde.atlandi ?? []).length === 0);

  const v2 = await filoOku([D1.id, D2.id]);
  ok("araçlar ESKİ filosunda", [...v2.values()].every((v) => v.fleet === kaynak), kaynak);

  const { data: log2 } = await supabaseAdmin
    .from("fleet_move_log")
    .select("*")
    .eq("batch_id", batch1);
  ok("iz satırı SİLİNMEDİ", (log2 ?? []).length === 2);
  ok("undone_at doldu", (log2 ?? []).every((r) => r.undone_at !== null));
  ok("undone_by doğru kişi", (log2 ?? []).every((r) => r.undone_by === adm.id));
  console.log(`   GERİ ALMA SONRASI dağılım: ${JSON.stringify(await sayim())}`);

  // ══ 4 · İKİNCİ GERİ ALMA → 409 ═══════════════════════════════════════════
  console.log("\n── 4 · ikinci geri alma ──");
  const r2 = await geriAl(batch1);
  ok("ikinci geri alma 409", r2.kod === 409, String(r2.kod));
  ok("sebep zaten_geri_alindi", r2.govde.sebep === "zaten_geri_alindi", r2.govde.sebep);

  const r404 = await geriAl("99999999-0000-4000-8000-000000000099");
  ok("bilinmeyen batch 404", r404.kod === 404, String(r404.kod));
  const rBozuk = await geriAl("bozuk-kimlik");
  ok("şekli bozuk batch 404 (503 DEĞİL)", rBozuk.kod === 404, String(rBozuk.kod));

  // ══ 5 · ARAYA MANUEL TAŞIMA → 'atlandi' DALI ═════════════════════════════
  console.log("\n── 5 · araya manuel taşıma sokulmuş geri alma ──");
  const t2 = await tasi(hedef, [D1.id, D2.id]);
  batch2 = t2.govde.batchId;
  ok("yeniden taşındı", t2.kod === 200 && (t2.govde.arac?.tasindi ?? []).length === 2, batch2);

  // Araya giren KARAR: D1 elle kaynak filoya geri alınıyor (uç DIŞINDAN).
  await supabaseAdmin.from("vehicles").update({ fleet: kaynak }).eq("id", D1.id);
  console.log(`   ${D1.plate} elle ${kaynak}'a alındı (geri alma bunu EZMEMELİ)`);

  const r3 = await geriAl(batch2);
  ok("geri alma 200 (409 DEĞİL)", r3.kod === 200, String(r3.kod));
  ok("1 geri alındı", (r3.govde.geriAlindi ?? []).length === 1, JSON.stringify((r3.govde.geriAlindi ?? []).map((a) => a.plaka)));
  ok("1 ATLANDI", (r3.govde.atlandi ?? []).length === 1, JSON.stringify((r3.govde.atlandi ?? []).map((a) => a.plaka)));
  ok("atlanan D1", r3.govde.atlandi?.[0]?.aracId === D1.id, r3.govde.atlandi?.[0]?.plaka);
  ok("atlananın ŞU ANKİ filosu söyleniyor", r3.govde.atlandi?.[0]?.mevcutFilo === kaynak, r3.govde.atlandi?.[0]?.mevcutFilo);

  const v3 = await filoOku([D1.id, D2.id]);
  ok("araya giren karar EZİLMEDİ", v3.get(D1.id).fleet === kaynak, v3.get(D1.id).fleet);
  ok("diğer araç geri alındı", v3.get(D2.id).fleet === kaynak, v3.get(D2.id).fleet);

  const { data: log3 } = await supabaseAdmin
    .from("fleet_move_log")
    .select("vehicle_id, undone_at")
    .eq("batch_id", batch2);
  ok("atlanan aracın izi AÇIK kaldı", (log3 ?? []).find((r) => r.vehicle_id === D1.id)?.undone_at === null);
  ok("geri alınanın izi damgalandı", (log3 ?? []).find((r) => r.vehicle_id === D2.id)?.undone_at !== null);
} finally {
  // ══ TEMİZLİK ═══════════════════════════════════════════════════════════════
  console.log("\n── temizlik ──");
  for (const [id, filo] of BASLANGIC) {
    await supabaseAdmin.from("vehicles").update({ fleet: filo }).eq("id", id);
  }
  const izler = [batch1, batch2].filter(Boolean);
  if (izler.length) {
    await supabaseAdmin.from("fleet_move_log").delete().in("batch_id", izler);
  }
  const son = await filoOku([D1.id, D2.id]);
  const geriDondu = [...son.values()].every((v) => v.fleet === BASLANGIC.get(v.id));
  const { data: kalan } = await supabaseAdmin
    .from("fleet_move_log")
    .select("id")
    .in("batch_id", izler.length ? izler : ["00000000-0000-4000-8000-000000000000"]);
  ok("araçlar BAŞLANGIÇ filosunda", geriDondu, JSON.stringify([...son.values()].map((v) => `${v.plate}=${v.fleet}`)));
  ok("bu koşumun iz satırları silindi", (kalan ?? []).length === 0, `kalan=${(kalan ?? []).length}`);
  console.log(`   SON dağılım: ${JSON.stringify(await sayim())}`);
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} filo taşıma izi canlı kanıt: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.baslik}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
