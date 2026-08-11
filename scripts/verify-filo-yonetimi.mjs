#!/usr/bin/env node
/**
 * FİLO YÖNETİMİ — CANLIDA KANIT. YAZAR ve GERİ ALIR.
 *
 * NE YAPAR: uçların GERÇEK işleyicilerini çağırır — sorgu yolu taklit EDİLMEZ,
 * kapı dahil uçtan uca çalışır. Token deponun kendi `issueTokens`'ıyla mühürlenir.
 *
 * ── ⚠️ BU BETİK CANLI VERİTABANINA YAZAR ──────────────────────────────────
 * Yazdığı tek şey `vehicles.fleet`. Emniyetler:
 *   • koşum başında TÜM araçların (id → fleet) haritası alınır ve `finally`
 *     içinde HER dokunulan araç eski filosuna geri yazılır;
 *   • taşıma denemesi için ATANMIŞ ŞOFÖRÜ OLMAYAN gerçek araç seçilir — o
 *     araç hiçbir kişinin şef kapsamına girmediği için pencere boyunca kimsenin
 *     listesi değişmez (aday yoksa iddia ÖLÇÜLMEDİ sayılır, uydurulmaz);
 *   • personel taşıma denemesi YALNIZ `is_test = true` şoför + test aracıyla
 *     yapılır (migration 028) — hiçbir gerçek kişiye dokunulmaz;
 *   • koşum sonunda tüm filo dağılımı BAŞLANGIÇTAKİNE eşit mi diye bakılır;
 *     eşit değilse betik hata verir. "Geri aldım" demek yetmez, ölçülür.
 *
 * ── MIGRATION 059 ÇALIŞTIRILMADAN NE ÖLÇÜLÜR ──────────────────────────────
 * GET ve TAŞIMA uçları bugün tam çalışıyor (yazdıkları kolon var) → uçtan uca
 * ölçülür. YENİ FİLO ve YENİDEN ADLANDIRMA `fleets` tablosunu gerektiriyor →
 * bu koşumda girdi redleri ölçülür ve `tablo_yok` cevabının GERÇEKTEN
 * verildiği doğrulanır. 059 çalıştıktan sonra betik yeniden koşulduğunda o
 * bloklar kendiliğinden MUTLU YOLA geçer (tablo varlığına göre dallanıyor).
 *
 * Kullanım:
 *   npm run verify:filo-yonetimi
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { GET as FLEETS_GET, POST as FLEETS_POST } from "@/app/api/mobile/fleets/route";
import { PATCH as FLEET_PATCH } from "@/app/api/mobile/fleets/[id]/route";
import { POST as ATAMA_POST } from "@/app/api/mobile/fleets/[id]/atamalar/route";
import { FILO_ADI_MAX, FILO_TAVANI, ATAMA_LISTE_TAVANI } from "@/lib/fleets";

const YOK_UUID = "00000000-0000-4000-8000-000000000000";
const YOK_UUID_2 = "00000000-0000-4000-8000-000000000001";

let dusen = 0;
let olculmeyen = 0;
/** id → koşum başındaki filo. Geri alma bundan yapılır. */
const baslangicFilolari = new Map();
/** Bu koşumda filosuna dokunulan araçlar. */
const dokunulan = new Set();

function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function olculmedi(baslik, sebep) {
  console.log(`  ○ ${baslik}  —  ÖLÇÜLMEDİ (${sebep})`);
  olculmeyen++;
}

const istek = (url, init = {}, token) => {
  const h = { ...(init.headers ?? {}) };
  if (token) h.authorization = `Bearer ${token}`;
  if (init.body !== undefined) h["content-type"] = "application/json";
  return new Request(url, { ...init, headers: h });
};
const govde = (o) => (typeof o === "string" ? o : JSON.stringify(o));

