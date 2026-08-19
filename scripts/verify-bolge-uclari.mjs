#!/usr/bin/env node
/**
 * MOBİL BÖLGE UÇLARI — CANLIDA KANIT.
 *
 * Beş ucun GERÇEK işleyicileri çağrılır (route.ts'ler saf `.ts`, JSX yok →
 * ts-server harness'ı doğrudan içe aktarabiliyor).
 *
 * ── ⚠️ CANLI VERİTABANI: NEYE DOKUNUR ────────────────────────────────────
 * YAZMA VAR ama YALNIZ kendi açtığı TEK test bölgesine. Gerçek iki depo
 * bölgesine (Wolfurt / Bordo filo) tek yazma gitmez; koşum başında ve sonunda
 * sayıları/alanları karşılaştırılır ve DEĞİŞMEDİĞİ iddia edilir.
 *
 * Test bölgesi Kuzey Atlantik'te (59°N 30°W) açılır: hiçbir aracın giremeyeceği
 * bir nokta, dolayısıyla `purpose='rule'` olsa da olmasa da depo tetiğini,
 * kilidi ya da kural değerlendirmesini etkileyemez. Sonunda HARD DELETE ile
 * silinir (uçlarda silme yok; temizlik doğrudan DB'den).
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-bolge-uclari.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { activeDepotZones } from "@/lib/depot";
import { GET as LISTE, POST as OLUSTUR } from "@/app/api/mobile/geofences/route";
import { PATCH as DUZENLE } from "@/app/api/mobile/geofences/[id]/route";
import { POST as AKTIF } from "@/app/api/mobile/geofences/[id]/aktif/route";
import { POST as ARSIV } from "@/app/api/mobile/geofences/[id]/arsiv/route";

const TEST_AD = "__QA_BOLGE__ (silinecek)";

let dusen = 0;
let olculmeyen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const olculmedi = (b, s) => {
  console.log(`  ○ ${b}  —  ÖLÇÜLMEDİ (${s})`);
  olculmeyen++;
};
const bilgi = (s) => console.log(`     ${s}`);

const istek = (url, token, init = {}) => {
  const h = { ...(init.headers ?? {}) };
  if (token) h.authorization = `Bearer ${token}`;
  if (init.body !== undefined) h["content-type"] = "application/json";
  return new Request(url, { ...init, headers: h });
};
async function cagir(handler, yol, token, init, params) {
  const req = istek(`http://x${yol}`, token, init);
  const res = params ? await handler(req, { params: Promise.resolve(params) }) : await handler(req);
  const metin = await res.text();
  let json = null;
  try {
    json = JSON.parse(metin);
  } catch {
    /* JSON değil */
  }
  return { status: res.status, json };
}

const liste = (qs, t) => cagir(LISTE, `/api/mobile/geofences${qs ?? ""}`, t);
const olustur = (g, t) =>
  cagir(OLUSTUR, "/api/mobile/geofences", t, { method: "POST", body: JSON.stringify(g) });
const duzenle = (id, g, t) =>
  cagir(DUZENLE, `/api/mobile/geofences/${id}`, t, { method: "PATCH", body: JSON.stringify(g) }, { id });
const aktifEt = (id, g, t) =>
  cagir(AKTIF, `/api/mobile/geofences/${id}/aktif`, t, { method: "POST", body: JSON.stringify(g) }, { id });
const arsivle = (id, g, t) =>
  cagir(ARSIV, `/api/mobile/geofences/${id}/arsiv`, t, { method: "POST", body: JSON.stringify(g) }, { id });

