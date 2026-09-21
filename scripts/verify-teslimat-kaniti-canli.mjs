#!/usr/bin/env node
/**
 * TESLİMAT KANITI UCU — CANLI DEMO TURU (yalnız galzura-demo).
 *
 * ═══ NE YAPAR ═══
 *
 * Migration 109 üç kiracıda da ÇALIŞTIRILDI (21.09.2026). Artık mutlu yol
 * canlıda ölçülebilir. Bu betik GERÇEK GİRİŞLE (telefon + PIN, jeton
 * mühürlenmiyor) uçtan uca tur atar ve her adımın HTTP kodunu basar:
 *
 *   jetonsuz POST/GET → 401
 *   foto (taslak=1) + imza (taslak=1, tur=imza) → 200
 *   kanıt (teslim) → 200 · durak `tamamlandi`
 *   GET → 200 · foto ve imza imzalı URL'leri
 *   aynı durağa ikinci kanıt → 409
 *   YÖNETİCİ, BAŞKASININ seferine kanıt → 403      (Volkan kararı 21.09.2026)
 *   iptal → kanıt geçersiz, aynı durağa yeni kanıt YENİDEN mümkün
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (ikisi de CANLI MÜŞTERİ).
 *
 * ── TEK HESAP, İKİ ROL ────────────────────────────────────────────────────
 * Elde TEK giriş var (+905535910471) ve o hesap YÖNETİCİ. Kural "kanıtı yalnız
 * SEFERİN ŞOFÖRÜ bırakır" olduğuna göre tur İKİ sefer açıyor:
 *   · Sefer A → worker_id = bu hesap  ⇒ hesap "seferin şoförü", POST GEÇER
 *   · Sefer B → worker_id = BAŞKA bir demo personeli  ⇒ aynı hesap artık
 *     yalnız "yönetici", POST 403 ALIR
 * İkisi yan yana olmadan "yönetici reddedildi" iddiası ölçülemezdi: tek başına
 * bir 403, "muafiyet kalktı" mı yoksa "zaten sahibi değildi" mi ayırt etmez.
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 * Yazılan HER ŞEY geri alınır ve geri alındığı AYRICA ölçülür: iki sefer, iki
 * durak, kanıt satırı, fotoğraf satırları, taslaklar ve **Storage dosyaları**.
 * Mevcut seferler, personel ve gerçek kanıtlar — hiçbirine dokunulmaz.
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

/** Volkan'ın verdiği demo giriş hesabı (yönetici). */
const TEL = "+905535910471";
const PIN = "183434";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

/** HTTP kodu tablosu — tur sonunda tek blok hâlinde basılır. */
const tablo = [];
const kaydet = (adim, rol, kod, govde) => {
  tablo.push({ adim, rol, kod, not: govde });
};

const { POST: LOGIN } = await import("@/app/api/mobile/auth/login/route.ts");
const KANIT = await import("@/app/api/mobile/sefer/[id]/duraklar/[durakId]/kanit/route.ts");
const { POST: FOTO } = await import(
  "@/app/api/mobile/sefer/[id]/duraklar/[durakId]/foto/route.ts"
);
const { iptalTeslimat, createTeslimat, TESLIMAT_KOVASI } = await import("@/lib/teslimat-db");
const { dosyaSil } = await import("@/lib/upload-core");

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

/** 1×1 gerçek JPEG / PNG — gerçek MIME, gerçek bayt. */
const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
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
    /* gövdesiz */
  }
  return { kod: res.status, govde };
};

