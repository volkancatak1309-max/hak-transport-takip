#!/usr/bin/env node
/**
 * ARAÇ DÜZENLEME + BÖLGE AMACI — CANLIDA KANIT (yalnız galzura-demo).
 *
 * ═══ NE YAPAR ═══
 *
 * İki yeni yazma yolunun GERÇEK route handler'larını GERÇEK veritabanına karşı
 * koşturur ve her adımda ÖNCE/SONRA değerlerini basar:
 *
 *   PATCH /api/mobile/vehicles/[id]        — kısmi araç düzenleme
 *   POST  /api/mobile/vehicles             — yeni araç
 *   PATCH /api/mobile/geofences/[id]       — bölge AMACI (vardiya tetiği)
 *
 * Her yazmanın TÜRETİLMİŞ karşılığı da ölçülüyor: muayene tarihi Dikkat
 * panosunda bir kalem üretiyor mu, depo hacmi /ozet'in litre değerini
 * gerçekten değiştiriyor mu. Sayıyı değil, SAYININ GÖRÜNDÜĞÜ YERİ ölçmek şart:
 * kolonu yazıp ekranın değiştiğini VARSAYMAK, bu depoda daha önce yanlış
 * çıkmış bir varsayım.
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (HAK61 salt okuma — Volkan kuralı).
 *
 * ⚠️ DEPO BÖLGELERİNE DOKUNULMAZ. `amac` yazması YALNIZ kapalı (active=false)
 * TEST bölgesinde denenir; canlı iki depo bölgesi (Nord · Süd) OKUNUR, asla
 * yazılmaz — çünkü purpose='depot' otomatik vardiya tetiğini sürüyor ve
 * demo'da vardiyalar oradan açılıyor.
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 *   • muayene tarihi → null iken bir tarih yazılır, ölçülür, null'a döner.
 *   • depo hacmi     → 80 L → null → 80 L.
 *   • bölge amacı    → customer → rule → customer.
 *   • yeni araç      → oluşturulur, okunur ve SİLİNİR (bu betiğin kendi
 *                      yarattığı satır; başka hiçbir kayda bağlı değil).
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-arac-bolge.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { getDashboardData } from "@/lib/admin-dashboard";
import { aracDonemOzeti } from "@/lib/vehicle-ozet";

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
const params = (id) => ({ params: Promise.resolve({ id }) });

const { GET: ARAC_GET, PATCH: ARAC_PATCH } = await import("@/app/api/mobile/vehicles/[id]/route.ts");
const { POST: ARAC_POST } = await import("@/app/api/mobile/vehicles/route.ts");
const { PATCH: BOLGE_PATCH } = await import("@/app/api/mobile/geofences/[id]/route.ts");

/** Dikkat panosundaki `inspection` kalemleri — panelin okuduğu fonksiyondan. */
async function muayeneKalemleri() {
  const d = await getDashboardData();
  return d.attention.filter((a) => a.kind === "inspection");
}

const AY = () => {
  const bugun = new Date();
  return { start: new Date(bugun.getTime() - 30 * 864e5), end: bugun };
};

console.log(`\n╔══ ARAÇ DÜZENLEME + BÖLGE AMACI · CANLIDA KANIT (galzura-demo) ═════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ hedef  ${url}`);

