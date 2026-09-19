#!/usr/bin/env node
/**
 * KİRACI AYARLARI (108) — CANLIDA KANIT (yalnız galzura-demo).
 *
 * ═══ İKİ MOD, TEK BETİK ═══
 *
 * Betik migration 108'in uygulanıp uygulanmadığını KENDİ ÖLÇER ve ona göre
 * koşar:
 *
 *   TABLO YOK  → yalnız DÜŞÜŞ kanıtı: uygulama bozulmuyor, zincir env/kod
 *                varsayılanına düşüyor, yazma yolu 409 `tablo_yok` diyor.
 *                Bu, migration'dan ÖNCE de koşabilen gerçek bir kanıttır.
 *   TABLO VAR  → tam tur: PATCH imperial → /me · saat dilimi → PANO GÜN
 *                SINIRI · şoför 403 · jetonsuz 401 · hepsi geri alınır.
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (HAK61 salt okuma — Volkan kuralı).
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 *   • birim  → metric → imperial → metric
 *   • dilim  → (neyse o) → Europe/Istanbul → ESKİ DEĞER
 *   `finally` bloğu satırı başlangıç hâline yazar ve geri almanın TUTTUĞUNU
 *   ayrıca ölçer.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-kiraci-ayarlari.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import {
  kiraciAyarlari,
  kiraciAyarSatiri,
  ayarOnbelleginiDusur,
} from "@/lib/tenant-settings";
import { startOfTodayVienna, viennaDayKey } from "@/lib/format";
import { TENANT_TZ, tenantTz, calismaZamaniTzAyarla } from "@/lib/tz";

// ── EMNİYET 1: ŞİM DEĞİL, GERÇEK İSTEMCİ ───────────────────────────────────
if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede. Bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}

// ── EMNİYET 2: YALNIZ galzura-demo ─────────────────────────────────────────
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(DEMO_REF)) {
  console.error(
    `✗ DURDURULDU — hedef galzura-demo DEĞİL.\n` +
      `  Beklenen ref: ${DEMO_REF}\n  Gelen URL:    ${url}\n` +
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

const istek = (yol, { token, method = "PATCH", govde } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`https://demo.galzura.com${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
};
const cevap = async (res) => ({ kod: res.status, govde: await res.json() });
const jeton = async (w) => (await issueTokens(w.id, w.is_admin, w.token_version ?? 0)).accessToken;

const { GET: TENANT_GET, PATCH: TENANT_PATCH } = await import("@/app/api/mobile/tenant/route.ts");
const { GET: ME_GET } = await import("@/app/api/mobile/me/route.ts");

console.log(`\n╔══ KİRACI AYARLARI (108) · CANLIDA KANIT (galzura-demo) ════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

let geri = null;

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — kurulum durumu ve jetonlar");
  const { data: yonetici } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, token_version")
    .eq("is_admin", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const { data: sofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, token_version")
    .eq("is_admin", false)
    .eq("is_active", true)
    .eq("is_test", false)
    .limit(1)
    .maybeSingle();
  if (!yonetici || !sofor) {
    console.error("✗ yönetici ya da şoför hesabı bulunamadı.");
    process.exit(1);
  }
  const tYon = await jeton(yonetici);
  const tSof = await jeton(sofor);
  bilgi(`yönetici "${yonetici.name}" · şoför "${sofor.name}"`);

  const { tabloYok } = await kiraciAyarSatiri();
  const ayar0 = await kiraciAyarlari({ tazele: true });
  bilgi(`migration 108: ${tabloYok ? "UYGULANMADI" : "UYGULANDI"}`);
  bilgi(`env NEXT_PUBLIC_TENANT_TZ → TENANT_TZ = ${TENANT_TZ}`);
  bilgi(`çözülen  birim=${ayar0.birimSistemi} (${ayar0.kaynak.birim}) · dilim=${ayar0.saatDilimi} (${ayar0.kaynak.saatDilimi})`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. DÜŞÜŞ ZİNCİRİ — tablo olmasa da uygulama ÇALIŞIR");
  {
    iddia("ayar okuması hata ATMIYOR", typeof ayar0.birimSistemi === "string", `${ayar0.birimSistemi}`);
    iddia("birim varsayılanı 'metric'", ["metric", "imperial"].includes(ayar0.birimSistemi), ayar0.birimSistemi);
    iddia("dilim IANA ve çözülebilir", (() => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: ayar0.saatDilimi }).format(new Date(0));
        return true;
      } catch {
        return false;
      }
    })(), ayar0.saatDilimi);
    iddia("tenantTz() çözülen dilimle AYNI", tenantTz() === ayar0.saatDilimi, `${tenantTz()}`);

    const g = await cevap(await TENANT_GET(istek("/api/mobile/tenant", { token: tYon, method: "GET" })));
    iddia("GET /tenant → 200", g.kod === 200, `${g.kod}`);
    iddia("gövde tabloYok bayrağını SÖYLÜYOR", g.govde.tabloYok === tabloYok, `${g.govde.tabloYok}`);
    iddia("gövde birimSistemi taşıyor", g.govde.tenant?.birimSistemi === ayar0.birimSistemi, `${g.govde.tenant?.birimSistemi}`);
    iddia("gövde kaynak etiketi taşıyor", typeof g.govde.kaynak?.saatDilimi === "string", JSON.stringify(g.govde.kaynak));

    const me = await cevap(await ME_GET(istek("/api/mobile/me", { token: tYon, method: "GET" })));
    iddia("GET /me tenant.birimSistemi taşıyor", me.govde.tenant?.birimSistemi === ayar0.birimSistemi, `${me.govde.tenant?.birimSistemi}`);
    iddia("GET /me tenant.saatDilimi = çözülen dilim", me.govde.tenant?.saatDilimi === ayar0.saatDilimi, `${me.govde.tenant?.saatDilimi}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. KAPI — şoför 403 · jetonsuz 401 · gövde beyaz listesi");
  {
    const rs = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tSof, govde: { birimSistemi: "imperial" } })));
    iddia("🔴 ŞOFÖR jetonuyla PATCH → 403 admin_required", rs.kod === 403 && rs.govde.error === "admin_required", `${rs.kod} ${rs.govde.error}`);

    const r401 = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { govde: { birimSistemi: "imperial" } })));
    iddia("jetonsuz PATCH → 401", r401.kod === 401, `${r401.kod} ${r401.govde.error ?? ""}`);

    const rg401 = await cevap(await TENANT_GET(istek("/api/mobile/tenant", { method: "GET" })));
    iddia("jetonsuz GET → 401", rg401.kod === 401, `${rg401.kod}`);

    for (const [ad, govde] of [
      ["paraBirimi", { paraBirimi: "USD" }],
      ["dil", { dil: "en" }],
      ["kod", { kod: "baska-kiraci" }],
    ]) {
      const r = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde })));
      iddia(`gövdede "${ad}" → 400 alan_izinsiz`, r.kod === 400 && r.govde.error === "alan_izinsiz", `${r.kod} ${r.govde.error}`);
    }
    const bos = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: {} })));
    iddia("boş gövde → 400 bos_govde", bos.kod === 400 && bos.govde.error === "bos_govde", `${bos.kod} ${bos.govde.error}`);

    const kotuTz = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { saatDilimi: "Mars/Olympus" } })));
    iddia("geçersiz IANA → 400 gecersiz", kotuTz.kod === 400 && kotuTz.govde.error === "gecersiz", `${kotuTz.kod} ${kotuTz.govde.error}/${kotuTz.govde.alan}`);

    const kotuBirim = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { birimSistemi: "nautical" } })));
    iddia("geçersiz birim → 400 gecersiz", kotuBirim.kod === 400 && kotuBirim.govde.error === "gecersiz", `${kotuBirim.kod} ${kotuBirim.govde.alan}`);
  }

  if (tabloYok) {
    // ════════════════════════════════════════════════════════════════════════
    baslik("3. TABLO YOK — yazma yolu SEBEBİNİ SÖYLÜYOR");
    const r = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { birimSistemi: "imperial" } })));
    iddia("PATCH → 409 tablo_yok", r.kod === 409 && r.govde.error === "tablo_yok", `${r.kod} ${r.govde.error}`);
    iddia("hangi migration olduğu yanıtta", r.govde.migration === "108_kiraci_ayarlari", `${r.govde.migration}`);
    // ══════════════════════════════════════════════════════════════════════
    baslik("4. MEKANİZMA KANITI — tablo beklerken gün sınırı ZİNCİRİ ölçülüyor");
    /**
     * ⚠️ BU ADIM TABLOYU KULLANMAZ ve tam turun yerine GEÇMEZ.
     *
     * Ölçtüğü şey şu: `lib/tenant-settings.ts`in yazacağı değer, senkron gün
     * sınırı fonksiyonlarına GERÇEKTEN ulaşıyor mu. Migration'dan sonra
     * çalışacak zincirin tek riskli halkası buydu (`lib/format.ts` sabiti
     * okusaydı tablo değeri hiçbir güne ulaşmazdı) ve migration'ı beklemeden
     * ölçülebilir. Çağrı sonunda değer geri alınır.
     */
    const dOnce = tenantTz();
    const sOnce = startOfTodayVienna();
    calismaZamaniTzAyarla("Europe/Istanbul");
    const dSonra = tenantTz();
    const sSonra = startOfTodayVienna();
    iddia("tenantTz() çalışma zamanı değerini alıyor", dSonra === "Europe/Istanbul", `${dOnce} → ${dSonra}`);
    iddia(
      "🔴 startOfTodayVienna() GÜN SINIRINI kaydırdı",
      sSonra.getTime() !== sOnce.getTime(),
      `${sOnce.toISOString()} → ${sSonra.toISOString()} (${(sOnce.getTime() - sSonra.getTime()) / 3.6e6} sa)`
    );
    /**
     * ÖRNEK AN SABİT DEĞİL, ARANIYOR. İki dilimin farkı yaz saatine göre
     * değişiyor (Vienna UTC+1/+2, Istanbul sabit UTC+3), yani "22:30 UTC"
     * gibi sabit bir an yılın yarısında İKİ DİLİMDE DE aynı güne düşer ve
     * iddia sahte biçimde düşerdi. Bugünün UTC gününde saat saat taranıp gün
     * atfının GERÇEKTEN ayrıldığı ilk an seçiliyor.
     */
    const bugunUtc = new Date().toISOString().slice(0, 10);
    let ornek = null;
    for (let h = 0; h < 24 && ornek === null; h++) {
      const an = `${bugunUtc}T${String(h).padStart(2, "0")}:30:00.000Z`;
      const a = new Date(an).toLocaleDateString("en-CA", { timeZone: dOnce });
      const b = new Date(an).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
      if (a !== b) ornek = { an, a, b };
    }
    iddia(
      "🔴 aynı ana ait GÜN ATFI değişti",
      ornek !== null && viennaDayKey(ornek.an) === ornek.b && ornek.a !== ornek.b,
      ornek
        ? `${ornek.an} → ${dOnce}:${ornek.a} · Istanbul:${viennaDayKey(ornek.an)}`
        : "iki dilim bugün hiçbir saatte ayrışmıyor (beklenmez)"
    );
    calismaZamaniTzAyarla(null);
    await kiraciAyarlari({ tazele: true });
    iddia("🔴 mekanizma kanıtı GERİ ALINDI", tenantTz() === dOnce, `${tenantTz()}`);

    console.log("");
    console.log("  ⏳ TAM TUR migration 108 uygulanınca koşar:");
    console.log("     birim imperial → /me · saat dilimi → pano gün sınırı · geri alma.");
  } else {
    // ════════════════════════════════════════════════════════════════════════
    baslik("3. PATCH BİRİM — imperial → GET /me → geri al");
    const { satir: satir0 } = await kiraciAyarSatiri();
    geri = { unit_system: satir0?.unit_system ?? null, timezone: satir0?.timezone ?? null, vardi: !!satir0 };

    const r = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { birimSistemi: "imperial" } })));
    iddia("PATCH birimSistemi:imperial → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
    iddia("yanıt once/sonra ikisini de taşıyor", r.govde.once?.birimSistemi === ayar0.birimSistemi && r.govde.tenant?.birimSistemi === "imperial", `${r.govde.once?.birimSistemi} → ${r.govde.tenant?.birimSistemi}`);

    const me = await cevap(await ME_GET(istek("/api/mobile/me", { token: tYon, method: "GET" })));
    iddia("🔴 GET /me tenant.birimSistemi = imperial", me.govde.tenant?.birimSistemi === "imperial", `${me.govde.tenant?.birimSistemi}`);
    const g = await cevap(await TENANT_GET(istek("/api/mobile/tenant", { token: tYon, method: "GET" })));
    iddia("kaynak etiketi 'tablo'ya döndü", g.govde.kaynak?.birim === "tablo", `${g.govde.kaynak?.birim}`);

    const rg = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { birimSistemi: null } })));
    const me2 = await cevap(await ME_GET(istek("/api/mobile/me", { token: tYon, method: "GET" })));
    iddia("🔴 birim GERİ ALINDI (null → metric)", rg.kod === 200 && me2.govde.tenant?.birimSistemi === "metric", `${me2.govde.tenant?.birimSistemi}`);

    // ════════════════════════════════════════════════════════════════════════
    baslik("4. PATCH SAAT DİLİMİ — PANO GÜN SINIRI gerçekten kayıyor mu");
    /**
     * ÖLÇÜ: gün sınırı iki dilimde AYNI ANDA hesaplanıyor ve bir vardiyanın
     * gün atfı karşılaştırılıyor. Sayıyı değil, SAYININ GÖRÜNDÜĞÜ YERİ ölçmek
     * şart — kolonu yazıp panonun değiştiğini VARSAYMAK bu depoda daha önce
     * yanlış çıkmış bir varsayım.
     */
    const dilimOnce = tenantTz();
    const sinirOnce = startOfTodayVienna();

    const rt = await cevap(await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { saatDilimi: "Europe/Istanbul" } })));
    iddia("PATCH saatDilimi:Europe/Istanbul → 200", rt.kod === 200, `${rt.kod} ${rt.govde.error ?? ""}`);

    await kiraciAyarlari({ tazele: true });
    const dilimSonra = tenantTz();
    const sinirSonra = startOfTodayVienna();
    iddia("tenantTz() YENİ dilime döndü", dilimSonra === "Europe/Istanbul", `${dilimOnce} → ${dilimSonra}`);
    iddia(
      "🔴 GÜN SINIRI KAYDI (startOfTodayVienna)",
      sinirSonra.getTime() !== sinirOnce.getTime(),
      `${sinirOnce.toISOString()} → ${sinirSonra.toISOString()} (${(sinirOnce.getTime() - sinirSonra.getTime()) / 3.6e6} sa)`
    );

    // Gün atfı: sınırın İKİ yanına düşen gerçek bir vardiya ara.
    const { data: vardiyalar } = await supabaseAdmin
      .from("time_entries")
      .select("id, started_at")
      .gte("started_at", new Date(Date.now() - 60 * 864e5).toISOString())
      .order("started_at", { ascending: false })
      .limit(400);
    const farkli = (vardiyalar ?? []).filter((v) => {
      const a = new Date(v.started_at).toLocaleDateString("en-CA", { timeZone: dilimOnce });
      const b = new Date(v.started_at).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
      return a !== b;
    });
    if (farkli.length > 0) {
      const v = farkli[0];
      const a = new Date(v.started_at).toLocaleDateString("en-CA", { timeZone: dilimOnce });
      iddia(
        `🔴 GÜN ATFI DEĞİŞEN VARDİYA var (${farkli.length}/${(vardiyalar ?? []).length})`,
        viennaDayKey(v.started_at) !== a,
        `${v.started_at} → ${dilimOnce}:${a} · Istanbul:${viennaDayKey(v.started_at)}`
      );
    } else {
      bilgi(`son 60 günde gün atfı değişen vardiya YOK (${(vardiyalar ?? []).length} satır) — sınır kayması yukarıda ölçüldü`);
    }

    // ── GERİ AL
    const rtg = await cevap(
      await TENANT_PATCH(istek("/api/mobile/tenant", { token: tYon, govde: { saatDilimi: geri.timezone } }))
    );
    await kiraciAyarlari({ tazele: true });
    iddia(
      `🔴 dilim GERİ ALINDI (${geri.timezone ?? "null → env/varsayılan"})`,
      rtg.kod === 200 && tenantTz() === dilimOnce,
      `${tenantTz()}`
    );
    iddia(
      "gün sınırı da eski hâline döndü",
      startOfTodayVienna().getTime() === sinirOnce.getTime(),
      `${startOfTodayVienna().toISOString()}`
    );
    geri = null;
  }
} finally {
  baslik("SON — geri alma emniyeti");
  if (geri) {
    if (geri.vardi) {
      await supabaseAdmin
        .from("tenant_settings")
        .update({ unit_system: geri.unit_system ?? "metric", timezone: geri.timezone })
        .eq("id", "singleton");
    } else {
      await supabaseAdmin.from("tenant_settings").delete().eq("id", "singleton");
    }
    ayarOnbelleginiDusur();
    const son = await kiraciAyarlari({ tazele: true });
    console.log(`  ✓ finally: birim=${son.birimSistemi} dilim=${son.saatDilimi}`);
  } else {
    console.log("  ✓ geri alınacak bir şey kalmadı");
  }
}

console.log(`\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ═══════════════════════════════\n`);
process.exit(dusen === 0 ? 0 : 1);
