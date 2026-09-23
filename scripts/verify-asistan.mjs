#!/usr/bin/env node
/**
 * AI ASİSTAN — CANLI DEMO TURU (yalnız galzura-demo).
 *
 * ═══ NE ÖLÇÜYOR ═══
 *
 * Modelin kendisi DIŞINDAKİ her şeyi, gerçek veritabanına karşı:
 *
 *   1. jetonsuz → 401
 *   2. gerçek giriş (telefon + PIN) → jeton
 *   3. KAPI SIRASI — şoför 403 alır, kurulum durumunu ÖĞRENEMEZ; yönetici
 *      bayrak kapalıyken 503 `bayrak_kapali`, bayrak açıkken anahtarsız
 *      503 `anahtar_yok` alır (iki sebep AYRI)
 *   4. GÖVDE DOĞRULAMASI — boş/fazla/son-mesaj-asistan/geçersiz dil → 400
 *   5. HIZ SINIRI — 30 kredi düşer, 31. istek 429 · sayaç fail-closed
 *   6. 🔴 ARAÇ KATMANI: her aracın döndürdüğü sayı, ucun KENDİ yanıtındaki
 *      sayıyla BİREBİR aynı mı (asistan ikinci bir sayı üretmiyor mu)
 *   7. ROL KAPISI — filo şefi yönetici araçlarını LİSTEDE görmüyor ve
 *      çağırsa bile 403 alıyor; şoför asistana hiç giremiyor
 *   8. KAPSAM SUNUCUDAN — şefin araç sonucu kendi filosuna daraltılmış
 *
 * ═══ 🔴 GERÇEK API ANAHTARI KULLANILMAZ ═══
 *
 * Volkan anahtarı demo Vercel env'ine girene kadar yerelde GERÇEK anahtar
 * KOYULMUYOR. 4-5. adımlar, koda dokunmadan geçilemeyen kurulum kapısını
 * aşmak için AÇIKÇA GEÇERSİZ bir yer tutucu kullanır
 * (`sk-ant-GECERSIZ-YER-TUTUCU`): istek Anthropic'e gider, 401 ile döner ve
 * biz de akışın `saglayici_hatasi` olayını ölçeriz. Yani ölçtüğümüz şey
 * "model ne dedi" değil, "model çağrısına KADAR olan yolun tamamı çalışıyor
 * mu". Modelin kendi turu (10 gerçek soru + önbellek okuması) anahtar
 * girildikten SONRA ölçülecek.
 *
 * ═══ YAZILAN HER ŞEY GERİ ALINIR ═══
 * Tek yazılan şey `login_attempts` tablosundaki `asistan:<id>` sayaç
 * satırlarıdır; tur sonunda silinir. Başka hiçbir satıra dokunulmaz —
 * asistanın dokuz aracının dokuzu da salt okuma.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --import ./scripts/ts-server.mjs \
 *     scripts/verify-asistan.mjs
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
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
const HOST = "https://demo.galzura.com";

let dusen = 0;
let gecti = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (k) gecti++;
  else dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);

const { POST: LOGIN } = await import("@/app/api/mobile/auth/login/route.ts");
const ASISTAN = await import("@/app/api/mobile/asistan/route.ts");
const { issueAccessToken } = await import("@/lib/mobile-auth");
const { ARACLAR, araclarFor, aracSemalari } = await import("@/lib/asistan-araclar.ts");
const { hizKrediDus, asistanAnahtari, ASISTAN_SORU_TAVANI } = await import("@/lib/asistan-hiz.ts");
const { sistemIstemi } = await import("@/lib/asistan-istem.ts");
const { ASISTAN_ENABLED } = await import("@/lib/tenant");

const istek = (yol, { token, govde, method = "POST" } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`${HOST}${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
};

/** JSON hata cevabı (akış değil). */
const cevap = async (res) => {
  let govde = null;
  try {
    govde = await res.json();
  } catch {
    /* gövdesiz */
  }
  return { kod: res.status, govde, tip: res.headers.get("content-type") ?? "" };
};

/** SSE gövdesini olay listesine çevirir. */
async function olaylar(res) {
  const metin = await res.text();
  const cikti = [];
  for (const blok of metin.split("\n\n")) {
    const e = blok.match(/^event: (.+)$/m);
    const d = blok.match(/^data: (.+)$/m);
    if (!e) continue;
    let veri = null;
    try {
      veri = d ? JSON.parse(d[1]) : null;
    } catch {
      /* ham */
    }
    cikti.push({ olay: e[1], veri });
  }
  return cikti;
}

