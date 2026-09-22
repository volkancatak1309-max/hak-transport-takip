#!/usr/bin/env node
/**
 * MEVZUAT UÇLARI — CANLI DEMO TURU (yalnız galzura-demo).
 *
 * ═══ NE YAPAR ═══
 *
 * GERÇEK GİRİŞLE (telefon + PIN) `GET` ve `PATCH /api/mobile/mevzuat` uçlarının
 * tamamını gezer, her adımın HTTP kodunu basar ve YAZMAYI GERİ ALIR:
 *
 *   jetonsuz GET/PATCH        → 401
 *   GET (yönetici)            → 200 · ayar + canlı + defter + belgeler
 *   PATCH kademe.erken +1     → 200 · once 60 → sonra 61
 *   GET (doğrulama)           → 200 · ayar.kademe.erken = 61
 *   PATCH geri al             → 200 · 61 → 60, DB'den teyit
 *   PATCH sınır dışı          → 400 · kademe_sirasi
 *   PATCH {ulke}              → 400 · ulke_kolonu_yok
 *   PATCH {kuralSeti:"XX"}    → 400
 *   GET ?durum=acik           → 400 · kapanis_ekseni_yok
 *   GET ?sofor=<uuid değil>   → 400
 *   ŞOFÖR: GET                → 403 fleet_view_required
 *   ŞOFÖR: PATCH              → 403 admin_required
 *
 * ═══ 🔴 DEFTERE TEK SATIR YAZILMADIĞI ÖLÇÜLÜR ═══
 * `mevzuat_uyarilari` tur öncesi ve sonrası sayılır. Uçlar o tabloya
 * dokunmuyor ve bu bir iddia değil, bir ÖLÇÜM olarak duruyor.
 *
 * ═══ AYAR BAYT BAYT GERİ KONUR ═══
 * `tenant_mevzuat`ın beş alanı da tur öncesi okunur ve sonunda karşılaştırılır.
 * Demo bir müşteri kurulumudur; QA kalıntısı bırakmaz.
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (ikisi de CANLI MÜŞTERİ).
 *
 * 🔑 JETON HİÇBİR YERE BASILMAZ — değişkende tutulur, yalnız `Authorization`
 * başlığında kullanılır.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-mevzuat-uclari.mjs
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
let gecti = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (k) gecti++;
  else dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);

const { POST: LOGIN } = await import("@/app/api/mobile/auth/login/route.ts");
const MEVZUAT = await import("@/app/api/mobile/mevzuat/route.ts");
const { issueAccessToken, readTokenVersion } = await import("@/lib/mobile-auth");

const HOST = "https://demo.galzura.com";
const istek = (yol, { token, govde, method = "GET" } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`${HOST}${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
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

console.log(`\n╔══ MEVZUAT UÇLARI · CANLI DEMO TURU (galzura-demo) ═════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

// ══ TUR ÖNCESİ ÖLÇÜM ══════════════════════════════════════════════════════
const ayarOnce = (
  await supabaseAdmin.from("tenant_mevzuat").select("*").eq("id", "singleton").maybeSingle()
).data;
const { count: defterOnce } = await supabaseAdmin
  .from("mevzuat_uyarilari")
  .select("id", { count: "exact", head: true });

if (!ayarOnce) {
  console.error("✗ DURDURULDU — tenant_mevzuat singleton satırı yok (086 koşmamış?).");
  process.exit(1);
}
console.log(
  `║ ÖNCE   kural_seti=${ayarOnce.kural_seti} kademe=${ayarOnce.kademe_erken_dk}/` +
    `${ayarOnce.kademe_yaklasti_dk}/${ayarOnce.kademe_son_dk} · defter=${defterOnce} satır`
);
console.log(`╚════════════════════════════════════════════════════════════════════`);

let yaziliDeger = null; // geri alma için

try {
  // ══ 1 · JETONSUZ ════════════════════════════════════════════════════════
  baslik("1 · jetonsuz");
  for (const [ad, fn, method] of [
    ["GET", MEVZUAT.GET, "GET"],
    ["PATCH", MEVZUAT.PATCH, "PATCH"],
  ]) {
    const r = await cevap(await fn(istek("/api/mobile/mevzuat", { method })));
    iddia(`${ad} jetonsuz → 401`, r.kod === 401, `${r.kod} ${r.govde?.error}`);
  }

  // ══ 2 · GERÇEK GİRİŞ ════════════════════════════════════════════════════
  baslik("2 · gerçek giriş (telefon + PIN)");
  const giris = await cevap(
    await LOGIN(istek("/api/mobile/auth/login", { method: "POST", govde: { phone: TEL, pin: PIN } }))
  );
  iddia("POST /auth/login → 200", giris.kod === 200, `${giris.kod}`);
  const jeton = giris.govde?.accessToken;
  if (!jeton) {
    console.error("✗ DURDURULDU — jeton alınamadı, tur devam edemez.");
    process.exit(1);
  }
  const benId = giris.govde?.user?.id ?? null;
  iddia("hesap yönetici", giris.govde?.user?.isAdmin === true, `rol=${giris.govde?.user?.rol}`);

  // ══ 3 · PANO ════════════════════════════════════════════════════════════
  baslik("3 · GET /mevzuat — pano");
  const t0 = Date.now();
  const pano = await cevap(await MEVZUAT.GET(istek("/api/mobile/mevzuat", { token: jeton })));
  const sure = Date.now() - t0;
  iddia("GET → 200", pano.kod === 200, `${pano.kod} · ${sure} ms`);
  const g = pano.govde ?? {};
  iddia("ayar.kuralSeti geldi", typeof g.ayar?.kuralSeti === "string", g.ayar?.kuralSeti);
  iddia(
    "ayar.kurallar eşikleri + dayanakları taşıyor",
    Array.isArray(g.ayar?.kurallar) &&
      g.ayar.kurallar.length > 0 &&
      g.ayar.kurallar.every((k) => typeof k.esikDk === "number" && typeof k.dayanak === "string"),
    `${g.ayar?.kurallar?.length} kural · ${g.ayar?.kurallar?.map((k) => `${k.ad}:${k.esikDk}dk`).join(" · ")}`
  );
  iddia(
    "ayar.kademe ayar satırıyla birebir",
    g.ayar?.kademe?.erken === ayarOnce.kademe_erken_dk &&
      g.ayar?.kademe?.yaklasti === ayarOnce.kademe_yaklasti_dk &&
      g.ayar?.kademe?.son === ayarOnce.kademe_son_dk,
    `${g.ayar?.kademe?.erken}/${g.ayar?.kademe?.yaklasti}/${g.ayar?.kademe?.son}`
  );
  iddia(
    "canlı satırlar geldi (açık vardiyalar)",
    Array.isArray(g.canli?.satirlar),
    `${g.canli?.satirlar?.length} satır · vardiyasiz=${g.canli?.vardiyasiz} · bayat=${g.canli?.bayatVardiya}`
  );
  iddia(
    "canlı satır kural durumu taşıyor",
    g.canli?.satirlar?.length === 0 ||
      g.canli.satirlar.every((s) => Array.isArray(s.kurallar) && "enKritik" in s),
    g.canli?.satirlar?.[0]
      ? `örnek: enKritik=${g.canli.satirlar[0].enKritik} · kalan=${g.canli.satirlar[0].enYakinKalanDk}dk`
      : "—"
  );
  iddia(
    "uyarı defteri DÜRÜST BOŞ (503/404 değil, 0 satır + sayfa bloğu)",
    Array.isArray(g.uyarilar?.satirlar) &&
      g.uyarilar.tabloYok === false &&
      typeof g.uyarilar.page?.total === "number",
    `${g.uyarilar?.satirlar?.length} satır · total=${g.uyarilar?.page?.total} · pencere=${g.uyarilar?.pencereGun} gün`
  );
  iddia(
    "defter sayısı DB ile tutarlı",
    (g.uyarilar?.page?.total ?? -1) === defterOnce,
    `uç=${g.uyarilar?.page?.total} · DB=${defterOnce}`
  );
  iddia(
    "belgeler SÜRE eksenli ve tür sayısı taşınıyor",
    typeof g.belgeler?.turSayisi === "number" && typeof g.belgeler?.dolmus === "number",
    `tür=${g.belgeler?.turSayisi} · dolmuş=${g.belgeler?.dolmus} · yaklaşan=${g.belgeler?.yaklasan}`
  );
  iddia(
    "yetenekler: kapatma/silme YOK, eksik-belge tespiti YOK",
    g.yetenekler?.uyariKapatma === false &&
      g.yetenekler?.uyariSilme === false &&
      g.yetenekler?.eksikBelgeTespiti === false,
    `sebep=${g.yetenekler?.uyariKapatmaSebep}`
  );
  iddia(
    "kapsam gövdede görünür",
    "kapsam" in g && typeof g.kapsam?.daraltildi === "boolean",
    `filo=${g.kapsam?.filo} · şef=${g.kapsam?.sef} · daraltıldı=${g.kapsam?.daraltildi}`
  );

  // ══ 4 · SÜZGEÇLER ═══════════════════════════════════════════════════════
  baslik("4 · süzgeçler");
  const durum = await cevap(
    await MEVZUAT.GET(istek("/api/mobile/mevzuat?durum=acik", { token: jeton }))
  );
  iddia(
    "?durum=acik → 400 kapanis_ekseni_yok",
    durum.kod === 400 && durum.govde?.sebep === "kapanis_ekseni_yok",
    `${durum.kod} ${durum.govde?.sebep}`
  );
  const kotuSofor = await cevap(
    await MEVZUAT.GET(istek("/api/mobile/mevzuat?sofor=abc", { token: jeton }))
  );
  iddia(
    "?sofor=abc → 400 (uuid değil)",
    kotuSofor.kod === 400 && kotuSofor.govde?.alan === "sofor",
    `${kotuSofor.kod} alan=${kotuSofor.govde?.alan}`
  );
  const kotuGun = await cevap(
    await MEVZUAT.GET(istek("/api/mobile/mevzuat?gun=999", { token: jeton }))
  );
  iddia(
    "?gun=999 → 400 (tavan 90)",
    kotuGun.kod === 400 && kotuGun.govde?.alan === "gun",
    `${kotuGun.kod} max=${kotuGun.govde?.max}`
  );
  if (benId) {
    const kendi = await cevap(
      await MEVZUAT.GET(istek(`/api/mobile/mevzuat?sofor=${benId}`, { token: jeton }))
    );
    iddia(
      "?sofor=<geçerli uuid> → 200 ve iki liste de süzüldü",
      kendi.kod === 200 &&
        (kendi.govde?.canli?.satirlar ?? []).every((s) => s.workerId === benId) &&
        (kendi.govde?.uyarilar?.satirlar ?? []).every((u) => u.workerId === benId),
      `${kendi.kod} · canlı=${kendi.govde?.canli?.satirlar?.length} · defter=${kendi.govde?.uyarilar?.satirlar?.length}`
    );
  }
  const sayfa = await cevap(
    await MEVZUAT.GET(istek("/api/mobile/mevzuat?limit=1&offset=0", { token: jeton }))
  );
  iddia(
    "?limit=1 sayfalama sözleşmesi uygulanıyor",
    sayfa.kod === 200 && sayfa.govde?.uyarilar?.page?.limit === 1,
    `limit=${sayfa.govde?.uyarilar?.page?.limit} · hasMore=${sayfa.govde?.uyarilar?.page?.hasMore}`
  );

  // ══ 5 · PATCH — YAZ, DOĞRULA, GERİ AL ═══════════════════════════════════
  baslik("5 · PATCH — bir eşik +1, sonra geri");
  const hedef = ayarOnce.kademe_erken_dk + 1;
  const yaz = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", { token: jeton, method: "PATCH", govde: { kademe: { erken: hedef } } })
    )
  );
  iddia(
    `PATCH {kademe:{erken:${hedef}}} → 200`,
    yaz.kod === 200 && yaz.govde?.sonra?.kademe?.erken === hedef,
    `${yaz.kod} · once=${yaz.govde?.once?.kademe?.erken} → sonra=${yaz.govde?.sonra?.kademe?.erken}`
  );
  if (yaz.kod === 200) yaziliDeger = hedef;
  iddia(
    "kısmi yama: diğer iki kademe KORUNDU",
    yaz.govde?.sonra?.kademe?.yaklasti === ayarOnce.kademe_yaklasti_dk &&
      yaz.govde?.sonra?.kademe?.son === ayarOnce.kademe_son_dk,
    `${yaz.govde?.sonra?.kademe?.yaklasti}/${yaz.govde?.sonra?.kademe?.son}`
  );

  const teyit = await cevap(await MEVZUAT.GET(istek("/api/mobile/mevzuat", { token: jeton })));
  iddia(
    "GET doğrulaması: yeni eşik okundu",
    teyit.govde?.ayar?.kademe?.erken === hedef,
    `GET → erken=${teyit.govde?.ayar?.kademe?.erken}`
  );
  const dbAra = (
    await supabaseAdmin.from("tenant_mevzuat").select("kademe_erken_dk").eq("id", "singleton").maybeSingle()
  ).data;
  iddia(
    "DB'de de yeni değer duruyor (uç gövdesi değil, tablo)",
    dbAra?.kademe_erken_dk === hedef,
    `DB kademe_erken_dk=${dbAra?.kademe_erken_dk}`
  );

  const geri = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", {
        token: jeton,
        method: "PATCH",
        govde: { kademe: { erken: ayarOnce.kademe_erken_dk } },
      })
    )
  );
  iddia(
    `PATCH geri al {erken:${ayarOnce.kademe_erken_dk}} → 200`,
    geri.kod === 200 && geri.govde?.sonra?.kademe?.erken === ayarOnce.kademe_erken_dk,
    `${geri.kod} · ${geri.govde?.once?.kademe?.erken} → ${geri.govde?.sonra?.kademe?.erken}`
  );
  if (geri.kod === 200) yaziliDeger = null;

  // ══ 6 · SINIR DIŞI ══════════════════════════════════════════════════════
  baslik("6 · sınır dışı ve tanınmayan alan");
  const sira = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", {
        token: jeton,
        method: "PATCH",
        govde: { kademe: { erken: 10 } }, // 10 > 30 değil → sıra bozulur
      })
    )
  );
  iddia(
    "PATCH {kademe:{erken:10}} → 400 kademe_sirasi",
    sira.kod === 400 && sira.govde?.sebep === "kademe_sirasi",
    `${sira.kod} ${sira.govde?.sebep}`
  );
  const sifir = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", {
        token: jeton,
        method: "PATCH",
        govde: { kademe: { erken: 60, yaklasti: 30, son: 0 } },
      })
    )
  );
  iddia("PATCH {son:0} → 400 (son > 0 şartı)", sifir.kod === 400, `${sifir.kod} ${sifir.govde?.sebep}`);
  const ondalik = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", { token: jeton, method: "PATCH", govde: { kademe: { erken: 60.5 } } })
    )
  );
  iddia(
    "PATCH {erken:60.5} → 400 (tamsayı) — 503 DEĞİL",
    ondalik.kod === 400 && ondalik.govde?.bicim === "tamsayi",
    `${ondalik.kod} ${ondalik.govde?.alan}`
  );
  const ulke = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", { token: jeton, method: "PATCH", govde: { ulke: "AT" } })
    )
  );
  iddia(
    "PATCH {ulke:'AT'} → 400 ulke_kolonu_yok (sessizce yutulmuyor)",
    ulke.kod === 400 && ulke.govde?.sebep === "ulke_kolonu_yok",
    `${ulke.kod} ${ulke.govde?.sebep}`
  );
  const kotuSet = await cevap(
    await MEVZUAT.PATCH(
      istek("/api/mobile/mevzuat", { token: jeton, method: "PATCH", govde: { kuralSeti: "XX" } })
    )
  );
  iddia(
    "PATCH {kuralSeti:'XX'} → 400 + geçerli liste",
    kotuSet.kod === 400 && Array.isArray(kotuSet.govde?.gecerli),
    `${kotuSet.kod} gecerli=${kotuSet.govde?.gecerli?.join(",")}`
  );
  const bos = await cevap(
    await MEVZUAT.PATCH(istek("/api/mobile/mevzuat", { token: jeton, method: "PATCH", govde: {} }))
  );
  iddia("PATCH {} → 400 bos_govde", bos.kod === 400 && bos.govde?.error === "bos_govde", `${bos.kod}`);

  // ══ 7 · ŞOFÖR ROLÜ ══════════════════════════════════════════════════════
  baslik("7 · şoför rolü (kapılar)");
  const { data: soforlar } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, managed_fleet, is_active")
    .eq("is_active", true)
    .eq("is_admin", false)
    .is("managed_fleet", null)
    .limit(1);
  const sofor = soforlar?.[0];
  if (!sofor) {
    iddia("şoför hesabı bulundu", false, "demo'da ne patron ne şef olan aktif kayıt yok");
  } else {
    const tv = await readTokenVersion(sofor.id);
    const { accessToken: soforJeton } = await issueAccessToken(
      sofor.id,
      false,
      tv.ok ? tv.version : 0
    );
    const sGet = await cevap(await MEVZUAT.GET(istek("/api/mobile/mevzuat", { token: soforJeton })));
    iddia(
      "ŞOFÖR: GET → 403 fleet_view_required",
      sGet.kod === 403 && sGet.govde?.error === "fleet_view_required",
      `${sGet.kod} ${sGet.govde?.error}`
    );
    const sPatch = await cevap(
      await MEVZUAT.PATCH(
        istek("/api/mobile/mevzuat", {
          token: soforJeton,
          method: "PATCH",
          govde: { kademe: { erken: 99 } },
        })
      )
    );
    iddia(
      "ŞOFÖR: PATCH → 403 admin_required",
      sPatch.kod === 403 && sPatch.govde?.error === "admin_required",
      `${sPatch.kod} ${sPatch.govde?.error}`
    );
  }
} finally {
  // ══ GERİ ALMA + SON ÖLÇÜM ═════════════════════════════════════════════
  baslik("son · geri alma ve ölçüm");
  if (yaziliDeger !== null) {
    await supabaseAdmin
      .from("tenant_mevzuat")
      .update({
        kural_seti: ayarOnce.kural_seti,
        surus_tahmini: ayarOnce.surus_tahmini,
        kademe_erken_dk: ayarOnce.kademe_erken_dk,
        kademe_yaklasti_dk: ayarOnce.kademe_yaklasti_dk,
        kademe_son_dk: ayarOnce.kademe_son_dk,
      })
      .eq("id", "singleton");
    console.log("     ⚠ uç geri alamadı, ayar elle geri kondu");
  }
  const ayarSonra = (
    await supabaseAdmin.from("tenant_mevzuat").select("*").eq("id", "singleton").maybeSingle()
  ).data;
  const { count: defterSonra } = await supabaseAdmin
    .from("mevzuat_uyarilari")
    .select("id", { count: "exact", head: true });

  const ALANLAR = [
    "kural_seti",
    "surus_tahmini",
    "kademe_erken_dk",
    "kademe_yaklasti_dk",
    "kademe_son_dk",
  ];
  iddia(
    "tenant_mevzuat beş alanıyla TUR ÖNCESİ hâlinde",
    ALANLAR.every((a) => ayarSonra?.[a] === ayarOnce[a]),
    ALANLAR.map((a) => `${a}=${ayarSonra?.[a]}`).join(" · ")
  );
  iddia(
    "🔴 uyarı defterine TEK SATIR yazılmadı",
    defterSonra === defterOnce,
    `${defterOnce} → ${defterSonra}`
  );

  console.log(`\n╔══ SONUÇ ═══════════════════════════════════════════════════════════`);
  console.log(`║ ${gecti}/${gecti + dusen} iddia geçti · ${dusen} düştü`);
  console.log(`╚════════════════════════════════════════════════════════════════════\n`);
  process.exit(dusen > 0 ? 1 : 0);
}