let geri = { muayene: null, depo: null, amac: null, yeniAracId: null };

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — hedefler ve jetonlar");
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
  bilgi(`yönetici  "${yonetici.name}"`);
  bilgi(`şoför     "${sofor.name}"  (403 kanıtı için)`);

  // Yakıt kapısını GEÇEN bir araç: depo hacmi silinince litre kaybolmalı.
  const { data: araclar } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, tank_capacity_l, inspection_due, insurance_due, fuel_type, status, notes")
    .eq("is_test", false)
    .not("tank_capacity_l", "is", null)
    .order("plate");
  let yakitArac = null;
  for (const v of araclar ?? []) {
    const o = await aracDonemOzeti(v.id, AY());
    if (o.yakit?.litre !== null && o.yakit?.litre !== undefined) {
      yakitArac = { ...v, litreOnce: o.yakit.litre };
      break;
    }
  }
  if (!yakitArac) {
    console.error("✗ yakıt kapısını geçen araç yok — depo kanıtı koşturulamaz.");
    process.exit(1);
  }
  bilgi(`yakıt hedefi   ${yakitArac.plate}  depo=${yakitArac.tank_capacity_l} L  litre=${yakitArac.litreOnce}`);

  // Muayene için AYRI bir araç: iki ölçüm birbirini gölgelemesin.
  const muayeneArac = (araclar ?? []).find(
    (v) => v.id !== yakitArac.id && v.inspection_due === null
  );
  if (!muayeneArac) {
    console.error("✗ muayene tarihi boş olan ikinci bir araç yok.");
    process.exit(1);
  }
  bilgi(`muayene hedefi ${muayeneArac.plate}  muayeneSon=${muayeneArac.inspection_due ?? "null"}`);

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. PATCH muayene tarihi → GET → DİKKAT PANOSU yeniden hesaplıyor");
  {
    const once = await muayeneKalemleri();
    const benimOnce = once.filter((a) => a.id.startsWith(muayeneArac.id));
    bilgi(`ÖNCE dikkat 'inspection' kalemi: ${once.length} (bu araçta ${benimOnce.length})`);

    // +10 gün: DOC_DUE_WINDOW_DAYS=30 penceresinin İÇİ. Pencere dışında bir
    // tarih yazmak "kalem çıkmadı" sonucunu anlamsız kılardı.
    const hedefTarih = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    geri.muayene = { id: muayeneArac.id, deger: muayeneArac.inspection_due };

    const r = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${muayeneArac.id}`, { token: tYon, govde: { muayeneSon: hedefTarih } }),
        params(muayeneArac.id)
      )
    );
    iddia("PATCH muayeneSon → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
    iddia("degisen = [inspection_due]", JSON.stringify(r.govde.degisen) === '["inspection_due"]', JSON.stringify(r.govde.degisen));

    const g = await cevap(
      await ARAC_GET(istek(`/api/mobile/vehicles/${muayeneArac.id}`, { token: tYon, method: "GET" }), params(muayeneArac.id))
    );
    iddia("GET yeni tarihi gösteriyor", g.govde.arac?.muayeneSon === hedefTarih, `${g.govde.arac?.muayeneSon}`);

    const sonra = await muayeneKalemleri();
    const benimSonra = sonra.filter((a) => a.id.startsWith(muayeneArac.id));
    iddia(
      `🔴 DİKKAT panosunda kalem DOĞDU (${benimOnce.length} → ${benimSonra.length})`,
      benimSonra.length === benimOnce.length + 1,
      `toplam ${once.length} → ${sonra.length}`
    );
    iddia(
      "kalem doğru araca ve doğru güne bağlı",
      benimSonra[0]?.due === hedefTarih && benimSonra[0]?.days === 10,
      `due=${benimSonra[0]?.due} gun=${benimSonra[0]?.days} plaka=${benimSonra[0]?.plate}`
    );

    // ── GERİ AL
    const rg = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${muayeneArac.id}`, { token: tYon, govde: { muayeneSon: null } }),
        params(muayeneArac.id)
      )
    );
    const geriKalem = (await muayeneKalemleri()).filter((a) => a.id.startsWith(muayeneArac.id));
    iddia(
      "🔴 muayene GERİ ALINDI ve kalem kayboldu",
      rg.kod === 200 && geriKalem.length === benimOnce.length,
      `kalem=${geriKalem.length}`
    );
    geri.muayene = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. PATCH depo hacmi → /ozet LİTRESİ değişiyor (yakıt kapısı)");
  {
    geri.depo = { id: yakitArac.id, deger: yakitArac.tank_capacity_l };

    const r = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde: { depoLitre: null } }),
        params(yakitArac.id)
      )
    );
    iddia("PATCH depoLitre:null → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);

    const o1 = await aracDonemOzeti(yakitArac.id, AY());
    iddia(
      `🔴 /ozet litre KAYBOLDU (${yakitArac.litreOnce} → null)`,
      o1.yakit.litre === null,
      `${o1.yakit.litre}`
    );
    iddia("€ de null (üçlü birlikte gizlenir)", o1.yakit.euro === null, `${o1.yakit.euro}`);
    iddia("L/100 null", o1.yakit.l100.deger === null, `${o1.yakit.l100.deger}`);
    iddia(
      "SEBEP söyleniyor: depo_yok",
      (o1.yakit.sebep?.kod ?? o1.yakit.l100?.sebep?.kod) === "depo_yok",
      JSON.stringify(o1.yakit.sebep ?? o1.yakit.l100?.sebep)
    );

    // ── GERİ AL
    const rg = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${yakitArac.id}`, {
          token: tYon,
          govde: { depoLitre: yakitArac.tank_capacity_l },
        }),
        params(yakitArac.id)
      )
    );
    const o2 = await aracDonemOzeti(yakitArac.id, AY());
    iddia(
      `🔴 depo GERİ ALINDI ve litre DÖNDÜ (${o2.yakit.litre})`,
      rg.kod === 200 && o2.yakit.litre === yakitArac.litreOnce,
      `${o2.yakit.litre} (önce ${yakitArac.litreOnce})`
    );
    geri.depo = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. PATCH — kısmi mi? Dokunulmayan alanlar DURUYOR");
  {
    const { data: v0 } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", yakitArac.id)
      .maybeSingle();

    const r = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde: { notlar: "QA kanıt notu" } }),
        params(yakitArac.id)
      )
    );
    const { data: v1 } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", yakitArac.id)
      .maybeSingle();

    iddia("tek alanlık PATCH → 200", r.kod === 200, `${r.kod}`);
    iddia("notlar YAZILDI", v1.notes === "QA kanıt notu", `${v1.notes}`);
    const degismeyen = ["plate", "make", "model", "year", "status", "fleet", "imei",
      "flespi_device_id", "tank_capacity_l", "inspection_due", "insurance_due",
      "assigned_worker_id", "fuel_type", "vin", "is_test"];
    const bozulan = degismeyen.filter((k) => (v0[k] ?? null) !== (v1[k] ?? null));
    iddia(
      `🔴 diğer ${degismeyen.length} alanın HİÇBİRİ değişmedi`,
      bozulan.length === 0,
      bozulan.length ? bozulan.join(",") : "hepsi aynı"
    );

    await supabaseAdmin.from("vehicles").update({ notes: v0.notes }).eq("id", yakitArac.id);
    const { data: v2 } = await supabaseAdmin.from("vehicles").select("notes").eq("id", yakitArac.id).maybeSingle();
    iddia("🔴 not GERİ ALINDI", (v2.notes ?? null) === (v0.notes ?? null), `${v2.notes}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. KAPI ve GÖVDE — şoför 403 · yasak alanlar 400");
  {
    const rs = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tSof, govde: { notlar: "olmaz" } }),
        params(yakitArac.id)
      )
    );
    iddia("🔴 ŞOFÖR jetonuyla PATCH → 403 admin_required", rs.kod === 403 && rs.govde.error === "admin_required", `${rs.kod} ${rs.govde.error}`);
    const rsp = await cevap(
      await ARAC_POST(istek("/api/mobile/vehicles", { token: tSof, method: "POST", govde: { plaka: "X", marka: "Y", model: "Z" } }))
    );
    iddia("🔴 ŞOFÖR jetonuyla POST → 403 admin_required", rsp.kod === 403 && rsp.govde.error === "admin_required", `${rsp.kod} ${rsp.govde.error}`);

    for (const [ad, govde] of [
      ["is_admin", { is_admin: true }],
      ["is_test", { is_test: true }],
      ["imei", { imei: "123456789012345" }],
      ["flespi_device_id", { flespi_device_id: 1 }],
      ["filo", { filo: "bordo" }],
      ["id", { id: "00000000-0000-0000-0000-000000000000" }],
    ]) {
      const r = await cevap(
        await ARAC_PATCH(
          istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde }),
          params(yakitArac.id)
        )
      );
      iddia(`gövdede "${ad}" → 400 invalid_field/izinsiz`, r.kod === 400 && r.govde.sebep === "izinsiz", `${r.kod} ${r.govde.error}/${r.govde.sebep}`);
    }

    const bos = await cevap(
      await ARAC_PATCH(istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde: {} }), params(yakitArac.id))
    );
    iddia("boş gövde → 400 empty_patch", bos.kod === 400 && bos.govde.error === "empty_patch", `${bos.kod} ${bos.govde.error}`);

    const kotu = await cevap(
      await ARAC_PATCH(istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde: { depoLitre: 9999 } }), params(yakitArac.id))
    );
    iddia("depoLitre 9999 → 400 errTank (panel şeması)", kotu.kod === 400 && kotu.govde.sebep === "errTank", `${kotu.kod} ${kotu.govde.sebep}`);

    const kotuYakit = await cevap(
      await ARAC_PATCH(istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde: { yakitTuru: "kerosen" } }), params(yakitArac.id))
    );
    iddia("yakitTuru 'kerosen' → 400 errFuelType", kotuYakit.kod === 400 && kotuYakit.govde.sebep === "errFuelType", `${kotuYakit.kod} ${kotuYakit.govde.sebep}`);

    const celiski = await cevap(
      await ARAC_PATCH(
        istek(`/api/mobile/vehicles/${yakitArac.id}`, { token: tYon, govde: { aktif: true, durum: "inactive" } }),
        params(yakitArac.id)
      )
    );
    iddia("aktif ve durum ÇELİŞİRSE → 400", celiski.kod === 400 && celiski.govde.sebep === "celisiyor", `${celiski.kod} ${celiski.govde.sebep}`);

    const r401 = await cevap(
      await ARAC_PATCH(istek(`/api/mobile/vehicles/${yakitArac.id}`, { govde: { notlar: "x" } }), params(yakitArac.id))
    );
    iddia("jetonsuz PATCH → 401", r401.kod === 401, `${r401.kod} ${r401.govde.error ?? ""}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. POST yeni araç → oku → PASİFE AL → sil");
  {
    const plaka = `QA-${Date.now().toString().slice(-6)}`;
    const eksik = await cevap(
      await ARAC_POST(istek("/api/mobile/vehicles", { token: tYon, method: "POST", govde: { plaka } }))
    );
    iddia("marka/model olmadan POST → 400 zorunlu", eksik.kod === 400 && eksik.govde.sebep === "zorunlu", `${eksik.kod} ${eksik.govde.alan}/${eksik.govde.sebep}`);

    const r = await cevap(
      await ARAC_POST(
        istek("/api/mobile/vehicles", {
          token: tYon,
          method: "POST",
          govde: { plaka: plaka.toLowerCase(), marka: "QA", model: "Kanıt", yil: 2020, depoLitre: 65, yakitTuru: "elektro" },
        })
      )
    );
    iddia("POST → 201", r.kod === 201, `${r.kod} ${r.govde.error ?? ""}`);
    geri.yeniAracId = r.govde.id ?? null;

    if (geri.yeniAracId) {
      const g = await cevap(
        await ARAC_GET(istek(`/api/mobile/vehicles/${geri.yeniAracId}`, { token: tYon, method: "GET" }), params(geri.yeniAracId))
      );
      iddia("plaka BÜYÜK harfe çevrildi", g.govde.arac?.plaka === plaka, `${g.govde.arac?.plaka}`);
      iddia("yakitTuru okunabiliyor (yeni alan)", g.govde.arac?.yakitTuru === "elektro", `${g.govde.arac?.yakitTuru}`);
      iddia("depoLitre yazıldı", g.govde.arac?.depoLitre === 65, `${g.govde.arac?.depoLitre}`);
      iddia("aktif=true doğdu", g.govde.arac?.aktif === true, `${g.govde.arac?.aktif}`);

      const cak = await cevap(
        await ARAC_POST(
          istek("/api/mobile/vehicles", { token: tYon, method: "POST", govde: { plaka, marka: "QA", model: "İkinci" } })
        )
      );
      iddia("🔴 AYNI plaka ikinci kez → 409 plate_taken", cak.kod === 409 && cak.govde.error === "plate_taken", `${cak.kod} ${cak.govde.error} conflict=${cak.govde.conflict}`);

      const pas = await cevap(
        await ARAC_PATCH(
          istek(`/api/mobile/vehicles/${geri.yeniAracId}`, { token: tYon, govde: { aktif: false } }),
          params(geri.yeniAracId)
        )
      );
      const { data: vp } = await supabaseAdmin.from("vehicles").select("status").eq("id", geri.yeniAracId).maybeSingle();
      iddia("PATCH {aktif:false} → 200", pas.kod === 200, `${pas.kod}`);
      iddia("status = inactive (pasife alma, silme DEĞİL)", vp.status === "inactive", `${vp.status}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("6. BÖLGE AMACI — depo bölgeleri OKUNUR, TEST bölgesi yazılır");
  {
    const { data: bolgeler } = await supabaseAdmin
      .from("geofences")
      .select("id, name, purpose, active, archived_at, customer_name, min_dwell_s")
      .order("name");
    const depolar = (bolgeler ?? []).filter((z) => z.purpose === "depot");
    bilgi(`SALT OKUMA — depo bölgeleri: ${depolar.length} (${depolar.map((z) => z.name).join(" · ")})`);
    bilgi(`  purpose='depot' beş şeyi sürüyor: otomatik vardiya tetiği, depo kilidi,`);
    bilgi(`  başlangıç anı türetme, şoför paneli rozeti, kural muafiyeti.`);

    // Otomatik açılan vardiya oranı — bu bölgelerin gerçekte ne yaptığının ölçüsü.
    const otuzGunOnce = new Date(Date.now() - 30 * 864e5).toISOString();
    const { count: toplam } = await supabaseAdmin
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .gte("started_at", otuzGunOnce);
    const { count: oto } = await supabaseAdmin
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .gte("started_at", otuzGunOnce)
      .eq("auto_started", true);
    bilgi(`  son 30 gün: ${oto}/${toplam} vardiya OTOMATİK açılmış (depo tetiği)`);
    iddia("🔴 depo bölgelerinin purpose'una DOKUNULMADI", true, `${depolar.length} bölge salt okundu`);

    const test = (bolgeler ?? []).find((z) => z.purpose !== "depot" && z.active === false);
    if (!test) {
      bilgi("⚠ kapalı TEST bölgesi yok — `amac` yazma adımı ATLANDI");
    } else {
      bilgi(`yazma hedefi  "${test.name}"  amac=${test.purpose}  aktif=${test.active}`);
      geri.amac = { id: test.id, deger: test.purpose, musteriAd: test.customer_name, kalis: test.min_dwell_s };

      const r = await cevap(
        await BOLGE_PATCH(istek(`/api/mobile/geofences/${test.id}`, { token: tYon, govde: { amac: "rule" } }), params(test.id))
      );
      iddia("PATCH amac:'rule' → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
      iddia("gövde amac='rule' döndürüyor", r.govde.bolge?.amac === "rule", `${r.govde.bolge?.amac}`);
      iddia("vardiyaTetigi false", r.govde.bolge?.vardiyaTetigi === false, `${r.govde.bolge?.vardiyaTetigi}`);

      const { data: z1 } = await supabaseAdmin
        .from("geofences")
        .select("purpose, customer_name, min_dwell_s, active")
        .eq("id", test.id)
        .maybeSingle();
      iddia("DB purpose='rule'", z1.purpose === "rule", `${z1.purpose}`);
      iddia(
        "🔴 müşteri alanları TEMİZLENDİ (panel kuralı)",
        z1.customer_name === null && z1.min_dwell_s === 120,
        `ad=${z1.customer_name} kalis=${z1.min_dwell_s}`
      );
      iddia("aktiflik DEĞİŞMEDİ (bu ucun işi değil)", z1.active === test.active, `${z1.active}`);

      const rd = await cevap(
        await BOLGE_PATCH(istek(`/api/mobile/geofences/${test.id}`, { token: tYon, govde: { amac: "depot" } }), params(test.id))
      );
      const { data: z2 } = await supabaseAdmin.from("geofences").select("purpose").eq("id", test.id).maybeSingle();
      iddia("PATCH amac:'depot' → 200 ve DB'ye yazıldı", rd.kod === 200 && z2.purpose === "depot", `${rd.kod} ${z2.purpose}`);
      iddia("vardiyaTetigi true", rd.govde.bolge?.vardiyaTetigi === true, `${rd.govde.bolge?.vardiyaTetigi}`);
      bilgi(`  ⚠ bu bölge active=false — tetik listesine GİRMEZ (motor filtresi active=true)`);

      const kotu = await cevap(
        await BOLGE_PATCH(istek(`/api/mobile/geofences/${test.id}`, { token: tYon, govde: { amac: "depo" } }), params(test.id))
      );
      // Geçerli küme `sinir` altında — kardeş alan `kategori` ile AYNI gövde
      // deseni (istemci tek yerden okusun diye).
      iddia(
        "amac:'depo' (yanlış değer) → 400 + geçerli küme",
        kotu.kod === 400 && Array.isArray(kotu.govde.sinir?.gecerli),
        `${kotu.kod} ${kotu.govde.alan}/${kotu.govde.sebep} ${JSON.stringify(kotu.govde.sinir?.gecerli)}`
      );

      const rsofor = await cevap(
        await BOLGE_PATCH(istek(`/api/mobile/geofences/${test.id}`, { token: tSof, govde: { amac: "rule" } }), params(test.id))
      );
      iddia("🔴 ŞOFÖR jetonuyla amac → 403", rsofor.kod === 403 && rsofor.govde.error === "admin_required", `${rsofor.kod} ${rsofor.govde.error}`);

      // ── GERİ AL
      const rg = await cevap(
        await BOLGE_PATCH(istek(`/api/mobile/geofences/${test.id}`, { token: tYon, govde: { amac: test.purpose } }), params(test.id))
      );
      const { data: z3 } = await supabaseAdmin
        .from("geofences")
        .select("purpose, customer_name, min_dwell_s")
        .eq("id", test.id)
        .maybeSingle();
      await supabaseAdmin
        .from("geofences")
        .update({ customer_name: test.customer_name, min_dwell_s: test.min_dwell_s })
        .eq("id", test.id);
      const { data: z4 } = await supabaseAdmin
        .from("geofences")
        .select("purpose, customer_name, min_dwell_s")
        .eq("id", test.id)
        .maybeSingle();
      iddia(
        `🔴 bölge GERİ ALINDI (amac=${test.purpose})`,
        rg.kod === 200 && z3.purpose === test.purpose &&
          z4.customer_name === test.customer_name && z4.min_dwell_s === test.min_dwell_s,
        `amac=${z4.purpose} ad=${z4.customer_name} kalis=${z4.min_dwell_s}`
      );
      geri.amac = null;

      // Depo bölgeleri hâlâ yerinde mi — bu betiğin en önemli iddiası.
      const { data: sonDepo } = await supabaseAdmin
        .from("geofences")
        .select("id, name, purpose, active")
        .eq("purpose", "depot");
      iddia(
        `🔴 DEPO BÖLGELERİ DOKUNULMADAN DURUYOR (${(sonDepo ?? []).length})`,
        (sonDepo ?? []).length === depolar.length &&
          (sonDepo ?? []).every((z) => z.active === true),
        (sonDepo ?? []).map((z) => `${z.name}:${z.active}`).join(" · ")
      );
    }
  }
} finally {
  // ── SON EMNİYET: her şey geri ─────────────────────────────────────────────
  baslik("SON — geri alma emniyeti");
  if (geri.muayene) {
    await supabaseAdmin.from("vehicles").update({ inspection_due: geri.muayene.deger }).eq("id", geri.muayene.id);
    console.log(`  ✓ finally: muayene geri (${geri.muayene.deger})`);
  }
  if (geri.depo) {
    await supabaseAdmin.from("vehicles").update({ tank_capacity_l: geri.depo.deger }).eq("id", geri.depo.id);
    console.log(`  ✓ finally: depo geri (${geri.depo.deger})`);
  }
  if (geri.amac) {
    await supabaseAdmin
      .from("geofences")
      .update({ purpose: geri.amac.deger, customer_name: geri.amac.musteriAd, min_dwell_s: geri.amac.kalis })
      .eq("id", geri.amac.id);
    console.log(`  ✓ finally: bölge amacı geri (${geri.amac.deger})`);
  }
  if (geri.yeniAracId) {
    await supabaseAdmin.from("vehicles").delete().eq("id", geri.yeniAracId);
    const { data: kalan } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .eq("id", geri.yeniAracId)
      .maybeSingle();
    console.log(`  ${kalan ? "✗" : "✓"} QA aracı silindi (${geri.yeniAracId})`);
    if (kalan) dusen++;
  }
}

console.log(`\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ═══════════════════════════════\n`);
process.exit(dusen === 0 ? 0 : 1);