const SORGU = { asistan: "POST /api/mobile/asistan" };
const soru = (metin) => ({ mesajlar: [{ rol: "kullanici", metin }], dil: "tr" });

console.log(`\n╔══ AI ASİSTAN · CANLI DEMO TURU (galzura-demo) ═════════════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ hedef   ${url}`);
console.log(`║ bayrak  ASISTAN_ENABLED=${ASISTAN_ENABLED}`);
console.log(`║ anahtar ${process.env.ANTHROPIC_API_KEY ? "TANIMLI (yer tutucu olmalı)" : "YOK"}`);
console.log(`╚════════════════════════════════════════════════════════════════════`);

const temizlenecek = new Set();
/** Tur sonunda ESKİ hâline döndürülecek yazmalar. */
const geriAlinacak = { sef: null };

/**
 * ── GERİ ALMA GÜNLÜĞÜ ──────────────────────────────────────────────────────
 *
 * `finally` bloğu her zaman koşmaz: süreç öldürülürse (boru hattı kapanması,
 * Ctrl-C, OOM) yazdığımız satır demo'da KALIR. 23.09.2026'da tam olarak bu
 * oldu. Bu yüzden yazma DİSKE de not ediliyor; bir sonraki tur başlarken
 * dosya duruyorsa önce o geri alınır. Dosya depo dışında (OS temp) — depoya
 * durum yazmıyoruz.
 */
const GUNLUK = path.join(tmpdir(), "hak61-verify-asistan-geri-alma.json");
const gunlukYaz = (kayit) => writeFileSync(GUNLUK, JSON.stringify(kayit), "utf8");
const gunlukSil = () => {
  if (existsSync(GUNLUK)) rmSync(GUNLUK);
};

/** Geçici şefi ESKİ değerine döndürür ve OKUYARAK doğrular. İki kez çağrılabilir. */
async function sefiGeriAl() {
  const kayit = geriAlinacak.sef;
  if (!kayit) return;
  geriAlinacak.sef = null;
  await supabaseAdmin.from("workers").update({ managed_fleet: kayit.eski }).eq("id", kayit.id);
  // "ok:true bir ölçüm değildir" — geri alındığı OKUNARAK doğrulanıyor.
  const { data } = await supabaseAdmin
    .from("workers")
    .select("managed_fleet")
    .eq("id", kayit.id)
    .maybeSingle();
  const geri = data?.managed_fleet ?? null;
  console.log(
    `     (geçici şef geri alındı — managed_fleet=${JSON.stringify(geri)}, beklenen ${JSON.stringify(kayit.eski)})`
  );
  if (geri !== kayit.eski) {
    console.error(`✗ GERİ ALMA BAŞARISIZ — ${kayit.id} elle düzeltilmeli!`);
    process.exitCode = 1;
    return;
  }
  gunlukSil();
}

// ── ÖNCEKİ TURDAN KALAN VAR MI ────────────────────────────────────────────
if (existsSync(GUNLUK)) {
  const kayit = JSON.parse(readFileSync(GUNLUK, "utf8"));
  console.log(`⚠ önceki tur yarıda kalmış — geri alınıyor: ${kayit.id} → ${JSON.stringify(kayit.eski)}`);
  geriAlinacak.sef = kayit;
  await sefiGeriAl();
}

