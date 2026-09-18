#!/usr/bin/env node
/**
 * PROFİL + MOLA UÇLARI — CANLIDA KANIT (yalnız galzura-demo).
 *
 * ═══ NE YAPAR ═══
 *
 * İki yeni yazma yolunun GERÇEK route handler'larını GERÇEK veritabanına karşı
 * koşturur ve her adımda ÖNCE/SONRA değerlerini basar:
 *
 *   PATCH /api/mobile/me            — kendi ad + telefon
 *   PATCH /api/mobile/shifts/[id]   — islem:"mola" (dakika ekle · bayrak)
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (HAK61 salt okuma — Volkan kuralı).
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 *   • Ad → "<asıl> QA" → "<asıl>". Geri almanın TUTTUĞU ayrıca ölçülüyor.
 *   • Telefon → HİÇ DEĞİŞMİYOR. Çakışma denemesi 409 ile reddedildiği için
 *     yazma zaten olmuyor; "reddedildi" iddiası satır okunarak doğrulanıyor.
 *   • Mola → +10 dk eklenir, ölçülür, `break_minutes` ORİJİNAL değere geri
 *     yazılır. Geri yazma DOĞRUDAN (çekirdek eksi dakika kabul etmez ve
 *     etmemeli — AZG alanına eksi mola yazan bir yol olmamalı).
 *
 * ── GERİ ALINAMAYAN (bilerek) ─────────────────────────────────────────────
 *   • `workers.updated_at` damgası ve varsa denetim izi satırı — iz silinirse
 *     izin kendisi anlamsızlaşır.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-profil-mola.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

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

const { GET: ME_GET, PATCH: ME_PATCH } = await import("@/app/api/mobile/me/route.ts");
const { PATCH: SHIFT_PATCH } = await import("@/app/api/mobile/shifts/[id]/route.ts");
const params = (id) => ({ params: Promise.resolve({ id }) });

console.log(`\n╔══ PROFİL + MOLA UÇLARI · CANLIDA KANIT (galzura-demo) ═════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

let hedef = null;
let adAsil = null;
let molaGeri = null; // { id, break_minutes }

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — başlangıç durumu");
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("id, name, phone, is_admin, is_active, token_version")
    .eq("phone", TEL)
    .maybeSingle();
  if (!w) {
    console.error(`✗ ${TEL} bulunamadı.`);
    process.exit(1);
  }
  hedef = w;
  adAsil = w.name;
  bilgi(`hesap   ${w.id}  "${w.name}"  is_admin=${w.is_admin}`);

  // Çakışma denemesi için BAŞKA bir kayıtlı numara.
  const { data: digerler } = await supabaseAdmin
    .from("workers")
    .select("id, name, phone")
    .not("phone", "is", null)
    .neq("id", w.id)
    .limit(1);
  const diger = (digerler ?? [])[0];
  if (!diger) {
    console.error("✗ çakışma denemesi için ikinci bir numara yok.");
    process.exit(1);
  }
  bilgi(`çakışma hedefi  "${diger.name}" (numara basılmıyor)`);

  // Mola için AÇIK vardiya + sahibi.
  const { data: acikRows } = await supabaseAdmin
    .from("time_entries")
    .select("id, worker_id, started_at, ended_at, break_minutes, break_started_at")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(5);
  const acik = (acikRows ?? [])[0] ?? null;
  const acik2 = (acikRows ?? [])[1] ?? null;
  bilgi(`açık vardiya sayısı  ${(acikRows ?? []).length}`);
  if (acik) bilgi(`mola hedefi  ${acik.id}  mola=${acik.break_minutes ?? 0} dk  bayrak=${acik.break_started_at ?? "—"}`);

  const tYonetici = await jeton(w);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. PATCH /me — AD DEĞİŞTİR, GET ile doğrula, GERİ AL");
  {
    const yeniAd = `${adAsil} QA`;
    const r = await cevap(
      await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde: { ad: yeniAd } }))
    );
    iddia("ad değişikliği → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
    iddia("degisen = [name]", JSON.stringify(r.govde.degisen) === '["name"]', JSON.stringify(r.govde.degisen));

    const g = await cevap(await ME_GET(istek("/api/mobile/me", { token: tYonetici, method: "GET" })));
    iddia("GET /me YENİ adı gösteriyor", g.govde.user?.adSoyad === yeniAd, `${g.govde.user?.adSoyad}`);

    const { data: db } = await supabaseAdmin.from("workers").select("name").eq("id", w.id).maybeSingle();
    iddia("DB satırı da yeni ad", db.name === yeniAd, db.name);

    // ── GERİ AL
    const rg = await cevap(
      await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde: { ad: adAsil } }))
    );
    const g2 = await cevap(await ME_GET(istek("/api/mobile/me", { token: tYonetici, method: "GET" })));
    iddia(`🔴 ad GERİ ALINDI ("${adAsil}")`, rg.kod === 200 && g2.govde.user?.adSoyad === adAsil, `${g2.govde.user?.adSoyad}`);

    // Aynı değeri tekrar yazmak DEĞİŞİKLİK SAYILMAZ (diff kuralı).
    const rr = await cevap(
      await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde: { ad: adAsil } }))
    );
    iddia("aynı ad tekrar → degisen BOŞ (gereksiz yazma yok)", JSON.stringify(rr.govde.degisen) === "[]", JSON.stringify(rr.govde.degisen));
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. PATCH /me — TELEFON: çakışma 409 · biçim 400 · kayıt DEĞİŞMEDİ");
  {
    const telOnce = (await supabaseAdmin.from("workers").select("phone").eq("id", w.id).maybeSingle()).data.phone;

    const r = await cevap(
      await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde: { telefon: diger.phone } }))
    );
    iddia("başkasının numarası → 409", r.kod === 409, `${r.kod} ${r.govde.error ?? ""}`);
    iddia("hata kodu phone_taken", r.govde.error === "phone_taken", `${r.govde.error}`);

    const rb = await cevap(
      await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde: { telefon: "123" } }))
    );
    iddia("E.164 olmayan numara → 400 errPhone", rb.kod === 400 && rb.govde.error === "errPhone", `${rb.kod} ${rb.govde.error}`);

    const telSonra = (await supabaseAdmin.from("workers").select("phone").eq("id", w.id).maybeSingle()).data.phone;
    iddia("🔴 kendi numarası DEĞİŞMEDİ", telSonra === telOnce, telSonra === telOnce ? "aynı" : "DEĞİŞTİ");

    const g = await cevap(await ME_GET(istek("/api/mobile/me", { token: tYonetici, method: "GET" })));
    iddia("GET /me telefonu okunabilir döndürüyor", g.govde.telefon === telOnce, g.govde.telefon === telOnce ? "eşleşti" : `${g.govde.telefon}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. PATCH /me — YETKİ ALANLARI GÖVDEDE: 400, hiçbir şey yazılmaz");
  {
    for (const [ad, govde] of [
      ["is_admin", { ad: "X", is_admin: true }],
      ["rol", { rol: "admin" }],
      ["araç", { vehicle_id: "00000000-0000-0000-0000-000000000000" }],
      ["filo", { managed_fleet: "bordo" }],
      ["kimlik", { id: "00000000-0000-0000-0000-000000000000", ad: "X" }],
    ]) {
      const r = await cevap(await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde })));
      iddia(`gövdede "${ad}" → 400 alan_izinsiz`, r.kod === 400 && r.govde.error === "alan_izinsiz", `${r.kod} ${r.govde.error}`);
    }
    const bos = await cevap(await ME_PATCH(istek("/api/mobile/me", { token: tYonetici, govde: {} })));
    iddia("boş gövde → 400 bos_govde", bos.kod === 400 && bos.govde.error === "bos_govde", `${bos.kod} ${bos.govde.error}`);

    const { data: db } = await supabaseAdmin.from("workers").select("name, is_admin").eq("id", w.id).maybeSingle();
    iddia("🔴 reddedilen isteklerin HİÇBİRİ yazmadı", db.name === adAsil && db.is_admin === w.is_admin, `ad="${db.name}" is_admin=${db.is_admin}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. PATCH /me — JETONSUZ 401");
  {
    const r = await cevap(await ME_PATCH(istek("/api/mobile/me", { govde: { ad: "X" } })));
    iddia("jetonsuz PATCH → 401", r.kod === 401, `${r.kod} ${r.govde.error ?? ""}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. MOLA — ŞOFÖR KENDİ AÇIK VARDİYASINA +10 dk");
  if (!acik) {
    bilgi("⚠ açık vardiya YOK — mola adımları ATLANDI");
  } else {
    const { data: sahip } = await supabaseAdmin
      .from("workers")
      .select("id, name, is_admin, token_version")
      .eq("id", acik.worker_id)
      .maybeSingle();
    const tSofor = await jeton(sahip);
    bilgi(`vardiya sahibi  "${sahip.name}" is_admin=${sahip.is_admin}`);

    const molaOnce = acik.break_minutes ?? 0;
    molaGeri = { id: acik.id, break_minutes: acik.break_minutes };

    const r = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { token: tSofor, govde: { islem: "mola", dakika: 10 } }),
        params(acik.id)
      )
    );
    iddia("mola 10 dk → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
    iddia(`yanıt molaDk = ${molaOnce} + 10`, r.govde.molaDk === molaOnce + 10, `${r.govde.molaDk}`);

    const { data: v } = await supabaseAdmin
      .from("time_entries")
      .select("break_minutes, break_started_at")
      .eq("id", acik.id)
      .maybeSingle();
    iddia(`DB break_minutes ${molaOnce} → ${molaOnce + 10}`, (v.break_minutes ?? 0) === molaOnce + 10, `${v.break_minutes}`);
    iddia("bayrak temizlendi (break_started_at null)", v.break_started_at === null, `${v.break_started_at}`);

    // Bayrak yolu — panelin "molaya başla" düğmesi.
    const rb = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { token: tSofor, govde: { islem: "mola", baslat: true } }),
        params(acik.id)
      )
    );
    const { data: v2 } = await supabaseAdmin
      .from("time_entries")
      .select("break_minutes, break_started_at")
      .eq("id", acik.id)
      .maybeSingle();
    iddia("baslat:true → 200", rb.kod === 200, `${rb.kod}`);
    iddia("bayrak KURULDU (break_started_at dolu)", v2.break_started_at !== null, `${v2.break_started_at ? "dolu" : "boş"}`);
    iddia("bayrak DAKİKA YAZMAZ (break_minutes aynı)", (v2.break_minutes ?? 0) === molaOnce + 10, `${v2.break_minutes}`);

    // Sınırlar.
    const rr = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { token: tSofor, govde: { islem: "mola", dakika: 99999 } }),
        params(acik.id)
      )
    );
    iddia("dakika 99999 → 400 errBreakRange", rr.kod === 400 && rr.govde.error === "errBreakRange", `${rr.kod} ${rr.govde.error}`);
    const rn = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { token: tSofor, govde: { islem: "mola", dakika: -5 } }),
        params(acik.id)
      )
    );
    iddia("dakika -5 → 400 errBreakNeg", rn.kod === 400 && rn.govde.error === "errBreakNeg", `${rn.kod} ${rn.govde.error}`);
    const rs = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { token: tSofor, govde: { islem: "mola" } }),
        params(acik.id)
      )
    );
    iddia("dakika/baslat yok → 400 missing_fields", rs.kod === 400 && rs.govde.error === "missing_fields", `${rs.kod} ${rs.govde.error}`);

    // ── GERİ AL (doğrudan; çekirdek eksi dakika kabul ETMEZ, etmemeli)
    await supabaseAdmin
      .from("time_entries")
      .update({ break_minutes: molaGeri.break_minutes, break_started_at: acik.break_started_at })
      .eq("id", acik.id);
    const { data: v3 } = await supabaseAdmin
      .from("time_entries")
      .select("break_minutes, break_started_at")
      .eq("id", acik.id)
      .maybeSingle();
    iddia(
      `🔴 mola GERİ ALINDI (${molaGeri.break_minutes ?? 0} dk)`,
      (v3.break_minutes ?? 0) === (molaGeri.break_minutes ?? 0) && v3.break_started_at === acik.break_started_at,
      `${v3.break_minutes} · bayrak=${v3.break_started_at ?? "—"}`
    );
    molaGeri = null;

    // ══════════════════════════════════════════════════════════════════════
    baslik("6. MOLA — SINIRLAR: başkasının vardiyası · kapalı vardiya · duzelt");
    if (acik2 && acik2.worker_id !== acik.worker_id) {
      const rx = await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${acik2.id}`, { token: tSofor, govde: { islem: "mola", dakika: 10 } }),
          params(acik2.id)
        )
      );
      const { data: vx } = await supabaseAdmin
        .from("time_entries")
        .select("break_minutes")
        .eq("id", acik2.id)
        .maybeSingle();
      iddia("🔴 BAŞKASININ açık vardiyası → 404", rx.kod === 404, `${rx.kod} ${rx.govde.error ?? ""}`);
      iddia("🔴 o satıra HİÇBİR ŞEY yazılmadı", (vx.break_minutes ?? 0) === (acik2.break_minutes ?? 0), `${vx.break_minutes}`);
    } else {
      bilgi("⚠ ikinci (başka şoföre ait) açık vardiya yok — sahiplik adımı ATLANDI");
    }

    const { data: kapali } = await supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, break_minutes")
      .eq("worker_id", acik.worker_id)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (kapali) {
      const rk = await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${kapali.id}`, { token: tSofor, govde: { islem: "mola", dakika: 10 } }),
          params(kapali.id)
        )
      );
      const { data: vk } = await supabaseAdmin
        .from("time_entries")
        .select("break_minutes")
        .eq("id", kapali.id)
        .maybeSingle();
      iddia("KAPALI vardiya → 409 shift_closed", rk.kod === 409 && rk.govde.error === "shift_closed", `${rk.kod} ${rk.govde.error}`);
      iddia("🔴 kapalı satıra yazılmadı (AZG geriye dönük değişmedi)", (vk.break_minutes ?? 0) === (kapali.break_minutes ?? 0), `${vk.break_minutes}`);
    } else {
      bilgi("⚠ kapalı vardiya yok — 409 adımı ATLANDI");
    }

    if (sahip.is_admin === false) {
      const rd = await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${acik.id}`, {
            token: tSofor,
            govde: { islem: "duzelt", sebep: "QA — reddedilmeli", baslangic: acik.started_at, baslangicKm: 0 },
          }),
          params(acik.id)
        )
      );
      iddia("🔴 ŞOFÖR jetonuyla duzelt → 403 admin_required", rd.kod === 403 && rd.govde.error === "admin_required", `${rd.kod} ${rd.govde.error}`);
      const rc = await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${acik.id}`, { token: tSofor, govde: { islem: "kapat", sebep: "QA — reddedilmeli" } }),
          params(acik.id)
        )
      );
      iddia("🔴 ŞOFÖR jetonuyla kapat → 403 admin_required", rc.kod === 403 && rc.govde.error === "admin_required", `${rc.kod} ${rc.govde.error}`);
    } else {
      bilgi("⚠ açık vardiyanın sahibi yönetici — 403 adımı için şoför jetonu aranıyor");
      const { data: sofor } = await supabaseAdmin
        .from("workers")
        .select("id, is_admin, token_version")
        .eq("is_admin", false)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (sofor) {
        const tS = await jeton(sofor);
        const rd = await cevap(
          await SHIFT_PATCH(
            istek(`/api/mobile/shifts/${acik.id}`, {
              token: tS,
              govde: { islem: "duzelt", sebep: "QA — reddedilmeli", baslangic: acik.started_at, baslangicKm: 0 },
            }),
            params(acik.id)
          )
        );
        iddia("🔴 ŞOFÖR jetonuyla duzelt → 403 admin_required", rd.kod === 403 && rd.govde.error === "admin_required", `${rd.kod} ${rd.govde.error}`);
      }
    }

    // Jetonsuz.
    const r401 = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { govde: { islem: "mola", dakika: 10 } }),
        params(acik.id)
      )
    );
    iddia("jetonsuz mola → 401", r401.kod === 401, `${r401.kod} ${r401.govde.error ?? ""}`);

    // ══════════════════════════════════════════════════════════════════════
    baslik("7. MOLA — YÖNETİCİ BAŞKASININ vardiyasına ekleyebilir");
    const mOnce = (await supabaseAdmin.from("time_entries").select("break_minutes").eq("id", acik.id).maybeSingle()).data.break_minutes ?? 0;
    const ry = await cevap(
      await SHIFT_PATCH(
        istek(`/api/mobile/shifts/${acik.id}`, { token: tYonetici, govde: { islem: "mola", dakika: 5 } }),
        params(acik.id)
      )
    );
    iddia("yönetici jetonuyla mola → 200", ry.kod === 200, `${ry.kod} ${ry.govde.error ?? ""}`);
    iddia(`molaDk ${mOnce} → ${mOnce + 5}`, ry.govde.molaDk === mOnce + 5, `${ry.govde.molaDk}`);
    await supabaseAdmin
      .from("time_entries")
      .update({ break_minutes: molaOnce, break_started_at: acik.break_started_at })
      .eq("id", acik.id);
    const { data: vson } = await supabaseAdmin
      .from("time_entries")
      .select("break_minutes, break_started_at")
      .eq("id", acik.id)
      .maybeSingle();
    iddia(`🔴 mola GERİ ALINDI (${molaOnce} dk)`, (vson.break_minutes ?? 0) === molaOnce, `${vson.break_minutes}`);
  }
} finally {
  // ── SON EMNİYET: ad ve mola her hâlükârda geri ────────────────────────────
  if (hedef && adAsil) {
    await supabaseAdmin.from("workers").update({ name: adAsil }).eq("id", hedef.id);
    const { data: son } = await supabaseAdmin.from("workers").select("name").eq("id", hedef.id).maybeSingle();
    console.log(`\n  ${son?.name === adAsil ? "✓" : "✗"} finally: ad "${son?.name}"`);
    if (son?.name !== adAsil) dusen++;
  }
  if (molaGeri) {
    await supabaseAdmin
      .from("time_entries")
      .update({ break_minutes: molaGeri.break_minutes })
      .eq("id", molaGeri.id);
    console.log(`  ✓ finally: mola geri (${molaGeri.break_minutes ?? 0} dk)`);
  }
}

console.log(`\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ═══════════════════════════════\n`);
process.exit(dusen === 0 ? 0 : 1);
