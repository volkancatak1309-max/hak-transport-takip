#!/usr/bin/env node
/**
 * MESAJ BİLDİR / ENGELLE / SÜZGEÇ / YÖNETİCİ SİLMESİ — YEREL uçtan uca kanıt (111).
 *
 * ⚠️ YALNIZ YEREL VERİTABANI. `NEXT_PUBLIC_SUPABASE_URL`in host'u 127.0.0.1 ya
 * da localhost DEĞİLSE betik HİÇBİR İSTEK ATMADAN durur. Demo, HAK61 ve
 * Sendigo'ya bu betikle dokunmanın yolu yok — kapı kodda, dikkatte değil.
 * (ts-server.mjs ENV_FILE verilmezse .env.local'i yükler; o zaman da bu
 * kapıda durur.)
 *
 * Düzenek (docs/MESAJ-BILDIR-ENGELLE.md, mobil depo, "Yerel ölçüm"):
 *   postgres:16 + kurulum SQL'i (109) + 111 · postgrest:v12 · /rest/v1 vekili
 *
 * NE KANITLIYOR — route handler'lar SÜREÇ İÇİNDE, gerçek PostgREST'e karşı:
 *   S  süzgeç: birebir/grup/duyuru 422 `uygunsuz_icerik`, mesaj YAZILMAZ
 *   B  bildir: kayıt, çift bildirim 200, kendi mesajı/yanlış sebep/uzun not
 *      reddi, erişimsiz 403, yöneticilere push (metin YOK), yönetici listesi,
 *      şef/şoför 403, liste rozeti
 *   E  engelle: grup geçmişinden düşer (sunucuda), birebirde düşmez,
 *      okunmamış sayacı + liste önizlemesi + makbuz + push süzülür, kaldırınca
 *      geri gelir, kendini/ortak grubu olmayanı engelleme reddi
 *   D  silme: yalnız yönetici, iz (?silinen=iz) / gizle (eski istemci),
 *      önizleme tazelenir, silinmiş mesaj bildirilemez, liste metni göstermez
 *   Ç  çöz: yalnız yönetici, idempotent, çözüldükten sonra yeniden bildirim
 *   P  pasife al: mevcut uç, jeton ölür
 *   T  tablo yok (111 koşmamış kiracı): mesajlaşma kırılmaz, moderasyon 503
 *      — yalnız `YEREL_PG_KAP` (konteyner adı) verilirse
 *
 * Kullanım (panel deposunda):
 *   ENV_FILE=<yerel env> YEREL_PG_KAP=mbe-pg npm run verify:mesaj-bildir-engelle-yerel
 */
import { execFileSync } from "node:child_process";

// ── KAPI: yalnız yerel ──────────────────────────────────────────────────────
const URL_HAM = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let host = "";
try {
  host = new URL(URL_HAM).hostname;
} catch {
  /* aşağıda düşer */
}
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(
    `✗ DURDURULDU — bu betik YAZAR ve yalnız YEREL veritabanında koşar.\n` +
      `  Bulunan host: "${host || "(yok)"}". ENV_FILE ile yerel env dosyasını ver.`
  );
  process.exit(1);
}

