#!/usr/bin/env node
/**
 * SEFER UÇLARI (Tur 1) — CANLIDA KANIT.
 *
 * Dört ucun GERÇEK işleyicileri çağrılır (route.ts'ler saf `.ts`).
 *
 * ── ⚠️ CANLI VERİTABANI: NEYE DOKUNUR ────────────────────────────────────
 * YAZMA VAR ama yalnız TEST dokusuna:
 *   1. Koşum başında GEÇİCİ bir `is_test` ŞOFÖR satırı açılır
 *      ("ZZ QA Sefer Şoförü"), sonunda SERT SİLİNİR.
 *   2. Seferler yalnız o şoföre atanır; sonunda silinir ve `seferler`
 *      tablosu başlangıçtaki satır sayısına döner.
 * Gerçek şoförlere sefer ATANMAZ. Gerçek şoför token'ı YALNIZ reddedilmesi
 * beklenen çağrılarda (403) kullanılır — reddedilen istek DB'ye yazmaz.
 *
 * ── ⚠️ NEDEN YENİ BİR TEST ŞOFÖRÜ: kalıcı test hesabı ŞOFÖR DEĞİL ────────
 * Migration 028'in kalıcı hesabı ("Test şoför") canlıda `is_admin = true` ve
 * `managed_fleet = 'mavi'` — yani YÖNETİCİ. Onunla "şoför POST /sefer → 403"
 * ölçülemez (201 döner, çünkü gerçekten yöneticidir) ve "durum çizgisini
 * ATANAN ŞOFÖR ilerletir" kanıtı da şoför tarafını göstermez. Bu yüzden
 * koşum kendi şoförünü açar; PIN karması geçersiz bir dizedir, hesaba GİRİŞ
 * YAPILAMAZ, ve satır koşum sonunda kalmaz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-sefer-tur1.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { viennaDayKey } from "@/lib/format";
import { GET as LISTE, POST as OLUSTUR } from "@/app/api/mobile/sefer/route";
import { PATCH as DUZENLE } from "@/app/api/mobile/sefer/[id]/route";
import { POST as DURUM } from "@/app/api/mobile/sefer/[id]/durum/route";

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
  const t = await res.text();
  let json = null;
  try { json = JSON.parse(t); } catch { /* JSON değil */ }
  return { status: res.status, json };
}

const liste = (qs, t) => cagir(LISTE, `/api/mobile/sefer${qs ?? ""}`, t);
const olustur = (g, t) => cagir(OLUSTUR, "/api/mobile/sefer", t, { method: "POST", body: JSON.stringify(g) });
const duzenle = (id, g, t) => cagir(DUZENLE, `/api/mobile/sefer/${id}`, t, { method: "PATCH", body: JSON.stringify(g) }, { id });
const durumla = (id, g, t) => cagir(DURUM, `/api/mobile/sefer/${id}/durum`, t, { method: "POST", body: JSON.stringify(g) }, { id });

const BUGUN = viennaDayKey(new Date());
const QA_AD = "ZZ QA Sefer Şoförü";
let qaSoforId = null;
let baslangicSayi = 0;

console.log(`\n╔══ SEFER UÇLARI (Tur 1) · CANLIDA KANIT ══════════════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ tarih  ${BUGUN}`);

