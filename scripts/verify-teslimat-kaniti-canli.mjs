#!/usr/bin/env node
/**
 * TESLİMAT KANITI UCU — CANLIDA ÖLÇÜM (yalnız galzura-demo).
 *
 * ═══ BU BETİK NEYİ ÖLÇER, NEYİ ÖLÇEMEZ ═══
 *
 * Migration 109 HENÜZ HİÇBİR KİRACIDA KOŞMADI (Volkan çalıştıracak) ve bu
 * depoda DDL kanalı yok — üç kiracıya da yalnız PostgREST üzerinden
 * erişiliyor. Yani kanıdın MUTLU YOLU canlıda bugün ölçülemez.
 *
 * ÖLÇEBİLDİĞİ — ve asıl önemli olan — şu: **uç, 109 uygulanmamış bir kiracıda
 * ne yapıyor?** Cevap "500 veriyor" ya da "sessizce yanlış yazıyor" olsaydı,
 * dağıtım o kiracıyı bozardı. Beklenen davranış kademeli düşüş:
 * `409 ozellik_kapali {migration:"109"}`.
 *
 * Ayrıca 109'dan BAĞIMSIZ olan her şey burada gerçekten ölçülüyor: kapılar
 * (401/403/404), gövde doğrulamaları (400) ve GET'in boş hâli.
 *
 * Mutlu yolun uçtan uca kanıtı AYRI ve GERÇEK bir yığında:
 *   npm run verify:teslimat-kaniti   (Postgres 16 + PostgREST, 109 UYGULANMIŞ)
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (ikisi de CANLI MÜŞTERİ).
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 * İki yazma, ikisi de geçici: bir SEFER (`seferler`) ve bir DURAK
 * (`sefer_duraklari`). ÖLÇÜLDÜ (21.09.2026) — demo'daki üç seferin üçü de
 * `iptal`, yani açık sefer yok ve uç kapanmış seferi zaten 409 ile reddediyor;
 * ölçülmek istenen kademeli düşüşe ulaşılamazdı.
 *
 * İkisi de `finally` bloğunda siliniyor ve silindikleri AYRICA ölçülüyor
 * (satır sayısı geri okunarak). Personel, araç, kanıt, mevcut seferler —
 * hiçbirine dokunulmuyor.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-teslimat-kaniti-canli.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";

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

/** Volkan'ın verdiği demo giriş hesabı. */
const TEL = "+905535910471";
const PIN = "183434";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

const { POST: LOGIN } = await import("@/app/api/mobile/auth/login/route.ts");
const KANIT = await import("@/app/api/mobile/sefer/[id]/duraklar/[durakId]/kanit/route.ts");
const { POST: FOTO } = await import(
  "@/app/api/mobile/sefer/[id]/duraklar/[durakId]/foto/route.ts"
);

const HOST = "https://demo.galzura.com";
const params = (id, durakId) => ({ params: Promise.resolve({ id, durakId }) });

