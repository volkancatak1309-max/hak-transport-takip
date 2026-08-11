#!/usr/bin/env node
/**
 * ARIZA BİLDİRİMİ — CANLIDA KANIT (U7). YAZAR ve TEMİZLER.
 *
 * NE YAPAR: `app/api/mobile/vehicles/[id]/ariza-bildir/route.ts` içindeki
 * GERÇEK `POST` işleyicisini çağırır — sorgu yolu taklit EDİLMEZ, kapı dahil
 * uçtan uca çalışır. Token, deponun kendi `issueTokens`'ı ile mühürlenir.
 *
 * ── ⚠️ BU BETİK CANLI VERİTABANINA YAZAR ──────────────────────────────────
 * Diğer `verify-*` betiklerinin hepsi salt-okunur; bu değil, çünkü sınanan şey
 * bir YAZMA ucudur. Emniyetler:
 *   • hedef araç `is_test = true` olan kalıcı test aracıdır (migration 028);
 *     gerçek bir araca satır girilmez.
 *   • açıklamalar `[QA]` ile başlar ve koşum kimliği taşır.
 *   • yazılan HER satırın kimliği tutulur ve sonunda SİLİNİR — silme `finally`
 *     içindedir, iddia düşse de çalışır.
 *   • koşum sonunda tablonun satır sayısı BAŞLANGIÇTAKİNE eşit mi diye bakılır;
 *     eşit değilse betik hata verir. "Temizledim" demek yetmez, ölçülür.
 *
 * Kullanım:
 *   npm run verify:ariza-bildir
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { POST } from "@/app/api/mobile/vehicles/[id]/ariza-bildir/route";
import { PATCH } from "@/app/api/mobile/fault-reports/[id]/route";
import { GET as VEHICLE_GET } from "@/app/api/mobile/vehicles/[id]/route";
import { ARIZA_ACIKLAMA_MAX } from "@/lib/fault-reports";

const KOSUM = `qa-${Date.now().toString(36)}`;
const yazilanIdler = [];
let dusen = 0;
let olculmeyen = 0;

function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function olculmedi(baslik, sebep) {
  console.log(`  ○ ${baslik}  —  ÖLÇÜLMEDİ (${sebep})`);
  olculmeyen++;
}

/** Gerçek işleyiciyi çağır — Request + Next'in params sözü. */
async function cagir(aracId, gövde, token) {
  const init = { method: "POST", headers: { "content-type": "application/json" } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (gövde !== undefined) init.body = typeof gövde === "string" ? gövde : JSON.stringify(gövde);
  const res = await POST(new Request("http://x/api/mobile/vehicles/x/ariza-bildir", init), {
    params: Promise.resolve({ id: aracId }),
  });
  const json = await res.json().catch(() => null);
  if (json?.ok && json.bildirim?.id) yazilanIdler.push(json.bildirim.id);
  return { status: res.status, json };
}

/** PATCH /api/mobile/fault-reports/[id] — gerçek işleyici. */
async function yama(bildirimId, gövde, token) {
  const init = { method: "PATCH", headers: { "content-type": "application/json" } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (gövde !== undefined) init.body = typeof gövde === "string" ? gövde : JSON.stringify(gövde);
  const res = await PATCH(new Request("http://x/api/mobile/fault-reports/x", init), {
    params: Promise.resolve({ id: bildirimId }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** GET /api/mobile/vehicles/[id] — okuma yüzeyi, gerçek işleyici. */
async function aracDetay(aracId, token) {
  const res = await VEHICLE_GET(
    new Request("http://x/api/mobile/vehicles/x", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ id: aracId }) }
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log(`\n╔══ ARIZA BİLDİRİMİ · CANLIDA KANIT ═════════════════════════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ koşum   ${KOSUM}`);

try {
  // ── Hazırlık: test aracı + patron + patron olmayan bir hesap ─────────────
  const { data: testArac } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, is_test")
    .eq("is_test", true)
    .order("plate")
    .limit(1)
    .maybeSingle();
  if (!testArac) {
    console.error("✗ test aracı yok (migration 028) — canlı araca YAZMAM, çıkıyorum.");
    process.exit(1);
  }
  const { data: patron } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, token_version")
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
    .select("id, name, is_admin, token_version")
    .eq("is_admin", false)
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();

  console.log(`║ araç    ${testArac.plate}  (is_test=${testArac.is_test})`);
  console.log(`║ patron  ${patron.name.slice(0, 3)}***  (is_admin=true)`);

  const { count: basSayi } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id", { count: "exact", head: true });
  console.log(`║ tablo   başlangıç satır sayısı: ${basSayi ?? 0}`);

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;

  // ══ KAPI ═════════════════════════════════════════════════════════════════
  console.log(`\n── KAPI ──`);
  const tokensiz = await cagir(testArac.id, { aciklama: "x" }, null);
  iddia("token yok → 401", tokensiz.status === 401, `${tokensiz.status} ${tokensiz.json?.error}`);

  const bozukToken = await cagir(testArac.id, { aciklama: "x" }, "kesinlikle-gecersiz");
  iddia("bozuk token → 401", bozukToken.status === 401, `${bozukToken.status} ${bozukToken.json?.error}`);

  if (sofor) {
    const soforToken = (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken;
    const r = await cagir(testArac.id, { aciklama: "x" }, soforToken);
    iddia("yönetici olmayan → 403 admin_required", r.status === 403 && r.json?.error === "admin_required", `${r.status} ${r.json?.error}`);
  } else {
    olculmedi("yönetici olmayan → 403", "aktif yönetici-olmayan hesap yok");
  }

  const yokArac = await cagir("00000000-0000-0000-0000-000000000000", { aciklama: "x" }, patronToken);
  iddia("olmayan araç → 404 not_found", yokArac.status === 404 && yokArac.json?.error === "not_found", `${yokArac.status} ${yokArac.json?.error}`);

  // ══ GİRDİ REDLERİ ════════════════════════════════════════════════════════
  console.log(`\n── GİRDİ REDLERİ ──`);
  const bozukJson = await cagir(testArac.id, "{bu json değil", patronToken);
  iddia("bozuk JSON → 400 invalid_json", bozukJson.status === 400 && bozukJson.json?.error === "invalid_json", `${bozukJson.status} ${bozukJson.json?.error}`);

  const alanYok = await cagir(testArac.id, { baska: "x" }, patronToken);
  iddia("alan yok → 400 missing_fields", alanYok.status === 400 && alanYok.json?.error === "missing_fields", `${alanYok.status} ${alanYok.json?.error}`);

  const bos = await cagir(testArac.id, { aciklama: "   \n\t " }, patronToken);
  iddia("yalnız boşluk → 400 invalid/bos", bos.status === 400 && bos.json?.error === "invalid" && bos.json?.sebep === "bos", `${bos.status} ${bos.json?.error}/${bos.json?.sebep}`);

  const tip = await cagir(testArac.id, { aciklama: 42 }, patronToken);
  iddia("sayı gönderildi → 400 invalid/tip", tip.status === 400 && tip.json?.error === "invalid" && tip.json?.sebep === "tip", `${tip.status} ${tip.json?.error}/${tip.json?.sebep}`);

  const uzun = await cagir(testArac.id, { aciklama: "a".repeat(ARIZA_ACIKLAMA_MAX + 1) }, patronToken);
  iddia("sınır+1 → 400 too_long", uzun.status === 400 && uzun.json?.error === "too_long", `${uzun.status} ${uzun.json?.error}`);
  iddia("too_long sınırı ve uzunluğu söyler", uzun.json?.enFazla === ARIZA_ACIKLAMA_MAX && uzun.json?.uzunluk === ARIZA_ACIKLAMA_MAX + 1, `enFazla=${uzun.json?.enFazla} uzunluk=${uzun.json?.uzunluk}`);

  const { count: redSonrasi } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id", { count: "exact", head: true });
  iddia("REDDEDİLEN istekler tabloya HİÇBİR satır yazmadı", (redSonrasi ?? 0) === (basSayi ?? 0), `${basSayi ?? 0} → ${redSonrasi ?? 0}`);

  // ══ MUTLU YOL ════════════════════════════════════════════════════════════
  console.log(`\n── YAZMA ──`);
  const metin = `[QA ${KOSUM}] Rölantide titreşim ve şanzımandan ses geliyor.`;
  const t0 = Date.now();
  const ok = await cagir(testArac.id, { aciklama: `   ${metin}   ` }, patronToken);
  const sure = Date.now() - t0;
  iddia("geçerli bildirim → 201", ok.status === 201, `${ok.status}`);
  iddia("yanıt kayıt kimliğini taşıyor", typeof ok.json?.bildirim?.id === "string" && ok.json.bildirim.id.length === 36, ok.json?.bildirim?.id);
  console.log(`  ⏱  ${sure} ms`);
  console.log("  " + JSON.stringify(ok.json, null, 1).replace(/\n/g, "\n  "));

  // ── Satır GERÇEKTEN yazıldı mı: DB'den geri oku ─────────────────────────
  console.log(`\n── DB'DEN GERİ OKUMA ──`);
  const { data: satir } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id, vehicle_id, reported_by, aciklama, durum, created_at")
    .eq("id", ok.json?.bildirim?.id)
    .maybeSingle();
  iddia("satır tabloda", !!satir, satir?.id);
  iddia("araç YOLDAN yazıldı", satir?.vehicle_id === testArac.id);
  iddia("bildiren OTURUMDAN yazıldı", satir?.reported_by === patron.id);
  iddia("açıklama TRIM edilmiş kaydedildi", satir?.aciklama === metin, JSON.stringify(satir?.aciklama?.slice(0, 24)));
  iddia("durum varsayılanı 'acik'", satir?.durum === "acik", satir?.durum);
  iddia("created_at doldu", !!satir?.created_at, satir?.created_at);

  // Gövdeden `durum` göndermek bir şeyi DEĞİŞTİRİYOR mu?
  const zorlama = await cagir(testArac.id, { aciklama: `[QA ${KOSUM}] durum zorlama denemesi`, durum: "kapali", vehicle_id: "baska", reported_by: "baska" }, patronToken);
  const { data: zSatir } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("vehicle_id, reported_by, durum")
    .eq("id", zorlama.json?.bildirim?.id)
    .maybeSingle();
  iddia("gövdedeki durum/vehicle_id/reported_by YOK SAYILDI",
    zSatir?.durum === "acik" && zSatir?.vehicle_id === testArac.id && zSatir?.reported_by === patron.id,
    `durum=${zSatir?.durum} arac=${zSatir?.vehicle_id === testArac.id ? "yol" : "GÖVDE"} bildiren=${zSatir?.reported_by === patron.id ? "oturum" : "GÖVDE"}`);

  // Tam sınırdaki metin kabul ediliyor mu (kesilmeden)?
  const sinirMetni = `[QA ${KOSUM}] ` + "x".repeat(ARIZA_ACIKLAMA_MAX - `[QA ${KOSUM}] `.length);
  const sinir = await cagir(testArac.id, { aciklama: sinirMetni }, patronToken);
  const { data: sSatir } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("aciklama")
    .eq("id", sinir.json?.bildirim?.id)
    .maybeSingle();
  iddia(`tam sınır (${ARIZA_ACIKLAMA_MAX}) KESİLMEDEN kaydedildi`,
    sinir.status === 201 && sSatir?.aciklama.length === ARIZA_ACIKLAMA_MAX,
    `${sSatir?.aciklama?.length} karakter`);

  const { count: yazmaSonrasi } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id", { count: "exact", head: true });
  iddia("yazılan satır sayısı beklenen", (yazmaSonrasi ?? 0) === (basSayi ?? 0) + yazilanIdler.length, `${basSayi ?? 0} + ${yazilanIdler.length} = ${yazmaSonrasi ?? 0}`);

  // ══ OKUMA YÜZEYİ · GET /vehicles/[id] ════════════════════════════════════
  console.log(`\n── OKUMA (araç detayı) ──`);
  const detay = await aracDetay(testArac.id, patronToken);
  iddia("araç detayı 200", detay.status === 200, String(detay.status));
  const liste = detay.json?.arizaBildirimleri ?? [];
  iddia("bildirimler yanıtta", Array.isArray(liste) && liste.length === yazilanIdler.length, `${liste.length} satır`);
  iddia("liste durumu 'var'", detay.json?.arizaBildirimDurumu === "var", detay.json?.arizaBildirimDurumu);
  iddia("toplam ve kırpma söylendi", detay.json?.arizaBildirimToplam === yazilanIdler.length && detay.json?.arizaBildirimKirpildi === false, `toplam=${detay.json?.arizaBildirimToplam} kirpildi=${detay.json?.arizaBildirimKirpildi}`);
  iddia(
    "YENİDEN ESKİYE sıralı",
    liste.every((r, i) => i === 0 || liste[i - 1].olusturma >= r.olusturma),
    liste.map((r) => r.olusturma?.slice(11, 23)).join(" ")
  );
  iddia("bildiren ADI çözüldü", liste.every((r) => r.bildiren === patron.name), liste[0]?.bildiren ? `${liste[0].bildiren.slice(0, 3)}***` : "null");
  iddia("satır alanları tam", liste.every((r) => r.id && r.aciklama && r.durum && r.olusturma));
  // Cihazın DTC'leriyle KARIŞMAMALI — iki farklı güven düzeyi, iki ayrı dizi.
  iddia(
    "elle bildirimler DTC dizisine karışmadı",
    (detay.json?.arizalar ?? []).every((f) => !yazilanIdler.includes(f.id)),
    `dtc=${(detay.json?.arizalar ?? []).length} elle=${liste.length}`
  );
  console.log("  " + JSON.stringify(liste[0], null, 1).replace(/\n/g, "\n  "));

  // ══ KAPATMA / YENİDEN AÇMA · PATCH ═══════════════════════════════════════
  console.log(`\n── KAPATMA / YENİDEN AÇMA ──`);
  const hedef = ok.json.bildirim.id;

  const pTokensiz = await yama(hedef, { durum: "kapali" }, null);
  iddia("PATCH token yok → 401", pTokensiz.status === 401, `${pTokensiz.status} ${pTokensiz.json?.error}`);
  if (sofor) {
    const soforToken = (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken;
    const r = await yama(hedef, { durum: "kapali" }, soforToken);
    iddia("PATCH yönetici olmayan → 403", r.status === 403 && r.json?.error === "admin_required", `${r.status} ${r.json?.error}`);
  } else {
    olculmedi("PATCH yönetici olmayan → 403", "aktif yönetici-olmayan hesap yok");
  }
  const pYok = await yama("00000000-0000-0000-0000-000000000000", { durum: "kapali" }, patronToken);
  iddia("PATCH olmayan kayıt → 404", pYok.status === 404 && pYok.json?.error === "not_found", `${pYok.status} ${pYok.json?.error}`);

  const pAlanYok = await yama(hedef, { baska: 1 }, patronToken);
  iddia("PATCH alan yok → 400 missing_fields", pAlanYok.status === 400 && pAlanYok.json?.error === "missing_fields", `${pAlanYok.status} ${pAlanYok.json?.error}`);
  const pTip = await yama(hedef, { durum: 1 }, patronToken);
  iddia("PATCH tip yanlış → 400 invalid/tip", pTip.status === 400 && pTip.json?.sebep === "tip", `${pTip.status} ${pTip.json?.sebep}`);
  const pDeger = await yama(hedef, { durum: "islemde" }, patronToken);
  iddia("PATCH bilinmeyen durum → 400 invalid/deger", pDeger.status === 400 && pDeger.json?.sebep === "deger", `${pDeger.status} ${pDeger.json?.sebep}`);
  iddia("PATCH geçerli kümeyi söylüyor", Array.isArray(pDeger.json?.gecerli) && pDeger.json.gecerli.join(",") === "acik,kapali", String(pDeger.json?.gecerli));

  const kapat = await yama(hedef, { durum: "kapali" }, patronToken);
  iddia("kapatma → 200 + degisti:true", kapat.status === 200 && kapat.json?.degisti === true && kapat.json?.bildirim?.durum === "kapali", `${kapat.status} degisti=${kapat.json?.degisti} durum=${kapat.json?.bildirim?.durum}`);
  const { data: kSatir } = await supabaseAdmin.from("vehicle_fault_reports").select("durum, aciklama").eq("id", hedef).maybeSingle();
  iddia("DB'de durum 'kapali'", kSatir?.durum === "kapali", kSatir?.durum);
  iddia("açıklama DEĞİŞMEDİ", kSatir?.aciklama === metin);

  const tekrar = await yama(hedef, { durum: "kapali" }, patronToken);
  iddia("aynı durum ikinci kez → 200 + degisti:false", tekrar.status === 200 && tekrar.json?.degisti === false, `${tekrar.status} degisti=${tekrar.json?.degisti}`);

  const ac = await yama(hedef, { durum: "acik" }, patronToken);
  iddia("YENİDEN AÇMA → 200 + degisti:true", ac.status === 200 && ac.json?.degisti === true && ac.json?.bildirim?.durum === "acik", `${ac.status} durum=${ac.json?.bildirim?.durum}`);
  const { data: aSatir } = await supabaseAdmin.from("vehicle_fault_reports").select("durum").eq("id", hedef).maybeSingle();
  iddia("DB'de durum geri 'acik'", aSatir?.durum === "acik", aSatir?.durum);

  // PATCH gövdesine açıklama koymak satırı değiştiriyor mu?
  await yama(hedef, { durum: "kapali", aciklama: "GEÇMİŞE DÖNÜK DEĞİŞTİRME DENEMESİ" }, patronToken);
  const { data: zSatir2 } = await supabaseAdmin.from("vehicle_fault_reports").select("aciklama").eq("id", hedef).maybeSingle();
  iddia("PATCH gövdesindeki aciklama YOK SAYILDI", zSatir2?.aciklama === metin, JSON.stringify(zSatir2?.aciklama?.slice(0, 24)));

  // Kapalı bildirim listede DURUYOR mu (kaybolmamalı, durumu değişmeli)?
  const detay2 = await aracDetay(testArac.id, patronToken);
  const kapananSatir = (detay2.json?.arizaBildirimleri ?? []).find((r) => r.id === hedef);
  iddia("kapalı bildirim listede DURUYOR", !!kapananSatir && kapananSatir.durum === "kapali", kapananSatir?.durum);
  iddia("liste uzunluğu değişmedi", (detay2.json?.arizaBildirimleri ?? []).length === yazilanIdler.length);
} catch (e) {
  /**
   * ⚠️ `finally` içinde `process.exit()` var ve o, fırlatılan hatayı YUTAR:
   * ilk koşumda okuma bölümü sessizce atlandı ve betik "hepsi geçti" dedi.
   * Hata artık burada YAKALANIR ve düşen iddia sayılır — sessiz atlama yok.
   */
  console.error(`\n  ✗ KOŞUM İSTİSNAYLA KESİLDİ: ${e?.stack ?? e}`);
  dusen++;
} finally {
  // ══ TEMİZLİK — iddia düşse de çalışır ════════════════════════════════════
  console.log(`\n── TEMİZLİK ──`);
  if (yazilanIdler.length) {
    const { error } = await supabaseAdmin
      .from("vehicle_fault_reports")
      .delete()
      .in("id", yazilanIdler);
    if (error) {
      console.error(`  ✗ SİLME HATASI: ${error.message}`);
      console.error(`    ELDE KALAN KİMLİKLER: ${yazilanIdler.join(", ")}`);
      dusen++;
    }
  }
  const { count: sonSayi } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id", { count: "exact", head: true });
  const { count: kalanQa } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id", { count: "exact", head: true })
    .like("aciklama", `%${KOSUM}%`);
  iddia(`${yazilanIdler.length} QA satırı SİLİNDİ`, (kalanQa ?? 0) === 0, `bu koşumdan kalan: ${kalanQa ?? 0}`);
  console.log(`  tablo son satır sayısı: ${sonSayi ?? 0}`);

  const kuyruk = olculmeyen ? ` · ${olculmeyen} iddia ÖLÇÜLMEDİ` : "";
  console.log(`\n${dusen === 0 ? "✓ TÜM ÖLÇÜLEBİLİR İDDİALAR CANLI VERİDE DOĞRULANDI" : `✗ ${dusen} iddia düştü`}${kuyruk}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
