#!/usr/bin/env node
/**
 * TESLİMAT KANITI UCU — UÇTAN UCA KANIT (yerel QA yığını, migration 109 UYGULANMIŞ).
 *
 * ═══ NEDEN CANLI DEĞİL, NEDEN ŞİM DE DEĞİL ═══
 *
 * Bu turun kalbi migration 109: iki yeni kolon, üç CHECK, genişletilmiş
 * değişmezlik tetikleyicisi, yeni taslak tablosu. Hiçbiri henüz HİÇBİR
 * kiracıda koşmadı (Volkan çalıştıracak) ve bu depoda DDL kanalı yok
 * (üç kiracıya da yalnız PostgREST üzerinden erişiliyor).
 *
 * `scripts/supabase-mock.mjs` kuru koşumu da yetmez ve bunu kendi başlığında
 * söylüyor: "Ne ispatlamaz: veritabanının o yükü kabul edeceği (kolon varlığı,
 * CHECK kısıtları, unique indeks)." Bu turda ölçülmesi gereken TAM OLARAK
 * odur.
 *
 * Bu yüzden ölçüm YEREL AMA GERÇEK bir yığında yapılıyor:
 *   Postgres 16 (docker)  ← db/install/galzura-full.sql (001→109)
 *   PostgREST v12.2.3     ← aynı istemcinin konuştuğu API
 *   scripts/qa-supabase-proxy.mjs  ← /rest/v1 + /storage/v1 köprüsü
 *
 * Yani CHECK kısıtları, kısmi tekil indeksler ve HK080 tetikleyicileri
 * GERÇEK PostgreSQL'de işliyor; taklit edilen tek şey dosya deposu.
 *
 * GİRİŞ GERÇEK: telefon + PIN ile `POST /api/mobile/auth/login` çağrılıyor,
 * jeton elle mühürlenmiyor.
 *
 * Kullanım:
 *   ENV_FILE=scripts/kuru-qa.env node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-teslimat-kaniti.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";

// ── EMNİYET: YALNIZ YEREL QA YIĞINI ────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  console.error(
    `✗ DURDURULDU — hedef yerel QA yığını DEĞİL.\n  Gelen URL: ${url}\n` +
      `  HAK61 ve Sendigo CANLI MÜŞTERİ; bu betik oralarda ASLA koşmaz.`
  );
  process.exit(1);
}
if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede. Bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

const { POST: LOGIN } = await import("@/app/api/mobile/auth/login/route.ts");
const { POST: FOTO } = await import(
  "@/app/api/mobile/sefer/[id]/duraklar/[durakId]/foto/route.ts"
);
const KANIT = await import("@/app/api/mobile/sefer/[id]/duraklar/[durakId]/kanit/route.ts");
const { listTeslimatBySefer, imzaliKanitlar } = await import("@/lib/teslimat-db");

const HOST = "https://qa.local";
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

/** 1×1 saydam PNG — gerçek bir görüntü, gerçek MIME. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

const fotoIstek = (yol, { token, dosya, ad, tip, alanlar = {} }) => {
  const fd = new FormData();
  fd.set("foto", new File([dosya], ad, { type: tip }));
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
    /* gövdesiz yanıt */
  }
  return { kod: res.status, govde };
};

console.log(`\n╔══ TESLİMAT KANITI UCU · UÇTAN UCA KANIT ═══════════════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}  (yerel QA · 109 uygulanmış)`);

const TEL_SOFOR = "+430000000901";
const TEL_DIGER = "+430000000902";
const TEL_YONETICI = "+430000000903";
const PIN = "183434";

