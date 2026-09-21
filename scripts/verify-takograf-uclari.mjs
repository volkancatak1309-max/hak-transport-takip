#!/usr/bin/env node
/**
 * TAKOGRAF UÇLARI — CANLI KANIT (yalnız galzura-demo).
 *
 * ═══ 🔴 BU BETİK KALICI BİR SATIR BIRAKIR — VE BU KAÇINILMAZ ═══
 *
 * `trg_takograf_dosya_silinemez` (091) KOŞULSUZ: `before delete … raise
 * exception HK091`, istisna yolu yok. Yani yüklenen bir .ddd satırı
 * SİLİNEMEZ — "arşiv ürünün satış vaadi" kuralının ta kendisi.
 *
 * Bu yüzden tur, kalıcı satır sayısını BİRE indirecek şekilde kuruldu:
 *   · 201 kanıtı  → GÜNE BAĞLI damgalı tek dosya (`qa-mobil-c3-YYYYMMDD.ddd`).
 *     Aynı gün yeniden koşarsa sha aynı çıkar, 409 alınır ve YENİ SATIR AÇILMAZ.
 *   · 409 kanıtı  → arşivdeki ORİJİNAL dosya (0 satır).
 *   · 429 kanıtı  → aynı orijinal 11 kez (hepsi 409/429 → 0 satır).
 *   · liste/künye/yeniden-oku/indir → okuma (0 satır).
 * HAK61 ve Sendigo'ya TEK BAYT yazılmaz.
 *
 * ═══ FİKSTÜR: ARŞİVDEN GERİ KAZANILDI ═══
 *
 * Depoda `.ddd` yok; `scripts/verify-takograf.mjs` onu `TAKOGRAF_DDD` env
 * yolundan okuyor ve o dizin bu makinede yok. Fikstür galzura-demo'nun KENDİ
 * arşivinden imzalı URL ile indirildi: `vu-004-full.ddd`, 98.590 bayt,
 * sha256 e9f6271b…ee8c — DB satırıyla birebir aynı, ilk baytlar `v1` (→ `vu`).
 * Damgalama tekniği `verify-takograf.mjs:181-188`ten: sona 8 bayt eklenir.
 *
 * ⚠️ SERVİS: `.env.galzura-demo` içinde TAKOGRAF_URL/TAKOGRAF_SECRET YOK.
 * Yerel koşumda `servisYapilandirildi()` false döner ve satır `bekliyor`da
 * kalır — bu bir ARIZA değil, bu makinede o sırrın olmaması. Ayrıştırmanın
 * GERÇEKTEN çalıştığı, dağıtımdan sonra canlı host turunda ölçülür.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-takograf-uclari.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";

// ── EMNİYET 1: ŞİM DEĞİL ───────────────────────────────────────────────────
if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede. Bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}

// ── EMNİYET 2: YALNIZ galzura-demo ─────────────────────────────────────────
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(DEMO_REF)) {
  console.error(
    `✗ DURDURULDU — hedef galzura-demo DEĞİL.\n  Beklenen ref: ${DEMO_REF}\n  Gelen URL: ${url}\n` +
      `  HAK61 ve Sendigo CANLI MÜŞTERİ; takograf arşivine ASLA test dosyası girmez.`
  );
  process.exit(1);
}

const TEL = "+905535910471";
const PIN = "183434";
const FIKSTUR =
  process.env.TAKOGRAF_FIKSTUR ??
  "C:/Users/90553/AppData/Local/Temp/claude/C--Users-90553-Desktop-business-hak-transport-takip/178d356c-587d-4c1a-9455-786655b5b324/scratchpad/tacho/vu-004-full.ddd";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

const tablo = [];
const kaydet = (adim, rol, kod, not) => tablo.push({ adim, rol, kod, not });

const { POST: LOGIN } = await import("@/app/api/mobile/auth/login/route.ts");
const LISTE = await import("@/app/api/mobile/takograf/route.ts");
const KUNYE = await import("@/app/api/mobile/takograf/[id]/route.ts");
const YENIDEN = await import("@/app/api/mobile/takograf/[id]/yeniden-oku/route.ts");
const INDIR = await import("@/app/api/mobile/takograf/[id]/indir/route.ts");

const HOST = "https://demo.galzura.com";
const p1 = (id) => ({ params: Promise.resolve({ id }) });

const istek = (yol, { token, govde, method = "POST" } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`${HOST}${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
};

const dosyaIstek = (yol, { token, baytlar, ad, alanlar = {} }) => {
  const fd = new FormData();
  fd.set("dosya", new File([baytlar], ad, { type: "application/octet-stream" }));
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

const sha = (b) => createHash("sha256").update(Buffer.from(b)).digest("hex");

console.log(`\n╔══ TAKOGRAF UÇLARI · CANLI KANIT (galzura-demo) ════════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

const temizlik = { workerIds: [], kotaOnce: null, workerId: null };

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — şema · fikstür · sayımlar");

  iddia("fikstür dosyası var", existsSync(FIKSTUR), FIKSTUR);
  if (!existsSync(FIKSTUR)) throw new Error("fikstür yok — TAKOGRAF_FIKSTUR ile yol verin");
  const ORIJINAL = new Uint8Array(readFileSync(FIKSTUR));
  const orijinalSha = sha(ORIJINAL);
  bilgi(`fikstür ${ORIJINAL.length} bayt · sha ${orijinalSha.slice(0, 12)}…`);
  iddia("fikstür .ddd imzası taşıyor (0x76 → vu)", ORIJINAL[0] === 0x76, `0x${ORIJINAL[0].toString(16)}`);

  const { data: arsivSatir, error: tErr } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("id, sha256, dosya_adi")
    .eq("sha256", orijinalSha)
    .maybeSingle();
  iddia("091 tablosu okunabiliyor", !tErr, tErr ? tErr.code : "ok");
  iddia(
    "fikstür arşivde MEVCUT (409 kanıtının zemini)",
    Boolean(arsivSatir),
    arsivSatir ? arsivSatir.id : "YOK"
  );

  const { count: dosyaOnce } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("id", { count: "exact", head: true });
  bilgi(`ÖNCE: takograf_dosyalari = ${dosyaOnce}`);

  const { data: hesap } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin")
    .eq("phone", TEL)
    .maybeSingle();
  if (!hesap) throw new Error(`${TEL} bulunamadı`);
  iddia("giriş hesabı YÖNETİCİ", hesap.is_admin === true, `is_admin=${hesap.is_admin}`);
  temizlik.workerId = hesap.id;

  // Kota sayacının ÖNCEKİ hâli — tur sonunda geri yazılacak.
  const { data: kotaSatir } = await supabaseAdmin
    .from("upload_rate")
    .select("worker_id, pencere_basi, sayac")
    .eq("worker_id", hesap.id)
    .maybeSingle();
  temizlik.kotaOnce = kotaSatir ?? null;
  bilgi(`ÖNCE: upload_rate sayac = ${kotaSatir?.sayac ?? "(satır yok)"}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. GERÇEK GİRİŞ + ŞOFÖR HESABI (403 için)");

  const g = await cevap(await LOGIN(istek("/api/mobile/auth/login", { govde: { phone: TEL, pin: PIN } })));
  kaydet("POST /auth/login", "yönetici", g.kod, "telefon + PIN");
  iddia("yönetici girişi 200", g.kod === 200, `${g.kod}`);
  const token = g.govde?.accessToken ?? g.govde?.access_token ?? null;
  if (!token) throw new Error("jeton alınamadı");

  /**
   * ⚠️ ŞOFÖR 403'Ü İÇİN GEÇİCİ HESAP — demo'nun TEK girişi yönetici.
   * Alternatif, o hesabın `is_admin`ini geçici olarak kapatmaktı; tek giriş
   * yolunu bir betiğin ortasında yetkisiz bırakmak kabul edilemez bir risk
   * (betik düşerse demo kilitlenir). Geçici şoför `finally`de siliniyor ve
   * `workers` tablosunda silme engeli YOK.
   */
  /**
   * ⚠️ ÖNCE ARTIK VARSA SİL — betik yeniden koşuma dayanıklı olmalı.
   * ÖLÇÜLDÜ: ilk koşum `| head` ile borulanınca SIGPIPE `finally` bloğunu
   * kesti ve geçici hesap geride kaldı; ikinci koşum `workers_phone_key`
   * ihlaliyle düştü. Bir doğrulama betiği, kendi artığı yüzünden kırmızı
   * dönmemeli.
   */
  await supabaseAdmin.from("workers").delete().eq("phone", "+430000000910");

  const { data: sofor, error: sErr } = await supabaseAdmin
    .from("workers")
    .insert({
      name: "QA Takograf Sofor",
      phone: "+430000000910",
      pin_hash: await bcrypt.hash(PIN, 10),
      is_admin: false,
      is_active: true,
    })
    .select("id, is_admin")
    .maybeSingle();
  iddia("geçici şoför hesabı açıldı", Boolean(sofor) && !sErr, sofor ? sofor.id : `${sErr?.message}`);
  if (sofor) temizlik.workerIds.push(sofor.id);

  const gs = await cevap(
    await LOGIN(istek("/api/mobile/auth/login", { govde: { phone: "+430000000910", pin: PIN } }))
  );
  const soforToken = gs.govde?.accessToken ?? gs.govde?.access_token ?? null;
  iddia("şoför girişi 200", gs.kod === 200 && Boolean(soforToken), `${gs.kod}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. KAPILAR — 401 · 403");

  const r401 = await cevap(await LISTE.GET(istek("/api/mobile/takograf", { method: "GET" })));
  kaydet("GET /takograf", "jetonsuz", r401.kod, r401.govde?.error);
  iddia("jetonsuz GET → 401", r401.kod === 401, `${r401.kod} ${r401.govde?.error}`);

  const r401p = await cevap(
    await LISTE.POST(dosyaIstek("/api/mobile/takograf", { baytlar: ORIJINAL, ad: "x.ddd" }))
  );
  kaydet("POST /takograf", "jetonsuz", r401p.kod, r401p.govde?.error);
  iddia("jetonsuz POST → 401", r401p.kod === 401, `${r401p.kod} ${r401p.govde?.error}`);

  const r403 = await cevap(
    await LISTE.POST(
      dosyaIstek("/api/mobile/takograf", { token: soforToken, baytlar: ORIJINAL, ad: "x.ddd" })
    )
  );
  kaydet("POST /takograf", "şoför", r403.kod, r403.govde?.error);
  iddia(
    "🔴 ŞOFÖR POST → 403 admin_required",
    r403.kod === 403 && r403.govde?.error === "admin_required",
    `${r403.kod} ${r403.govde?.error}`
  );

  const r403g = await cevap(
    await LISTE.GET(istek("/api/mobile/takograf", { token: soforToken, method: "GET" }))
  );
  kaydet("GET /takograf", "şoför", r403g.kod, r403g.govde?.error);
  iddia("şoför GET → 403 (okuma da yöneticide)", r403g.kod === 403, `${r403g.kod} ${r403g.govde?.error}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. GÖVDE DOĞRULAMALARI (kota harcamadan)");

  const rUzanti = await cevap(
    await LISTE.POST(dosyaIstek("/api/mobile/takograf", { token, baytlar: ORIJINAL, ad: "rapor.pdf" }))
  );
  kaydet("POST /takograf (.pdf)", "yönetici", rUzanti.kod, rUzanti.govde?.error);
  iddia("yanlış uzantı → 400", rUzanti.kod === 400, `${rUzanti.kod} ${rUzanti.govde?.error}`);

  const rBos = await cevap(
    await LISTE.POST(dosyaIstek("/api/mobile/takograf", { token, baytlar: new Uint8Array(0), ad: "a.ddd" }))
  );
  kaydet("POST /takograf (0 bayt)", "yönetici", rBos.kod, rBos.govde?.error);
  iddia("boş dosya → 400", rBos.kod === 400, `${rBos.kod} ${rBos.govde?.error}`);

  const rSuzgec = await cevap(
    await LISTE.GET(istek("/api/mobile/takograf?sofor=abc", { token, method: "GET" }))
  );
  kaydet("GET ?sofor=", "yönetici", rSuzgec.kod, rSuzgec.govde?.sebep);
  iddia(
    "?sofor= SESSİZCE yok sayılmıyor → 400 + gerekçe",
    rSuzgec.kod === 400 && rSuzgec.govde?.sebep === "kimlik_bagi_yok",
    `${rSuzgec.kod} ${rSuzgec.govde?.error} ${rSuzgec.govde?.sebep}`
  );

  const { data: kotaAra } = await supabaseAdmin
    .from("upload_rate")
    .select("sayac")
    .eq("worker_id", hesap.id)
    .maybeSingle();
  iddia(
    "reddedilen istekler KOTA YEMEDİ",
    (kotaAra?.sayac ?? 0) === (temizlik.kotaOnce?.sayac ?? 0),
    `önce ${temizlik.kotaOnce?.sayac ?? 0} → şimdi ${kotaAra?.sayac ?? 0}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. YÜKLEME → 201 (güne bağlı damga)");

  /**
   * DAMGA GÜNE BAĞLI, RASTGELE DEĞİL: aynı gün ikinci koşum aynı sha'yı üretir
   * ve 409 alır — yani arşive İKİNCİ bir kalıcı satır girmez.
   */
  const gun = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const damga = Buffer.from(`qa${gun}`.padEnd(8, "0").slice(0, 8), "utf8");
  const DAMGALI = new Uint8Array(ORIJINAL.length + 8);
  DAMGALI.set(ORIJINAL);
  DAMGALI.set(damga, ORIJINAL.length);
  const damgaliSha = sha(DAMGALI);
  const QA_AD = `qa-mobil-c3-${gun}.ddd`;

  const t0 = Date.now();
  const rYukle = await cevap(
    await LISTE.POST(
      dosyaIstek("/api/mobile/takograf", { token, baytlar: DAMGALI, ad: QA_AD, alanlar: { tur: "kart" } })
    )
  );
  const sureMs = Date.now() - t0;
  kaydet("POST /takograf (damgalı)", "yönetici", rYukle.kod, `${sureMs} ms`);

  let dosyaId = null;
  if (rYukle.kod === 201) {
    iddia("yükleme → 201", true, `${sureMs} ms`);
    dosyaId = rYukle.govde?.id ?? null;
    iddia("tur SUNUCUDA tespit edildi (vu)", rYukle.govde?.tur === "vu", `${rYukle.govde?.tur}`);
    iddia(
      "istemcinin 'kart' iddiası REDDEDİLMEDİ ama YAZILMADI",
      rYukle.govde?.turUyusmazligi?.gonderilen === "kart" &&
        rYukle.govde?.turUyusmazligi?.yazilan === "vu",
      JSON.stringify(rYukle.govde?.turUyusmazligi)
    );
    iddia("bayt doğru", rYukle.govde?.bayt === DAMGALI.length, `${rYukle.govde?.bayt}`);
  } else if (rYukle.kod === 409) {
    dosyaId = rYukle.govde?.mevcutId ?? null;
    iddia(
      "bugünün damgası ZATEN yüklü → 409 (yeni kalıcı satır AÇILMADI)",
      Boolean(dosyaId),
      `mevcutId=${dosyaId}`
    );
    bilgi("201 bu gün için daha önce ölçüldü; tur kalan adımlarla sürüyor.");
  } else {
    iddia("yükleme 201 ya da 409", false, `${rYukle.kod} ${JSON.stringify(rYukle.govde)}`);
  }
  if (!dosyaId) throw new Error("dosya kimliği alınamadı");

  const { data: dbSatir } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("id, tur, sha256, bayt, dosya_adi, ayristirma_durumu, yukleyen_worker_id")
    .eq("id", dosyaId)
    .maybeSingle();
  iddia("DB satırı: sha damgalı dosyanınki", dbSatir?.sha256 === damgaliSha, `${dbSatir?.sha256?.slice(0, 12)}…`);
  iddia("DB satırı: tur = vu (HK091 ile donuk)", dbSatir?.tur === "vu", `${dbSatir?.tur}`);
  iddia("DB satırı: yükleyen = giriş yapan", dbSatir?.yukleyen_worker_id === hesap.id, `${dbSatir?.yukleyen_worker_id}`);
  bilgi(`ayrıştırma durumu: ${dbSatir?.ayristirma_durumu} (servis bu makinede yapılandırılmamışsa 'bekliyor')`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. LİSTE — süzgeç + sayfalama");

  const rListe = await cevap(
    await LISTE.GET(istek("/api/mobile/takograf?tur=vu&limit=5", { token, method: "GET" }))
  );
  kaydet("GET /takograf?tur=vu&limit=5", "yönetici", rListe.kod, `${rListe.govde?.page?.total} toplam`);
  iddia("liste → 200", rListe.kod === 200, `${rListe.kod}`);
  iddia("sayfa bloğu var", Boolean(rListe.govde?.page), JSON.stringify(rListe.govde?.page));
  iddia("limit uygulandı", (rListe.govde?.dosyalar ?? []).length <= 5, `${(rListe.govde?.dosyalar ?? []).length}`);
  iddia(
    "yeni dosya listede",
    (rListe.govde?.dosyalar ?? []).some((d) => d.id === dosyaId),
    dosyaId
  );
  iddia(
    "liste satırında faaliyet sayısı YOK (1000 tavanı tuzağı)",
    (rListe.govde?.dosyalar ?? []).every((d) => d.faaliyetSayisi === undefined),
    null
  );

  const rKart = await cevap(
    await LISTE.GET(istek("/api/mobile/takograf?tur=kart", { token, method: "GET" }))
  );
  iddia("tür süzgeci gerçekten süzüyor", (rKart.govde?.dosyalar ?? []).every((d) => d.tur === "kart"), `${(rKart.govde?.dosyalar ?? []).length} kart`);

  const rDonem = await cevap(
    await LISTE.GET(istek("/api/mobile/takograf?donem=2026-01", { token, method: "GET" }))
  );
  kaydet("GET ?donem=2026-01", "yönetici", rDonem.kod, `gizlenen ${rDonem.govde?.filtre?.donemsizGizlendi}`);
  iddia("dönem süzgeci → 200", rDonem.kod === 200, `${rDonem.kod}`);
  iddia(
    "dönemsiz dosyalar SESSİZCE elenmiyor",
    typeof rDonem.govde?.filtre?.donemsizGizlendi === "number",
    `donemsizGizlendi=${rDonem.govde?.filtre?.donemsizGizlendi}`
  );

  const rBozukDonem = await cevap(
    await LISTE.GET(istek("/api/mobile/takograf?donem=2026-13", { token, method: "GET" }))
  );
  iddia("geçersiz dönem → 400", rBozukDonem.kod === 400, `${rBozukDonem.kod} ${rBozukDonem.govde?.error}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("6. KÜNYE — gerçek sayımlar, sayfalı alt listeler");

  const rKunye = await cevap(
    await KUNYE.GET(istek(`/api/mobile/takograf/${dosyaId}?fLimit=10`, { token, method: "GET" }), p1(dosyaId))
  );
  kaydet("GET /takograf/{id}", "yönetici", rKunye.kod, `f=${rKunye.govde?.sayim?.faaliyet} o=${rKunye.govde?.sayim?.olay}`);
  iddia("künye → 200", rKunye.kod === 200, `${rKunye.kod}`);
  iddia("künye kimliği doğru", rKunye.govde?.kunye?.id === dosyaId, null);
  iddia("sha256 künyede", rKunye.govde?.kunye?.sha256 === damgaliSha, null);
  iddia(
    "faaliyet sayfalı ve toplam GERÇEK",
    (rKunye.govde?.faaliyet?.satirlar ?? []).length <= 10 &&
      typeof rKunye.govde?.faaliyet?.toplam === "number",
    `${(rKunye.govde?.faaliyet?.satirlar ?? []).length}/${rKunye.govde?.faaliyet?.toplam}`
  );
  iddia(
    "sayım count:exact ile künye toplamıyla tutarlı",
    rKunye.govde?.sayim?.faaliyet === rKunye.govde?.faaliyet?.toplam,
    `${rKunye.govde?.sayim?.faaliyet} vs ${rKunye.govde?.faaliyet?.toplam}`
  );
  iddia("mühür HAM metin DEĞİL kapalı kod", !("sebep" in (rKunye.govde?.kunye?.muhur ?? {})), JSON.stringify(rKunye.govde?.kunye?.muhur));

  const rYok = await cevap(
    await KUNYE.GET(
      istek("/api/mobile/takograf/00000000-0000-0000-0000-000000000000", { token, method: "GET" }),
      p1("00000000-0000-0000-0000-000000000000")
    )
  );
  iddia("olmayan künye → 404", rYok.kod === 404, `${rYok.kod}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("7. AYNI DOSYA → 409 + mevcutId");

  const r409 = await cevap(
    await LISTE.POST(
      dosyaIstek("/api/mobile/takograf", { token, baytlar: ORIJINAL, ad: "tekrar.ddd" })
    )
  );
  kaydet("POST /takograf (orijinal)", "yönetici", r409.kod, r409.govde?.mevcutId);
  iddia(
    "aynı dosya → 409 zaten_yuklu",
    r409.kod === 409 && r409.govde?.error === "zaten_yuklu",
    `${r409.kod} ${r409.govde?.error}`
  );
  iddia("409 mevcut kaydın kimliğini SÖYLÜYOR", Boolean(r409.govde?.mevcutId), `${r409.govde?.mevcutId}`);
  iddia("mevcutId arşivdeki satır", r409.govde?.mevcutId === arsivSatir?.id, `${arsivSatir?.id}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("8. YENİDEN OKU · İNDİR");

  const rTekrar = await cevap(
    await YENIDEN.POST(istek(`/api/mobile/takograf/${dosyaId}/yeniden-oku`, { token }), p1(dosyaId))
  );
  kaydet("POST /{id}/yeniden-oku", "yönetici", rTekrar.kod, rTekrar.govde?.ayristirma?.durum);
  iddia("yeniden-oku → 200", rTekrar.kod === 200, `${rTekrar.kod}`);
  iddia(
    "ayrıştırma SONUCU gövdede (panelden farkı)",
    typeof rTekrar.govde?.ayristirma?.durum === "string",
    `${rTekrar.govde?.ayristirma?.durum}`
  );
  iddia(
    "servis yapılandırması AYRI bildiriliyor",
    typeof rTekrar.govde?.servisYapilandirildi === "boolean",
    `servisYapilandirildi=${rTekrar.govde?.servisYapilandirildi}`
  );

  const rIndir = await cevap(
    await INDIR.GET(istek(`/api/mobile/takograf/${dosyaId}/indir`, { token, method: "GET" }), p1(dosyaId))
  );
  kaydet("GET /{id}/indir", "yönetici", rIndir.kod, `${rIndir.govde?.sonKullanmaSn} sn`);
  iddia("indir → 200", rIndir.kod === 200, `${rIndir.kod}`);
  iddia("imzalı URL geldi", Boolean(rIndir.govde?.url), null);
  iddia("kısa ömür (300 sn)", rIndir.govde?.sonKullanmaSn === 300, `${rIndir.govde?.sonKullanmaSn}`);

  // İmzalı URL GERÇEKTEN çalışıyor mu — indir ve baytları doğrula.
  const dl = await fetch(rIndir.govde.url);
  const indirilen = new Uint8Array(await dl.arrayBuffer());
  kaydet("GET imzalı URL (Storage)", "—", dl.status, `${indirilen.length} bayt`);
  iddia("imzalı URL indirilebiliyor", dl.ok, `${dl.status}`);
  iddia(
    "🔑 İNDİRİLEN DOSYA BAYT BAYT AYNI",
    sha(indirilen) === damgaliSha && indirilen.length === DAMGALI.length,
    `${indirilen.length} bayt · sha ${sha(indirilen).slice(0, 12)}…`
  );

  // ══════════════════════════════════════════════════════════════════════════
  baslik("9. HIZ SINIRI → 11. istekte 429 (kalıcı satır BIRAKMADAN)");

  /**
   * Sayaç SIFIRLANIYOR: fren bir SAYAÇTIR, delil değil. Deterministik ölçüm
   * için pencere temiz başlatılıyor; tur sonunda ÖNCEKİ değer geri yazılıyor.
   * Gönderilen dosya ORİJİNAL — hepsi 409 alır, arşive SIFIR satır girer.
   */
  await supabaseAdmin.from("upload_rate").delete().eq("worker_id", hesap.id);

  const kodlar = [];
  for (let i = 1; i <= 11; i++) {
    const r = await cevap(
      await LISTE.POST(
        dosyaIstek("/api/mobile/takograf", { token, baytlar: ORIJINAL, ad: `fren-${i}.ddd` })
      )
    );
    kodlar.push(r.kod);
    if (r.kod === 429) {
      kaydet(`POST /takograf (#${i})`, "yönetici", 429, `Retry-After ${r.govde?.retryAfter}`);
      iddia(`${i}. istek → 429 hiz_siniri`, i === 11, `${i}. istekte tavana çarpıldı`);
      iddia("429 retryAfter taşıyor", typeof r.govde?.retryAfter === "number", `${r.govde?.retryAfter}`);
      break;
    }
  }
  iddia("ilk 10 istek 409 (kota yiyor, satır yazmıyor)", kodlar.slice(0, 10).every((k) => k === 409), kodlar.join(","));
  iddia("11. istek 429", kodlar[10] === 429, `${kodlar[10]}`);

  const { count: dosyaSonra } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("id", { count: "exact", head: true });
  iddia(
    "🔑 FREN TURU ARŞİVE SIFIR SATIR EKLEDİ",
    dosyaSonra === (rYukle.kod === 201 ? dosyaOnce + 1 : dosyaOnce),
    `önce ${dosyaOnce} → sonra ${dosyaSonra}`
  );
} catch (e) {
  console.error(`\n✗ BETİK DÜŞTÜ: ${e?.message ?? e}`);
  dusen++;
} finally {
  baslik("10. GERİ ALMA");

  if (temizlik.workerIds.length) {
    const { data } = await supabaseAdmin
      .from("workers")
      .delete()
      .in("id", temizlik.workerIds)
      .select("id");
    iddia("geçici şoför hesabı SİLİNDİ", (data ?? []).length === temizlik.workerIds.length, `${(data ?? []).length}`);
  }

  if (temizlik.workerId) {
    await supabaseAdmin.from("upload_rate").delete().eq("worker_id", temizlik.workerId);
    if (temizlik.kotaOnce) {
      await supabaseAdmin.from("upload_rate").insert(temizlik.kotaOnce);
    }
    const { data: k } = await supabaseAdmin
      .from("upload_rate")
      .select("sayac")
      .eq("worker_id", temizlik.workerId)
      .maybeSingle();
    iddia(
      "kota sayacı ÖNCEKİ hâline döndü",
      (k?.sayac ?? null) === (temizlik.kotaOnce?.sayac ?? null),
      `önce ${temizlik.kotaOnce?.sayac ?? "(yok)"} → sonra ${k?.sayac ?? "(yok)"}`
    );
  }

  bilgi("⚠️ Yüklenen .ddd satırı SİLİNMEDİ — HK091 silmeyi reddediyor (arşiv sözü).");
  bilgi("   Adı 'qa-mobil-c3-<gün>.ddd'; aynı gün yeniden koşum YENİ satır açmaz.");

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