try {
  // ── Hazırlık: aktörler ───────────────────────────────────────────────────
  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", true).eq("is_active", true).neq("is_test", true)
    .order("name").limit(1).maybeSingle();
  const { data: sef } = await supabaseAdmin
    .from("workers").select("id, name, token_version, managed_fleet")
    .not("managed_fleet", "is", null).eq("is_admin", false).eq("is_active", true)
    .order("name").limit(1).maybeSingle();
  const { data: gercekSofor } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", false).eq("is_active", true).is("managed_fleet", null)
    .neq("is_test", true).order("name").limit(1).maybeSingle();
  if (!patron) { console.error("✗ aktif yönetici yok"); process.exit(1); }

  // Artık kalmış QA satırı varsa önce temizle (tekrar çalıştırılabilirlik).
  {
    const { data: eski } = await supabaseAdmin.from("workers").select("id").eq("name", QA_AD);
    for (const w of eski ?? []) {
      await supabaseAdmin.from("seferler").delete().eq("worker_id", w.id);
      await supabaseAdmin.from("workers").delete().eq("id", w.id);
    }
    if ((eski ?? []).length) bilgi(`önceki koşumdan ${eski.length} QA satırı temizlendi`);
  }

  // GEÇİCİ test şoförü — is_test dokusu, girişi kapalı, sonunda silinir.
  const { data: qa, error: qaHata } = await supabaseAdmin
    .from("workers")
    .insert({
      name: QA_AD,
      phone: "+43000000000",
      pin_hash: "QA_GIRIS_KAPALI_gecersiz_hash",
      is_active: true,
      is_test: true,
      is_admin: false,
    })
    .select("id, name, is_admin, is_test, managed_fleet, token_version")
    .maybeSingle();
  if (qaHata || !qa) { console.error("✗ QA şoförü açılamadı:", qaHata?.message); process.exit(1); }
  qaSoforId = qa.id;

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;
  const sefToken = sef ? (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken : null;
  const qaToken = (await issueTokens(qa.id, false, qa.token_version ?? 0)).accessToken;
  const gercekToken = gercekSofor ? (await issueTokens(gercekSofor.id, false, gercekSofor.token_version ?? 0)).accessToken : null;

  console.log(`║ patron ${patron.name.slice(0, 4)}***  ·  şef ${sef ? sef.name.slice(0, 4) + "***" : "YOK"}  ·  gerçek şoför ${gercekSofor ? gercekSofor.name.slice(0, 4) + "***" : "YOK"}`);
  console.log(`║ QA şoförü ${qa.name} (is_test=${qa.is_test}, is_admin=${qa.is_admin}, managed_fleet=${qa.managed_fleet})`);

  const { count: c0 } = await supabaseAdmin.from("seferler").select("id", { count: "exact", head: true });
  baslangicSayi = c0 ?? 0;
  console.log(`║ seferler tablosu başlangıç: ${baslangicSayi} satır\n`);

  // ══ 1. KAPI ══════════════════════════════════════════════════════════════
  console.log("── 1. KAPI ──");
  const YOK = "00000000-0000-4000-8000-000000000000";
  const uclar = [
    ["GET   /sefer", (t) => liste(`?tarih=${BUGUN}`, t)],
    ["POST  /sefer", (t) => olustur({ tarih: BUGUN, soforId: YOK }, t)],
    ["PATCH /sefer/[id]", (t) => duzenle(YOK, { notlar: "x" }, t)],
    ["POST  /sefer/[id]/durum", (t) => durumla(YOK, { durum: "kabul" }, t)],
  ];
  for (const [ad, f] of uclar) {
    const a = await f(null);
    iddia(`${ad} · token yok → 401`, a.status === 401 && a.json?.error === "missing_token", `${a.status} ${a.json?.error}`);
    const b = await f("kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, b.status === 401, `${b.status} ${b.json?.error}`);
  }

  // Rol kapıları — YAZMAYAN redler
  {
    const a = await olustur({ tarih: BUGUN, soforId: qaSoforId }, qaToken);
    iddia("POST /sefer · ŞOFÖR → 403 admin_required", a.status === 403 && a.json?.error === "admin_required", `${a.status} ${a.json?.error}`);
    const b = await duzenle(YOK, { notlar: "x" }, qaToken);
    iddia("PATCH /sefer · ŞOFÖR → 403 admin_required", b.status === 403 && b.json?.error === "admin_required", `${b.status} ${b.json?.error}`);
  }
  if (sefToken) {
    const a = await olustur({ tarih: BUGUN, soforId: qaSoforId }, sefToken);
    iddia("POST /sefer · FİLO ŞEFİ → 403 admin_required", a.status === 403 && a.json?.error === "admin_required", `${a.status} ${a.json?.error}`);
    const b = await duzenle(YOK, { notlar: "x" }, sefToken);
    iddia("PATCH /sefer · FİLO ŞEFİ → 403 admin_required", b.status === 403 && b.json?.error === "admin_required", `${b.status} ${b.json?.error}`);
  } else olculmedi("şef 403 denemeleri", "filo şefi yok");
  if (gercekToken) {
    const a = await olustur({ tarih: BUGUN, soforId: qaSoforId }, gercekToken);
    iddia("POST /sefer · GERÇEK ŞOFÖR → 403 (yazma olmadı)", a.status === 403 && a.json?.error === "admin_required", `${a.status} ${a.json?.error}`);
  } else olculmedi("gerçek şoför 403", "gerçek şoför bulunamadı");

  // ══ 2. GİRDİ REDLERİ ═════════════════════════════════════════════════════
  console.log("\n── 2. GİRDİ REDLERİ ──");
  {
    const a = await liste("?tarih=2026-02-31", patronToken);
    iddia("GET · takvimde olmayan tarih → 400", a.status === 400 && a.json?.error === "invalid_tarih", `${a.status} ${a.json?.error}`);
    const b = await olustur({ tarih: BUGUN, soforId: YOK }, patronToken);
    iddia("POST · olmayan şoför → 404 worker_not_found", b.status === 404 && b.json?.error === "worker_not_found", `${b.status} ${b.json?.error}`);
    const c = await olustur({ tarih: BUGUN, soforId: qaSoforId, paketHedef: -3 }, patronToken);
    iddia("POST · paketHedef negatif → 400", c.status === 400 && c.json?.alan === "paketHedef", `${c.status} ${c.json?.alan}`);
    const d = await olustur({ tarih: "19.08.2026", soforId: qaSoforId }, patronToken);
    iddia("POST · bozuk tarih → 400", d.status === 400 && d.json?.alan === "tarih", `${d.status} ${d.json?.alan}`);
  }

  // ══ 3. DURUM MAKİNESİ ════════════════════════════════════════════════════
  console.log("\n── 3. DURUM MAKİNESİ (QA şoförü) ──");
  const r1 = await olustur({ tarih: BUGUN, soforId: qaSoforId, paketHedef: 120, notlar: "QA Tur 1" }, patronToken);
  const seferId = r1.json?.sefer?.id ?? null;
  iddia("oluştur (yönetici) → 201, durum=atandi", r1.status === 201 && r1.json?.sefer?.durum === "atandi",
    `${r1.status} durum=${r1.json?.sefer?.durum} sonraki=${r1.json?.sefer?.sonrakiDurum}`);
  if (!seferId) throw new Error("sefer oluşturulamadı: " + JSON.stringify(r1.json));
  iddia("   yalnız atandi damgası dolu",
    !!r1.json?.sefer?.damgalar?.atandi && r1.json?.sefer?.damgalar?.kabul === null
    && r1.json?.sefer?.damgalar?.yolda === null && r1.json?.sefer?.damgalar?.tamamlandi === null,
    JSON.stringify(r1.json?.sefer?.damgalar));

  // İŞ KURALI 1
  const r1b = await olustur({ tarih: BUGUN, soforId: qaSoforId }, patronToken);
  iddia("İK1 · aynı şoför+gün ikinci AÇIK sefer → 409 acik_sefer_var",
    r1b.status === 409 && r1b.json?.error === "acik_sefer_var",
    `${r1b.status} ${r1b.json?.error} mevcutDurum=${r1b.json?.mevcutDurum}`);

  // İŞ KURALI 2 — sıra atlama / geri gitme
  const s1 = await durumla(seferId, { durum: "yolda" }, qaToken);
  iddia("İK2 · atandi→yolda (SIRA ATLAMA) → 409 gecersiz_gecis",
    s1.status === 409 && s1.json?.error === "gecersiz_gecis",
    `${s1.status} ${s1.json?.error} mevcut=${s1.json?.mevcutDurum} beklenen=${s1.json?.sonrakiDurum}`);
  const s1b = await durumla(seferId, { durum: "tamamlandi" }, qaToken);
  iddia("İK2 · atandi→tamamlandi (İKİ ADIM ATLAMA) → 409", s1b.status === 409, `${s1b.status} ${s1b.json?.error}`);
  const s1c = await durumla(seferId, { durum: "iptal" }, qaToken);
  iddia("şoför İPTAL edemez → 400 invalid_body", s1c.status === 400 && s1c.json?.alan === "durum", `${s1c.status} ${s1c.json?.error}`);
  const s1d = await durumla(seferId, { durum: "reddet" }, qaToken);
  iddia("'reddet' diye bir geçiş YOK → 400", s1d.status === 400, `${s1d.status} ${s1d.json?.error}`);

  // Sahiplik
  if (gercekToken) {
    const y = await durumla(seferId, { durum: "kabul" }, gercekToken);
    iddia("BAŞKA şoför ilerletemez → 403 sefer_sizin_degil",
      y.status === 403 && y.json?.error === "sefer_sizin_degil", `${y.status} ${y.json?.error}`);
  } else olculmedi("başka şoför denemesi", "gerçek şoför bulunamadı");
  const yn = await durumla(seferId, { durum: "kabul" }, patronToken);
  iddia("YÖNETİCİ de ilerletemez → 403 sefer_sizin_degil",
    yn.status === 403 && yn.json?.error === "sefer_sizin_degil", `${yn.status} ${yn.json?.error}`);

  // Doğru çizgi
  const s2 = await durumla(seferId, { durum: "kabul" }, qaToken);
  iddia("atandi → kabul → 200, kabul damgası YAZILDI",
    s2.status === 200 && s2.json?.sefer?.durum === "kabul" && !!s2.json?.sefer?.damgalar?.kabul,
    `durum=${s2.json?.sefer?.durum} kabul_at=${s2.json?.sefer?.damgalar?.kabul ?? "NULL"} sonraki=${s2.json?.sefer?.sonrakiDurum}`);
  iddia("   sonraki damgalar HÂLÂ boş",
    s2.json?.sefer?.damgalar?.yolda === null && s2.json?.sefer?.damgalar?.tamamlandi === null, null);

  const s2b = await durumla(seferId, { durum: "kabul" }, qaToken);
  iddia("kabul → kabul (AYNI ADIM) → 409", s2b.status === 409, `${s2b.status} ${s2b.json?.error}`);

  const s3 = await durumla(seferId, { durum: "yolda" }, qaToken);
  iddia("kabul → yolda → 200, yolda damgası YAZILDI",
    s3.status === 200 && s3.json?.sefer?.durum === "yolda" && !!s3.json?.sefer?.damgalar?.yolda,
    `durum=${s3.json?.sefer?.durum} yolda_at=${s3.json?.sefer?.damgalar?.yolda ?? "NULL"}`);
  iddia("   önceki damga KORUNDU (kabul hâlâ dolu)", !!s3.json?.sefer?.damgalar?.kabul,
    `kabul_at=${s3.json?.sefer?.damgalar?.kabul ?? "NULL"}`);

  const s3b = await durumla(seferId, { durum: "kabul" }, qaToken);
  iddia("yolda → kabul (GERİ GİTME) → 409 gecersiz_gecis",
    s3b.status === 409 && s3b.json?.error === "gecersiz_gecis", `${s3b.status} ${s3b.json?.error}`);

  const s4 = await durumla(seferId, { durum: "tamamlandi" }, qaToken);
  iddia("yolda → tamamlandi → 200, acik=false, sonrakiDurum=null",
    s4.status === 200 && s4.json?.sefer?.durum === "tamamlandi" && s4.json?.sefer?.acik === false && s4.json?.sefer?.sonrakiDurum === null,
    `durum=${s4.json?.sefer?.durum} acik=${s4.json?.sefer?.acik} sonraki=${String(s4.json?.sefer?.sonrakiDurum)}`);
  iddia("   dört damganın DÖRDÜ de dolu, iptal boş",
    ["atandi", "kabul", "yolda", "tamamlandi"].every((k) => !!s4.json?.sefer?.damgalar?.[k]) && s4.json?.sefer?.damgalar?.iptal === null,
    JSON.stringify(s4.json?.sefer?.damgalar));

  const s5 = await durumla(seferId, { durum: "kabul" }, qaToken);
  iddia("KAPANMIŞ seferde geçiş → 409 kapali_sefer", s5.status === 409 && s5.json?.error === "kapali_sefer", `${s5.status} ${s5.json?.error}`);
  const s5b = await duzenle(seferId, { iptal: true }, patronToken);
  iddia("KAPANMIŞ sefer iptal edilemez → 409 kapali_sefer", s5b.status === 409 && s5b.json?.error === "kapali_sefer", `${s5b.status} ${s5b.json?.error}`);

  // İK1 · kapandıktan sonra YENİSİ açılabilir
  const r2 = await olustur({ tarih: BUGUN, soforId: qaSoforId, notlar: "QA ikinci" }, patronToken);
  iddia("İK1 · sefer KAPANDIKTAN sonra yenisi açılabilir → 201", r2.status === 201, `${r2.status} ${r2.json?.error ?? ""}`);
  const sefer2 = r2.json?.sefer?.id ?? null;

  // ══ 4. DÜZENLEME + İPTAL ═════════════════════════════════════════════════
  console.log("\n── 4. DÜZENLEME + İPTAL (yönetici) ──");
  if (sefer2) {
    const p1 = await duzenle(sefer2, { paketHedef: 250, notlar: "guncellendi" }, patronToken);
    iddia("PATCH kısmi → 200, verilmeyen alan korundu",
      p1.status === 200 && p1.json?.sefer?.paketHedef === 250 && p1.json?.sefer?.tarih === BUGUN && p1.json?.sefer?.durum === "atandi",
      `paketHedef=${p1.json?.sefer?.paketHedef} tarih=${p1.json?.sefer?.tarih} durum=${p1.json?.sefer?.durum}`);
    const p2 = await duzenle(sefer2, { durum: "yolda" }, patronToken);
    iddia("PATCH ile durum değişmez → 400", p2.status === 400 && p2.json?.error === "durum_bu_uctan_degismez", `${p2.status} ${p2.json?.error}`);
    const p3 = await duzenle(sefer2, { iptal: true, notlar: "x" }, patronToken);
    iddia("iptal + düzenleme BİRLİKTE → 400", p3.status === 400 && p3.json?.error === "iptal_ile_duzenleme_birlikte_olmaz", `${p3.status} ${p3.json?.error}`);
    const p3b = await duzenle(sefer2, {}, patronToken);
    iddia("boş PATCH → 400 empty_patch", p3b.status === 400 && p3b.json?.error === "empty_patch", `${p3b.status} ${p3b.json?.error}`);
    const p4 = await duzenle(sefer2, { iptal: true }, patronToken);
    iddia("iptal → 200, durum=iptal, iptal damgası dolu, acik=false",
      p4.status === 200 && p4.json?.sefer?.durum === "iptal" && !!p4.json?.sefer?.damgalar?.iptal && p4.json?.sefer?.acik === false,
      `durum=${p4.json?.sefer?.durum} iptal_at=${p4.json?.sefer?.damgalar?.iptal ?? "NULL"}`);
    const p5 = await durumla(sefer2, { durum: "kabul" }, qaToken);
    iddia("İPTAL edilmiş seferde geçiş → 409 kapali_sefer", p5.status === 409 && p5.json?.error === "kapali_sefer", `${p5.status} ${p5.json?.error}`);
  } else olculmedi("düzenleme + iptal", "ikinci sefer açılamadı");

  // ══ 5. LİSTE KAPSAMI ═════════════════════════════════════════════════════
  console.log("\n── 5. LİSTE KAPSAMI ──");
  const lp = await liste(`?tarih=${BUGUN}`, patronToken);
  iddia("yönetici · kapsam='filo'", lp.status === 200 && lp.json?.kapsam === "filo",
    `${lp.status} kapsam=${lp.json?.kapsam} ${lp.json?.seferler?.length} sefer`);
  iddia("yönetici listesinde TEST şoförünün seferi GÖRÜNMEZ (test elemesi)",
    !(lp.json?.seferler ?? []).some((s) => s.soforId === qaSoforId),
    `${(lp.json?.seferler ?? []).length} sefer döndü`);
  const lt = await liste(`?tarih=${BUGUN}`, qaToken);
  iddia("şoför · kapsam='kendi' ve YALNIZ kendi seferleri",
    lt.status === 200 && lt.json?.kapsam === "kendi" && (lt.json?.seferler ?? []).length === 2
    && (lt.json?.seferler ?? []).every((s) => s.soforId === qaSoforId),
    `kapsam=${lt.json?.kapsam} ${lt.json?.seferler?.length} sefer (kendi verisi: eleme uygulanmaz)`);
  const ld = await liste("?tarih=2026-01-01", qaToken);
  iddia("başka gün → boş liste", ld.status === 200 && (ld.json?.seferler ?? []).length === 0, `${ld.json?.seferler?.length} sefer`);
  if (sefToken) {
    const ls = await liste(`?tarih=${BUGUN}`, sefToken);
    iddia("filo şefi · kapsam='kendi' (şoför muamelesi)", ls.status === 200 && ls.json?.kapsam === "kendi", `${ls.status} kapsam=${ls.json?.kapsam}`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
} finally {
  // ══ 6. TEMİZLİK ═══════════════════════════════════════════════════════════
  console.log("\n── 6. TEMİZLİK ──");
  if (qaSoforId) {
    await supabaseAdmin.from("seferler").delete().eq("worker_id", qaSoforId);
    await supabaseAdmin.from("workers").delete().eq("id", qaSoforId);
    const { data: kalanSefer } = await supabaseAdmin.from("seferler").select("id, worker_id, durum, tarih");
    const { data: kalanQa } = await supabaseAdmin.from("workers").select("id, name").eq("name", QA_AD);
    const { count } = await supabaseAdmin.from("seferler").select("id", { count: "exact", head: true });
    iddia("QA seferleri silindi", !(kalanSefer ?? []).some((s) => s.worker_id === qaSoforId), `${(kalanSefer ?? []).length} satır kaldı`);
    iddia("QA şoför satırı silindi", (kalanQa ?? []).length === 0, `${(kalanQa ?? []).length} satır`);
    iddia(`seferler tablosu başlangıçtaki satır sayısına döndü (${baslangicSayi})`, (count ?? -1) === baslangicSayi, `${count} satır`);
    bilgi(`kalan seferler: ${(kalanSefer ?? []).length ? JSON.stringify(kalanSefer) : "(yok)"}`);
    const { count: wc } = await supabaseAdmin.from("workers").select("id", { count: "exact", head: true }).eq("is_test", true);
    bilgi(`is_test personel sayısı: ${wc} (beklenen 1 — migration 028'in kalıcı hesabı)`);
  } else {
    olculmedi("temizlik", "QA şoförü hiç açılmadı");
  }
}

console.log(`\n╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
