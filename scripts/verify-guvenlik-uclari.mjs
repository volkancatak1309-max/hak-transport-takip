#!/usr/bin/env node
/**
 * GÜVENLİK UÇLARI — CANLI DEMO TURU (yalnız galzura-demo).
 *
 * ═══ İKİ MOD, BAYRAKTAN TÜRER ═══
 *
 * Betik `SECURITY_LAYER_ENABLED`e bakıp turu kendisi seçer:
 *
 *   KAPALI  → altı ucun altısı da `{katman:"kapali", veri:null}` dönmeli.
 *             Bu, HAK61/Sendigo'daki gerçek hâlin birebir provası: o
 *             kiracılarda bayrak tanımsız ve 045-048 hiç koşmadı.
 *   AÇIK    → tam tur: oturum listesi, kesme, onay kararı, erişim yaması,
 *             anahtar (YALNIZ yanlış cevap) ve denetim izi.
 *
 * Kullanım:
 *   # kapalı katman provası (yerel env'de bayrak yok)
 *   ENV_FILE=.env.galzura-demo node --import ./scripts/ts-server.mjs \
 *     scripts/verify-guvenlik-uclari.mjs
 *
 *   # açık katman turu (üretimdeki demo ayarının aynısı)
 *   SECURITY_LAYER_ENABLED=true ACCESS_GATES_ENABLED=true \
 *     ENV_FILE=.env.galzura-demo node --import ./scripts/ts-server.mjs \
 *     scripts/verify-guvenlik-uclari.mjs
 *
 * ═══ 🔴 ANAHTAR ÇEKİLMEZ ═══
 * Tur anahtarı ASLA aktive etmez. Yalnız (a) yanlış onay metni ve (b) BİR
 * yanlış gizli cevap denenir. (b) bir hakkı yakar (3 → 2) ve bu kalıcıdır;
 * sayı tur sonunda basılır. Üç yanlış 24 saat kilitler, o yüzden tek deneme.
 *
 * ═══ YAZILAN HER ŞEY GERİ ALINIR ═══
 * Geçici oturum satırı, geçici cihaz onayı ve Test Şoför'ün sayaçları tur
 * sonunda tur öncesi hâline döner. `audit_log` satırları KALIR ve kalmalıdır:
 * gerçekleşmiş bir eylemin izi silinemez (045 kuralı).
 */
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
    `✗ DURDURULDU — hedef galzura-demo DEĞİL.\n  Beklenen: ${DEMO_REF}\n  Gelen:    ${url}\n` +
      `  HAK61 ve Sendigo CANLI MÜŞTERİ; bu betik oralarda ASLA koşmaz.`
  );
  process.exit(1);
}

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
const DURUM = await import("@/app/api/mobile/guvenlik/route.ts");
const OTURUMLAR = await import("@/app/api/mobile/guvenlik/oturumlar/route.ts");
const KES = await import("@/app/api/mobile/guvenlik/oturumlar/[id]/kes/route.ts");
const ONAYLAR = await import("@/app/api/mobile/guvenlik/onaylar/route.ts");
const ONAY_ID = await import("@/app/api/mobile/guvenlik/onaylar/[id]/route.ts");
const ERISIM = await import("@/app/api/mobile/guvenlik/erisim/[workerId]/route.ts");
const ANAHTAR = await import("@/app/api/mobile/guvenlik/kill-switch/route.ts");
const DENETIM = await import("@/app/api/mobile/guvenlik/denetim/route.ts");
const { issueAccessToken, readTokenVersion } = await import("@/lib/mobile-auth");
const { SECURITY_LAYER_ENABLED, ACCESS_GATES_ENABLED } = await import("@/lib/tenant");

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
const par = (o) => ({ params: Promise.resolve(o) });

console.log(`\n╔══ GÜVENLİK UÇLARI · CANLI DEMO TURU (galzura-demo) ════════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ hedef   ${url}`);
console.log(`║ bayrak  SECURITY_LAYER_ENABLED=${SECURITY_LAYER_ENABLED} · ACCESS_GATES_ENABLED=${ACCESS_GATES_ENABLED}`);
console.log(`║ mod     ${SECURITY_LAYER_ENABLED ? "AÇIK KATMAN — tam tur" : "KAPALI KATMAN — HAK61/Sendigo provası"}`);
console.log(`╚════════════════════════════════════════════════════════════════════`);

const TEST_SOFOR = "5c9d9739-6b80-4c1f-b61b-d53eedf7802a"; // "Test Şoför", is_test
const temizlik = { oturumId: null, onayId: null, sayacGeri: null, saatGeri: false, muafGeri: false };