const jsonIstek = (yol, { token, govde, method = "POST" } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`${HOST}${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
};

const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);
const fotoIstek = (yol, { token, alanlar = {} }) => {
  const fd = new FormData();
  fd.set("foto", new File([JPG], "qa.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(alanlar)) fd.set(k, String(v));
  const h = { "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`${HOST}${yol}`, { method: "POST", headers: h, body: fd });
};

const cevap = async (res) => {
  let govde = null;
  try {
    govde = await res.json();
  } catch {
    /* gövdesiz */
  }
  return { kod: res.status, govde };
};

console.log(`\n╔══ TESLİMAT KANITI UCU · CANLIDA ÖLÇÜM (galzura-demo) ══════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

let gecici = null;       // silinecek durak
let geciciSefer = null;  // silinecek sefer

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — şema ve veri, ölçülerek");

  const { data: kanitSatirlari, error: kErr } = await supabaseAdmin
    .from("teslimatlar")
    .select("id, sonuc")
    .limit(1);
  const sonucVarMi = !kErr;
  bilgi(
    kErr
      ? `teslimatlar.sonuc OKUNAMIYOR → ${kErr.code} (109 uygulanmamış — beklenen)`
      : `teslimatlar.sonuc okunabiliyor (109 UYGULANMIŞ, ${kanitSatirlari?.length ?? 0} satır)`
  );

  /**
   * ⚠️ `head:true` TABLO YOKLUĞUNU GİZLİYOR — 21.09.2026'da ölçüldü.
   * `select("id",{count:"exact",head:true})` olmayan bir tabloda `error:null`
   * + `count:null` döndürdü; ham HTTP ise 404/PGRST205 veriyor. Gövdesiz
   * yanıtta istemci hatayı çözemiyor. Bu yüzden prob GÖVDELİ.
   */
  const { error: tErr } = await supabaseAdmin
    .from("teslimat_taslak_dosyalari")
    .select("id")
    .limit(1);
  const taslakVarMi = !tErr;
  bilgi(
    tErr
      ? `teslimat_taslak_dosyalari YOK → ${tErr.code} (109 uygulanmamış — beklenen)`
      : `taslak tablosu VAR (109 uygulanmış)`
  );
  iddia(
    "şema iki kaynakta TUTARLI (sonuc kolonu ↔ taslak tablosu)",
    sonucVarMi === taslakVarMi,
    `sonuc=${sonucVarMi} taslak=${taslakVarMi}`
  );

  const { data: hesapOn } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin")
    .eq("phone", TEL)
    .maybeSingle();
  if (!hesapOn) throw new Error(`${TEL} bulunamadı`);

  /**
   * ⚠️ AÇIK SEFER YOK — ÖLÇÜLDÜ (21.09.2026): galzura-demo'daki 3 seferin
   * ÜÇÜ DE `iptal`. Kanıt ucu kapanmış seferi zaten 409 ile reddediyor, yani
   * asıl ölçmek istediğimiz kademeli düşüşe HİÇ ULAŞILAMAZDI. Bu yüzden
   * geçici bir sefer açılıyor ve `finally`de siliniyor.
   */
  const bugun = new Date().toISOString().slice(0, 10);
  const { data: sefer, error: sErr } = await supabaseAdmin
    .from("seferler")
    .insert({ tarih: bugun, worker_id: hesapOn.id, durum: "yolda", notlar: "QA KANIT OLCUMU (silinecek)" })
    .select("id, tarih, durum, worker_id")
    .maybeSingle();
  iddia("geçici sefer açıldı", Boolean(sefer) && !sErr, sefer ? `${sefer.id} (${sefer.durum})` : `${sErr?.message}`);
  if (!sefer) throw new Error("sefer açılamadı — ölçüm yapılamaz");
  geciciSefer = sefer.id;

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. GERÇEK GİRİŞ — +905535910471 / PIN");

  const g = await cevap(
    await LOGIN(jsonIstek("/api/mobile/auth/login", { govde: { phone: TEL, pin: PIN } }))
  );
  iddia("giriş 200", g.kod === 200, `${g.kod}`);
  const token = g.govde?.accessToken ?? g.govde?.access_token ?? null;
  iddia("accessToken geldi", Boolean(token), token ? `${String(token).slice(0, 18)}…` : "YOK");
  if (!token) throw new Error("jeton alınamadı");

  bilgi(`hesap ${hesapOn.id} is_admin=${hesapOn.is_admin}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. GEÇİCİ DURAK — tek yazma, geri alınacak");

  const { data: siraSon } = await supabaseAdmin
    .from("sefer_duraklari")
    .select("sira")
    .eq("sefer_id", sefer.id)
    .order("sira", { ascending: false })
    .limit(1);
  const sira = (siraSon?.[0]?.sira ?? 0) + 1;

  const { data: durak, error: dErr } = await supabaseAdmin
    .from("sefer_duraklari")
    .insert({ sefer_id: sefer.id, sira, ad: "QA KANIT OLCUMU (silinecek)", durum: "bekliyor" })
    .select("id, sira, durum")
    .maybeSingle();
  iddia("geçici durak açıldı", Boolean(durak) && !dErr, durak ? durak.id : `${dErr?.message}`);
  if (!durak) throw new Error("durak açılamadı");
  gecici = durak.id;

  const YOL = `/api/mobile/sefer/${sefer.id}/duraklar/${durak.id}/kanit`;
  const FOTO_YOL = `/api/mobile/sefer/${sefer.id}/duraklar/${durak.id}/foto`;

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. KAPILAR — 109'dan BAĞIMSIZ, gerçekten ölçülüyor");

  const r401 = await cevap(
    await KANIT.POST(jsonIstek(YOL, { govde: { sonuc: "teslim" } }), params(sefer.id, durak.id))
  );
  iddia("jetonsuz POST → 401", r401.kod === 401, `${r401.kod} ${r401.govde?.error}`);

  const r401g = await cevap(
    await KANIT.GET(jsonIstek(YOL, { method: "GET" }), params(sefer.id, durak.id))
  );
  iddia("jetonsuz GET → 401", r401g.kod === 401, `${r401g.kod} ${r401g.govde?.error}`);

  const rYokDurak = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim", not: "x" } }),
      params(sefer.id, "00000000-0000-0000-0000-000000000000")
    )
  );
  iddia("olmayan durak → 404 not_found", rYokDurak.kod === 404, `${rYokDurak.kod} ${rYokDurak.govde?.error}`);

  const rSebep = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim_edilemedi" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "teslim_edilemedi SEBEPSİZ → 400 sebep_gerekli",
    rSebep.kod === 400 && rSebep.govde?.error === "sebep_gerekli",
    `${rSebep.kod} ${rSebep.govde?.error}`
  );

  const rAlan = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "belki" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "tanınmayan sonuc → 400 invalid_field",
    rAlan.kod === 400 && rAlan.govde?.error === "invalid_field",
    `${rAlan.kod} ${rAlan.govde?.error}`
  );

  const rBos = await cevap(
    await KANIT.POST(
      new Request(`${HOST}${YOL}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: "bozuk-json",
      }),
      params(sefer.id, durak.id)
    )
  );
  iddia("bozuk gövde → 400 invalid_body", rBos.kod === 400, `${rBos.kod} ${rBos.govde?.error}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. 🔴 ASIL SORU — 109 YOKKEN UÇ NE YAPIYOR");

  const rKanit = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, {
        token,
        govde: { sonuc: "teslim", not: "109 kademeli dusus olcumu" },
      }),
      params(sefer.id, durak.id)
    )
  );
  if (sonucVarMi) {
    iddia("109 UYGULANMIŞ — kanıt yazıldı (200)", rKanit.kod === 200, `${rKanit.kod}`);
    bilgi("⚠️ Bu kiracıda 109 koşmuş; mutlu yol burada ölçülebilir.");
    if (rKanit.govde?.kanit?.id) {
      const { error } = await supabaseAdmin.from("teslimatlar").delete().eq("id", rKanit.govde.kanit.id);
      iddia("ölçüm kanıtı GERİ ALINDI", !error, error ? error.message : "silindi");
    }
  } else {
    iddia(
      "109 YOK → 409 ozellik_kapali {migration:109}",
      rKanit.kod === 409 &&
        rKanit.govde?.error === "ozellik_kapali" &&
        rKanit.govde?.migration === "109",
      `${rKanit.kod} ${rKanit.govde?.error} migration=${rKanit.govde?.migration}`
    );
    iddia("500 DEĞİL — dağıtım bu kiracıyı bozmuyor", rKanit.kod < 500, `${rKanit.kod}`);

    const { count: yaziliMi } = await supabaseAdmin
      .from("teslimatlar")
      .select("id", { count: "exact", head: true })
      .eq("sefer_id", sefer.id);
    iddia("reddedilen istek SATIR YAZMADI", yaziliMi === 0, `${yaziliMi}`);
  }

  const rTaslak = await cevap(
    await FOTO(fotoIstek(FOTO_YOL, { token, alanlar: { taslak: "1" } }), params(sefer.id, durak.id))
  );
  if (sonucVarMi) {
    iddia("taslak yükleme 200", rTaslak.kod === 200, `${rTaslak.kod}`);
  } else {
    iddia(
      "taslak yükleme → 409 ozellik_kapali {migration:109}",
      rTaslak.kod === 409 && rTaslak.govde?.migration === "109",
      `${rTaslak.kod} ${rTaslak.govde?.error} migration=${rTaslak.govde?.migration}`
    );
    iddia(
      "🔑 YÜKLENEN DOSYA TEMİZLENDİ (yetim kalmadı)",
      rTaslak.govde?.dosyaTemizlendi === true,
      `dosyaTemizlendi=${rTaslak.govde?.dosyaTemizlendi}`
    );
  }

  const rEski = await cevap(
    await FOTO(fotoIstek(FOTO_YOL, { token }), params(sefer.id, durak.id))
  );
  iddia(
    "taslak bayrağı YOKKEN eski 409 kanit_yok korunuyor",
    rEski.kod === 409 && rEski.govde?.error === "kanit_yok",
    `${rEski.kod} ${rEski.govde?.error}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. GET — kanıt yokken");

  const rGet = await cevap(
    await KANIT.GET(jsonIstek(YOL, { token, method: "GET" }), params(sefer.id, durak.id))
  );
  iddia("GET → 200 (kanıt yokluğu HATA DEĞİL)", rGet.kod === 200, `${rGet.kod}`);
  iddia("kanit = null", rGet.govde?.kanit === null, `${JSON.stringify(rGet.govde?.kanit)}`);
  iddia("durak gövdesi geldi", rGet.govde?.durak?.id === durak.id, `${rGet.govde?.durak?.id}`);
  if (!sonucVarMi) {
    iddia(
      "GET 109 eksikliğini SÖYLÜYOR",
      rGet.govde?.ozellikKapali?.migration === "109",
      `${JSON.stringify(rGet.govde?.ozellikKapali)}`
    );
  }
} catch (e) {
  console.error(`\n✗ BETİK DÜŞTÜ: ${e?.message ?? e}`);
  dusen++;
} finally {
  baslik("6. GERİ ALMA");
  if (gecici) {
    const { data, error } = await supabaseAdmin
      .from("sefer_duraklari")
      .delete()
      .eq("id", gecici)
      .select("id");
    iddia(
      "geçici durak SİLİNDİ",
      !error && (data ?? []).length === 1,
      error ? error.message : `${(data ?? []).length} satır`
    );
    const { count } = await supabaseAdmin
      .from("sefer_duraklari")
      .select("id", { count: "exact", head: true })
      .eq("id", gecici);
    iddia("SONRA: o durak artık yok", count === 0, `${count}`);
  } else {
    bilgi("geçici durak açılmamıştı — silinecek bir şey yok");
  }

  if (geciciSefer) {
    const { data, error } = await supabaseAdmin
      .from("seferler")
      .delete()
      .eq("id", geciciSefer)
      .select("id");
    iddia(
      "geçici sefer SİLİNDİ",
      !error && (data ?? []).length === 1,
      error ? error.message : `${(data ?? []).length} satır`
    );
    const { data: kalan } = await supabaseAdmin
      .from("seferler")
      .select("id")
      .eq("id", geciciSefer);
    iddia("SONRA: o sefer artık yok", (kalan ?? []).length === 0, `${(kalan ?? []).length}`);
  }

  console.log(
    `\n╚══ ${dusen === 0 ? "✅ TÜM İDDİALAR GEÇTİ" : `🔴 ${dusen} İDDİA DÜŞTÜ`} ══════════════════\n`
  );
  process.exit(dusen === 0 ? 0 : 1);
}