const temizlik = { teslimatIds: [], taslakIds: [], durakIds: [], seferIds: [], workerIds: [] };

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. TOHUM — şoför · ikinci şoför · sefer · durak");

  const pinHash = await bcrypt.hash(PIN, 10);
  const wYaz = async (ad, tel, yonetici = false) => {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .insert({ name: ad, phone: tel, pin_hash: pinHash, is_admin: yonetici, is_active: true })
      .select("id, name, phone, is_admin, token_version")
      .maybeSingle();
    if (error) throw new Error(`${ad} yazılamadı: ${error.message}`);
    temizlik.workerIds.push(data.id);
    return data;
  };
  const sofor = await wYaz("QA Sofor", TEL_SOFOR);
  const diger = await wYaz("QA Diger Sofor", TEL_DIGER);
  const yonetici = await wYaz("QA Yonetici", TEL_YONETICI, true);
  bilgi(`şoför    ${sofor.id}`);
  bilgi(`diğer    ${diger.id}`);
  bilgi(`yönetici ${yonetici.id}  is_admin=${yonetici.is_admin}`);

  const bugun = new Date().toISOString().slice(0, 10);
  const { data: sefer, error: sErr } = await supabaseAdmin
    .from("seferler")
    .insert({ tarih: bugun, worker_id: sofor.id, durum: "yolda" })
    .select("id, durum, worker_id")
    .maybeSingle();
  if (sErr) throw new Error(`sefer yazılamadı: ${sErr.message}`);
  temizlik.seferIds.push(sefer.id);

  const { data: durak, error: dErr } = await supabaseAdmin
    .from("sefer_duraklari")
    .insert({ sefer_id: sefer.id, sira: 1, ad: "QA Musteri 1", durum: "bekliyor" })
    .select("id, durum, sira")
    .maybeSingle();
  if (dErr) throw new Error(`durak yazılamadı: ${dErr.message}`);
  temizlik.durakIds.push(durak.id);
  bilgi(`sefer ${sefer.id} (${sefer.durum}) · durak ${durak.id} (${durak.durum})`);

  const YOL = `/api/mobile/sefer/${sefer.id}/duraklar/${durak.id}/kanit`;
  const FOTO_YOL = `/api/mobile/sefer/${sefer.id}/duraklar/${durak.id}/foto`;

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. GERÇEK GİRİŞ — telefon + PIN (jeton mühürlenmiyor)");

  const g = await cevap(
    await LOGIN(jsonIstek("/api/mobile/auth/login", { govde: { phone: TEL_SOFOR, pin: PIN } }))
  );
  iddia("giriş 200", g.kod === 200, `${g.kod}`);
  const token = g.govde?.accessToken ?? g.govde?.access_token ?? null;
  iddia("accessToken geldi", Boolean(token), token ? `${String(token).slice(0, 18)}…` : "YOK");
  if (!token) throw new Error("jeton alınamadı, devam edilemez");

  const g2 = await cevap(
    await LOGIN(jsonIstek("/api/mobile/auth/login", { govde: { phone: TEL_DIGER, pin: PIN } }))
  );
  const tokenDiger = g2.govde?.accessToken ?? g2.govde?.access_token ?? null;
  iddia("ikinci şoför de giriş yaptı", Boolean(tokenDiger), `${g2.kod}`);

  const g3 = await cevap(
    await LOGIN(jsonIstek("/api/mobile/auth/login", { govde: { phone: TEL_YONETICI, pin: PIN } }))
  );
  const tokenYonetici = g3.govde?.accessToken ?? g3.govde?.access_token ?? null;
  iddia("yönetici de giriş yaptı", Boolean(tokenYonetici), `${g3.kod}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. KAPILAR");

  const r401 = await cevap(
    await KANIT.POST(jsonIstek(YOL, { govde: { sonuc: "teslim" } }), params(sefer.id, durak.id))
  );
  iddia("jetonsuz POST → 401", r401.kod === 401, `${r401.kod} ${r401.govde?.error}`);

  const r403 = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token: tokenDiger, govde: { sonuc: "teslim", not: "x" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "başkasının seferi → 403 sefer_sizin_degil",
    r403.kod === 403 && r403.govde?.error === "sefer_sizin_degil",
    `${r403.kod} ${r403.govde?.error}`
  );

  // 🔴 VOLKAN KARARI 21.09.2026 — kanıtı YALNIZ seferin şoförü bırakır.
  const rYonetici = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token: tokenYonetici, govde: { sonuc: "teslim", not: "yonetici denemesi" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "🔴 YÖNETİCİ POST → 403 (yazmada muafiyet YOK)",
    rYonetici.kod === 403 && rYonetici.govde?.error === "sefer_sizin_degil",
    `${rYonetici.kod} ${rYonetici.govde?.error}`
  );

  const rYoneticiTaslak = await cevap(
    await FOTO(
      fotoIstek(FOTO_YOL, {
        token: tokenYonetici,
        dosya: JPG,
        ad: "y.jpg",
        tip: "image/jpeg",
        alanlar: { taslak: "1" },
      }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "🔴 YÖNETİCİ TASLAK → 403 (iki kapı aynı cümle)",
    rYoneticiTaslak.kod === 403 && rYoneticiTaslak.govde?.error === "sefer_sizin_degil",
    `${rYoneticiTaslak.kod} ${rYoneticiTaslak.govde?.error}`
  );

  const rYoneticiGet = await cevap(
    await KANIT.GET(jsonIstek(YOL, { token: tokenYonetici, method: "GET" }), params(sefer.id, durak.id))
  );
  iddia(
    "yönetici GET → 200 (GÖRME yöneticide kalıyor)",
    rYoneticiGet.kod === 200,
    `${rYoneticiGet.kod}`
  );

  const r400 = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim_edilemedi" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "teslim_edilemedi SEBEPSİZ → 400 sebep_gerekli",
    r400.kod === 400 && r400.govde?.error === "sebep_gerekli",
    `${r400.kod} ${r400.govde?.error}`
  );

  const rKisa = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim_edilemedi", sebep: "ab" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "2 harflik sebep → 400 (DB'ye 23514 olarak GİTMİYOR)",
    rKisa.kod === 400 && rKisa.govde?.error === "sebep_gerekli",
    `${rKisa.kod} ${rKisa.govde?.error}`
  );

  const rUzun = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim", aliciAd: "A".repeat(81) } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "aliciAd 81 karakter → 400 invalid_field (503 DEĞİL)",
    rUzun.kod === 400 && rUzun.govde?.error === "invalid_field",
    `${rUzun.kod} ${rUzun.govde?.error} alan=${rUzun.govde?.alan}`
  );

  const rSebepsiz = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim", sebep: "gereksiz" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "teslim + sebep → 400 sebep_gereksiz",
    rSebepsiz.kod === 400 && rSebepsiz.govde?.error === "sebep_gereksiz",
    `${rSebepsiz.kod} ${rSebepsiz.govde?.error}`
  );

  const { count: kanitSayisi0 } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true });
  iddia("ÖNCE: teslimatlar = 0 (reddedilen istekler satır yazmadı)", kanitSayisi0 === 0, `${kanitSayisi0}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. FOTOĞRAF + İMZA YÜKLE (taslak yolu)");

  const rEski = await cevap(
    await FOTO(
      fotoIstek(FOTO_YOL, { token, dosya: JPG, ad: "a.jpg", tip: "image/jpeg" }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "taslak BAYRAĞI YOKKEN eski davranış korunuyor → 409 kanit_yok",
    rEski.kod === 409 && rEski.govde?.error === "kanit_yok",
    `${rEski.kod} ${rEski.govde?.error}`
  );

  const rFoto = await cevap(
    await FOTO(
      fotoIstek(FOTO_YOL, {
        token,
        dosya: JPG,
        ad: "teslim.jpg",
        tip: "image/jpeg",
        alanlar: { taslak: "1", tur: "foto", lat: "47.41", lng: "9.74", accuracy: "8" },
      }),
      params(sefer.id, durak.id)
    )
  );
  iddia("taslak=1 fotoğraf → 200", rFoto.kod === 200 && rFoto.govde?.ok === true, `${rFoto.kod}`);
  const fotoId = rFoto.govde?.taslak?.id ?? null;
  iddia("fotoId döndü", Boolean(fotoId), fotoId ?? "YOK");
  if (fotoId) temizlik.taslakIds.push(fotoId);

  const rImza = await cevap(
    await FOTO(
      fotoIstek(FOTO_YOL, {
        token,
        dosya: PNG,
        ad: "imza.png",
        tip: "image/png",
        alanlar: { taslak: "1", tur: "imza" },
      }),
      params(sefer.id, durak.id)
    )
  );
  iddia("taslak=1 imza (png) → 200", rImza.kod === 200, `${rImza.kod}`);
  const imzaId = rImza.govde?.taslak?.id ?? null;
  iddia("imzaId döndü", Boolean(imzaId), imzaId ?? "YOK");
  if (imzaId) temizlik.taslakIds.push(imzaId);

  // Yabancı taslak denemesi: ikinci şoför aynı durağa taslak yükleyemez.
  const rYabanci = await cevap(
    await FOTO(
      fotoIstek(FOTO_YOL, {
        token: tokenDiger,
        dosya: JPG,
        ad: "y.jpg",
        tip: "image/jpeg",
        alanlar: { taslak: "1" },
      }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "başkasının seferine taslak → 403",
    rYabanci.kod === 403,
    `${rYabanci.kod} ${rYabanci.govde?.error}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. KANIT BIRAK (teslim)");

  const rKanit = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, {
        token,
        govde: {
          sonuc: "teslim",
          aliciAd: "M. Huber",
          not: "arka kapiya birakildi",
          konum: { lat: 47.41, lng: 9.74, at: new Date().toISOString() },
          fotoIds: [fotoId],
          imzaId,
        },
      }),
      params(sefer.id, durak.id)
    )
  );
  iddia("kanıt → 200", rKanit.kod === 200 && rKanit.govde?.ok === true, `${rKanit.kod}`);
  /**
   * ⚠️ `kanitId` ÖNCE OKUNUYOR, `kanit.id` YEDEK. Ucun kendi uyarısı:
   * geri okuma düşerse gövde `kanit:null` + `kanitId:"<uuid>"` olur ve SATIR
   * YAZILMIŞTIR. Yalnız `kanit?.id` okunsaydı temizlik o satırı kaçırır,
   * ardından durak silmesi `teslimatlar.durak_id` yüzünden düşerdi.
   */
  const kanitId = rKanit.govde?.kanitId ?? rKanit.govde?.kanit?.id ?? null;
  if (kanitId) temizlik.teslimatIds.push(kanitId);
  iddia("sonuc = teslim", rKanit.govde?.kanit?.sonuc === "teslim", `${rKanit.govde?.kanit?.sonuc}`);
  iddia("sebep NULL", rKanit.govde?.kanit?.sebep === null, `${rKanit.govde?.kanit?.sebep}`);
  iddia("alıcı yazıldı", rKanit.govde?.kanit?.aliciAd === "M. Huber", `${rKanit.govde?.kanit?.aliciAd}`);
  iddia(
    "fotoğraf BAĞLANDI (1/1)",
    rKanit.govde?.foto?.bagli === 1 && rKanit.govde?.foto?.dusen === 0,
    `bagli=${rKanit.govde?.foto?.bagli} dusen=${rKanit.govde?.foto?.dusen}`
  );
  iddia(
    "fotoğrafın imzalı URL'i var",
    Boolean(rKanit.govde?.kanit?.fotograflar?.[0]?.url),
    rKanit.govde?.kanit?.fotograflar?.[0]?.url ?? "YOK"
  );
  iddia("imza yolu yazıldı", Boolean(rKanit.govde?.kanit?.imzaYol), rKanit.govde?.kanit?.imzaYol ?? "YOK");
  iddia("imzanın imzalı URL'i var", Boolean(rKanit.govde?.kanit?.imzaUrl), rKanit.govde?.kanit?.imzaUrl ?? "YOK");
  iddia(
    "DURAK İLERLEDİ → tamamlandi",
    rKanit.govde?.durumIlerledi === true && rKanit.govde?.durak?.durum === "tamamlandi",
    `ilerledi=${rKanit.govde?.durumIlerledi} durum=${rKanit.govde?.durak?.durum}`
  );
  iddia(
    "özet 1/1 tamamlandı",
    rKanit.govde?.ozet?.tamamlanan === 1 && rKanit.govde?.ozet?.toplam === 1,
    `${rKanit.govde?.ozet?.tamamlanan}/${rKanit.govde?.ozet?.toplam}`
  );
  iddia("taslaklar silindi (2)", rKanit.govde?.taslakSilindi === 2, `${rKanit.govde?.taslakSilindi}`);

  const { count: taslakKalan } = await supabaseAdmin
    .from("teslimat_taslak_dosyalari")
    .select("id", { count: "exact", head: true });
  iddia("SONRA: bekleyen taslak = 0", taslakKalan === 0, `${taslakKalan}`);

  const { data: dbKanit } = await supabaseAdmin
    .from("teslimatlar")
    .select("id, sonuc, sebep, worker_id, durak_id, imza_yol, teslim_at, latitude")
    .eq("id", kanitId)
    .maybeSingle();
  iddia("DB satırı: sonuc=teslim", dbKanit?.sonuc === "teslim", `${dbKanit?.sonuc}`);
  iddia("DB satırı: durak_id bağlı", dbKanit?.durak_id === durak.id, `${dbKanit?.durak_id}`);
  iddia("DB satırı: worker_id = giriş yapan", dbKanit?.worker_id === sofor.id, `${dbKanit?.worker_id}`);
  iddia("DB satırı: konum yazıldı", Number(dbKanit?.latitude) === 47.41, `${dbKanit?.latitude}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. GET — kanıt + imzalı URL'ler");

  const rGet = await cevap(
    await KANIT.GET(jsonIstek(YOL, { token, method: "GET" }), params(sefer.id, durak.id))
  );
  iddia("GET → 200", rGet.kod === 200, `${rGet.kod}`);
  iddia("aynı kanıt döndü", rGet.govde?.kanit?.id === kanitId, `${rGet.govde?.kanit?.id}`);
  iddia("GET'te de fotoğraf URL'i var", Boolean(rGet.govde?.kanit?.fotograflar?.[0]?.url), null);
  iddia("GET'te de imza URL'i var", Boolean(rGet.govde?.kanit?.imzaUrl), null);
  iddia("bekleyen taslak listesi boş", (rGet.govde?.bekleyenTaslaklar ?? []).length === 0, null);

  /**
   * ⚠️ YÖNETİCİ GET'İ BURADA, KANIT DOĞDUKTAN SONRA ÖLÇÜLÜYOR.
   * "2. KAPILAR"daki yönetici GET'i durakta kanıt YOKKEN çağrılıyordu ve yalnız
   * 200'e bakıyordu — yani "görme yöneticide kalır" yarısı fiilen ölçülmüyordu.
   * Gövde de iddia ediliyor: yönetici GERÇEK kanıdı ve imzalı URL'lerini görmeli.
   */
  const rYonGet2 = await cevap(
    await KANIT.GET(jsonIstek(YOL, { token: tokenYonetici, method: "GET" }), params(sefer.id, durak.id))
  );
  iddia("yönetici GET → 200 (kanıt VARKEN)", rYonGet2.kod === 200, `${rYonGet2.kod}`);
  iddia("yönetici AYNI kanıdı görüyor", rYonGet2.govde?.kanit?.id === kanitId, `${rYonGet2.govde?.kanit?.id}`);
  iddia(
    "yönetici fotoğrafın imzalı URL'ini görüyor",
    Boolean(rYonGet2.govde?.kanit?.fotograflar?.[0]?.url),
    null
  );
  iddia(
    "yönetici BAŞKASININ taslağını GÖRMÜYOR",
    (rYonGet2.govde?.bekleyenTaslaklar ?? []).length === 0,
    `${(rYonGet2.govde?.bekleyenTaslaklar ?? []).length}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("6. PANEL AYNI ÇEKİRDEĞİ OKUYOR MU (kopya yok)");

  const { teslimatlar } = await listTeslimatBySefer(sefer.id);
  const panelGorunum = await imzaliKanitlar(teslimatlar);
  const p = panelGorunum[0];
  const m = rGet.govde?.kanit;
  iddia("panel ve mobil AYNI kanıt kimliği", p?.id === m?.id, `${p?.id}`);
  iddia("panel gövdesinde de sonuc var", p?.sonuc === m?.sonuc, `${p?.sonuc}`);
  iddia("panel gövdesinde de imzaUrl var", Boolean(p?.imzaUrl), null);
  iddia(
    "alan kümeleri BİREBİR aynı",
    JSON.stringify(Object.keys(p ?? {}).sort()) === JSON.stringify(Object.keys(m ?? {}).sort()),
    `panel=${Object.keys(p ?? {}).length} mobil=${Object.keys(m ?? {}).length}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("7. İKİNCİ KANIT → 409");

  const rIki = await cevap(
    await KANIT.POST(
      jsonIstek(YOL, { token, govde: { sonuc: "teslim", not: "ikinci deneme" } }),
      params(sefer.id, durak.id)
    )
  );
  iddia(
    "aynı durağa ikinci kanıt → 409 kanit_zaten_var",
    rIki.kod === 409 && rIki.govde?.error === "kanit_zaten_var",
    `${rIki.kod} ${rIki.govde?.error}`
  );
  const { count: kanitSayisi1 } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true });
  iddia("teslimatlar HÂLÂ 1 (ikinci satır yazılmadı)", kanitSayisi1 === 1, `${kanitSayisi1}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("7b. TESLİM EDİLEMEDİ — ikinci durak, sebep delil oluyor");

  const { data: durak2, error: d2Err } = await supabaseAdmin
    .from("sefer_duraklari")
    .insert({ sefer_id: sefer.id, sira: 2, ad: "QA Musteri 2", durum: "bekliyor" })
    .select("id, durum")
    .maybeSingle();
  if (d2Err) throw new Error(`2. durak yazılamadı: ${d2Err.message}`);
  temizlik.durakIds.push(durak2.id);
  const YOL2 = `/api/mobile/sefer/${sefer.id}/duraklar/${durak2.id}/kanit`;

  // ⚠️ İMZASIZ, FOTOĞRAFSIZ, NOTSUZ — tek kanıt SEBEP. 080'in "en az bir kanıt"
  // kuralı gevşetilmedi; 109 sebebi başarısız teslimatın kanıtı SAYIYOR.
  const rRed = await cevap(
    await KANIT.POST(
      jsonIstek(YOL2, {
        token,
        govde: {
          sonuc: "teslim_edilemedi",
          sebep: "kapali dukkan, alici ulasilamadi",
          konum: { lat: 47.42, lng: 9.75, at: new Date().toISOString() },
        },
      }),
      params(sefer.id, durak2.id)
    )
  );
  iddia("sebep TEK BAŞINA kanıt sayıldı → 200", rRed.kod === 200, `${rRed.kod} ${rRed.govde?.error ?? ""}`);
  if (rRed.govde?.kanit?.id) temizlik.teslimatIds.push(rRed.govde.kanit.id);
  iddia("sonuc = teslim_edilemedi", rRed.govde?.kanit?.sonuc === "teslim_edilemedi", `${rRed.govde?.kanit?.sonuc}`);
  iddia(
    "sebep KIRPILMADAN yazıldı",
    rRed.govde?.kanit?.sebep === "kapali dukkan, alici ulasilamadi",
    `${rRed.govde?.kanit?.sebep}`
  );
  iddia(
    "DURAK → atlandi (panel kuralı)",
    rRed.govde?.durumIlerledi === true && rRed.govde?.durak?.durum === "atlandi",
    `ilerledi=${rRed.govde?.durumIlerledi} durum=${rRed.govde?.durak?.durum}`
  );
  iddia(
    "durağın atlama_sebep'i de doldu",
    rRed.govde?.durak?.atlamaSebep === "kapali dukkan, alici ulasilamadi",
    `${rRed.govde?.durak?.atlamaSebep}`
  );
  iddia(
    "özet 1 tamamlandı · 1 atlandı",
    rRed.govde?.ozet?.tamamlanan === 1 && rRed.govde?.ozet?.atlanan === 1,
    `tamam=${rRed.govde?.ozet?.tamamlanan} atlandi=${rRed.govde?.ozet?.atlanan}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("8. 🔴 DEĞİŞMEZLİK — 109'un tetikleyicisi gerçekten tutuyor mu");

  const { error: e1 } = await supabaseAdmin
    .from("teslimatlar")
    .update({ sonuc: "teslim_edilemedi", sebep: "sonradan degistirildi" })
    .eq("id", kanitId);
  iddia(
    "sonuc DEĞİŞTİRİLEMEDİ (HK080)",
    Boolean(e1) && String(e1.code) === "HK080",
    e1 ? `${e1.code}: ${String(e1.message).slice(0, 60)}` : "🔴 GEÇTİ — DELİK VAR"
  );

  const { error: e2 } = await supabaseAdmin
    .from("teslimatlar")
    .update({ notlar: "sonradan degistirildi" })
    .eq("id", kanitId);
  iddia("notlar DEĞİŞTİRİLEMEDİ (HK080)", Boolean(e2) && String(e2.code) === "HK080", `${e2?.code}`);

  const { error: e3 } = await supabaseAdmin
    .from("teslimatlar")
    .update({ iptal_at: new Date().toISOString(), iptal_sebep: "QA iptal denemesi", iptal_eden: sofor.id })
    .eq("id", kanitId);
  iddia("İPTAL yolu HÂLÂ AÇIK (kural kırılmadı)", !e3, e3 ? `${e3.code} ${e3.message}` : "geçti");

  const { error: e4 } = await supabaseAdmin
    .from("teslimatlar")
    .update({ iptal_eden: diger.id })
    .eq("id", kanitId);
  iddia(
    "iptal_eden ikinci kez DEĞİŞTİRİLEMEDİ (109'da kapatılan delik)",
    Boolean(e4) && String(e4.code) === "HK080",
    e4 ? `${e4.code}` : "🔴 GEÇTİ — DELİK AÇIK"
  );

  const { error: e5 } = await supabaseAdmin
    .from("teslimat_fotograflari")
    .update({ storage_path: "baska/yol.jpg" })
    .eq("teslimat_id", kanitId);
  iddia("fotoğraf satırı DEĞİŞTİRİLEMEDİ (HK080)", Boolean(e5) && String(e5.code) === "HK080", `${e5?.code}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("9. CHECK KISITI GERÇEKTEN VAR MI (uç atlansa DB tutuyor mu)");

  const { error: e6 } = await supabaseAdmin
    .from("teslimatlar")
    .insert({ sefer_id: sefer.id, worker_id: sofor.id, sonuc: "teslim_edilemedi", notlar: "sebepsiz" });
  iddia(
    "sebepsiz teslim_edilemedi → 23514 teslimat_sebep_butun",
    Boolean(e6) && String(e6.code) === "23514",
    e6 ? `${e6.code}: ${String(e6.message).slice(0, 50)}` : "🔴 GEÇTİ"
  );

  const { error: e7 } = await supabaseAdmin
    .from("teslimatlar")
    .insert({ sefer_id: sefer.id, worker_id: sofor.id, sonuc: "belki", notlar: "x" });
  iddia(
    "tanınmayan sonuc → 23514 teslimat_sonuc_gecerli",
    Boolean(e7) && String(e7.code) === "23514",
    e7 ? `${e7.code}` : "🔴 GEÇTİ"
  );
} catch (e) {
  console.error(`\n✗ BETİK DÜŞTÜ: ${e?.message ?? e}`);
  dusen++;
} finally {
  // ── TEMİZLİK: her şey geri alınır ────────────────────────────────────────
  baslik("10. TEMİZLİK");
  /**
   * ⚠️ SİLME HATASI YUTULMUYOR. Eskiden `error` destructure bile edilmiyordu:
   * bir silme düşse betik yine "temizlendi" der, kalıntı sessizce dururdu —
   * tam da bu betiğin önlemek için var olduğu şey.
   */
  const silmeHatalari = [];
  const sil = async (tablo, kolon, idler) => {
    if (!idler.length) return 0;
    const { data, error } = await supabaseAdmin.from(tablo).delete().in(kolon, idler).select("id");
    if (error) silmeHatalari.push(`${tablo}: ${error.code} ${error.message}`);
    return (data ?? []).length;
  };
  const f = await sil("teslimat_fotograflari", "teslimat_id", temizlik.teslimatIds);
  const k = await sil("teslimatlar", "id", temizlik.teslimatIds);
  const ta = await sil("teslimat_taslak_dosyalari", "id", temizlik.taslakIds);
  const d = await sil("sefer_duraklari", "id", temizlik.durakIds);
  const s = await sil("seferler", "id", temizlik.seferIds);
  const w = await sil("workers", "id", temizlik.workerIds);
  bilgi(`silindi — foto ${f} · kanıt ${k} · taslak ${ta} · durak ${d} · sefer ${s} · personel ${w}`);

  const { count: kalanKanit } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true });
  const { count: kalanTaslak } = await supabaseAdmin
    .from("teslimat_taslak_dosyalari")
    .select("id", { count: "exact", head: true });
  iddia("SONRA: teslimatlar = 0", kalanKanit === 0, `${kalanKanit}`);
  iddia("SONRA: taslak = 0", kalanTaslak === 0, `${kalanTaslak}`);
  iddia(
    "hiçbir silme DÜŞMEDİ",
    silmeHatalari.length === 0,
    silmeHatalari.length ? silmeHatalari.join(" · ") : "0 hata"
  );

  console.log(
    `\n╚══ ${dusen === 0 ? "✅ TÜM İDDİALAR GEÇTİ" : `🔴 ${dusen} İDDİA DÜŞTÜ`} ══════════════════\n`
  );
  process.exit(dusen === 0 ? 0 : 1);
}