try {
  // ══ 1 · JETONSUZ ════════════════════════════════════════════════════════
  baslik("1 · jetonsuz → 401");
  const jetonsuz = [
    ["GET /guvenlik", () => DURUM.GET(istek("/api/mobile/guvenlik"))],
    ["GET /oturumlar", () => OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar"))],
    ["GET /onaylar", () => ONAYLAR.GET(istek("/api/mobile/guvenlik/onaylar"))],
    ["GET /denetim", () => DENETIM.GET(istek("/api/mobile/guvenlik/denetim"))],
    ["POST /kill-switch", () => ANAHTAR.POST(istek("/api/mobile/guvenlik/kill-switch", { method: "POST", govde: {} }))],
    [
      "GET /erisim/[id]",
      () => ERISIM.GET(istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`), par({ workerId: TEST_SOFOR })),
    ],
  ];
  for (const [ad, fn] of jetonsuz) {
    const r = await cevap(await fn());
    iddia(`${ad} → 401`, r.kod === 401, `${r.kod} ${r.govde?.error}`);
  }

  // ══ 2 · GERÇEK GİRİŞ ════════════════════════════════════════════════════
  baslik("2 · gerçek giriş (telefon + PIN)");
  const giris = await cevap(
    await LOGIN(istek("/api/mobile/auth/login", { method: "POST", govde: { phone: TEL, pin: PIN } }))
  );
  iddia("POST /auth/login → 200", giris.kod === 200, `${giris.kod} rol=${giris.govde?.user?.rol}`);
  const jeton = giris.govde?.accessToken;
  const benId = giris.govde?.user?.id;
  if (!jeton) {
    console.error("✗ DURDURULDU — jeton alınamadı.");
    process.exit(1);
  }
  const { data: benSatir } = await supabaseAdmin
    .from("workers")
    .select("is_owner")
    .eq("id", benId)
    .maybeSingle();
  iddia("hesap is_owner", benSatir?.is_owner === true, `is_owner=${benSatir?.is_owner}`);

  // ══ 3 · ROL KAPILARI ════════════════════════════════════════════════════
  baslik("3 · rol kapıları");
  const tvSofor = await readTokenVersion(TEST_SOFOR);
  const { accessToken: soforJeton } = await issueAccessToken(
    TEST_SOFOR,
    false,
    tvSofor.status === "ok" ? tvSofor.value : 0
  );
  const sofGet = await cevap(await DURUM.GET(istek("/api/mobile/guvenlik", { token: soforJeton })));
  /**
   * 🔑 ERİŞİM KAPILARI AÇIKKEN REDDİ AUTH KATMANI VERİR, BİZİM KAPIMIZ DEĞİL.
   *
   * İlk koşumda bu iddia `admin_required` bekliyordu ve `gate_hours` geldi:
   * `verifyMobileRequest` her mobil istekte dört kapıyı değerlendiriyor ve
   * saat penceresi (07:00–21:00 Europe/Istanbul) dışındaki şoförü daha kapıya
   * gelmeden reddediyor. İkisi de 403 ve ikisinde de VERİ YOK — önemli olan bu.
   * Hangi kapının çalıştığı kanıta yazılıyor; `admin_required` beklemek,
   * ürünün kendi tasarımını kusur sanmak olurdu.
   */
  iddia(
    "ŞOFÖR → 403 (veri yok; hangi kapı olduğu kanıtta)",
    sofGet.kod === 403 && !sofGet.govde?.katman && !sofGet.govde?.satirlar,
    `${sofGet.kod} ${sofGet.govde?.error}`
  );

  const { data: yoneticiler } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("is_admin", true)
    .eq("is_owner", false)
    .eq("is_active", true)
    .limit(1);
  const yon = yoneticiler?.[0];
  if (!yon) {
    iddia("owner olmayan yönetici bulundu", false, "demo'da yok");
  } else {
    const tvY = await readTokenVersion(yon.id);
    const { accessToken: yonJeton } = await issueAccessToken(yon.id, true, tvY.status === "ok" ? tvY.value : 0);
    const yGet = await cevap(await DURUM.GET(istek("/api/mobile/guvenlik", { token: yonJeton })));
    if (SECURITY_LAYER_ENABLED) {
      iddia(
        "YÖNETİCİ (owner değil) → 403 owner_required",
        yGet.kod === 403 && yGet.govde?.error === "owner_required",
        `${yGet.kod} ${yGet.govde?.error}`
      );
    } else {
      iddia(
        "YÖNETİCİ (owner değil) → 200 {katman:kapali} (403 DEĞİL)",
        yGet.kod === 200 && yGet.govde?.katman === "kapali",
        `${yGet.kod} katman=${yGet.govde?.katman}`
      );
    }
  }

  // ══ 4 · KATMAN KAPALI PROVASI ═══════════════════════════════════════════
  if (!SECURITY_LAYER_ENABLED) {
    baslik("4 · KATMAN KAPALI — altı ucun altısı da dürüst cevap veriyor");
    const kapaliTur = [
      ["GET /guvenlik", () => DURUM.GET(istek("/api/mobile/guvenlik", { token: jeton }))],
      ["GET /oturumlar", () => OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar", { token: jeton }))],
      ["GET /onaylar", () => ONAYLAR.GET(istek("/api/mobile/guvenlik/onaylar", { token: jeton }))],
      ["GET /denetim", () => DENETIM.GET(istek("/api/mobile/guvenlik/denetim", { token: jeton }))],
      [
        "GET /erisim/[id]",
        () =>
          ERISIM.GET(istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, { token: jeton }), par({ workerId: TEST_SOFOR })),
      ],
      [
        "POST /kill-switch",
        () =>
          ANAHTAR.POST(
            istek("/api/mobile/guvenlik/kill-switch", { token: jeton, method: "POST", govde: { islem: "kapa" } })
          ),
      ],
      [
        "POST /oturumlar/[id]/kes",
        () =>
          KES.POST(
            istek("/api/mobile/guvenlik/oturumlar/x/kes", { token: jeton, method: "POST", govde: { kapsam: "hepsi" } }),
            par({ id: "00000000-0000-0000-0000-000000000000" })
          ),
      ],
      [
        "POST /onaylar/[id]",
        () =>
          ONAY_ID.POST(
            istek("/api/mobile/guvenlik/onaylar/x", { token: jeton, method: "POST", govde: { karar: "ret" } }),
            par({ id: "00000000-0000-0000-0000-000000000000" })
          ),
      ],
    ];
    for (const [ad, fn] of kapaliTur) {
      const r = await cevap(await fn());
      iddia(
        `${ad} → 200 {katman:"kapali", veri:null}`,
        r.kod === 200 && r.govde?.katman === "kapali" && r.govde?.veri === null,
        `${r.kod} katman=${r.govde?.katman} veri=${JSON.stringify(r.govde?.veri)} bayrak=${r.govde?.bayrak}`
      );
    }
    iddia(
      "boş liste DÖNMÜYOR (satirlar alanı hiç yok)",
      !(await cevap(await OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar", { token: jeton })))).govde?.satirlar,
      "sessiz boş liste yasağı"
    );
    console.log("\n  ⓘ Tam tur için bayrakları açın (başlıktaki kullanım notuna bakın).");
  } else {
    // ══ 5 · DURUM PANOSU ══════════════════════════════════════════════════
    baslik("4 · GET /guvenlik — durum panosu");
    const d = await cevap(await DURUM.GET(istek("/api/mobile/guvenlik", { token: jeton })));
    iddia("GET → 200", d.kod === 200, `${d.kod}`);
    const g = d.govde ?? {};
    iddia("katman açık", g.katman === "acik", `katman=${g.katman} kapilar=${g.kapilar}`);
    iddia(
      "erişim kapıları raporlanıyor",
      g.kapilar_detay !== null && typeof g.kapilar_detay === "object",
      `saat=${g.kapilar_detay?.varsayilanSaat} (${g.kapilar_detay?.varsayilanSaatDilimi}) · ülke=${JSON.stringify(g.kapilar_detay?.varsayilanUlkeler)}`
    );
    iddia(
      "anahtar durumu geldi",
      g.anahtar !== null && typeof g.anahtar?.aktif === "boolean",
      `aktif=${g.anahtar?.aktif} · kalanHak=${g.anahtar?.kalanHak} · sirVar=${g.anahtar?.sirVar} · sirVarsayilan=${g.anahtar?.sirVarsayilan}`
    );
    iddia("🔴 anahtar ÇEKİLİ DEĞİL (sistem açık)", g.anahtar?.aktif === false, `aktif=${g.anahtar?.aktif}`);
    iddia(
      "bekleyen onay sayıları",
      g.bekleyen !== null,
      `cihaz=${g.bekleyen?.cihaz} · ülke=${g.bekleyen?.ulke}`
    );
    iddia(
      "son 24 sa ÖLÇÜLDÜ (null değil)",
      typeof g.son24Saat?.giris === "number",
      `giriş=${g.son24Saat?.giris} · iz=${g.son24Saat?.izSatiri}`
    );
    iddia(
      "kadro özeti",
      typeof g.kadro?.patron === "number",
      `toplam=${g.kadro?.toplam} · patron=${g.kadro?.patron} · yönetici=${g.kadro?.yonetici} · donmuş=${g.kadro?.donmus}`
    );

    // ══ 6 · OTURUMLAR ═════════════════════════════════════════════════════
    baslik("5 · GET /oturumlar");
    const o1 = await cevap(await OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar?sayfa=1&limit=5", { token: jeton })));
    iddia(
      "?sayfa=1&limit=5 → 200",
      o1.kod === 200 && o1.govde?.satirlar?.length <= 5,
      `${o1.kod} · ${o1.govde?.satirlar?.length} satır · toplam=${o1.govde?.page?.toplam} · sonSayfa=${o1.govde?.page?.sonSayfa}`
    );
    iddia(
      "satır kim/ne zaman/cihaz/şehir/açık alanlarını taşıyor",
      o1.govde?.satirlar?.[0] &&
        "sofor" in o1.govde.satirlar[0] &&
        "basladi" in o1.govde.satirlar[0] &&
        "cihaz" in o1.govde.satirlar[0] &&
        "sehir" in o1.govde.satirlar[0] &&
        "acik" in o1.govde.satirlar[0] &&
        "canli" in o1.govde.satirlar[0],
      o1.govde?.satirlar?.[0]
        ? `örnek: ${o1.govde.satirlar[0].sofor} · ${o1.govde.satirlar[0].ulke}/${o1.govde.satirlar[0].sehir} · açık=${o1.govde.satirlar[0].acik} · canlı=${o1.govde.satirlar[0].canli}`
        : "—"
    );
    const o2 = await cevap(await OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar?sayfa=2&limit=5", { token: jeton })));
    iddia(
      "?sayfa=2 farklı satır getiriyor",
      o2.kod === 200 && o2.govde?.satirlar?.[0]?.id !== o1.govde?.satirlar?.[0]?.id,
      `sayfa2 offset=${o2.govde?.page?.offset}`
    );
    const oAcik = await cevap(await OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar?acik=1", { token: jeton })));
    iddia(
      "?acik=1 yalnız açıkları getiriyor",
      oAcik.kod === 200 && (oAcik.govde?.satirlar ?? []).every((s) => s.acik === true),
      `${oAcik.govde?.page?.toplam} açık`
    );
    const oKotu = await cevap(
      await OTURUMLAR.GET(istek("/api/mobile/guvenlik/oturumlar?sayfa=1&offset=0", { token: jeton }))
    );
    iddia(
      "?sayfa ve ?offset birlikte → 400",
      oKotu.kod === 400 && oKotu.govde?.sebep === "sayfa_ve_offset_birlikte",
      `${oKotu.kod} ${oKotu.govde?.sebep}`
    );

    // ══ 7 · OTURUM KESME (geçici kayıt → işlem → geri al) ═════════════════
    baslik("6 · POST /oturumlar/[id]/kes — geçici kayıt üzerinde");
    const { data: sayacOnce } = await supabaseAdmin
      .from("workers")
      .select("session_version, token_version")
      .eq("id", TEST_SOFOR)
      .maybeSingle();
    temizlik.sayacGeri = sayacOnce;

    const { data: yeniOturum, error: oturumHata } = await supabaseAdmin
      .from("login_sessions")
      .insert({
        worker_id: TEST_SOFOR,
        source: "mobile",
        ip: "198.51.100.42",
        user_agent: "qa-guvenlik-turu",
        device_hash: "qa-test-cihaz",
        city: "QA",
        country: "TR",
      })
      .select("id")
      .single();
    iddia("geçici oturum satırı açıldı", !oturumHata && !!yeniOturum?.id, oturumHata?.message ?? "ok");
    temizlik.oturumId = yeniOturum?.id ?? null;

    if (temizlik.oturumId) {
      const kKotu = await cevap(
        await KES.POST(
          istek(`/api/mobile/guvenlik/oturumlar/${temizlik.oturumId}/kes`, {
            token: jeton,
            method: "POST",
            govde: { kapsam: "bu_oturum" },
          }),
          par({ id: temizlik.oturumId })
        )
      );
      iddia(
        "🔴 {kapsam:'bu_oturum'} → 400 tek_oturum_kesilemez",
        kKotu.kod === 400 && kKotu.govde?.sebep === "tek_oturum_kesilemez",
        `${kKotu.kod} ${kKotu.govde?.sebep}`
      );

      const kes = await cevap(
        await KES.POST(
          istek(`/api/mobile/guvenlik/oturumlar/${temizlik.oturumId}/kes`, {
            token: jeton,
            method: "POST",
            govde: { kapsam: "hepsi" },
          }),
          par({ id: temizlik.oturumId })
        )
      );
      iddia(
        "{kapsam:'hepsi'} → 200",
        kes.kod === 200,
        `${kes.kod} · açık ${kes.govde?.acikOturum?.once} → ${kes.govde?.acikOturum?.sonra} · sv=${kes.govde?.sessionVersion}`
      );
      const { data: sayacSonra } = await supabaseAdmin
        .from("workers")
        .select("session_version, token_version")
        .eq("id", TEST_SOFOR)
        .maybeSingle();
      iddia(
        "🔑 session_version ARTTI (web çerezleri öldü)",
        (sayacSonra?.session_version ?? 0) === (sayacOnce?.session_version ?? 0) + 1,
        `${sayacOnce?.session_version} → ${sayacSonra?.session_version}`
      );
      iddia(
        "🔑 token_version ARTTI (mobil jetonlar öldü)",
        (sayacSonra?.token_version ?? 0) === (sayacOnce?.token_version ?? 0) + 1,
        `${sayacOnce?.token_version} → ${sayacSonra?.token_version}`
      );
      const { data: kapandi } = await supabaseAdmin
        .from("login_sessions")
        .select("ended_at, ended_reason")
        .eq("id", temizlik.oturumId)
        .maybeSingle();
      iddia(
        "oturum satırı 'revoked' ile kapandı",
        kapandi?.ended_at !== null && kapandi?.ended_reason === "revoked",
        `sebep=${kapandi?.ended_reason}`
      );

      const kendi = await cevap(
        await KES.POST(
          istek("/api/mobile/guvenlik/oturumlar/x/kes", { token: jeton, method: "POST", govde: { kapsam: "hepsi" } }),
          par({ id: "00000000-0000-0000-0000-000000000000" })
        )
      );
      iddia("olmayan oturum → 404", kendi.kod === 404, `${kendi.kod} ${kendi.govde?.error}`);
    }

    // ══ 8 · ONAYLAR ═══════════════════════════════════════════════════════
    baslik("7 · onaylar — geçici cihaz onayı → ret → geri al");
    const on0 = await cevap(await ONAYLAR.GET(istek("/api/mobile/guvenlik/onaylar", { token: jeton })));
    iddia(
      "GET /onaylar → 200",
      on0.kod === 200,
      `${on0.kod} · cihaz=${on0.govde?.toplam?.cihaz} · ülke=${on0.govde?.toplam?.ulke} · tavan=${on0.govde?.tavan}`
    );

    const { data: yeniOnay, error: onayHata } = await supabaseAdmin
      .from("device_approvals")
      .insert({
        worker_id: TEST_SOFOR,
        device_hash: "qa-guvenlik-turu-cihaz",
        status: "pending",
        first_ip: "198.51.100.42",
        first_city: "QA",
        first_country: "TR",
        user_agent: "qa-guvenlik-turu",
      })
      .select("id")
      .single();
    iddia("geçici cihaz onayı açıldı", !onayHata && !!yeniOnay?.id, onayHata?.message ?? "ok");
    temizlik.onayId = yeniOnay?.id ?? null;

    if (temizlik.onayId) {
      const on1 = await cevap(await ONAYLAR.GET(istek("/api/mobile/guvenlik/onaylar", { token: jeton })));
      iddia(
        "listede görünüyor",
        (on1.govde?.cihaz ?? []).some((c) => c.id === temizlik.onayId),
        `cihaz=${on1.govde?.toplam?.cihaz}`
      );
      const kar = await cevap(
        await ONAY_ID.POST(
          istek(`/api/mobile/guvenlik/onaylar/${temizlik.onayId}`, {
            token: jeton,
            method: "POST",
            govde: { karar: "ret" },
          }),
          par({ id: temizlik.onayId })
        )
      );
      iddia(
        "{karar:'ret'} → 200 (tür otomatik çözüldü)",
        kar.kod === 200 && kar.govde?.tur === "cihaz" && kar.govde?.yeniDurum === "denied",
        `${kar.kod} tur=${kar.govde?.tur} durum=${kar.govde?.yeniDurum}`
      );
      const { data: onaySonra } = await supabaseAdmin
        .from("device_approvals")
        .select("status, decided_by")
        .eq("id", temizlik.onayId)
        .maybeSingle();
      iddia(
        "DB'de denied + karar veren yazıldı",
        onaySonra?.status === "denied" && onaySonra?.decided_by === benId,
        `durum=${onaySonra?.status}`
      );
      const kar2 = await cevap(
        await ONAY_ID.POST(
          istek(`/api/mobile/guvenlik/onaylar/${temizlik.onayId}`, {
            token: jeton,
            method: "POST",
            govde: { karar: "onay" },
          }),
          par({ id: temizlik.onayId })
        )
      );
      iddia(
        "ikinci karar → 409 zaten_karara_baglandi",
        kar2.kod === 409 && kar2.govde?.error === "zaten_karara_baglandi",
        `${kar2.kod} mevcut=${kar2.govde?.mevcutDurum}`
      );
      const kar3 = await cevap(
        await ONAY_ID.POST(
          istek("/api/mobile/guvenlik/onaylar/x", { token: jeton, method: "POST", govde: { karar: "yok" } }),
          par({ id: temizlik.onayId })
        )
      );
      iddia("geçersiz karar → 400", kar3.kod === 400 && kar3.govde?.alan === "karar", `${kar3.kod}`);
    }

    // ══ 9 · ERİŞİM ════════════════════════════════════════════════════════
    baslik("8 · erişim kuralı — yaz, doğrula, geri al");
    const e0 = await cevap(
      await ERISIM.GET(istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, { token: jeton }), par({ workerId: TEST_SOFOR }))
    );
    iddia(
      "GET → 200",
      e0.kod === 200,
      `${e0.kod} · saat=${e0.govde?.saatler?.etkin} · ülke=${JSON.stringify(e0.govde?.ulkeler?.etkin)} · muaf=${e0.govde?.muafiyet?.muaf}`
    );
    iddia(
      "ülke SALT OKUNUR olduğu gövdede",
      e0.govde?.ulkeler?.yazilabilir === false,
      `sebep=${e0.govde?.ulkeler?.yazilamazSebep}`
    );
    iddia(
      "muafiyet anahtarı GEÇMEZ bilgisi gövdede",
      e0.govde?.muafiyet?.anahtariGecer === false,
      `kapsam=${JSON.stringify(e0.govde?.muafiyet?.kapsam)}`
    );

    const eYaz = await cevap(
      await ERISIM.PATCH(
        istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, {
          token: jeton,
          method: "PATCH",
          govde: { saatler: { bas: "08:00", bit: "18:00" }, muaf: true },
        }),
        par({ workerId: TEST_SOFOR })
      )
    );
    iddia(
      "PATCH saat + muafiyet → 200",
      eYaz.kod === 200 && eYaz.govde?.sonra?.saatler?.bas === "08:00" && eYaz.govde?.sonra?.muafiyet?.muaf === true,
      `${eYaz.kod} · ${eYaz.govde?.once?.saatler?.etkin} → ${eYaz.govde?.sonra?.saatler?.etkin} · muaf ${eYaz.govde?.once?.muafiyet?.muaf} → ${eYaz.govde?.sonra?.muafiyet?.muaf}`
    );
    temizlik.saatGeri = true;
    temizlik.muafGeri = true;

    const eTekUc = await cevap(
      await ERISIM.PATCH(
        istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, {
          token: jeton,
          method: "PATCH",
          govde: { saatler: { bas: "08:00" } },
        }),
        par({ workerId: TEST_SOFOR })
      )
    );
    iddia(
      "tek uç → 400 tek_uc",
      eTekUc.kod === 400 && eTekUc.govde?.sebep === "tek_uc",
      `${eTekUc.kod} ${eTekUc.govde?.sebep}`
    );
    const eBicim = await cevap(
      await ERISIM.PATCH(
        istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, {
          token: jeton,
          method: "PATCH",
          govde: { saatler: { bas: "25:00", bit: "18:00" } },
        }),
        par({ workerId: TEST_SOFOR })
      )
    );
    iddia("25:00 → 400 bicim", eBicim.kod === 400 && eBicim.govde?.sebep === "bicim", `${eBicim.kod}`);
    const eUlke = await cevap(
      await ERISIM.PATCH(
        istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, {
          token: jeton,
          method: "PATCH",
          govde: { ulkeler: ["TR"] },
        }),
        par({ workerId: TEST_SOFOR })
      )
    );
    iddia(
      "🔴 {ulkeler} → 400 ulke_yazma_yolu_yok",
      eUlke.kod === 400 && eUlke.govde?.sebep === "ulke_yazma_yolu_yok",
      `${eUlke.kod} ${eUlke.govde?.sebep}`
    );

    const eGeri = await cevap(
      await ERISIM.PATCH(
        istek(`/api/mobile/guvenlik/erisim/${TEST_SOFOR}`, {
          token: jeton,
          method: "PATCH",
          govde: { saatler: null, muaf: false },
        }),
        par({ workerId: TEST_SOFOR })
      )
    );
    iddia(
      "geri al (saatler:null + muaf:false) → 200",
      eGeri.kod === 200 && eGeri.govde?.sonra?.saatler?.bas === null && eGeri.govde?.sonra?.muafiyet?.muaf === false,
      `${eGeri.kod} · etkin=${eGeri.govde?.sonra?.saatler?.etkin}`
    );
    if (eGeri.kod === 200) {
      temizlik.saatGeri = false;
      temizlik.muafGeri = false;
    }

    // ══ 10 · ANAHTAR — YALNIZ YANLIŞ CEVAP ════════════════════════════════
    baslik("9 · ölü adam anahtarı — SADECE yanlış cevap (AÇILMAZ)");
    const { getKillSwitchState } = await import("@/lib/kill-switch");
    const aOnce = await getKillSwitchState();

    const aKapa = await cevap(
      await ANAHTAR.POST(
        istek("/api/mobile/guvenlik/kill-switch", { token: jeton, method: "POST", govde: { islem: "kapa" } })
      )
    );
    iddia(
      "{islem:'kapa'} anahtar çekili değilken → 409",
      aKapa.kod === 409 && aKapa.govde?.error === "zaten_kapali",
      `${aKapa.kod} sistem=${aKapa.govde?.sistemDurumu}`
    );
    const aBosCevap = await cevap(
      await ANAHTAR.POST(
        istek("/api/mobile/guvenlik/kill-switch", {
          token: jeton,
          method: "POST",
          govde: { islem: "ac", onay: "ONAYLIYORUM" },
        })
      )
    );
    iddia(
      "boş cevap → 400 (HAK YAKMAZ)",
      aBosCevap.kod === 400 && aBosCevap.govde?.alan === "cevap",
      `${aBosCevap.kod} · soru="${aBosCevap.govde?.soru}" · kalanHak=${aBosCevap.govde?.kalanHak}`
    );
    const aYanlisOnay = await cevap(
      await ANAHTAR.POST(
        istek("/api/mobile/guvenlik/kill-switch", {
          token: jeton,
          method: "POST",
          govde: { islem: "ac", onay: "olur", cevap: "x" },
        })
      )
    );
    iddia(
      "yanlış onay metni → 403 confirm_mismatch (gizli soru HİÇ denenmez)",
      aYanlisOnay.kod === 403 && aYanlisOnay.govde?.error === "confirm_mismatch",
      `${aYanlisOnay.kod} kalanHak=${aYanlisOnay.govde?.kalanHak}`
    );
    const aOrta = await getKillSwitchState();
    iddia(
      "yanlış onaydan sonra hak DEĞİŞMEDİ",
      aOrta.kalanHak === aOnce.kalanHak,
      `${aOnce.kalanHak} → ${aOrta.kalanHak}`
    );

    /**
     * 🔴 YANLIŞ CEVAP DENEMESİ YALNIZ HAK TAMKEN YAPILIR.
     *
     * Her yanlış cevap bir hakkı KALICI olarak yakar ve üçüncüsü anahtarı
     * 24 saat kilitler. Tur tekrar tekrar koşulabilir olmalı ama bir QA
     * koşumu üretimdeki bir güvenlik mekanizmasını kilitleyemez. Bu yüzden
     * deneme yalnız `kalanHak` tamken (3) yapılır; daha azsa ATLANIR ve
     * sebebi basılır. Ölçüm bir kez alınır, kilit riski sıfır kalır.
     */
    if (aOnce.kalanHak < 3) {
      console.log(
        `  ⊘ ATLANDI    yanlış cevap denemesi — kalanHak=${aOnce.kalanHak} (< 3). ` +
          `Her deneme bir hak yakar, üçüncüsü 24 saat kilitler; QA kilit üretmez.`
      );
      iddia(
        "anahtar yine de ÇEKİLİ DEĞİL",
        aOnce.active === false,
        `aktif=${aOnce.active} · kalanHak=${aOnce.kalanHak}`
      );
    } else {
      const aYanlis = await cevap(
        await ANAHTAR.POST(
          istek("/api/mobile/guvenlik/kill-switch", {
            token: jeton,
            method: "POST",
            govde: { islem: "ac", onay: "ONAYLIYORUM", cevap: "qa-yanlis-cevap-" + benId.slice(0, 6) },
          })
        )
      );
      iddia(
        "🔴 doğru onay + YANLIŞ cevap → 403 wrong_answer",
        aYanlis.kod === 403 && aYanlis.govde?.error === "wrong_answer",
        `${aYanlis.kod} kalanHak=${aYanlis.govde?.kalanHak}`
      );
      const aY = await getKillSwitchState();
      iddia("bir hak yakıldı (beklenen)", aY.kalanHak === aOnce.kalanHak - 1, `${aOnce.kalanHak} → ${aY.kalanHak}`);
      iddia("kilit AÇILMADI", aY.lockedUntil === null, `kilit=${aY.lockedUntil}`);
    }
    const aSonra = await getKillSwitchState();
    iddia("🔴 ANAHTAR ÇEKİLMEDİ — sistem açık", aSonra.active === false, `aktif=${aSonra.active}`);
    const { count: acikAnahtar } = await supabaseAdmin
      .from("kill_switch")
      .select("id", { count: "exact", head: true })
      .is("deactivated_at", null);
    iddia("kill_switch tablosunda açık kayıt YOK", acikAnahtar === 0, `${acikAnahtar} satır`);

    const aKotu = await cevap(
      await ANAHTAR.POST(
        istek("/api/mobile/guvenlik/kill-switch", { token: jeton, method: "POST", govde: { islem: "baska" } })
      )
    );
    iddia("geçersiz islem → 400", aKotu.kod === 400 && aKotu.govde?.alan === "islem", `${aKotu.kod}`);

    // ══ 11 · DENETİM ══════════════════════════════════════════════════════
    baslik("10 · GET /denetim");
    const dn = await cevap(await DENETIM.GET(istek("/api/mobile/guvenlik/denetim?sayfa=1&limit=5", { token: jeton })));
    iddia(
      "?sayfa=1&limit=5 → 200",
      dn.kod === 200 && dn.govde?.satirlar?.length <= 5,
      `${dn.kod} · ${dn.govde?.satirlar?.length} satır · toplam=${dn.govde?.page?.toplam}`
    );
    iddia(
      "🔴 yalnız audit_log olduğu SÖYLENİYOR",
      dn.govde?.birlesikDegil === true && Array.isArray(dn.govde?.disaridaKalanKaynaklar),
      `dışarıda: ${dn.govde?.disaridaKalanKaynaklar?.join(", ")}`
    );
    const dnF = await cevap(
      await DENETIM.GET(istek("/api/mobile/guvenlik/denetim?islem=access_deny&limit=5", { token: jeton }))
    );
    iddia(
      "?islem=access_deny süzüyor",
      dnF.kod === 200 && (dnF.govde?.satirlar ?? []).every((r) => r.islem === "access_deny"),
      `${dnF.govde?.page?.toplam} satır`
    );
    iddia(
      "🔑 bu turun kararı ize DÜŞTÜ",
      (dnF.govde?.page?.toplam ?? 0) > 0,
      `access_deny toplam=${dnF.govde?.page?.toplam}`
    );
    const dnKotu = await cevap(
      await DENETIM.GET(istek("/api/mobile/guvenlik/denetim?islem=Access%20Deny", { token: jeton }))
    );
    iddia("geçersiz ?islem biçimi → 400", dnKotu.kod === 400, `${dnKotu.kod} ${dnKotu.govde?.alan}`);
  }
} finally {
  // ══ GERİ ALMA ═══════════════════════════════════════════════════════════
  baslik("son · geri alma");
  if (temizlik.onayId) {
    await supabaseAdmin.from("device_approvals").delete().eq("id", temizlik.onayId);
    const { count } = await supabaseAdmin
      .from("device_approvals")
      .select("id", { count: "exact", head: true })
      .eq("id", temizlik.onayId);
    iddia("geçici cihaz onayı silindi", count === 0, `${count} satır kaldı`);
  }
  if (temizlik.oturumId) {
    await supabaseAdmin.from("login_sessions").delete().eq("id", temizlik.oturumId);
    const { count } = await supabaseAdmin
      .from("login_sessions")
      .select("id", { count: "exact", head: true })
      .eq("id", temizlik.oturumId);
    iddia("geçici oturum satırı silindi", count === 0, `${count} satır kaldı`);
  }
  if (temizlik.sayacGeri) {
    await supabaseAdmin
      .from("workers")
      .update({
        session_version: temizlik.sayacGeri.session_version,
        token_version: temizlik.sayacGeri.token_version,
      })
      .eq("id", TEST_SOFOR);
    const { data: son } = await supabaseAdmin
      .from("workers")
      .select("session_version, token_version, access_hours_start, access_hours_end, gate_exempt")
      .eq("id", TEST_SOFOR)
      .maybeSingle();
    iddia(
      "Test Şoför sayaçları tur öncesi hâlinde",
      son?.session_version === temizlik.sayacGeri.session_version &&
        son?.token_version === temizlik.sayacGeri.token_version,
      `sv=${son?.session_version} tv=${son?.token_version}`
    );
    iddia(
      "Test Şoför erişim kuralı tur öncesi hâlinde",
      son?.access_hours_start === null && son?.access_hours_end === null && son?.gate_exempt === false,
      `saat=${son?.access_hours_start}-${son?.access_hours_end} muaf=${son?.gate_exempt}`
    );
  }

  console.log(`\n╔══ SONUÇ ═══════════════════════════════════════════════════════════`);
  console.log(`║ ${gecti}/${gecti + dusen} iddia geçti · ${dusen} düştü`);
  console.log(`║ mod: ${SECURITY_LAYER_ENABLED ? "AÇIK KATMAN" : "KAPALI KATMAN"}`);
  console.log(`╚════════════════════════════════════════════════════════════════════\n`);
  process.exit(dusen > 0 ? 1 : 0);
}
