#!/usr/bin/env node
/**
 * KİRACI SORGU UCU — CANLI KANIT (SALT OKUMA).
 *
 * Playwright QA bu depoda bloklu, bu yüzden kanıt yöntemi UI-path proof: sayfanın
 * / ucun GERÇEK kodunu süreç içinde çağırıp canlı veritabanına karşı ölçmek.
 * Burada GERÇEKTEN route handler'ın kendisi çağrılıyor — kopyası değil.
 *
 * ⚠️ HİÇBİR YAZMA YOK. Uç zaten yalnız SELECT yapıyor; giriş akışının aksine
 * `login_attempts`e satır yazmaz (kilit sayacı PIN'e ait, bu uçta PIN yok).
 *
 * ── EN ÖNEMLİ DENETİM: D8 · GİRİŞLE PARİTE ────────────────────────────────
 * Kadrodaki HER kayıt için, HER makul yazımla uca sorulur ve cevap, girişin
 * aynı kişi için vereceği kararla karşılaştırılır. Tek bir ayrışma bile
 * "sorguda var, girişte yok" demektir ve bu betik kırılır.
 *
 * Kullanım:
 *   npm run verify:kiraci-sorgu                      → HAK61 (.env.local)
 *   ENV_FILE=.env.sendigo NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false \
 *     npm run verify:kiraci-sorgu                    → Sendigo (panel KAPALI)
 */
process.env.KIRACI_SORGU_SECRET ??= "olcum-sirri-" + "x".repeat(24);

const { POST, GET } = await import("../app/api/mobile/kiraci-sorgu/route.ts");
const { supabaseAdmin } = await import("../lib/supabase.ts");
const { DRIVER_PANEL_ENABLED } = await import("../lib/tenant.ts");
const { TENANT } = await import("../lib/brand.ts");
const { canonicalPhone, phoneVariants } = await import("../lib/phone.ts");
const { sinirSifirla } = await import("../lib/rate-limit.ts");

const SIR = process.env.KIRACI_SORGU_SECRET;
const hatalar = [];
const notlar = [];
let denetim = 0;

function esit(ad, bulunan, beklenen) {
  denetim++;
  if (JSON.stringify(bulunan) === JSON.stringify(beklenen)) return true;
  hatalar.push(`${ad}\n     beklenen: ${JSON.stringify(beklenen)}\n     bulunan : ${JSON.stringify(bulunan)}`);
  return false;
}

/** Uca istek — gerçek handler, gerçek gövde. */
async function sor(govde, { sir = SIR, ham = null } = {}) {
  const baslik = { "content-type": "application/json" };
  if (sir !== null) baslik.authorization = `Bearer ${sir}`;
  const req = new Request("https://ornek.test/api/mobile/kiraci-sorgu", {
    method: "POST",
    headers: baslik,
    body: ham ?? JSON.stringify(govde),
  });
  const res = await POST(req);
  return { status: res.status, govde: await res.json(), headers: res.headers };
}

console.log(`── KİRACI: ${TENANT} · şoför paneli ${DRIVER_PANEL_ENABLED ? "AÇIK" : "KAPALI"} ──`);

// ── D1 · env yokken FAIL-CLOSED ve GÜRÜLTÜLÜ ──────────────────────────────
{
  const yedek = process.env.KIRACI_SORGU_SECRET;
  delete process.env.KIRACI_SORGU_SECRET;
  const r = await sor({ telefon: "+436601113783" }, { sir: null });
  esit("D1 · env tanımsız → 503 yapilandirilmadi (\"hayır\" DEĞİL)", [r.status, r.govde], [503, { ok: false, hata: "yapilandirilmadi" }]);
  process.env.KIRACI_SORGU_SECRET = yedek;
}

// ── D2/D3 · sır kapısı ────────────────────────────────────────────────────
{
  const yok = await sor({ telefon: "+436601113783" }, { sir: null });
  esit("D2 · başlık yok → 401", [yok.status, yok.govde.hata], [401, "yetkisiz"]);
  const yanlis = await sor({ telefon: "+436601113783" }, { sir: SIR + "z" });
  esit("D3 · yanlış sır → 401", [yanlis.status, yanlis.govde.hata], [401, "yetkisiz"]);
}

// ── D4 · "acik" sentineli kimliksiz çalıştırır ────────────────────────────
{
  const yedek = process.env.KIRACI_SORGU_SECRET;
  process.env.KIRACI_SORGU_SECRET = "acik";
  const r = await sor({ telefon: "+436600000042" }, { sir: null });
  esit("D4 · KIRACI_SORGU_SECRET=acik → kimliksiz 200", [r.status, r.govde.ok], [200, true]);
  process.env.KIRACI_SORGU_SECRET = yedek;
}

// ── D5 · PIN reddi ────────────────────────────────────────────────────────
{
  const r = await sor({ telefon: "+436601113783", pin: "123456" });
  esit("D5 · gövdede pin → 400 pin_gonderilmemeli", [r.status, r.govde.hata], [400, "pin_gonderilmemeli"]);
  const r2 = await sor({ telefon: "+436601113783", password: "x" });
  esit("D5b · password alanı da reddediliyor", [r2.status, r2.govde.hata], [400, "pin_gonderilmemeli"]);
}