console.log(`\n╔══ TESLİMAT KANITI UCU · CANLI DEMO TURU (galzura-demo) ════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

const temizlik = { seferIds: [], durakIds: [], teslimatIds: [], taslakIds: [], yollar: [] };

/**
 * ⚠️ `try` DIŞINDA TANIMLI: `finally` bloğu bu iki sayıyı okuyor ve bir `try`
 * içinde `const` ile tanımlanan değişken orada görünmez. İlk koşumda betik tam
 * temizliği YAPTIKTAN SONRA `ReferenceError` ile düştü — yani kanıt yeşildi ama
 * rapor düşmüş görünüyordu.
 */
let kanitOnce = 0;
let taslakOnce = 0;

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — 109 gerçekten uygulanmış mı");

  const { error: kErr } = await supabaseAdmin.from("teslimatlar").select("id, sonuc, sebep").limit(1);
  iddia("teslimatlar.sonuc + sebep OKUNABİLİYOR", !kErr, kErr ? `${kErr.code}` : "2 kolon");

  const { error: tErr } = await supabaseAdmin.from("teslimat_taslak_dosyalari").select("id").limit(1);
  iddia("teslimat_taslak_dosyalari VAR", !tErr, tErr ? `${tErr.code}` : "tablo 1");

  /**
   * ⚠️ ÖNCE DEĞERİ ÖLÇÜLÜYOR VE SONRA ONUNLA KARŞILAŞTIRILIYOR — "SONRA = 0"
   * DEĞİL. Demo kiracısında gerçek bir kanıt (080: "kanıt SİLİNMEZ") ya da
   * bağlanmamış bir taslak (109 §5: "bağlanmayanlar KALIR") bulunabilir; mutlak
   * sıfır beklemek, turu kendi temizliğinden değil kiracının geçmişinden
   * düşürürdü.
   */
  const { count: kanitSayimi } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true });
  const { data: taslakOnceSatir } = await supabaseAdmin
    .from("teslimat_taslak_dosyalari")
    .select("id");
  kanitOnce = kanitSayimi ?? 0;
  taslakOnce = (taslakOnceSatir ?? []).length;
  bilgi(`ÖNCE: teslimatlar = ${kanitOnce} · bekleyen taslak = ${taslakOnce}`);

  const { data: hesap } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin")
    .eq("phone", TEL)
    .maybeSingle();
  if (!hesap) throw new Error(`${TEL} bulunamadı`);
  iddia("giriş hesabı YÖNETİCİ", hesap.is_admin === true, `is_admin=${hesap.is_admin}`);

  const { data: baskasi } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .neq("id", hesap.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!baskasi) throw new Error("ikinci personel bulunamadı");
  bilgi(`hesap ${hesap.id} · başka personel ${baskasi.id}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. GERÇEK GİRİŞ — +905535910471 / PIN (jeton mühürlenmiyor)");

  const g = await cevap(
    await LOGIN(jsonIstek("/api/mobile/auth/login", { govde: { phone: TEL, pin: PIN } }))
  );
  kaydet("POST /auth/login", "—", g.kod, "telefon + PIN");
  iddia("giriş 200", g.kod === 200, `${g.kod}`);
  const token = g.govde?.accessToken ?? g.govde?.access_token ?? null;
  iddia("accessToken geldi", Boolean(token), token ? `${String(token).slice(0, 18)}…` : "YOK");
  if (!token) throw new Error("jeton alınamadı");

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. TEST SEFERİ + DURAK (A: hesap ŞOFÖR · B: hesap yalnız YÖNETİCİ)");

  const bugun = new Date().toISOString().slice(0, 10);
  const seferAc = async (workerId, etiket) => {
    const { data, error } = await supabaseAdmin
      .from("seferler")
      .insert({
        tarih: bugun,
        worker_id: workerId,
        durum: "yolda",
        notlar: `QA KANIT TURU ${etiket} (silinecek)`,
      })
      .select("id, durum, worker_id")
      .maybeSingle();
    if (error) throw new Error(`sefer ${etiket} açılamadı: ${error.message}`);
    temizlik.seferIds.push(data.id);
    return data;
  };
  const durakAc = async (seferId, ad) => {
    const { data, error } = await supabaseAdmin
      .from("sefer_duraklari")
      .insert({ sefer_id: seferId, sira: 1, ad, durum: "bekliyor" })
      .select("id, durum, sira")
      .maybeSingle();
    if (error) throw new Error(`durak açılamadı: ${error.message}`);
    temizlik.durakIds.push(data.id);
    return data;
  };

  const seferA = await seferAc(hesap.id, "A");
  const durakA = await durakAc(seferA.id, "QA Musteri A (silinecek)");
  const seferB = await seferAc(baskasi.id, "B");
  const durakB = await durakAc(seferB.id, "QA Musteri B (silinecek)");

  iddia("sefer A hesabın ÜZERİNE açıldı", seferA.worker_id === hesap.id, seferA.id);
  iddia("sefer B BAŞKASININ üzerine açıldı", seferB.worker_id === baskasi.id, seferB.id);
  iddia("iki durak da bekliyor", durakA.durum === "bekliyor" && durakB.durum === "bekliyor", null);

  const YOL_A = `/api/mobile/sefer/${seferA.id}/duraklar/${durakA.id}/kanit`;
  const FOTO_A = `/api/mobile/sefer/${seferA.id}/duraklar/${durakA.id}/foto`;
  const YOL_B = `/api/mobile/sefer/${seferB.id}/duraklar/${durakB.id}/kanit`;
  const FOTO_B = `/api/mobile/sefer/${seferB.id}/duraklar/${durakB.id}/foto`;

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. JETONSUZ → 401");

  const r401p = await cevap(
    await KANIT.POST(jsonIstek(YOL_A, { govde: { sonuc: "teslim" } }), params(seferA.id, durakA.id))
  );
  kaydet("POST …/kanit", "jetonsuz", r401p.kod, r401p.govde?.error);
  iddia("jetonsuz POST → 401", r401p.kod === 401, `${r401p.kod} ${r401p.govde?.error}`);

  const r401g = await cevap(
    await KANIT.GET(jsonIstek(YOL_A, { method: "GET" }), params(seferA.id, durakA.id))
  );
  kaydet("GET …/kanit", "jetonsuz", r401g.kod, r401g.govde?.error);
  iddia("jetonsuz GET → 401", r401g.kod === 401, `${r401g.kod} ${r401g.govde?.error}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. FOTOĞRAF + İMZA (taslak=1) — seferin şoförü");

  const rFoto = await cevap(
    await FOTO(
      fotoIstek(FOTO_A, {
        token,
        dosya: JPG,
        ad: "teslim.jpg",
        tip: "image/jpeg",
        alanlar: { taslak: "1", tur: "foto", lat: "47.41", lng: "9.74", accuracy: "8" },
      }),
      params(seferA.id, durakA.id)
    )
  );
  kaydet("POST …/foto (taslak=1, tur=foto)", "şoför", rFoto.kod, rFoto.govde?.taslak?.id ?? rFoto.govde?.error);
  iddia("foto taslağı → 200", rFoto.kod === 200, `${rFoto.kod} ${rFoto.govde?.error ?? ""}`);
  const fotoId = rFoto.govde?.taslak?.id ?? null;
  if (fotoId) temizlik.taslakIds.push(fotoId);
  if (rFoto.govde?.taslak?.yol) temizlik.yollar.push(rFoto.govde.taslak.yol);

  const rImza = await cevap(
    await FOTO(
      fotoIstek(FOTO_A, {
        token,
        dosya: PNG,
        ad: "imza.png",
        tip: "image/png",
        alanlar: { taslak: "1", tur: "imza" },
      }),
      params(seferA.id, durakA.id)
    )
  );
  kaydet("POST …/foto (taslak=1, tur=imza)", "şoför", rImza.kod, rImza.govde?.taslak?.id ?? rImza.govde?.error);
  iddia("imza taslağı → 200", rImza.kod === 200, `${rImza.kod}`);
  const imzaId = rImza.govde?.taslak?.id ?? null;
  if (imzaId) temizlik.taslakIds.push(imzaId);
  if (rImza.govde?.taslak?.yol) temizlik.yollar.push(rImza.govde.taslak.yol);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. KANIT (teslim) → durak tamamlandi");

  const rKanit = await cevap(
    await KANIT.POST(
      jsonIstek(YOL_A, {
        token,
        govde: {
          sonuc: "teslim",
          aliciAd: "QA Alici",
          not: "canli tur",
          konum: { lat: 47.41, lng: 9.74, at: new Date().toISOString() },
          fotoIds: fotoId ? [fotoId] : [],
          imzaId,
        },
      }),
      params(seferA.id, durakA.id)
    )
  );
  kaydet("POST …/kanit {sonuc:teslim}", "şoför", rKanit.kod, rKanit.govde?.error ?? "kanıt yazıldı");
  iddia("kanıt → 200", rKanit.kod === 200, `${rKanit.kod} ${rKanit.govde?.error ?? ""}`);
  const kanitId = rKanit.govde?.kanitId ?? rKanit.govde?.kanit?.id ?? null;
  if (kanitId) temizlik.teslimatIds.push(kanitId);
  iddia("sonuc = teslim", rKanit.govde?.kanit?.sonuc === "teslim", `${rKanit.govde?.kanit?.sonuc}`);
  iddia(
    "fotoğraf bağlandı 1/1",
    rKanit.govde?.foto?.bagli === 1 && rKanit.govde?.foto?.dusen === 0,
    `bagli=${rKanit.govde?.foto?.bagli} dusen=${rKanit.govde?.foto?.dusen}`
  );
  iddia(
    "DURAK → tamamlandi",
    rKanit.govde?.durumIlerledi === true && rKanit.govde?.durak?.durum === "tamamlandi",
    `${rKanit.govde?.durak?.durum}`
  );
  iddia("taslaklar tüketildi (2)", rKanit.govde?.taslakSilindi === 2, `${rKanit.govde?.taslakSilindi}`);
  for (const f of rKanit.govde?.kanit?.fotograflar ?? []) temizlik.yollar.push(f.storagePath);
  if (rKanit.govde?.kanit?.imzaYol) temizlik.yollar.push(rKanit.govde.kanit.imzaYol);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("6. GET — kanıt + imzalı URL'ler");

  const rGet = await cevap(
    await KANIT.GET(jsonIstek(YOL_A, { token, method: "GET" }), params(seferA.id, durakA.id))
  );
  kaydet("GET …/kanit", "şoför/yönetici", rGet.kod, "kanıt + imzalı URL");
  iddia("GET → 200", rGet.kod === 200, `${rGet.kod}`);
  iddia("aynı kanıt", rGet.govde?.kanit?.id === kanitId, `${rGet.govde?.kanit?.id}`);
  iddia("fotoğrafın imzalı URL'i var", Boolean(rGet.govde?.kanit?.fotograflar?.[0]?.url), null);
  iddia("imzanın imzalı URL'i var", Boolean(rGet.govde?.kanit?.imzaUrl), null);

  // İmzalı URL GERÇEKTEN ÇALIŞIYOR MU — dosyayı indir.
  const fotoUrl = rGet.govde?.kanit?.fotograflar?.[0]?.url;
  if (fotoUrl) {
    const indir = await fetch(fotoUrl);
    const bayt = indir.ok ? (await indir.arrayBuffer()).byteLength : 0;
    kaydet("GET imzalı URL (Storage)", "—", indir.status, `${bayt} bayt`);
    iddia("imzalı URL indirilebiliyor", indir.ok && bayt > 0, `${indir.status} · ${bayt} bayt`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("7. AYNI DURAĞA İKİNCİ KANIT → 409");

  const rIki = await cevap(
    await KANIT.POST(
      jsonIstek(YOL_A, { token, govde: { sonuc: "teslim", not: "ikinci deneme" } }),
      params(seferA.id, durakA.id)
    )
  );
  kaydet("POST …/kanit (ikinci)", "şoför", rIki.kod, rIki.govde?.error);
  iddia(
    "ikinci kanıt → 409 kanit_zaten_var",
    rIki.kod === 409 && rIki.govde?.error === "kanit_zaten_var",
    `${rIki.kod} ${rIki.govde?.error}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("8. 🔴 YÖNETİCİ, BAŞKASININ SEFERİNE → 403 (Volkan kararı)");

  const rYon = await cevap(
    await KANIT.POST(
      jsonIstek(YOL_B, { token, govde: { sonuc: "teslim", not: "yonetici denemesi" } }),
      params(seferB.id, durakB.id)
    )
  );
  kaydet("POST …/kanit (sefer B)", "yönetici", rYon.kod, rYon.govde?.error);
  iddia(
    "yönetici POST → 403 sefer_sizin_degil",
    rYon.kod === 403 && rYon.govde?.error === "sefer_sizin_degil",
    `${rYon.kod} ${rYon.govde?.error}`
  );

  const rYonTaslak = await cevap(
    await FOTO(
      fotoIstek(FOTO_B, { token, dosya: JPG, ad: "y.jpg", tip: "image/jpeg", alanlar: { taslak: "1" } }),
      params(seferB.id, durakB.id)
    )
  );
  kaydet("POST …/foto taslak (sefer B)", "yönetici", rYonTaslak.kod, rYonTaslak.govde?.error);
  iddia(
    "yönetici taslak → 403 (iki kapı aynı cümle)",
    rYonTaslak.kod === 403 && rYonTaslak.govde?.error === "sefer_sizin_degil",
    `${rYonTaslak.kod} ${rYonTaslak.govde?.error}`
  );

  const { count: redSonrasi } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true })
    .eq("sefer_id", seferB.id);
  iddia("reddedilen yönetici yazmaları SATIR BIRAKMADI", redSonrasi === 0, `${redSonrasi}`);

  /**
   * ⚠️ YÖNETİCİ MUAFİYETİ KANITLI BİR SEFERDE ÖLÇÜLÜYOR.
   *
   * Boş bir durakta 200 görmek hiçbir şey ispatlamaz: uç `kanit:null` dönse de
   * 200 olurdu. "Görme yöneticide kalır" ancak yönetici GERÇEK bir kanıt
   * görebildiğinde ölçülür. Sefer B'nin şoförünün PIN'i elde olmadığı için kanıt
   * VERİ KATMANINDAN onun adına yazılıyor — ölçülen şey uçun OKUMA kapısı.
   */
  const bKanit = await createTeslimat(
    {
      seferId: seferB.id,
      workerId: baskasi.id,
      durakId: durakB.id,
      durakNo: 1,
      notlar: "QA — yonetici okuma kapisi olcumu",
      sonuc: "teslim",
    },
    false
  );
  iddia("sefer B'ye BAŞKASININ kanıtı yazıldı (ölçüm zemini)", bKanit.ok === true, bKanit.ok ? bKanit.id : bKanit.sebep);
  if (bKanit.ok) temizlik.teslimatIds.push(bKanit.id);

  const rYonGet = await cevap(
    await KANIT.GET(jsonIstek(YOL_B, { token, method: "GET" }), params(seferB.id, durakB.id))
  );
  kaydet("GET …/kanit (sefer B, kanıtlı)", "yönetici", rYonGet.kod, "görme yöneticide");
  iddia("yönetici GET → 200", rYonGet.kod === 200, `${rYonGet.kod}`);
  iddia(
    "🔴 yönetici BAŞKASININ kanıdını GÖRÜYOR (muafiyet yolu ölçüldü)",
    bKanit.ok && rYonGet.govde?.kanit?.id === bKanit.id,
    `${rYonGet.govde?.kanit?.id}`
  );
  iddia(
    "yönetici o kanıdın sonucunu da görüyor",
    rYonGet.govde?.kanit?.sonuc === "teslim",
    `${rYonGet.govde?.kanit?.sonuc}`
  );


  // ══════════════════════════════════════════════════════════════════════════
  baslik("9. İPTAL — yönetici kanıtı geçersiz ilan eder");

  /**
   * ⚠️ NE ÖLÇÜLÜYOR, NE ÖLÇÜLMÜYOR: mobilde iptal UCU YOK; iptal panelin
   * sunucu eyleminde (`teslimatIptalEt`, `requireFleetView`). Burada VERİ
   * KATMANI çağrılıyor, yani ölçülen şey iptalin ETKİSİ — kapının kendisi
   * değil. Panelin kapısı bu turda SINANMADI ve bu bilerek söyleniyor.
   */
  const rIptal = await iptalTeslimat(kanitId, "QA turu — kanit geri alindi", hesap.id);
  iddia("iptal yazıldı", rIptal.ok === true, rIptal.ok ? kanitId : rIptal.sebep);

  const { data: iptalli } = await supabaseAdmin
    .from("teslimatlar")
    .select("iptal_at, iptal_sebep, iptal_eden, sonuc")
    .eq("id", kanitId)
    .maybeSingle();
  iddia("iptal_at doldu", Boolean(iptalli?.iptal_at), `${iptalli?.iptal_at}`);
  iddia("iptal_eden = yönetici", iptalli?.iptal_eden === hesap.id, `${iptalli?.iptal_eden}`);
  iddia("sonuc DEĞİŞMEDİ (delil duruyor)", iptalli?.sonuc === "teslim", `${iptalli?.sonuc}`);

  // İptal edilen kanıt yuvayı BOŞALTIR — kısmi indeksin `iptal_at is null` şartı.
  const rYeni = await cevap(
    await KANIT.POST(
      jsonIstek(YOL_A, { token, govde: { sonuc: "teslim", not: "iptal sonrasi yeni kanit" } }),
      params(seferA.id, durakA.id)
    )
  );
  kaydet("POST …/kanit (iptal sonrası)", "şoför", rYeni.kod, rYeni.govde?.error ?? "yeni kanıt");
  iddia(
    "iptal sonrası aynı durağa YENİ kanıt → 200",
    rYeni.kod === 200,
    `${rYeni.kod} ${rYeni.govde?.error ?? ""}`
  );
  const kanitId2 = rYeni.govde?.kanitId ?? rYeni.govde?.kanit?.id ?? null;
  if (kanitId2) temizlik.teslimatIds.push(kanitId2);
  iddia(
    "durak zaten kapalıydı → durumIlerledi:false (kanıt YİNE DE yazıldı)",
    rYeni.govde?.durumIlerledi === false && rYeni.govde?.durumSebep === "kapali_durak",
    `ilerledi=${rYeni.govde?.durumIlerledi} sebep=${rYeni.govde?.durumSebep}`
  );
} catch (e) {
  console.error(`\n✗ BETİK DÜŞTÜ: ${e?.message ?? e}`);
  dusen++;
} finally {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("10. GERİ ALMA — yazılan her şey siliniyor");

  const sil = async (tablo, kolon, idler) => {
    if (!idler.length) return 0;
    const { data } = await supabaseAdmin.from(tablo).delete().in(kolon, idler).select("id");
    return (data ?? []).length;
  };
  // Sıra FK'lere göre: foto → kanıt → taslak → durak → sefer.
  const f = await sil("teslimat_fotograflari", "teslimat_id", temizlik.teslimatIds);
  const k = await sil("teslimatlar", "id", temizlik.teslimatIds);
  const ta = await sil("teslimat_taslak_dosyalari", "id", temizlik.taslakIds);
  const d = await sil("sefer_duraklari", "id", temizlik.durakIds);
  const s = await sil("seferler", "id", temizlik.seferIds);
  bilgi(`satır — foto ${f} · kanıt ${k} · taslak ${ta} · durak ${d} · sefer ${s}`);

  const ds = await dosyaSil(TESLIMAT_KOVASI, temizlik.yollar);
  iddia(
    "Storage dosyaları SİLİNDİ",
    ds.ok,
    `${ds.silinen}/${new Set(temizlik.yollar).size} dosya${ds.hata ? " · " + ds.hata : ""}`
  );

  const { count: kalanKanit } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true });
  const { data: kalanTaslak } = await supabaseAdmin.from("teslimat_taslak_dosyalari").select("id");
  const { data: kalanSefer } = await supabaseAdmin
    .from("seferler")
    .select("id")
    .in("id", temizlik.seferIds.length ? temizlik.seferIds : ["00000000-0000-0000-0000-000000000000"]);
  iddia(
    "SONRA: teslimatlar ÖNCEKİ değere döndü",
    kalanKanit === kanitOnce,
    `önce ${kanitOnce} → sonra ${kalanKanit}`
  );
  iddia(
    "SONRA: bekleyen taslak ÖNCEKİ değere döndü",
    (kalanTaslak ?? []).length === taslakOnce,
    `önce ${taslakOnce} → sonra ${(kalanTaslak ?? []).length}`
  );
  iddia("SONRA: test seferleri yok", (kalanSefer ?? []).length === 0, `${(kalanSefer ?? []).length}`);

  // ── HTTP KODU TABLOSU ────────────────────────────────────────────────────
  if (tablo.length) {
    console.log(`\n── HTTP KODLARI ──`);
    const w1 = Math.max(...tablo.map((t) => t.adim.length), 4);
    const w2 = Math.max(...tablo.map((t) => String(t.rol).length), 3);
    console.log(`  ${"adım".padEnd(w1)}  ${"rol".padEnd(w2)}  kod  not`);
    console.log(`  ${"-".repeat(w1)}  ${"-".repeat(w2)}  ---  ---`);
    for (const t of tablo) {
      console.log(
        `  ${t.adim.padEnd(w1)}  ${String(t.rol).padEnd(w2)}  ${String(t.kod).padStart(3)}  ${t.not ?? ""}`
      );
    }
  }

  console.log(
    `\n╚══ ${dusen === 0 ? "✅ TÜM İDDİALAR GEÇTİ" : `🔴 ${dusen} İDDİA DÜŞTÜ`} ══════════════════\n`
  );
  process.exit(dusen === 0 ? 0 : 1);
}