async function filolar(token) {
  const res = await FLEETS_GET(istek("http://x/api/mobile/fleets", {}, token));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function filoAc(g, token) {
  const init = { method: "POST" };
  if (g !== undefined) init.body = govde(g);
  const res = await FLEETS_POST(istek("http://x/api/mobile/fleets", init, token));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function adlandir(kod, g, token) {
  const init = { method: "PATCH" };
  if (g !== undefined) init.body = govde(g);
  const res = await FLEET_PATCH(istek("http://x/api/mobile/fleets/x", init, token), {
    params: Promise.resolve({ id: kod }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function tasi(kod, g, token) {
  const init = { method: "POST" };
  if (g !== undefined) init.body = govde(g);
  const res = await ATAMA_POST(istek("http://x/api/mobile/fleets/x/atamalar", init, token), {
    params: Promise.resolve({ id: kod }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Canlı filo dağılımı — uçtan BAĞIMSIZ ölçüm (karşılaştırma tabanı). */
async function dagilim() {
  const { data, error } = await supabaseAdmin
    .from("vehicles")
    .select("id, fleet, is_test, assigned_worker_id");
  if (error) throw new Error(`vehicles okunamadı: ${error.message}`);
  return data ?? [];
}

console.log(`\n╔══ FİLO YÖNETİMİ · CANLIDA KANIT ═══════════════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

try {
  // ── Hazırlık ─────────────────────────────────────────────────────────────
  const { data: patron } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", true)
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (!patron) {
    console.error("✗ aktif yönetici hesabı bulunamadı, çıkıyorum.");
    process.exit(1);
  }
  const { data: sofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", false)
    .eq("is_active", true)
    .is("managed_fleet", null)
    .order("name")
    .limit(1)
    .maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version, managed_fleet")
    .not("managed_fleet", "is", null)
    .eq("is_admin", false)
    .eq("is_active", true)
    .order("name")
    .limit(1);
  const sef = (sefler ?? [])[0] ?? null;
  const { data: testSofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_test")
    .eq("is_test", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;
  const soforToken = sofor
    ? (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken
    : null;
  const sefToken = sef
    ? (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken
    : null;

  const basAraclar = await dagilim();
  for (const v of basAraclar) baslangicFilolari.set(v.id, v.fleet);
  const basSayim = {};
  for (const v of basAraclar) basSayim[v.fleet] = (basSayim[v.fleet] ?? 0) + 1;
  console.log(`║ patron  ${patron.name.slice(0, 3)}***`);
  console.log(`║ şef     ${sef ? `${sef.name.slice(0, 3)}*** (${sef.managed_fleet})` : "YOK"}`);
  console.log(`║ araç    ${basAraclar.length} · ham dağılım ${JSON.stringify(basSayim)}`);

  // ══ KAPI ═════════════════════════════════════════════════════════════════
  console.log(`\n── KAPI (dört uç) ──`);
  const kapilar = [
    ["GET /fleets", (t) => filolar(t)],
    ["POST /fleets", (t) => filoAc({}, t)],
    ["PATCH /fleets/mavi", (t) => adlandir("mavi", { ad: "x" }, t)],
    ["POST /fleets/mavi/atamalar", (t) => tasi("mavi", { aracIdleri: [YOK_UUID] }, t)],
  ];
  for (const [ad, cagir] of kapilar) {
    const t0 = await cagir(null);
    iddia(`${ad} · token yok → 401`, t0.status === 401, `${t0.status} ${t0.json?.error}`);
    const t1 = await cagir("kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, t1.status === 401, `${t1.status} ${t1.json?.error}`);
    if (soforToken) {
      const t2 = await cagir(soforToken);
      iddia(`${ad} · şoför → 403 admin_required`, t2.status === 403 && t2.json?.error === "admin_required", `${t2.status} ${t2.json?.error}`);
    } else {
      olculmedi(`${ad} · şoför → 403`, "aktif yönetici-olmayan hesap yok");
    }
    /**
     * ⚠️ ASIL KAPI BU: filo ŞEFİ girerse kendi filosuna karşı filodan araç
     * çekebilir. requireMobileFleetView kullanılsaydı bu iddia düşerdi.
     */
    if (sefToken) {
      const t3 = await cagir(sefToken);
      iddia(`${ad} · FİLO ŞEFİ → 403 admin_required`, t3.status === 403 && t3.json?.error === "admin_required", `${t3.status} ${t3.json?.error}`);
    } else {
      olculmedi(`${ad} · filo şefi → 403`, "filo şefi hesabı yok");
    }
  }

  // ══ LİSTE — SAYILAR BAĞIMSIZ ÖLÇÜMLE KARŞILAŞTIRILIR ═════════════════════
  console.log(`\n── LİSTE ──`);
  const t0 = Date.now();
  const liste = await filolar(patronToken);
  console.log(`  ⏱  ${Date.now() - t0} ms`);
  iddia("GET 200", liste.status === 200, String(liste.status));
  const F = liste.json?.filolar ?? [];
  iddia("filolar[] dolu", Array.isArray(F) && F.length > 0, `${F.length} filo`);
  iddia("tabloDurumu söyleniyor", ["var", "tablo_yok"].includes(liste.json?.tabloDurumu), liste.json?.tabloDurumu);
  iddia(`tavan yanıtta (${FILO_TAVANI})`, liste.json?.enFazlaFilo === FILO_TAVANI, String(liste.json?.enFazlaFilo));
  iddia("filo sayısı tavanı aşmıyor", F.length <= FILO_TAVANI, `${F.length}/${FILO_TAVANI}`);
  iddia("sıra KARARLI (artan)", F.every((f, i) => i === 0 || F[i - 1].sira < f.sira), F.map((f) => f.sira).join("<"));
  iddia("her filoda kod/ad/sıra var", F.every((f) => f.kod && f.ad && Number.isInteger(f.sira)), F.map((f) => `${f.kod}:${f.ad}`).join(" · "));
  iddia("bilinmeyen filo YOK (veri ile tanım uyuşuyor)", (liste.json?.bilinmeyenFilolar ?? []).length === 0, JSON.stringify(liste.json?.bilinmeyenFilolar));
  iddia("sayım KIRPILMADI", liste.json?.sayimKirpildi === false, String(liste.json?.sayimKirpildi));

  /**
   * ── SAYILAR DOĞRU MU: UÇTAN BAĞIMSIZ HESAP ──────────────────────────────
   * Ucun kendi çıktısını kendisiyle karşılaştırmak hiçbir şey kanıtlamaz.
   * Burada araç ve personel sayıları ham tablolardan YENİDEN hesaplanıyor ve
   * ucun söylediğiyle karşılaştırılıyor. Test elemesi de böyle ölçülüyor:
   * test aracı 'mavi' filosunda ve HAM sayı ile ucun sayısı 1 fark etmeli.
   */
  const { data: aktifKadro } = await supabaseAdmin
    .from("workers")
    .select("id, is_test")
    .eq("is_active", true);
  const aktifTestsiz = new Set((aktifKadro ?? []).filter((w) => !w.is_test).map((w) => w.id));
  const beklenenArac = {};
  const beklenenPersonel = {};
  for (const v of basAraclar) {
    if (v.is_test === true) continue;
    beklenenArac[v.fleet] = (beklenenArac[v.fleet] ?? 0) + 1;
    if (v.assigned_worker_id && aktifTestsiz.has(v.assigned_worker_id)) {
      (beklenenPersonel[v.fleet] ??= new Set()).add(v.assigned_worker_id);
    }
  }
  for (const f of F) {
    iddia(
      `${f.kod}: araç sayısı bağımsız hesapla aynı`,
      f.aracSayisi === (beklenenArac[f.kod] ?? 0),
      `uç=${f.aracSayisi} hesap=${beklenenArac[f.kod] ?? 0}`
    );
    iddia(
      `${f.kod}: personel sayısı bağımsız hesapla aynı`,
      f.personelSayisi === (beklenenPersonel[f.kod]?.size ?? 0),
      `uç=${f.personelSayisi} hesap=${beklenenPersonel[f.kod]?.size ?? 0}`
    );
  }
  const testArac = basAraclar.filter((v) => v.is_test === true);
  if (testArac.length > 0) {
    const hamMavi = basSayim[testArac[0].fleet] ?? 0;
    const ucMavi = F.find((f) => f.kod === testArac[0].fleet)?.aracSayisi ?? -1;
    iddia(
      `TEST aracı sayımda YOK (${testArac[0].fleet}: ham ${hamMavi} → uç ${ucMavi})`,
      ucMavi === hamMavi - testArac.length,
      `fark=${hamMavi - ucMavi}`
    );
  } else {
    olculmedi("test aracı elemesi", "is_test=true araç yok (migration 028)");
  }
  const filoluToplam = F.reduce((a, f) => a + f.personelSayisi, 0);
  iddia(
    "filo personeli + filosuz = aktif test-dışı kadro",
    filoluToplam + (liste.json?.filosuzPersonel ?? -1) === aktifTestsiz.size,
    `${filoluToplam} + ${liste.json?.filosuzPersonel} = ${aktifTestsiz.size}`
  );

  const tabloVar = liste.json?.tabloDurumu === "var";
  console.log(`  · migration 059: ${tabloVar ? "UYGULANMIŞ" : "UYGULANMAMIŞ (türetilmiş liste)"}`);

  // ══ YENİ FİLO ════════════════════════════════════════════════════════════
  console.log(`\n── YENİ FİLO (POST) ──`);
  const bozukJson = await filoAc("{bu json değil", patronToken);
  iddia("bozuk JSON → 400 invalid_json", bozukJson.status === 400 && bozukJson.json?.error === "invalid_json", `${bozukJson.status} ${bozukJson.json?.error}`);
  const kotuTip = await filoAc({ ad: 42 }, patronToken);
  iddia("ad tipi yanlış → 400 invalid/tip", kotuTip.status === 400 && kotuTip.json?.sebep === "tip", `${kotuTip.status} ${kotuTip.json?.sebep}`);
  const uzunAd = await filoAc({ ad: "a".repeat(FILO_ADI_MAX + 1) }, patronToken);
  iddia("uzun ad → 400 too_long", uzunAd.status === 400 && uzunAd.json?.error === "too_long", `${uzunAd.status} ${uzunAd.json?.error}`);
  iddia("too_long sınırı ve uzunluğu söyler", uzunAd.json?.enFazla === FILO_ADI_MAX && uzunAd.json?.uzunluk === FILO_ADI_MAX + 1, `enFazla=${uzunAd.json?.enFazla} uzunluk=${uzunAd.json?.uzunluk}`);

  const bosGovde = await filoAc(undefined, patronToken);
  if (tabloVar) {
    iddia("adsız POST → 201 (varsayılan ad)", bosGovde.status === 201, String(bosGovde.status));
    iddia("varsayılan ad 'N. Filo' kalıbında", /^\d+\. Filo$/.test(bosGovde.json?.filo?.ad ?? ""), bosGovde.json?.filo?.ad);
    iddia("ad kiracıya ait DEĞİL (adOzel:false)", bosGovde.json?.filo?.adOzel === false, String(bosGovde.json?.filo?.adOzel));
    // Açılan filo hemen SİLİNİR: bu koşum kalıcı iz bırakmaz.
    if (bosGovde.json?.filo?.kod) {
      await supabaseAdmin.from("fleets").delete().eq("code", bosGovde.json.filo.kod);
      console.log(`  · açılan test filosu silindi: ${bosGovde.json.filo.kod}`);
    }
  } else {
    // ⚠️ ASIL İDDİA: 059 yokken uç SESSİZCE başarısız olmuyor, SEBEBİNİ söylüyor.
    iddia("059 yokken adsız POST → 503 db_error", bosGovde.status === 503 && bosGovde.json?.error === "db_error", `${bosGovde.status} ${bosGovde.json?.error}`);
    iddia("sebep 'tablo_yok' (genel hata DEĞİL)", bosGovde.json?.sebep === "tablo_yok", String(bosGovde.json?.sebep));
    olculmedi("tavan aşımı → 400 limit_reached", "migration 059 uygulanmamış");
  }

  // ══ YENİDEN ADLANDIRMA ═══════════════════════════════════════════════════
  console.log(`\n── YENİDEN ADLANDIRMA (PATCH) ──`);
  const pBozuk = await adlandir("mavi", "{json değil", patronToken);
  iddia("bozuk JSON → 400 invalid_json", pBozuk.status === 400 && pBozuk.json?.error === "invalid_json", `${pBozuk.status} ${pBozuk.json?.error}`);
  const pAlanYok = await adlandir("mavi", { baska: 1 }, patronToken);
  iddia("ad alanı yok → 400 missing_fields", pAlanYok.status === 400 && pAlanYok.json?.error === "missing_fields", `${pAlanYok.status} ${pAlanYok.json?.error}`);
  const pUzun = await adlandir("mavi", { ad: "a".repeat(FILO_ADI_MAX + 1) }, patronToken);
  iddia("uzun ad → 400 too_long", pUzun.status === 400 && pUzun.json?.error === "too_long", `${pUzun.status} ${pUzun.json?.error}`);

  if (tabloVar) {
    const { data: onceki } = await supabaseAdmin.from("fleets").select("code, name").eq("code", "mavi").maybeSingle();
    const yeniAd = `QA ${Date.now().toString(36)}`;
    const r1 = await adlandir("mavi", { ad: `  ${yeniAd}  ` }, patronToken);
    iddia("adlandırma → 200 + degisti:true", r1.status === 200 && r1.json?.degisti === true, `${r1.status} degisti=${r1.json?.degisti}`);
    iddia("ad TRIM edilerek yazıldı", r1.json?.filo?.ad === yeniAd, r1.json?.filo?.ad);
    const { data: sonra } = await supabaseAdmin.from("fleets").select("code, name, sort_order").eq("code", "mavi").maybeSingle();
    iddia("DB'de ad yeni", sonra?.name === yeniAd, sonra?.name);
    iddia("KOD değişmedi", sonra?.code === "mavi", sonra?.code);
    const r2 = await adlandir("mavi", { ad: yeniAd }, patronToken);
    iddia("aynı ad ikinci kez → 200 + degisti:false", r2.status === 200 && r2.json?.degisti === false, `${r2.status} degisti=${r2.json?.degisti}`);
    const r3 = await adlandir("mavi", { ad: "" }, patronToken);
    iddia("boş ad → varsayılana dön (adOzel:false)", r3.status === 200 && r3.json?.filo?.adOzel === false, `${r3.status} adOzel=${r3.json?.filo?.adOzel}`);
    // Eski hâline geri yaz.
    await supabaseAdmin.from("fleets").update({ name: onceki?.name ?? null }).eq("code", "mavi");
    const yok = await adlandir("boyle-bir-filo-yok", { ad: "x" }, patronToken);
    iddia("olmayan filo → 404 not_found", yok.status === 404 && yok.json?.error === "not_found", `${yok.status} ${yok.json?.error}`);
  } else {
    const r = await adlandir("mavi", { ad: "Kuzey" }, patronToken);
    iddia("059 yokken adlandırma → 503 db_error", r.status === 503 && r.json?.error === "db_error", `${r.status} ${r.json?.error}`);
    iddia("sebep 'tablo_yok'", r.json?.sebep === "tablo_yok", String(r.json?.sebep));
  }

  // ══ TAŞIMA — GİRDİ REDLERİ ═══════════════════════════════════════════════
  console.log(`\n── TAŞIMA · GİRDİ REDLERİ ──`);
  const tBozuk = await tasi("mavi", "{json değil", patronToken);
  iddia("bozuk JSON → 400 invalid_json", tBozuk.status === 400 && tBozuk.json?.error === "invalid_json", `${tBozuk.status} ${tBozuk.json?.error}`);
  for (const g of [{}, { aracIdleri: [] }, { aracIdleri: [], personelIdleri: [] }]) {
    const r = await tasi("mavi", g, patronToken);
    iddia(`boş taşıma → 400 missing_fields: ${JSON.stringify(g)}`, r.status === 400 && r.json?.error === "missing_fields" && r.json?.alan === "govde", `${r.status} ${r.json?.error}/${r.json?.alan}`);
  }
  /**
   * ⚠️ EN KRİTİK RET: uuid olmayan kimlik. Ayıklama olmasaydı PostgreSQL 22P02
   * fırlatır, istek 503'e döner ve AYNI GÖVDEDEKİ GEÇERLİ araçlar da taşınmazdı.
   */
  const tKotuId = await tasi("mavi", { aracIdleri: ["abc", YOK_UUID] }, patronToken);
  iddia("uuid olmayan kimlik → 400 invalid/deger", tKotuId.status === 400 && tKotuId.json?.sebep === "deger", `${tKotuId.status} ${tKotuId.json?.sebep}`);
  iddia("bozuk kimliği SÖYLÜYOR", (tKotuId.json?.gecersiz ?? []).join(",") === "abc", String(tKotuId.json?.gecersiz));
  const tUzun = await tasi("mavi", { aracIdleri: Array.from({ length: ATAMA_LISTE_TAVANI + 1 }, () => YOK_UUID) }, patronToken);
  iddia("liste tavanı aşıldı → 400 too_long", tUzun.status === 400 && tUzun.json?.error === "too_long", `${tUzun.status} ${tUzun.json?.error}`);
  const tYokFilo = await tasi("filo3", { aracIdleri: [YOK_UUID] }, patronToken);
  iddia("tanınmayan filo → 404 not_found", tYokFilo.status === 404 && tYokFilo.json?.error === "not_found", `${tYokFilo.status} ${tYokFilo.json?.error}`);
  const tBuyukHarf = await tasi("MAVI", { aracIdleri: [YOK_UUID] }, patronToken);
  iddia("büyük harfli kod ESNETİLMİYOR → 404", tBuyukHarf.status === 404, `${tBuyukHarf.status} ${tBuyukHarf.json?.error}`);

  const redSonrasi = await dagilim();
  iddia(
    "REDDEDİLEN istekler HİÇBİR aracın filosunu değiştirmedi",
    redSonrasi.every((v) => v.fleet === baslangicFilolari.get(v.id)),
    `${redSonrasi.filter((v) => v.fleet !== baslangicFilolari.get(v.id)).length} sapma`
  );

  // ══ TAŞIMA — GERÇEK ARAÇ, SAYI DEĞİŞİYOR MU ══════════════════════════════
  console.log(`\n── TAŞIMA · GERÇEK ARAÇ (sayı ölçümü) ──`);
  /**
   * ŞOFÖRÜ OLMAYAN gerçek araç seçilir: filo şefinin kapsamı araç→şoför
   * bağından türediği için atamasız araç kimsenin listesini değiştirmez.
   */
  const aday = basAraclar.find(
    (v) => v.is_test !== true && !v.assigned_worker_id && v.fleet !== "mavi"
  ) ?? basAraclar.find((v) => v.is_test !== true && !v.assigned_worker_id);
  if (!aday) {
    olculmedi("gerçek araç taşıma + sayı değişimi", "atanmamış gerçek araç yok");
  } else {
    const kaynak = aday.fleet;
    const hedef = F.map((f) => f.kod).find((k) => k !== kaynak);
    if (!hedef) {
      olculmedi("gerçek araç taşıma", "ikinci bir filo yok");
    } else {
      const oncekiKaynak = F.find((f) => f.kod === kaynak)?.aracSayisi ?? -1;
      const oncekiHedef = F.find((f) => f.kod === hedef)?.aracSayisi ?? -1;
      console.log(`  · aday ${aday.id.slice(0, 8)}… ${kaynak} → ${hedef} · ÖNCE ${kaynak}=${oncekiKaynak} ${hedef}=${oncekiHedef}`);

      dokunulan.add(aday.id);
      const r = await tasi(hedef, { aracIdleri: [aday.id] }, patronToken);
      iddia("taşıma → 200", r.status === 200, String(r.status));
      // Kanıt metninde PLAKA YOK (gizlilik kuralı): sayı ve kimlik öneki yeter.
      iddia(
        "yanıt 1 araç taşındı diyor",
        (r.json?.arac?.tasindi ?? []).length === 1,
        `taşınan=${(r.json?.arac?.tasindi ?? []).length} zatenOrada=${(r.json?.arac?.zatenOrada ?? []).length} bulunamadı=${(r.json?.arac?.bulunamadi ?? []).length}`
      );
      iddia("önceki filo doğru bildiriliyor", r.json?.arac?.tasindi?.[0]?.oncekiFilo === kaynak, r.json?.arac?.tasindi?.[0]?.oncekiFilo);
      iddia("plaka yanıtta", typeof r.json?.arac?.tasindi?.[0]?.plaka === "string" && r.json.arac.tasindi[0].plaka.length > 0);

      const { data: dbSatir } = await supabaseAdmin
        .from("vehicles")
        .select("fleet, assigned_worker_id")
        .eq("id", aday.id)
        .maybeSingle();
      iddia("DB'de filo DEĞİŞTİ", dbSatir?.fleet === hedef, `${kaynak} → ${dbSatir?.fleet}`);
      iddia("şoför ataması DEĞİŞMEDİ", (dbSatir?.assigned_worker_id ?? null) === (aday.assigned_worker_id ?? null), String(dbSatir?.assigned_worker_id));

      // ── SAYININ GERÇEKTEN DEĞİŞTİĞİ ÖLÇÜLÜR ─────────────────────────────
      const sonraListe = await filolar(patronToken);
      const yeniKaynak = (sonraListe.json?.filolar ?? []).find((f) => f.kod === kaynak)?.aracSayisi ?? -1;
      const yeniHedef = (sonraListe.json?.filolar ?? []).find((f) => f.kod === hedef)?.aracSayisi ?? -1;
      iddia(`${kaynak} araç sayısı 1 AZALDI`, yeniKaynak === oncekiKaynak - 1, `${oncekiKaynak} → ${yeniKaynak}`);
      iddia(`${hedef} araç sayısı 1 ARTTI`, yeniHedef === oncekiHedef + 1, `${oncekiHedef} → ${yeniHedef}`);

      // Aynı istek ikinci kez: hiçbir şey değişmemeli ve BUNU SÖYLEMELİ.
      const r2 = await tasi(hedef, { aracIdleri: [aday.id] }, patronToken);
      iddia("aynı taşıma ikinci kez → 200", r2.status === 200, String(r2.status));
      iddia("ikinci kez HİÇBİR araç taşınmadı", (r2.json?.arac?.tasindi ?? []).length === 0, JSON.stringify(r2.json?.arac?.tasindi));
      iddia("'zatenOrada' listesinde", (r2.json?.arac?.zatenOrada ?? []).includes(aday.id), JSON.stringify(r2.json?.arac?.zatenOrada));

      // Olmayan araç kimliği: sessizce yutulmuyor.
      const r3 = await tasi(hedef, { aracIdleri: [YOK_UUID] }, patronToken);
      iddia("olmayan araç → 'bulunamadi' listesinde", (r3.json?.arac?.bulunamadi ?? []).includes(YOK_UUID), JSON.stringify(r3.json?.arac?.bulunamadi));
      iddia("olmayan araç taşınmadı", (r3.json?.arac?.tasindi ?? []).length === 0);

      // ── GERİ AL ve SAYININ DÖNDÜĞÜNÜ ÖLÇ ────────────────────────────────
      const geri = await tasi(kaynak, { aracIdleri: [aday.id] }, patronToken);
      iddia("geri taşıma → 200 + 1 araç", geri.status === 200 && (geri.json?.arac?.tasindi ?? []).length === 1, String(geri.status));
      const donusListe = await filolar(patronToken);
      const donKaynak = (donusListe.json?.filolar ?? []).find((f) => f.kod === kaynak)?.aracSayisi ?? -1;
      const donHedef = (donusListe.json?.filolar ?? []).find((f) => f.kod === hedef)?.aracSayisi ?? -1;
      iddia("sayılar BAŞLANGIÇTAKİNE döndü", donKaynak === oncekiKaynak && donHedef === oncekiHedef, `${kaynak}=${donKaynak} ${hedef}=${donHedef}`);
    }
  }

  // ══ TAŞIMA — PERSONEL EKSENİ (yalnız TEST hesabı) ════════════════════════
  console.log(`\n── TAŞIMA · PERSONEL ──`);
  const testAraci = basAraclar.find((v) => v.is_test === true && v.assigned_worker_id);
  if (!testSofor || !testAraci || testAraci.assigned_worker_id !== testSofor.id) {
    olculmedi("personel taşıma (mutlu yol)", "test şoförü + ona atanmış test aracı bulunamadı");
  } else {
    const kaynak = testAraci.fleet;
    const hedef = F.map((f) => f.kod).find((k) => k !== kaynak);
    if (!hedef) {
      olculmedi("personel taşıma", "ikinci bir filo yok");
    } else {
      const oncekiHedefPersonel = F.find((f) => f.kod === hedef)?.personelSayisi ?? -1;
      dokunulan.add(testAraci.id);
      const r = await tasi(hedef, { personelIdleri: [testSofor.id] }, patronToken);
      iddia("personel taşıma → 200", r.status === 200, String(r.status));
      const p = (r.json?.personel ?? [])[0];
      iddia("personel taşındı", p?.tasindi === true, JSON.stringify(p));
      iddia("HANGİ araç üzerinden taşındığı söyleniyor", (p?.araclar ?? []).includes(testAraci.id), JSON.stringify(p?.araclar));
      iddia("araç bloğunda da görünüyor", (r.json?.arac?.tasindi ?? []).some((a) => a.id === testAraci.id));
      const { data: tSatir } = await supabaseAdmin
        .from("vehicles")
        .select("fleet, assigned_worker_id")
        .eq("id", testAraci.id)
        .maybeSingle();
      iddia("DB'de test aracının filosu değişti", tSatir?.fleet === hedef, `${kaynak} → ${tSatir?.fleet}`);
      iddia("şoför ataması KORUNDU", tSatir?.assigned_worker_id === testSofor.id, "atama duruyor");

      /**
       * TEST KAYDI SAYIMA GİRMEZ: test aracı hedef filoya taşındığı hâlde
       * hedefin personel sayısı DEĞİŞMEMELİ. Bu, test elemesinin sayım
       * yolunda gerçekten çalıştığının doğrudan kanıtı.
       */
      const araListe = await filolar(patronToken);
      const yeniHedefPersonel = (araListe.json?.filolar ?? []).find((f) => f.kod === hedef)?.personelSayisi ?? -1;
      iddia("test şoförü personel sayısını DEĞİŞTİRMEDİ", yeniHedefPersonel === oncekiHedefPersonel, `${oncekiHedefPersonel} → ${yeniHedefPersonel}`);

      const geri = await tasi(kaynak, { personelIdleri: [testSofor.id] }, patronToken);
      iddia("personel geri taşındı", geri.status === 200 && (geri.json?.personel ?? [])[0]?.tasindi === true);
    }
  }

  // Aracı OLMAYAN kişi: sessizce başarılı sayılmıyor.
  const { data: aracsizlar } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("id", patron.id);
  const patronunAraci = basAraclar.some((v) => v.assigned_worker_id === patron.id);
  if (!patronunAraci && (aracsizlar ?? []).length > 0) {
    const r = await tasi("mavi", { personelIdleri: [patron.id] }, patronToken);
    const p = (r.json?.personel ?? [])[0];
    iddia("aracı olmayan kişi → tasindi:false + sebep 'arac_yok'", r.status === 200 && p?.tasindi === false && p?.sebep === "arac_yok", JSON.stringify(p));
  } else {
    olculmedi("aracı olmayan kişi → arac_yok", "elde aracı olmayan hesap yok");
  }
  const rYok = await tasi("mavi", { personelIdleri: [YOK_UUID_2] }, patronToken);
  const pYok = (rYok.json?.personel ?? [])[0];
  iddia("olmayan personel → sebep 'yok' ('arac_yok' DEĞİL)", pYok?.sebep === "yok", JSON.stringify(pYok));
} catch (e) {
  /**
   * `finally` içinde `process.exit()` var ve o, fırlatılan hatayı YUTAR
   * (verify-ariza-bildir.mjs'te ölçüldü). Hata burada YAKALANIR ve düşen iddia
   * sayılır — sessiz atlama yok.
   */
  console.error(`\n  ✗ KOŞUM İSTİSNAYLA KESİLDİ: ${e?.stack ?? e}`);
  dusen++;
} finally {
  // ══ TEMİZLİK — iddia düşse de çalışır ════════════════════════════════════
  console.log(`\n── TEMİZLİK ──`);
  for (const id of dokunulan) {
    const eski = baslangicFilolari.get(id);
    if (!eski) continue;
    const { error } = await supabaseAdmin.from("vehicles").update({ fleet: eski }).eq("id", id).neq("fleet", eski);
    if (error) {
      console.error(`  ✗ GERİ ALMA HATASI ${id} → ${eski}: ${error.message}`);
      dusen++;
    }
  }

  // "Geri aldım" demek yetmez — ÖLÇÜLÜR. Tüm filo dağılımı başlangıçtaki mi?
  const { data: son } = await supabaseAdmin.from("vehicles").select("id, fleet");
  const sapma = (son ?? []).filter((v) => baslangicFilolari.get(v.id) !== v.fleet);
  iddia(
    `${dokunulan.size} araç eski filosuna DÖNDÜ`,
    sapma.length === 0,
    sapma.length ? sapma.map((v) => `${v.id.slice(0, 8)}…=${v.fleet}`).join(",") : "sapma yok"
  );
  const sonSayim = {};
  for (const v of son ?? []) sonSayim[v.fleet] = (sonSayim[v.fleet] ?? 0) + 1;
  console.log(`  · son ham dağılım ${JSON.stringify(sonSayim)}`);

  const kuyruk = olculmeyen ? ` · ${olculmeyen} iddia ÖLÇÜLMEDİ` : "";
  console.log(`\n${dusen === 0 ? "✓ TÜM ÖLÇÜLEBİLİR İDDİALAR CANLI VERİDE DOĞRULANDI" : `✗ ${dusen} iddia düştü`}${kuyruk}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