// ── D6 · biçim ve gövde hataları ──────────────────────────────────────────
{
  esit("D6a · telefon yok → 400", (await sor({})).govde.hata, "telefon_bicimsiz");
  esit("D6b · çok kısa numara → 400", (await sor({ telefon: "123" })).govde.hata, "telefon_bicimsiz");
  esit("D6c · sayı gönderildi → 400", (await sor({ telefon: 4366011 })).govde.hata, "telefon_bicimsiz");
  const bozuk = await sor(null, { ham: "{bu json degil" });
  esit("D6d · bozuk JSON → 400 gecersiz_govde", [bozuk.status, bozuk.govde.hata], [400, "gecersiz_govde"]);
}

// ── D7 · GET kapalı ───────────────────────────────────────────────────────
{
  const res = await GET();
  denetim++;
  const g = await res.json();
  if (res.status !== 405 || g.hata !== "sadece_post") {
    hatalar.push(`D7 · GET 405 dönmeli (numara URL'e yazılmasın) — bulunan ${res.status} ${JSON.stringify(g)}`);
  }
}

// ── D8 · CANLI PARİTE: her kayıt, her yazım, girişin kararıyla aynı mı ────
const { data: kadro, error } = await supabaseAdmin
  .from("workers")
  .select("phone, is_active, is_admin, is_test");
if (error) {
  hatalar.push(`D8 · kadro okunamadı: ${error.message}`);
} else {
  sinirSifirla(); // parite turu, hız sınırı kovalarını tüketmesin
  let ayrisma = 0, evet = 0, hayir = 0, yazimSayisi = 0;
  for (const w of kadro) {
    const P = (w.phone ?? "").trim();
    if (!P) continue;
    // GİRİŞİN KARARI — lib/auth-core.ts → workerCanSignIn ile aynı kural,
    // burada BAĞIMSIZ yazıldı ki uç kendi kendini onaylamasın.
    const beklenen = w.is_active === true && (DRIVER_PANEL_ENABLED || w.is_admin === true);
    if (beklenen) evet++;
    else hayir++;
    // Kişinin numarasını yazabileceği makul biçimler. Hepsi AYNI cevabı vermeli.
    const yazimlar = [...new Set([P, canonicalPhone(P), ...phoneVariants(P)])];
    for (const y of yazimlar) {
      yazimSayisi++;
      const r = await sor({ telefon: y });
      if (r.status !== 200 || r.govde.var !== beklenen) {
        ayrisma++;
        if (ayrisma <= 5) {
          hatalar.push(
            `D8 · AYRIŞMA — yazım "${y.slice(0, 5)}…" · uç "${r.govde.var}" dedi, giriş "${beklenen}" der ` +
              `(aktif=${w.is_active} yönetici=${w.is_admin} test=${w.is_test})`
          );
        }
      }
    }
  }
  denetim++;
  notlar.push(
    `D8 ✓ parite: ${kadro.length} kayıt × ${yazimSayisi} yazım — 0 ayrışma ` +
      `(uç "evet" diyecek: ${evet}, "hayır": ${hayir})`
  );
  if (ayrisma > 0) notlar.pop();
}

// ── D9 · kayıtlı olmayan numaralar ────────────────────────────────────────
{
  sinirSifirla();
  let yanlisEvet = 0;
  for (const n of ["+436600000042", "+436600000043", "+491701234567", "+905551112233"]) {
    const r = await sor({ telefon: n });
    if (r.govde.var !== false) yanlisEvet++;
  }
  esit("D9 · 4 kayıtsız numara → hepsi false", yanlisEvet, 0);
}

// ── D10 · gövde ve başlıklar ──────────────────────────────────────────────
{
  const r = await sor({ telefon: "+436600000042" });
  esit("D10a · gövde alanları yalnız ok/var/kod", Object.keys(r.govde).sort(), ["kod", "ok", "var"]);
  esit("D10b · kod = kiracı kodu", r.govde.kod, TENANT);
  esit("D10c · cache-control no-store", r.headers.get("cache-control"), "no-store, private");
  esit("D10d · x-robots-tag noindex", r.headers.get("x-robots-tag"), "noindex, nofollow");
}

// ── D11 · hız sınırı gerçekten kesiyor mu ─────────────────────────────────
{
  sinirSifirla();
  const tel = "+436600000077";
  let ilk429 = 0;
  for (let i = 1; i <= 25; i++) {
    const r = await sor({ telefon: tel });
    if (r.status === 429 && ilk429 === 0) ilk429 = i;
  }
  esit("D11a · aynı numara 21. istekte 429", ilk429, 21);
  // Sınır KANONİK numaraya bağlı: farklı yazım aynı kovaya düşmeli.
  const trunk = await sor({ telefon: tel.replace("+43", "+430") });
  esit("D11b · trunk sıfırlı yazım AYNI kovada (429)", trunk.status, 429);
  // Başka bir numara etkilenmemeli.
  const baska = await sor({ telefon: "+436600000078" });
  esit("D11c · başka numara etkilenmedi (200)", baska.status, 200);
  sinirSifirla();
}

// ── SONUÇ ────────────────────────────────────────────────────────────────
console.log("");
for (const n of notlar) console.log("  " + n);
if (hatalar.length > 0) {
  console.error(`\n✗ ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}
console.log(`\n✓ kiracı sorgu ucu — ${denetim} denetim geçti (${TENANT}, canlı DB, salt okuma).`);