// ── Dışarı istek kapısı + Expo yakalama ─────────────────────────────────────
// PostgREST (yerel) geçer; exp.host YAKALANIR ve gerçek Expo'ya GİTMEZ; başka
// her dış istek KESİLİR ve düşen iddia sayılır.
const gercekFetch = globalThis.fetch;
const expoIstekleri = [];
const kesilen = [];
globalThis.fetch = async (girdi, init) => {
  const u = typeof girdi === "string" ? girdi : girdi.url;
  const h = new URL(u).hostname;
  if (h === "127.0.0.1" || h === "localhost") return gercekFetch(girdi, init);
  if (h === "exp.host") {
    const govde = JSON.parse(String(init?.body ?? "[]"));
    expoIstekleri.push(govde);
    return new Response(JSON.stringify({ data: govde.map(() => ({ status: "ok", id: "yerel" })) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  kesilen.push(u);
  throw new Error(`dış istek kesildi: ${h}`);
};

const { supabaseAdmin } = await import("@/lib/supabase");
const { issueAccessToken } = await import("@/lib/mobile-auth");

let gecen = 0;
const dusen = [];
function ok(baslik, kosul, kanit) {
  if (kosul) {
    gecen++;
    console.log(`  ✓ ${baslik}${kanit !== undefined ? `   [${kanit}]` : ""}`);
  } else {
    dusen.push(baslik);
    console.log(`  ✗ ${baslik}   [${kanit}]`);
  }
}

// ── Uçlar ───────────────────────────────────────────────────────────────────
const U = {
  liste: await import("@/app/api/mobile/messages/route.ts"),
  sohbet: await import("@/app/api/mobile/messages/[id]/route.ts"),
  okundu: await import("@/app/api/mobile/messages/[id]/okundu/route.ts"),
  duyuru: await import("@/app/api/mobile/messages/duyuru/route.ts"),
  grupKur: await import("@/app/api/mobile/messages/gruplar/route.ts"),
  sil: await import("@/app/api/mobile/messages/mesaj/[mesajId]/route.ts"),
  bildir: await import("@/app/api/mobile/messages/mesaj/[mesajId]/bildir/route.ts"),
  bildirimler: await import("@/app/api/mobile/messages/bildirimler/route.ts"),
  coz: await import("@/app/api/mobile/messages/bildirimler/[mesajId]/coz/route.ts"),
  engeller: await import("@/app/api/mobile/messages/engeller/route.ts"),
  engelKaldir: await import("@/app/api/mobile/messages/engeller/[workerId]/route.ts"),
  pasif: await import("@/app/api/mobile/workers/[id]/pasif/route.ts"),
};

async function cagir(fn, { yol, jeton, govde, method = "GET", params = {} }) {
  const headers = { "content-type": "application/json" };
  if (jeton) headers.authorization = `Bearer ${jeton}`;
  const req = new Request(`http://yerel.invalid${yol}`, {
    method,
    headers,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
  const res = await fn(req, { params: Promise.resolve(params) });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* gövdesiz */
  }
  return { kod: res.status, j: json };
}

// ── Tohum — önce önceki koşumun artığını temizle ────────────────────────────
const ON = "+4399977";
async function temizle() {
  await supabaseAdmin.from("conversations").delete().like("title", "YEREL-%");
  await supabaseAdmin.from("workers").delete().like("phone", `${ON}%`);
}
await temizle();

async function kisi(ad, ek, tel) {
  const { data, error } = await supabaseAdmin
    .from("workers")
    .insert({ name: ad, phone: `${ON}${tel}`, pin_hash: "yerel", ...ek })
    .select("id, token_version, is_admin")
    .single();
  if (error) throw new Error(`tohum ${ad}: ${error.message}`);
  const { accessToken } = await issueAccessToken(data.id, data.is_admin, data.token_version ?? 0);
  return { id: data.id, ad, jeton: accessToken };
}
const A = await kisi("Yerel Yonetici A", { is_admin: true }, "001");
const B = await kisi("Yerel Yonetici B", { is_admin: true }, "002");
const C = await kisi("Yerel Sef C", { managed_fleet: "bordo" }, "003");
const S1 = await kisi("Yerel Sofor 1", {}, "011");
const S2 = await kisi("Yerel Sofor 2", {}, "012");
const S3 = await kisi("Yerel Sofor 3", {}, "013");
await supabaseAdmin.from("push_tokens").insert([
  { token: "ExponentPushToken[YEREL-B]", worker_id: B.id, platform: "ios" },
  { token: "ExponentPushToken[YEREL-1]", worker_id: S1.id, platform: "android" },
  { token: "ExponentPushToken[YEREL-2]", worker_id: S2.id, platform: "android" },
  { token: "ExponentPushToken[YEREL-3]", worker_id: S3.id, platform: "android" },
]);

const sohbetYaz = (kim, adres, metin) =>
  cagir(U.sohbet.POST, { yol: `/api/mobile/messages/${adres}`, jeton: kim.jeton, method: "POST", govde: { govde: metin }, params: { id: adres } });
const sohbetOku = (kim, adres, iz = false) =>
  cagir(U.sohbet.GET, { yol: `/api/mobile/messages/${adres}?limit=200${iz ? "&silinen=iz" : ""}`, jeton: kim.jeton, params: { id: adres } });
const mesajSayisi = async (konusmaId) =>
  (await supabaseAdmin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", konusmaId)).count;

console.log("\n═══ YEREL · mesaj bildir / engelle / süzgeç / silme (111) ═══");
console.log(`  host ${host} · yönetici A/B · şef C · şoför 1/2/3`);

// Grup: A kurar; üyeler S1, S2, S3 (A otomatik üye). Şef C üye DEĞİL.
const g = await cagir(U.grupKur.POST, {
  yol: "/api/mobile/messages/gruplar", jeton: A.jeton, method: "POST",
  govde: { baslik: "YEREL-Sabah", uyeler: [S1.id, S2.id, S3.id] },
});
const G = g.j?.grup?.konusmaId;
ok("grup kuruldu", g.kod === 200 && typeof G === "string", g.kod);

// ═══ S — SÜZGEÇ ═══
console.log("\n── S · süzgeç");
let once = await mesajSayisi(G);
let r = await sohbetYaz(S1, G, "Du Arschloch, wo bleibst du?");
ok("grup: küfür → 422 uygunsuz_icerik", r.kod === 422 && r.j?.error === "uygunsuz_icerik", `${r.kod} ${r.j?.error}`);
ok("grup: mesaj YAZILMADI", (await mesajSayisi(G)) === once, `${once} → ${await mesajSayisi(G)}`);
r = await sohbetYaz(S1, S1.id, "SİKTİR");
ok("birebir: Türkçe küfür (İ) → 422", r.kod === 422 && r.j?.error === "uygunsuz_icerik", `${r.kod}`);
r = await sohbetYaz(S1, S1.id, "SIK sık geliyorum, 06:30 A deposu");
ok("birebir: 'SIK sık' (I→ı kuralı) geçer → 200", r.kod === 200, `${r.kod} ${r.j?.error ?? ""}`);
r = await cagir(U.duyuru.POST, { yol: "/api/mobile/messages/duyuru", jeton: A.jeton, method: "POST", govde: { govde: "what the fuck is this" } });
ok("duyuru: küfür → 422", r.kod === 422 && r.j?.error === "uygunsuz_icerik", `${r.kod}`);

// Gruba dört temiz mesaj: S1 iki, A bir, S3 bir; S1 en son yazar.
const m1 = (await sohbetYaz(S1, G, "Lieferung 1 erledigt")).j?.mesaj?.id;
const mA = (await sohbetYaz(A, G, "Danke, weiter zu Lager B")).j?.mesaj?.id;
const m3 = (await sohbetYaz(S3, G, "Bin unterwegs")).j?.mesaj?.id;
expoIstekleri.length = 0;
const m1b = (await sohbetYaz(S1, G, "Tor 4 ist zu, warte")).j?.mesaj?.id;
ok("grup: dört temiz mesaj yazıldı", [m1, mA, m3, m1b].every(Boolean), [m1, mA, m3, m1b].filter(Boolean).length);

// ═══ B — BİLDİR ═══
console.log("\n── B · bildir");
expoIstekleri.length = 0;
const bildir = (kim, mesajId, govde) =>
  cagir(U.bildir.POST, { yol: `/api/mobile/messages/mesaj/${mesajId}/bildir`, jeton: kim.jeton, method: "POST", govde, params: { mesajId } });
r = await bildir(S2, m1, { sebep: "harassment", not: "beni rahatsız ediyor" });
ok("S2 S1'in grup mesajını bildirdi → 200", r.kod === 200 && r.j?.zatenBildirildi === false, `${r.kod} ${r.j?.error ?? ""}`);
const push1 = expoIstekleri.flat();
ok("yöneticiye push gitti (yalnız B'nin jetonu)", push1.length === 1 && push1[0].to === "ExponentPushToken[YEREL-B]", push1.map((p) => p.to).join(","));
ok("push: başlık kurulum dilinde ('Reported message')", push1[0]?.title === "Reported message", push1[0]?.title);
ok("push: veri tur=mesaj_bildirimi + mesajId", push1[0]?.data?.tur === "mesaj_bildirimi" && push1[0]?.data?.mesajId === m1, JSON.stringify(push1[0]?.data));
ok("push: mesaj METNİ yok", !JSON.stringify(push1).includes("Lieferung 1"), push1[0]?.body);
expoIstekleri.length = 0;
r = await bildir(S2, m1, { sebep: "spam" });
ok("aynı kişi ikinci kez → 200 zatenBildirildi", r.kod === 200 && r.j?.zatenBildirildi === true, `${r.kod}`);
ok("ikinci bildirimde push YOK", expoIstekleri.length === 0, expoIstekleri.length);
r = await bildir(S1, m1, { sebep: "spam" });
ok("kendi mesajı → 400 own_message", r.kod === 400 && r.j?.error === "own_message", `${r.kod} ${r.j?.error}`);
r = await bildir(S3, m1, { sebep: "kotu" });
ok("geçersiz sebep → 400 invalid_reason", r.kod === 400 && r.j?.error === "invalid_reason", `${r.kod}`);
r = await bildir(S3, m1, { sebep: "other", not: "x".repeat(501) });
ok("501 karakter not → 400 note_too_long", r.kod === 400 && r.j?.error === "note_too_long", `${r.kod}`);
const birebirMesaj = (await sohbetOku(A, S1.id)).j?.mesajlar?.[0]?.id;
r = await bildir(S3, birebirMesaj, { sebep: "spam" });
ok("başkasının birebir konuşması → 403", r.kod === 403, `${r.kod} ${r.j?.error}`);
r = await bildir(S3, "bozuk-kimlik", { sebep: "spam" });
ok("bozuk kimlik → 404 (22P02'ye düşmez)", r.kod === 404, `${r.kod}`);

const bListe = (kim, durum = "open") =>
  cagir(U.bildirimler.GET, { yol: `/api/mobile/messages/bildirimler?durum=${durum}`, jeton: kim.jeton });
r = await bListe(A);
const k1 = r.j?.kayitlar?.find((k) => k.mesajId === m1);
ok("yönetici listesi 200, mesaj başına 1 kayıt", r.kod === 200 && r.j?.kayitlar?.length === 1, `${r.kod} ${r.j?.kayitlar?.length}`);
ok("kayıt: metin, gönderen, grup başlığı", k1?.govde === "Lieferung 1 erledigt" && k1?.gonderen?.id === S1.id && k1?.konusmaBaslik === "YEREL-Sabah", JSON.stringify({ g: k1?.govde, k: k1?.konusmaBaslik }));
ok("kayıt: bildiren, sebep, not", k1?.bildirimler?.[0]?.bildirenAd === S2.ad && k1?.bildirimler?.[0]?.sebep === "harassment" && k1?.bildirimler?.[0]?.notlar === "beni rahatsız ediyor", JSON.stringify(k1?.bildirimler?.[0]));
r = await bListe(C);
ok("şef → 403 admin_required", r.kod === 403 && r.j?.error === "admin_required", `${r.kod}`);
r = await bListe(S2);
ok("şoför → 403 admin_required", r.kod === 403, `${r.kod}`);
r = await cagir(U.liste.GET, { yol: "/api/mobile/messages?limit=200", jeton: A.jeton });
ok("liste: yöneticide bildirimSayisi = 1", r.j?.bildirimSayisi === 1, r.j?.bildirimSayisi);
r = await cagir(U.liste.GET, { yol: "/api/mobile/messages?limit=200", jeton: S2.jeton });
ok("liste: şoförde bildirimSayisi = null", r.j?.bildirimSayisi === null, r.j?.bildirimSayisi);

// ═══ E — ENGELLE ═══
console.log("\n── E · engelle");
const engelle = (kim, workerId) =>
  cagir(U.engeller.POST, { yol: "/api/mobile/messages/engeller", jeton: kim.jeton, method: "POST", govde: { workerId } });
const engelKaldir = (kim, workerId) =>
  cagir(U.engelKaldir.DELETE, { yol: `/api/mobile/messages/engeller/${workerId}`, jeton: kim.jeton, method: "DELETE", params: { workerId } });

// Okundu öncesi: S2'nin grup okunmamışı (A'nın yazdığı 1 + S1'in 2 + S3'ün 1 = 4).
const okunmamis = async (kim) =>
  (await cagir(U.liste.GET, { yol: "/api/mobile/messages?limit=200", jeton: kim.jeton })).j?.konusmalar?.find((k) => k.konusmaId === G);
let satir = await okunmamis(S2);
ok("engel öncesi S2 grup okunmamış = 4, önizleme S1'in", satir?.okunmamis === 4 && satir?.sonMesajOnizleme === "Tor 4 ist zu, warte", `${satir?.okunmamis} · ${satir?.sonMesajOnizleme}`);

r = await engelle(S2, S1.id);
ok("S2 S1'i engelledi → 200", r.kod === 200 && r.j?.engel?.zatenEngelli === false, `${r.kod} ${r.j?.error ?? ""}`);
r = await engelle(S2, S1.id);
ok("ikinci kez → 200 zatenEngelli", r.kod === 200 && r.j?.engel?.zatenEngelli === true, `${r.kod}`);

r = await sohbetOku(S2, G);
const s2Gonderenler = new Set((r.j?.mesajlar ?? []).map((m) => m.gonderenId));
ok("S2 grup geçmişinde S1'in mesajı YOK (sunucu süzdü)", r.kod === 200 && !s2Gonderenler.has(S1.id), [...s2Gonderenler].length);
ok("S2 grup sayfa toplamı süzülmüş kümeyi sayıyor (2)", r.j?.sayfa?.total === 2, r.j?.sayfa?.total);
r = await sohbetOku(S3, G);
ok("S3 (engel yok) S1'in mesajlarını görüyor", (r.j?.mesajlar ?? []).some((m) => m.gonderenId === S1.id), (r.j?.mesajlar ?? []).length);
satir = await okunmamis(S2);
ok("S2 liste: okunmamış 4 → 2 (engelli sayılmaz)", satir?.okunmamis === 2, satir?.okunmamis);
ok("S2 liste: önizleme S1'in metni DEĞİL (S3'ün)", satir?.sonMesajOnizleme === "Bin unterwegs", satir?.sonMesajOnizleme);

expoIstekleri.length = 0;
const m1c = (await sohbetYaz(S1, G, "Bin wieder da")).j?.mesaj?.id;
const alicilar = expoIstekleri.flat().map((p) => p.to).sort();
ok("S1 yazınca push S2'ye GİTMEDİ, S3'e gitti", !alicilar.includes("ExponentPushToken[YEREL-2]") && alicilar.includes("ExponentPushToken[YEREL-3]"), alicilar.join(","));

r = await cagir(U.okundu.POST, { yol: `/api/mobile/messages/${G}/okundu`, jeton: S2.jeton, method: "POST", govde: {}, params: { id: G } });
const { data: mk } = await supabaseAdmin.from("message_receipts").select("message_id").eq("worker_id", S2.id).in("message_id", [m1, m1b, m1c, mA, m3]);
const mkSet = new Set((mk ?? []).map((x) => x.message_id));
ok("okundu: engellinin mesajlarına makbuz YAZILMADI", ![m1, m1b, m1c].some((x) => mkSet.has(x)) && mkSet.has(mA) && mkSet.has(m3), [...mkSet].length);

// Birebir kanal: S2 yöneticiyi (A) engellese de birebir mesaj görünür.
r = await engelle(S2, A.id);
ok("S2 A'yı (grup arkadaşı yönetici) engelledi", r.kod === 200, `${r.kod}`);
const birebirS2 = (await sohbetYaz(A, S2.id, "Morgen 06:30 Lager A")).j?.mesaj?.id;
r = await sohbetOku(S2, S2.id);
ok("birebir: A'nın mesajı S2'de GÖRÜNÜR (işveren kanalı süzülmez)", (r.j?.mesajlar ?? []).some((m) => m.id === birebirS2), (r.j?.mesajlar ?? []).length);
r = await sohbetOku(S2, G);
ok("grup: A'nın mesajı S2'de görünmez", !(r.j?.mesajlar ?? []).some((m) => m.gonderenId === A.id), (r.j?.mesajlar ?? []).length);

r = await engelle(S2, S2.id);
ok("kendini engelleme → 400 self_block", r.kod === 400 && r.j?.error === "self_block", `${r.kod}`);
r = await engelle(S2, C.id);
ok("ortak grubu olmayan (şef C) → 403", r.kod === 403, `${r.kod}`);
r = await engelle(S2, "bozuk");
ok("bozuk kimlik → 400 worker_required", r.kod === 400, `${r.kod}`);
r = await engelle(A, C.id);
ok("yönetici ortak grup şartından muaf → 200", r.kod === 200, `${r.kod}`);
await engelKaldir(A, C.id);

r = await cagir(U.engeller.GET, { yol: "/api/mobile/messages/engeller", jeton: S2.jeton });
const engelIdler = (r.j?.engeller ?? []).map((e) => e.workerId).sort();
ok("S2 engel listesi: S1 + A (adlarıyla)", engelIdler.length === 2 && engelIdler.includes(S1.id) && engelIdler.includes(A.id) && r.j.engeller.every((e) => e.adSoyad !== "—"), JSON.stringify(r.j?.engeller?.map((e) => e.adSoyad)));

r = await engelKaldir(S2, S1.id);
ok("engel kaldırıldı → kaldirildi:true", r.kod === 200 && r.j?.kaldirildi === true, `${r.kod}`);
r = await engelKaldir(S2, S1.id);
ok("ikinci kez → 200 kaldirildi:false", r.kod === 200 && r.j?.kaldirildi === false, `${r.kod}`);
r = await sohbetOku(S2, G);
ok("kaldırınca S1'in mesajları S2'ye GERİ geldi", (r.j?.mesajlar ?? []).some((m) => m.gonderenId === S1.id), (r.j?.mesajlar ?? []).length);
await engelKaldir(S2, A.id);

// ═══ D — YÖNETİCİ SİLMESİ ═══
console.log("\n── D · yönetici silmesi");
const sil = (kim, mesajId) =>
  cagir(U.sil.DELETE, { yol: `/api/mobile/messages/mesaj/${mesajId}`, jeton: kim.jeton, method: "DELETE", params: { mesajId } });
r = await sil(S2, m1);
ok("şoför silemez → 403 admin_required", r.kod === 403 && r.j?.error === "admin_required", `${r.kod}`);
r = await sil(C, m1);
ok("şef silemez → 403", r.kod === 403, `${r.kod}`);
r = await sil(A, m1c);
ok("yönetici sildi (grubun SON mesajı) → 200", r.kod === 200 && r.j?.zatenSilinmisti === false, `${r.kod} ${r.j?.error ?? ""}`);
r = await sil(A, m1c);
ok("ikinci kez → 200 zatenSilinmisti", r.kod === 200 && r.j?.zatenSilinmisti === true, `${r.kod}`);
r = await sohbetOku(S3, G, true);
const iz = (r.j?.mesajlar ?? []).find((m) => m.id === m1c);
ok("?silinen=iz: satır döner, silindiMi:true, metin BOŞ", iz?.silindiMi === true && iz?.govde === "" && iz?.okuyanlar === null, JSON.stringify(iz));
r = await sohbetOku(S3, G, false);
ok("eski istemci (iz istemez): satır HİÇ dönmez", !(r.j?.mesajlar ?? []).some((m) => m.id === m1c), (r.j?.mesajlar ?? []).length);
ok("hiçbir yanıtta silinen metin yok", !JSON.stringify(r.j).includes("Bin wieder da"), "metin taraması");
satir = await okunmamis(S3);
ok("liste önizlemesi tazelendi (silinen metin değil)", satir?.sonMesajOnizleme === "Tor 4 ist zu, warte", satir?.sonMesajOnizleme);
r = await sil(A, m1);
r = await bildir(S3, m1, { sebep: "spam" });
ok("silinmiş mesaj bildirilemez → 409 message_deleted", r.kod === 409 && r.j?.error === "message_deleted", `${r.kod}`);
r = await bListe(A);
const k1s = r.j?.kayitlar?.find((k) => k.mesajId === m1);
ok("yönetici listesi: silinmiş mesajın metni YOK, silen adı var", k1s?.silindiMi === true && k1s?.govde === null && k1s?.silenAd === A.ad, JSON.stringify({ g: k1s?.govde, s: k1s?.silenAd }));

// ═══ Ç — ÇÖZ ═══
console.log("\n── Ç · çözüldü işaretle");
const coz = (kim, mesajId) =>
  cagir(U.coz.POST, { yol: `/api/mobile/messages/bildirimler/${mesajId}/coz`, jeton: kim.jeton, method: "POST", params: { mesajId } });
r = await coz(S2, m1);
ok("şoför çözemez → 403", r.kod === 403, `${r.kod}`);
r = await coz(A, m1);
ok("yönetici çözdü → cozulen 1", r.kod === 200 && r.j?.cozulen === 1, `${r.kod} ${r.j?.cozulen}`);
r = await coz(A, m1);
ok("ikinci kez → 200 cozulen 0", r.kod === 200 && r.j?.cozulen === 0, `${r.kod}`);
r = await coz(A, m3);
ok("hiç bildirilmemiş mesaj → 404", r.kod === 404, `${r.kod}`);
r = await bListe(A, "open");
ok("açık liste boş, acikSayisi 0", r.j?.kayitlar?.length === 0 && r.j?.acikSayisi === 0, `${r.j?.kayitlar?.length} ${r.j?.acikSayisi}`);
r = await bListe(A, "resolved");
const kc = r.j?.kayitlar?.find((k) => k.mesajId === m1);
ok("çözülmüş listede: durum resolved, çözen A", kc?.bildirimler?.[0]?.durum === "resolved" && kc?.bildirimler?.[0]?.cozenAd === A.ad, JSON.stringify(kc?.bildirimler?.[0]));
r = await bildir(S1, m3, { sebep: "inappropriate" });
await coz(A, m3);
r = await bildir(S1, m3, { sebep: "inappropriate" });
ok("çözüldükten sonra aynı kişi yeniden bildirebilir → yeni açık kayıt", r.kod === 200 && r.j?.zatenBildirildi === false, `${r.kod} ${r.j?.zatenBildirildi}`);

// ═══ P — PASİFE AL (mevcut uç) ═══
console.log("\n── P · pasife al");
r = await cagir(U.pasif.POST, { yol: `/api/mobile/workers/${S3.id}/pasif`, jeton: A.jeton, method: "POST", govde: { pasif: true }, params: { id: S3.id } });
ok("yönetici S3'ü pasife aldı → 200 degisti", r.kod === 200 && r.j?.degisti === true, `${r.kod}`);
r = await sohbetOku(S3, G);
ok("S3'ün jetonu artık geçersiz → 401", r.kod === 401, `${r.kod} ${r.j?.error}`);

// ═══ T — TABLO YOK (111 koşmamış kiracı) ═══
const KAP = process.env.YEREL_PG_KAP;
if (KAP) {
  console.log("\n── T · tablo yok (111 koşmamış kiracı provası)");
  const psql = (sql) => execFileSync("docker", ["exec", KAP, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql]);
  const bekle = (ms) => new Promise((s) => setTimeout(s, ms));
  psql("alter table public.mesaj_engeller rename to mesaj_engeller_gizli; alter table public.mesaj_bildirimleri rename to mesaj_bildirimleri_gizli; notify pgrst, 'reload schema';");
  await bekle(1500);
  try {
    r = await sohbetOku(S2, G);
    ok("grup geçmişi KIRILMADI → 200", r.kod === 200, `${r.kod} ${r.j?.error ?? ""}`);
    r = await sohbetYaz(S1, G, "ohne Tabelle");
    ok("grup mesajı yazılır, push gider → 200", r.kod === 200, `${r.kod}`);
    r = await cagir(U.liste.GET, { yol: "/api/mobile/messages?limit=200", jeton: A.jeton });
    ok("liste 200, yöneticide bildirimSayisi null (bilinmiyor)", r.kod === 200 && r.j?.bildirimSayisi === null, `${r.kod} ${r.j?.bildirimSayisi}`);
    r = await bildir(S2, m3, { sebep: "spam" });
    ok("bildir → 503 tablo_yok (sessiz başarı yok)", r.kod === 503 && r.j?.error === "tablo_yok", `${r.kod} ${r.j?.error}`);
    r = await cagir(U.engeller.GET, { yol: "/api/mobile/messages/engeller", jeton: S2.jeton });
    ok("engel listesi → 503 tablo_yok (sessiz boş liste yok)", r.kod === 503 && r.j?.error === "tablo_yok", `${r.kod}`);
    r = await engelle(S2, S1.id);
    ok("engelle → 503 tablo_yok", r.kod === 503 && r.j?.error === "tablo_yok", `${r.kod} ${r.j?.error}`);
    r = await engelKaldir(S2, S1.id);
    ok("engel kaldır → 503 tablo_yok", r.kod === 503 && r.j?.error === "tablo_yok", `${r.kod} ${r.j?.error}`);
    r = await bListe(A);
    ok("yönetici listesi → 503 tablo_yok", r.kod === 503 && r.j?.error === "tablo_yok", `${r.kod} ${r.j?.error}`);
    r = await coz(A, m3);
    ok("çöz → 503 tablo_yok", r.kod === 503 && r.j?.error === "tablo_yok", `${r.kod} ${r.j?.error}`);
  } finally {
    psql("alter table public.mesaj_engeller_gizli rename to mesaj_engeller; alter table public.mesaj_bildirimleri_gizli rename to mesaj_bildirimleri; notify pgrst, 'reload schema';");
    await bekle(1500);
  }
}

ok("dışarıya (yerel + yakalanan Expo dışında) tek istek çıkmadı", kesilen.length === 0, kesilen.join(","));

await temizle();
console.log(`\n${dusen.length === 0 ? "✓" : "✗"} ${gecen} geçti · ${dusen.length} düştü`);
if (dusen.length) {
  for (const d of dusen) console.log(`   ✗ ${d}`);
  process.exit(1);
}