try {
  // ══ 1 · JETONSUZ ════════════════════════════════════════════════════════
  baslik("1 · jetonsuz → 401");
  {
    const r = await cevap(await ASISTAN.POST(istek("/api/mobile/asistan", { govde: soru("merhaba") })));
    iddia(`${SORGU.asistan} → 401`, r.kod === 401, `${r.kod} ${r.govde?.error}`);
  }

  // ══ 2 · GERÇEK GİRİŞ ════════════════════════════════════════════════════
  baslik("2 · gerçek giriş (telefon + PIN)");
  const giris = await cevap(
    await LOGIN(istek("/api/mobile/auth/login", { govde: { phone: TEL, pin: PIN } }))
  );
  iddia("POST /auth/login → 200", giris.kod === 200, `${giris.kod} rol=${giris.govde?.user?.rol}`);
  const yoneticiJeton = giris.govde?.accessToken;
  const benId = giris.govde?.user?.id;
  if (!yoneticiJeton) {
    console.error("✗ DURDURULDU — jeton alınamadı.");
    process.exit(1);
  }
  iddia("giriş yapan hesap YÖNETİCİ", giris.govde?.user?.isAdmin === true, `isAdmin=${giris.govde?.user?.isAdmin}`);

  // Kadrodan bir FİLO ŞEFİ ve bir ŞOFÖR bul (rol kapısı ölçümü için).
  const { data: kadro } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, managed_fleet, is_active, token_version")
    .eq("is_active", true);
  let sefSatir = (kadro ?? []).find((w) => w.managed_fleet && !w.is_admin);
  /** Şef OLMAYAN, yönetici OLMAYAN adaylar — biri şoför rolü, biri geçici şef. */
  const adaylar = (kadro ?? []).filter(
    (w) => !w.is_admin && !w.managed_fleet && w.id !== benId
  );
  const soforSatir = adaylar[0] ?? null;
  const sefAdayi = adaylar[1] ?? null;

  const soforJeton = soforSatir
    ? (await issueAccessToken(soforSatir.id, false, soforSatir.token_version ?? 0)).accessToken
    : null;
  console.log(
    `     kadro: şef=${sefSatir ? sefSatir.managed_fleet : "YOK (7. adımda geçici atanacak)"} · şoför=${soforSatir ? "var" : "YOK"}`
  );

  // ══ 3 · KAPI SIRASI ═════════════════════════════════════════════════════
  baslik("3 · kapı sırası — şoför kurulum durumunu ÖĞRENEMEZ");
  if (soforJeton) {
    const r = await cevap(
      await ASISTAN.POST(istek("/api/mobile/asistan", { token: soforJeton, govde: soru("merhaba") }))
    );
    iddia(
      "şoför → 403 fleet_view_required (503 DEĞİL)",
      r.kod === 403 && r.govde?.error === "fleet_view_required",
      `${r.kod} ${r.govde?.error}`
    );
  } else {
    iddia("şoför jetonu bulunamadı — kontrol atlandı", false, "kadroda uygun şoför yok");
  }
  {
    const r = await cevap(
      await ASISTAN.POST(istek("/api/mobile/asistan", { token: yoneticiJeton, govde: soru("merhaba") }))
    );
    if (ASISTAN_ENABLED) {
      iddia(
        "yönetici + bayrak AÇIK + anahtar yer tutucu → gövdeye geçiyor",
        r.kod !== 503 || r.govde?.sebep !== "bayrak_kapali",
        `${r.kod} ${r.govde?.error ?? "(akış)"} ${r.govde?.sebep ?? ""}`
      );
    } else {
      iddia(
        "yönetici + bayrak KAPALI → 503 asistan_kapali sebep=bayrak_kapali",
        r.kod === 503 && r.govde?.error === "asistan_kapali" && r.govde?.sebep === "bayrak_kapali",
        `${r.kod} ${r.govde?.error} sebep=${r.govde?.sebep}`
      );
    }
  }

  // ══ 4 · GÖVDE DOĞRULAMASI ═══════════════════════════════════════════════
  // Bayrak + (yer tutucu) anahtar gerektirir; yoksa kurulum kapısı önce döner.
  const govdeTurunuKos = ASISTAN_ENABLED && !!process.env.ANTHROPIC_API_KEY;
  baslik(`4 · gövde doğrulaması ${govdeTurunuKos ? "" : "(ATLANDI — bayrak/anahtar yok)"}`);
  if (govdeTurunuKos) {
    const hatali = [
      ["mesajlar boş dizi", { mesajlar: [] }, "invalid"],
      ["mesajlar eksik", {}, "invalid"],
      ["son mesaj asistan", { mesajlar: [{ rol: "kullanici", metin: "a" }, { rol: "asistan", metin: "b" }] }, "invalid"],
      ["ilk mesaj asistan", { mesajlar: [{ rol: "asistan", metin: "a" }] }, "invalid"],
      ["21 mesaj (tavan 20)", { mesajlar: Array.from({ length: 21 }, () => ({ rol: "kullanici", metin: "a" })) }, "invalid"],
      ["geçersiz dil", { ...soru("a"), dil: "fr" }, "invalid_dil"],
      ["4001 karakter", { mesajlar: [{ rol: "kullanici", metin: "x".repeat(4001) }] }, "invalid"],
    ];
    for (const [ad, govde, kod] of hatali) {
      const r = await cevap(await ASISTAN.POST(istek("/api/mobile/asistan", { token: yoneticiJeton, govde })));
      iddia(`${ad} → 400 ${kod}`, r.kod === 400 && r.govde?.error === kod, `${r.kod} ${r.govde?.error} ${JSON.stringify(r.govde?.alan ?? "")}`);
    }
  }

  // ══ 5 · HIZ SINIRI ══════════════════════════════════════════════════════
  baslik("5 · hız sınırı — 30 kredi, 31. istek reddedilir");
  {
    const deneId = benId;
    temizlenecek.add(asistanAnahtari(deneId));
    await supabaseAdmin.from("login_attempts").delete().eq("identifier", asistanAnahtari(deneId));
    let sonOk = null;
    let ilkRed = null;
    for (let i = 1; i <= ASISTAN_SORU_TAVANI + 1; i++) {
      const k = await hizKrediDus(deneId);
      if (k.ok) sonOk = { i, kalan: k.kalan };
      else if (!ilkRed) ilkRed = { i, kod: k.kod, retryAfter: k.retryAfter };
    }
    iddia(
      `${ASISTAN_SORU_TAVANI}. istek hâlâ geçiyor (kalan 0)`,
      sonOk?.i === ASISTAN_SORU_TAVANI && sonOk?.kalan === 0,
      `son geçen=${sonOk?.i} kalan=${sonOk?.kalan}`
    );
    iddia(
      `${ASISTAN_SORU_TAVANI + 1}. istek → hiz_siniri`,
      ilkRed?.i === ASISTAN_SORU_TAVANI + 1 && ilkRed?.kod === "hiz_siniri",
      `ilk red=${ilkRed?.i} kod=${ilkRed?.kod} retryAfter=${ilkRed?.retryAfter}sn`
    );
    const { data: satir } = await supabaseAdmin
      .from("login_attempts")
      .select("identifier, attempts, locked_until")
      .eq("identifier", asistanAnahtari(deneId))
      .maybeSingle();
    iddia(
      "sayaç satırı doğru anahtarda ve locked_until BOŞ",
      satir?.attempts === ASISTAN_SORU_TAVANI && satir?.locked_until === null,
      `attempts=${satir?.attempts} locked_until=${satir?.locked_until}`
    );
    iddia(
      "anahtarda boru işareti YOK (giriş kilidiyle çakışmaz)",
      !String(satir?.identifier ?? "|").includes("|"),
      `identifier=${satir?.identifier}`
    );
    // Giriş kilidi arayışı bu satırı GÖRMEMELİ.
    const { data: girisSatirlari } = await supabaseAdmin
      .from("login_attempts")
      .select("identifier")
      .like("identifier", `%|${TEL}`);
    iddia(
      "giriş kilidi LIKE kalıbı asistan satırını bulmuyor",
      !(girisSatirlari ?? []).some((r) => r.identifier.startsWith("asistan:")),
      `giriş kalıbıyla eşleşen: ${(girisSatirlari ?? []).length}`
    );
    /**
     * Sayaç HEMEN sıfırlanıyor: 9. adımdaki akış turu aynı kişinin kredisini
     * kullanıyor ve tavan dolu kalsaydı o tur 429 alır, ölçemezdik. Tur sonu
     * temizliği yine de duruyor (bu satır 9. adımda yeniden yazılacak).
     */
    await supabaseAdmin.from("login_attempts").delete().eq("identifier", asistanAnahtari(deneId));
  }

  // ══ 6 · 🔴 ARAÇ KATMANI: SAYI UCUN SAYISIYLA AYNI MI ════════════════════
  baslik("6 · araç katmanı — her sayı ucun KENDİ yanıtındaki sayı");
  const ctx = { yetkiBasligi: `Bearer ${yoneticiJeton}`, taban: HOST };

  // Karşılaştırma için ucun kendisini ayrıca çağırıyoruz.
  const UC = {
    pano: await import("@/app/api/mobile/dashboard/route.ts"),
    analiz: await import("@/app/api/mobile/analytics/route.ts"),
    alarm: await import("@/app/api/mobile/alarms/route.ts"),
    skor: await import("@/app/api/mobile/driver-scores/route.ts"),
    aracListe: await import("@/app/api/mobile/vehicles/route.ts"),
    aracOzet: await import("@/app/api/mobile/vehicles/[id]/ozet/route.ts"),
    isEmri: await import("@/app/api/mobile/is-emirleri/route.ts"),
    izin: await import("@/app/api/mobile/leaves/route.ts"),
    mevzuat: await import("@/app/api/mobile/mevzuat/route.ts"),
  };
  const get = (yol) =>
    new Request(`${HOST}${yol}`, { headers: { authorization: `Bearer ${yoneticiJeton}` } });
  const jsonu = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  const cagir = async (ad, girdi = {}) => {
    const arac = ARACLAR.find((a) => a.ad === ad);
    const bas = Date.now();
    const r = await arac.calistir(girdi, ctx);
    return { r, ms: Date.now() - bas };
  };

  // Araç listesinden bir araç kimliği (arac_ozeti için).
  const aracListeCikti = await cagir("filo_araclari");
  const ilkArac = aracListeCikti.r?.satirlar?.[0];

  const KARSILASTIR = [
    {
      ad: "filo_panosu",
      girdi: {},
      uc: async () => jsonu(await UC.pano.GET(get("/api/mobile/dashboard"))),
      alanlar: [
        ["bugün toplam km", (t) => t.bugun?.toplamKm, (u) => u.bugun?.toplamKm],
        ["filo toplam", (t) => t.filo?.toplam, (u) => u.filo?.toplam],
        ["uyarı toplam", (t) => t.uyari?.toplam, (u) => u.uyari?.toplam],
        ["dtc araç sayısı", (t) => t.dtc_arac_sayisi, (u) => u.dtcAracSayisi],
        ["7g ortalama skor", (t) => t.performans_7gun?.ortalamaSkor, (u) => u.performans7g?.ortalamaSkor],
      ],
    },
    {
      ad: "filo_analizi",
      girdi: { aralik: "ay" },
      uc: async () => jsonu(await UC.analiz.GET(get("/api/mobile/analytics?range=ay"))),
      alanlar: [
        ["vardiya", (t) => t.toplam?.vardiya, (u) => u.toplam?.vardiya],
        ["km", (t) => t.toplam?.km, (u) => u.toplam?.km],
        ["alarm toplam", (t) => t.toplam?.alarm?.toplam, (u) => u.toplam?.alarm?.toplam],
        ["rölanti ms", (t) => t.toplam?.rolanti?.toplamMs, (u) => u.toplam?.rolanti?.toplamMs],
      ],
    },
    {
      ad: "alarmlar",
      girdi: { aralik: "hafta" },
      uc: async () => jsonu(await UC.alarm.GET(get("/api/mobile/alarms?range=hafta&limit=200"))),
      alanlar: [["alarm toplamı", (t) => t.sayfa?.total, (u) => u.page?.total]],
    },
    {
      ad: "sofor_skorlari",
      girdi: { donem: "ay" },
      uc: async () => jsonu(await UC.skor.GET(get("/api/mobile/driver-scores?donem=ay&limit=200"))),
      alanlar: [
        ["ortalama skor", (t) => t.skor?.ortalama, (u) => u.skor?.ortalama],
        ["skorlanan", (t) => t.skor?.skorlanan, (u) => u.skor?.skorlanan],
        ["şoför sayısı", (t) => t.skor?.soforSayisi, (u) => u.skor?.soforSayisi],
        ["toplam km", (t) => t.toplam?.km, (u) => u.toplam?.km],
      ],
    },
    {
      ad: "filo_araclari",
      girdi: {},
      uc: async () => jsonu(await UC.aracListe.GET(get("/api/mobile/vehicles?limit=200"))),
      alanlar: [["araç sayısı", (t) => t.sayfa?.total, (u) => u.page?.total]],
    },
    {
      ad: "is_emirleri",
      girdi: {},
      uc: async () => jsonu(await UC.isEmri.GET(get("/api/mobile/is-emirleri?durum=acik&limit=200"))),
      alanlar: [["açık iş emri", (t) => t.sayfa?.total, (u) => u.page?.total]],
    },
    {
      ad: "izin_takvimi",
      girdi: {},
      uc: async () => jsonu(await UC.izin.GET(get("/api/mobile/leaves"))),
      alanlar: [
        ["ay", (t) => t.ay, (u) => u.ay],
        ["kadro sayısı", (t) => t.kadro?.satirlar?.length, (u) => Math.min(u.kisiler?.length ?? 0, 60)],
        ["izin kaydı", (t) => t.satirlar?.length, (u) => Math.min(u.izinler?.length ?? 0, 80)],
      ],
    },
    {
      ad: "mevzuat_panosu",
      girdi: {},
      uc: async () => jsonu(await UC.mevzuat.GET(get("/api/mobile/mevzuat?limit=100"))),
      alanlar: [
        ["kural seti", (t) => t.ayar?.kuralSeti, (u) => u.ayar?.kuralSeti],
        ["vardiyasız", (t) => t.canli?.vardiyasiz, (u) => u.canli?.vardiyasiz],
        ["bayat vardiya", (t) => t.canli?.bayatVardiya, (u) => u.canli?.bayatVardiya],
        ["dolmuş belge", (t) => t.belgeler?.dolmus, (u) => u.belgeler?.dolmus],
      ],
    },
  ];

  if (ilkArac?.id) {
    KARSILASTIR.push({
      ad: "arac_ozeti",
      girdi: { aracId: ilkArac.id, donem: "ay" },
      uc: async () =>
        jsonu(
          await UC.aracOzet.GET(get(`/api/mobile/vehicles/${ilkArac.id}/ozet?donem=ay`), {
            params: Promise.resolve({ id: ilkArac.id }),
          })
        ),
      alanlar: [
        ["km", (t) => t.km, (u) => u.km],
        ["vardiya sayısı", (t) => t.vardiyaSayisi, (u) => u.vardiyaSayisi],
        ["rölanti", (t) => JSON.stringify(t.rolanti), (u) => JSON.stringify(u.rolanti)],
        ["yakıt", (t) => JSON.stringify(t.yakit), (u) => JSON.stringify(u.yakit)],
      ],
    });
  } else {
    iddia("arac_ozeti — karşılaştırılacak araç bulunamadı", false, "filo_araclari boş döndü");
  }

  for (const k of KARSILASTIR) {
    const { r: aracCikti, ms } = await cagir(k.ad, k.girdi);
    const ucCikti = await k.uc();
    if (aracCikti?.hata) {
      iddia(`${k.ad}: araç hata döndürdü`, false, JSON.stringify(aracCikti));
      continue;
    }
    if (!ucCikti?.ok) {
      iddia(`${k.ad}: uç hata döndürdü`, false, JSON.stringify(ucCikti)?.slice(0, 120));
      continue;
    }
    const farklar = [];
    const volatil = [];
    for (const [alanAd, tf, uf] of k.alanlar) {
      const a = tf(aracCikti);
      const b = uf(ucCikti);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      farklar.push([alanAd, a, b, uf]);
    }
    /**
     * ── 🔴 "DÜNYA KAYDI" ile "ARAÇ BAŞKA SAYI ÜRETTİ"Yİ AYIRAN ÖLÇÜM ────────
     *
     * galzura-demo CANLI telemetri alıyor: iki tur arasında `bugün toplam km`
     * 402→404, alarm sayısı 398→399 diye ölçüldü (23.09.2026). Araç ile uç
     * ARDIŞIK çağrıldığı için aradaki saniyelerde sayı gerçekten değişebilir
     * ve bu bir kusur DEĞİLDİR.
     *
     * Farkı "tolerans" diye yutmak yanlış olurdu — o, gerçek bir ayrışmayı da
     * gizlerdi. Onun yerine AYIRT EDİYORUZ: uç İKİNCİ kez okunur.
     *   • uç kendi kendinden de farklıysa → alan VOLATİL, dünya kaydı
     *   • uç ikinci okumada da aynıysa    → araç GERÇEKTEN başka sayı üretti
     */
    if (farklar.length > 0) {
      const ikinci = await k.uc();
      for (let i = farklar.length - 1; i >= 0; i--) {
        const [alanAd, a, b, uf] = farklar[i];
        const c = ikinci?.ok ? uf(ikinci) : b;
        if (JSON.stringify(b) !== JSON.stringify(c)) {
          volatil.push(`${alanAd}: uç ${JSON.stringify(b)}→${JSON.stringify(c)} (araç ${JSON.stringify(a)})`);
          farklar.splice(i, 1);
        }
      }
    }
    const gercekFark = farklar.map(([n, a, b]) => `${n}: araç=${JSON.stringify(a)} uç=${JSON.stringify(b)}`);
    iddia(
      `${k.ad}: ${k.alanlar.length} alanın hepsi ucunkiyle BİREBİR (${ms}ms)` +
        (volatil.length ? ` [${volatil.length} alan VOLATİL]` : ""),
      gercekFark.length === 0,
      gercekFark.length
        ? gercekFark.join(" | ")
        : (volatil.length ? `VOLATİL → ${volatil.join(" | ")} · ` : "") +
          k.alanlar.map(([n, tf]) => `${n}=${JSON.stringify(tf(aracCikti))}`).join(" · ")
    );
  }

  // ══ 7 · ROL KAPISI ══════════════════════════════════════════════════════
  baslik("7 · rol kapısı — şef yönetici araçlarını göremez ve çağıramaz");
  {
    const yoneticiListe = araclarFor(true).map((a) => a.ad);
    const sefListe = araclarFor(false).map((a) => a.ad);
    iddia("yönetici 9 araç görür", yoneticiListe.length === 9, yoneticiListe.join(", "));
    iddia(
      "filo şefi YALNIZ 4 filo aracı görür",
      sefListe.length === 4 && sefListe.every((a) => !["filo_analizi", "alarmlar", "sofor_skorlari", "filo_araclari", "arac_ozeti"].includes(a)),
      sefListe.join(", ")
    );
    iddia("araç şemaları üretilebiliyor", aracSemalari(araclarFor(true)).length === 9, `${aracSemalari(araclarFor(true)).length} şema`);
  }
  /**
   * ── GEÇİCİ FİLO ŞEFİ — DAR PENCERE + GÜNLÜK ─────────────────────────────
   *
   * Demo kadrosunda şef YOKSA bu turun en değerli kontrolü (şef yönetici
   * aracını çağırınca 403 alıyor mu, kapsamı kendi filosuna daralıyor mu)
   * ölçülemeden geçerdi — "şef yok" bir kanıt değildir. Bu yüzden bir şoför
   * GEÇİCİ olarak şef yapılıyor.
   *
   * ⚠️ 23.09.2026'DA ÖLÇÜLEREK ÖĞRENİLDİ: atama betiğin BAŞINDA yapılıyor ve
   * geri alma en dıştaki `finally`de duruyordu. Betik bir kez boru hattı
   * kapandığı için yarıda öldü, `finally` HİÇ koşmadı ve demo'da "Andreas
   * Bauer" filo şefi olarak KALDI (elle düzeltildi). Ders: geri alma
   * yazmanın hemen yanında durmalı ve süreç ölse bile bir yol bırakmalı.
   *
   * İki değişiklik:
   *   1. PENCERE DAR — atama ve geri alma aynı blokta, aralarında yalnız
   *      şef kontrolleri var (saniyeler).
   *   2. GÜNLÜK — atama DİSKE yazılıyor; bir sonraki tur başlangıcında dosya
   *      duruyorsa önce o geri alınıyor. Yani çöken bir tur kendini onarır.
   */
  let sefJeton = null;
  let sefBilgi = sefSatir;
  try {
    if (!sefSatir && sefAdayi) {
      gunlukYaz({ id: sefAdayi.id, eski: sefAdayi.managed_fleet ?? null });
      await supabaseAdmin.from("workers").update({ managed_fleet: "mavi" }).eq("id", sefAdayi.id);
      geriAlinacak.sef = { id: sefAdayi.id, eski: sefAdayi.managed_fleet ?? null };
      sefBilgi = { ...sefAdayi, managed_fleet: "mavi" };
      console.log(`     (geçici şef: ${sefAdayi.name} → mavi; blok sonunda geri alınacak)`);
    }
    sefJeton = sefBilgi
      ? (await issueAccessToken(sefBilgi.id, false, sefBilgi.token_version ?? 0)).accessToken
      : null;

    if (sefJeton) {
      const sefCtx = { yetkiBasligi: `Bearer ${sefJeton}`, taban: HOST };
      for (const ad of ["filo_analizi", "alarmlar", "sofor_skorlari", "filo_araclari"]) {
        const arac = ARACLAR.find((a) => a.ad === ad);
        const r = await arac.calistir({}, sefCtx);
        iddia(
          `şef ${ad} çağırsa bile 403 admin_required`,
          r?.durum === 403 && r?.hata === "admin_required",
          `${r?.durum} ${r?.hata}`
        );
      }
      // Kapsam sunucudan: şefin panosu kendi filosuna daraltılmış.
      const pano = await ARACLAR.find((a) => a.ad === "filo_panosu").calistir({}, sefCtx);
      iddia(
        "şefin filo_panosu kapsamı SUNUCUDAN geliyor (isChief + filo)",
        pano?.kapsam?.isChief === true && pano?.kapsam?.fleet === sefBilgi.managed_fleet,
        `isChief=${pano?.kapsam?.isChief} fleet=${pano?.kapsam?.fleet} (kadro: ${sefBilgi.managed_fleet})`
      );
      iddia(
        "şefin panosunda patron blokları null (panel paritesi)",
        pano?.rolanti === null && pano?.alarm === null,
        `rolanti=${pano?.rolanti} alarm=${pano?.alarm}`
      );
    } else {
      console.log("     (demo kadrosunda şef ve uygun aday yok — şef kontrolleri atlandı)");
    }
  } finally {
    await sefiGeriAl();
  }
  if (soforJeton) {
    const soforCtx = { yetkiBasligi: `Bearer ${soforJeton}`, taban: HOST };
    const r = await ARACLAR.find((a) => a.ad === "filo_panosu").calistir({}, soforCtx);
    iddia(
      "şoför filo_panosu çağırsa 403 fleet_view_required",
      r?.durum === 403 && r?.hata === "fleet_view_required",
      `${r?.durum} ${r?.hata}`
    );
  }

  // ══ 8 · SİSTEM İSTEMİ ═══════════════════════════════════════════════════
  baslik("8 · sistem istemi — üç dil, durağan");
  {
    const a1 = sistemIstemi("tr");
    const a2 = sistemIstemi("tr");
    iddia("aynı dil iki çağrıda BİREBİR aynı (önbellek ön eki durağan)", a1 === a2, `${a1.length} karakter`);
    iddia(
      "üç dil de dolu ve birbirinden farklı",
      new Set([sistemIstemi("tr"), sistemIstemi("de"), sistemIstemi("en")]).size === 3,
      `tr=${sistemIstemi("tr").length} de=${sistemIstemi("de").length} en=${sistemIstemi("en").length} karakter`
    );
  }

  // ══ 9 · AKIŞ (yalnız yer tutucu anahtar varken) ══════════════════════════
  if (govdeTurunuKos) {
    baslik("9 · SSE akışı — model çağrısına kadar olan yol");
    const res = await ASISTAN.POST(
      istek("/api/mobile/asistan", { token: yoneticiJeton, govde: soru("Bugün sahada kaç araç var?") })
    );
    iddia("yanıt text/event-stream", (res.headers.get("content-type") ?? "").includes("text/event-stream"), res.headers.get("content-type"));
    const ev = await olaylar(res);
    const adlar = ev.map((e) => e.olay);
    iddia("akış 'basladi' olayıyla açılıyor", adlar[0] === "basladi", adlar.join(" → ").slice(0, 160));
    const bas = ev.find((e) => e.olay === "basladi");
    iddia("basladi olayı araç listesini ve kalan hakkı taşıyor", Array.isArray(bas?.veri?.araclar) && typeof bas?.veri?.kalanSoru === "number", JSON.stringify(bas?.veri));
    const hata = ev.find((e) => e.olay === "hata");
    iddia(
      "geçersiz anahtar → saglayici_hatasi (401), anahtar gövdede YOK",
      hata?.veri?.kod === "saglayici_hatasi" && !JSON.stringify(ev).includes("sk-ant"),
      JSON.stringify(hata?.veri)
    );
  }
} finally {
  // ── TEMİZLİK: yazılan her şey ESKİ hâline döner ────────────────────────
  for (const id of temizlenecek) {
    await supabaseAdmin.from("login_attempts").delete().eq("identifier", id);
  }
  if (temizlenecek.size) console.log(`\n(temizlik: ${temizlenecek.size} asistan sayaç satırı silindi)`);
  // Emniyet ağı: 7. adımdaki dar blok zaten geri aldı, bu yalnız o bloğa hiç
  // girilemeden düşen bir turu yakalar. `sefiGeriAl` iki kez çağrılabilir.
  await sefiGeriAl();
}

console.log(`\n╔════════════════════════════════════════════════════════════════════`);
console.log(`║ SONUÇ  ${gecti} geçti · ${dusen} düştü`);
console.log(`╚════════════════════════════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