console.log(`\n╔══ MOBİL BÖLGE UÇLARI · CANLIDA KANIT ════════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

let testId = null;
let gercekOnce = null;

try {
  // ── Hazırlık ─────────────────────────────────────────────────────────────
  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", true).eq("is_active", true).order("name").limit(1).maybeSingle();
  const { data: sofor } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", false).eq("is_active", true).is("managed_fleet", null)
    .order("name").limit(1).maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .not("managed_fleet", "is", null).eq("is_admin", false).eq("is_active", true)
    .order("name").limit(1);
  const sef = (sefler ?? [])[0] ?? null;
  if (!patron) {
    console.error("✗ aktif yönetici yok");
    process.exit(1);
  }
  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;
  const soforToken = sofor ? (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken : null;
  const sefToken = sef ? (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken : null;

  // Artık kalmış test bölgesi varsa temizle (tekrar çalıştırılabilirlik).
  await supabaseAdmin.from("geofences").delete().eq("name", TEST_AD);
  await supabaseAdmin.from("geofences").delete().eq("name", TEST_AD + " v2");

  gercekOnce = (await supabaseAdmin
    .from("geofences")
    .select("id, name, purpose, category, active, archived_at, radius_m")
    .order("created_at")).data ?? [];
  console.log(`║ gerçek bölge: ${gercekOnce.length} (depo ${gercekOnce.filter((z) => z.purpose === "depot").length})\n`);

  // ══ 1. KAPI ══════════════════════════════════════════════════════════════
  console.log("── 1. KAPI ──");
  const YOK = "00000000-0000-4000-8000-000000000000";
  const kapilar = [
    ["GET  /geofences", (t) => liste("", t)],
    ["POST /geofences", (t) => olustur({ ad: "x", kategori: "custom", lat: 1, lng: 1, yaricapM: 100 }, t)],
    ["PATCH /geofences/[id]", (t) => duzenle(YOK, { ad: "x" }, t)],
    ["POST /geofences/[id]/aktif", (t) => aktifEt(YOK, { aktif: false }, t)],
    ["POST /geofences/[id]/arsiv", (t) => arsivle(YOK, { arsiv: true }, t)],
  ];
  for (const [ad, f] of kapilar) {
    const a = await f(null);
    iddia(`${ad} · token yok → 401`, a.status === 401 && a.json?.error === "missing_token", `${a.status} ${a.json?.error}`);
    const b = await f("kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, b.status === 401, `${b.status} ${b.json?.error}`);
    if (soforToken) {
      const c = await f(soforToken);
      iddia(`${ad} · ŞOFÖR → 403`, c.status === 403 && c.json?.error === "admin_required", `${c.status} ${c.json?.error}`);
    } else olculmedi(`${ad} · şoför → 403`, "şoför yok");
    if (sefToken) {
      const d = await f(sefToken);
      iddia(`${ad} · FİLO ŞEFİ → 403`, d.status === 403 && d.json?.error === "admin_required", `${d.status} ${d.json?.error}`);
    } else olculmedi(`${ad} · şef → 403`, "şef yok");
  }

  // ══ 2. GİRDİ REDLERİ ═════════════════════════════════════════════════════
  console.log("\n── 2. GİRDİ REDLERİ (hiçbiri yazmıyor) ──");
  const redler = [
    ["yarıçap 49 (alt sınır)", { ad: "x", kategori: "custom", lat: 59, lng: -30, yaricapM: 49 }, "yaricapM"],
    ["yarıçap 5001 (üst sınır)", { ad: "x", kategori: "custom", lat: 59, lng: -30, yaricapM: 5001 }, "yaricapM"],
    ["yarıçap ondalık", { ad: "x", kategori: "custom", lat: 59, lng: -30, yaricapM: 100.5 }, "yaricapM"],
    ["kategori uydurma", { ad: "x", kategori: "depo", lat: 59, lng: -30, yaricapM: 100 }, "kategori"],
    ["ad boş", { ad: "   ", kategori: "custom", lat: 59, lng: -30, yaricapM: 100 }, "ad"],
    ["lat aralık dışı", { ad: "x", kategori: "custom", lat: 91, lng: -30, yaricapM: 100 }, "lat"],
    ["yalnız lat (lng yok)", { ad: "x", kategori: "custom", lat: 59, yaricapM: 100 }, "lat|lng"],
  ];
  for (const [ad, govde, alan] of redler) {
    const r = await olustur(govde, patronToken);
    iddia(`POST · ${ad} → 400 invalid_field(${alan})`,
      r.status === 400 && r.json?.error === "invalid_field" && r.json?.alan === alan,
      `${r.status} ${r.json?.error} alan=${r.json?.alan}`);
  }
  {
    const r = await cagir(OLUSTUR, "/api/mobile/geofences", patronToken, { method: "POST", body: "bozuk-json" });
    iddia("POST · bozuk JSON → 400 invalid_body", r.status === 400 && r.json?.error === "invalid_body", `${r.status} ${r.json?.error}`);
    const s = await duzenle(YOK, { ad: "x" }, patronToken);
    iddia("PATCH · olmayan kimlik → 404", s.status === 404, `${s.status} ${s.json?.error}`);
    const u = await duzenle(YOK, {}, patronToken);
    iddia("PATCH · boş gövde olmayan kimlikte de 404 (önce varlık)", u.status === 404, `${u.status}`);
  }

  // ══ 3. ZİNCİR: oluştur → düzenle → kapat → arşivle → geri al ═════════════
  console.log("\n── 3. UÇTAN UCA ZİNCİR (test bölgesi) ──");
  const olusturGovde = { ad: TEST_AD, kategori: "customer", lat: 59.0, lng: -30.0, yaricapM: 250 };
  const r1 = await olustur(olusturGovde, patronToken);
  testId = r1.json?.bolge?.id ?? null;
  iddia("1) OLUŞTUR → 201", r1.status === 201 && !!testId,
    `${r1.status} id=${String(testId).slice(0, 8)}… kategori=${r1.json?.bolge?.kategori} yaricapM=${r1.json?.bolge?.yaricapM} aktif=${r1.json?.bolge?.aktif}`);
  iddia("   yeni bölge vardiyaTetigi=false (purpose mobilden yazılmaz)",
    r1.json?.bolge?.vardiyaTetigi === false, `vardiyaTetigi=${r1.json?.bolge?.vardiyaTetigi}`);
  if (!testId) throw new Error("test bölgesi oluşturulamadı, zincir durduruldu");

  const r2 = await duzenle(testId, { ad: TEST_AD + " v2", yaricapM: 800 }, patronToken);
  iddia("2) DÜZENLE (kısmi: ad+yarıçap) → 200",
    r2.status === 200 && r2.json?.bolge?.yaricapM === 800 && r2.json?.bolge?.ad === TEST_AD + " v2",
    `${r2.status} ad="${r2.json?.bolge?.ad?.slice(0, 22)}…" yaricapM=${r2.json?.bolge?.yaricapM}`);
  iddia("   dokunulmayan alan korundu (kategori hâlâ customer)",
    r2.json?.bolge?.kategori === "customer", `kategori=${r2.json?.bolge?.kategori}`);
  iddia("   dokunulmayan alan korundu (merkez aynı)",
    r2.json?.bolge?.lat === 59 && r2.json?.bolge?.lng === -30,
    `${r2.json?.bolge?.lat},${r2.json?.bolge?.lng}`);
  const r2b = await duzenle(testId, { yaricapM: 6000 }, patronToken);
  iddia("   yarıçap 6000 → 400 (sınır düzenlemede de geçerli)",
    r2b.status === 400 && r2b.json?.alan === "yaricapM", `${r2b.status} ${r2b.json?.alan}`);

  const r3 = await aktifEt(testId, { aktif: false }, patronToken);
  iddia("3) KAPAT → 200, aktif=false", r3.status === 200 && r3.json?.bolge?.aktif === false, `${r3.status} aktif=${r3.json?.bolge?.aktif}`);
  iddia("   depo OLMAYAN bölgede uyarı YOK", r3.json?.uyari === undefined, `uyari=${r3.json?.uyari ?? "(yok)"}`);
  await aktifEt(testId, { aktif: true }, patronToken); // arşiv etkisini yalın ölçmek için geri aç

  const r4 = await arsivle(testId, { arsiv: true }, patronToken);
  iddia("4) ARŞİVLE → 200, archivedAt dolu VE aktif=false",
    r4.status === 200 && !!r4.json?.bolge?.archivedAt && r4.json?.bolge?.aktif === false,
    `${r4.status} archivedAt=${r4.json?.bolge?.archivedAt ? "dolu" : "NULL"} aktif=${r4.json?.bolge?.aktif}`);

  const lVar = await liste("", patronToken);
  const lTum = await liste("?arsiv=1", patronToken);
  iddia("   arşivli VARSAYILAN listede YOK",
    !(lVar.json?.bolgeler ?? []).some((z) => z.id === testId),
    `varsayılan ${lVar.json?.bolgeler?.length} bölge`);
  iddia("   ?arsiv=1 ile GELİYOR",
    (lTum.json?.bolgeler ?? []).some((z) => z.id === testId),
    `arsiv=1 → ${lTum.json?.bolgeler?.length} bölge · arsivSayisi=${lTum.json?.arsivSayisi}`);

  const zonesArsiv = await activeDepotZones();
  iddia("   arşivli bölge MOTOR listesinde yok (activeDepotZones)",
    !zonesArsiv.some((z) => z.id === testId), `${zonesArsiv.length} depo bölgesi`);

  const r5 = await arsivle(testId, { arsiv: false }, patronToken);
  iddia("5) GERİ AL → 200, archivedAt NULL",
    r5.status === 200 && r5.json?.bolge?.archivedAt === null, `${r5.status} archivedAt=${r5.json?.bolge?.archivedAt}`);
  iddia("   geri alınan bölge KAPALI geliyor (açılmıyor)",
    r5.json?.bolge?.aktif === false && r5.json?.geriAlindiKapali === true,
    `aktif=${r5.json?.bolge?.aktif} geriAlindiKapali=${r5.json?.geriAlindiKapali}`);

  // ══ 4. DEPO UYARISI (test bölgesine purpose='depot' verilerek) ═══════════
  console.log("\n── 4. DEPO KAPATMA UYARISI ──");
  bilgi("gerçek depolara YAZMADAN ölçüm: TEST bölgesinin purpose'u DB'den depot yapılır");
  await supabaseAdmin.from("geofences").update({ purpose: "depot", active: true }).eq("id", testId);
  const zonesTest = await activeDepotZones();
  iddia("   test bölgesi artık depo tetiği (motor listesinde)",
    zonesTest.some((z) => z.id === testId), `${zonesTest.length} depo bölgesi`);

  const rU = await aktifEt(testId, { aktif: false }, patronToken);
  iddia("depo KAPATILIRKEN uyari='depo_vardiya_tetigi' döndü",
    rU.status === 200 && rU.json?.uyari === "depo_vardiya_tetigi", `${rU.status} uyari=${rU.json?.uyari}`);
  iddia("   uyarı ENGEL değil — işlem yapıldı (aktif=false)", rU.json?.bolge?.aktif === false, `aktif=${rU.json?.bolge?.aktif}`);
  const rA = await aktifEt(testId, { aktif: true }, patronToken);
  iddia("   AÇMADA uyarı YOK", rA.status === 200 && rA.json?.uyari === undefined, `uyari=${rA.json?.uyari ?? "(yok)"}`);
  const rAr = await arsivle(testId, { arsiv: true }, patronToken);
  iddia("   depo ARŞİVLENİRKEN de uyarı var", rAr.json?.uyari === "depo_vardiya_tetigi", `uyari=${rAr.json?.uyari}`);

  // ══ 5. GERÇEK BÖLGELER LİSTEDE DOĞRU MU ═════════════════════════════════
  console.log("\n── 5. GERÇEK DEPO BÖLGELERİ ──");
  const lg = await liste("", patronToken);
  const gercek = (lg.json?.bolgeler ?? []).filter((z) => z.id !== testId);
  for (const z of gercek) {
    console.log(`     ${z.ad.padEnd(28)} kategori=${z.kategori} yaricapM=${z.yaricapM} aktif=${z.aktif} vardiyaTetigi=${z.vardiyaTetigi} archivedAt=${z.archivedAt ?? "null"}`);
  }
  iddia("gerçek 2 bölge listede", gercek.length === 2, `${gercek.length} bölge`);
  iddia("ikisi de 500 m ve AÇIK", gercek.every((z) => z.yaricapM === 500 && z.aktif === true));
  iddia("ikisi de kategori=depot ve vardiyaTetigi=true",
    gercek.every((z) => z.kategori === "depot" && z.vardiyaTetigi === true));
  iddia("liste sözleşmesi: sinir + kategoriler alanları var",
    lg.json?.sinir?.yaricapMinM === 50 && lg.json?.sinir?.yaricapMaxM === 5000 && Array.isArray(lg.json?.kategoriler),
    `sinir=${JSON.stringify(lg.json?.sinir)} kategoriler=${lg.json?.kategoriler?.length}`);
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
} finally {
  // ══ 6. TEMİZLİK ═══════════════════════════════════════════════════════════
  console.log("\n── 6. TEMİZLİK ──");
  const { error: silHata } = await supabaseAdmin.from("geofences").delete().eq("id", testId ?? "00000000-0000-0000-0000-000000000000");
  const kalan = (await supabaseAdmin
    .from("geofences")
    .select("id, name, purpose, category, active, archived_at, radius_m")
    .order("created_at")).data ?? [];
  iddia("test bölgesi silindi", !silHata && !kalan.some((z) => z.id === testId), silHata ? silHata.message : "ok");
  iddia(`gerçek bölgeler DEĞİŞMEDİ (${gercekOnce?.length ?? "?"} satır)`,
    JSON.stringify(kalan) === JSON.stringify(gercekOnce ?? []),
    `${kalan.length} satır`);
  for (const z of kalan) {
    console.log(`     ${z.name.padEnd(28)} purpose=${z.purpose} category=${z.category} active=${z.active} archived_at=${z.archived_at ?? "NULL"} r=${z.radius_m}`);
  }
}

console.log(`\n╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
