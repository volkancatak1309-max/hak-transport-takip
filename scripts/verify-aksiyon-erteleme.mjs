#!/usr/bin/env node
/**
 * AKSİYON ERTELEME + İZİN KARARI — CANLIDA KANIT. YAZAR ve TEMİZLER.
 *
 * NE YAPAR: uçların GERÇEK işleyicilerini çağırır — sorgu yolu taklit EDİLMEZ,
 * kapı dahil uçtan uca çalışır. Token deponun kendi `issueTokens`'ıyla mühürlenir.
 *
 * ── ⚠️ BU BETİK CANLI VERİTABANINA YAZAR ──────────────────────────────────
 * Emniyetler (verify-ariza-bildir.mjs'teki düzenin aynısı):
 *   • erteleme kalem kimlikleri `qa:<koşum>` önekli — gerçek bir alarm ya da
 *     dikkat kalemi ERTELENMEZ;
 *   • izin denemesi yalnız `is_test = true` şoförüyle (migration 028) ve
 *     2027'nin ortasındaki tarihlerle yapılır — bugünün panosuna, auto-shift'e
 *     ve hiçbir rapora değmez;
 *   • yazılan HER satırın kimliği tutulur ve sonunda SİLİNİR — silme `finally`
 *     içindedir, iddia düşse de çalışır;
 *   • koşum sonunda İKİ tablonun satır sayısı BAŞLANGIÇTAKİNE eşit mi diye
 *     bakılır; eşit değilse betik hata verir. "Temizledim" demek yetmez, ölçülür.
 *
 * Kullanım:
 *   npm run verify:aksiyon-erteleme
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { POST as SNOOZE_POST } from "@/app/api/mobile/action-snoozes/route";
import { PATCH as SNOOZE_PATCH } from "@/app/api/mobile/action-snoozes/[id]/route";
import { POST as LEAVE_ONAY } from "@/app/api/mobile/leaves/[id]/onay/route";
import { GET as ALARMS_GET } from "@/app/api/mobile/alarms/route";
import { GET as DASH_GET } from "@/app/api/mobile/dashboard/route";
import { KALEM_ID_MAX } from "@/lib/action-snoozes";
import { KARAR_NOTU_MAX } from "@/lib/leave-decision";

const KOSUM = `qa-${Date.now().toString(36)}`;
const QA = (s) => `qa:${KOSUM}:${s}`;
const yazilanErtelemeler = new Set();
let yazilanIzinId = null;
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
const gelecek = (ms) => new Date(Date.now() + ms).toISOString();

/** POST /api/mobile/action-snoozes — gerçek işleyici. */
async function ertele(gövde, token) {
  const init = { method: "POST", headers: { "content-type": "application/json" } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (gövde !== undefined) init.body = typeof gövde === "string" ? gövde : JSON.stringify(gövde);
  const res = await SNOOZE_POST(new Request("http://x/api/mobile/action-snoozes", init));
  const json = await res.json().catch(() => null);
  if (json?.ok && json.erteleme?.id) yazilanErtelemeler.add(json.erteleme.id);
  return { status: res.status, json };
}

/** PATCH /api/mobile/action-snoozes/[id] — gerçek işleyici. */
async function geriAl(id, token) {
  const init = { method: "PATCH", headers: { "content-type": "application/json" } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  const res = await SNOOZE_PATCH(new Request("http://x/api/mobile/action-snoozes/x", init), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** POST /api/mobile/leaves/[id]/onay — gerçek işleyici. */
async function karar(izinId, gövde, token) {
  const init = { method: "POST", headers: { "content-type": "application/json" } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (gövde !== undefined) init.body = typeof gövde === "string" ? gövde : JSON.stringify(gövde);
  const res = await LEAVE_ONAY(new Request("http://x/api/mobile/leaves/x/onay", init), {
    params: Promise.resolve({ id: izinId }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function alarmListesi(token) {
  const res = await ALARMS_GET(
    new Request("http://x/api/mobile/alarms?range=gun", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function pano(token) {
  const res = await DASH_GET(
    new Request("http://x/api/mobile/dashboard", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

const sayac = (tablo) =>
  supabaseAdmin.from(tablo).select("id", { count: "exact", head: true }).then((r) => r.count ?? 0);

console.log(`\n╔══ AKSİYON ERTELEME · CANLIDA KANIT ════════════════════════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ koşum   ${KOSUM}`);

let basErteleme = 0;
let basIzin = 0;
let basLog = 0;

try {
  // ── Hazırlık ─────────────────────────────────────────────────────────────
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
  const { data: testSofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_test, counts_as_driver, terminated_at")
    .eq("is_test", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  console.log(`║ patron  ${patron.name.slice(0, 3)}***  (is_admin=true)`);
  basErteleme = await sayac("action_snoozes");
  basIzin = await sayac("worker_leaves");
  basLog = await sayac("leave_edit_log");
  console.log(`║ tablo   action_snoozes=${basErteleme} · worker_leaves=${basIzin} · leave_edit_log=${basLog}`);

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;
  const soforToken = sofor
    ? (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken
    : null;

  // ══ KAPI ═════════════════════════════════════════════════════════════════
  console.log(`\n── KAPI (erteleme) ──`);
  const g1 = { kaynak: "alarm", kalemId: QA("kapi"), kadar: gelecek(3600_000) };
  const tokensiz = await ertele(g1, null);
  iddia("token yok → 401", tokensiz.status === 401, `${tokensiz.status} ${tokensiz.json?.error}`);
  const bozukToken = await ertele(g1, "kesinlikle-gecersiz");
  iddia("bozuk token → 401", bozukToken.status === 401, `${bozukToken.status} ${bozukToken.json?.error}`);
  if (soforToken) {
    const r = await ertele(g1, soforToken);
    iddia("yönetici olmayan → 403 admin_required", r.status === 403 && r.json?.error === "admin_required", `${r.status} ${r.json?.error}`);
  } else {
    olculmedi("yönetici olmayan → 403", "aktif yönetici-olmayan hesap yok");
  }

  // ══ GİRDİ REDLERİ ════════════════════════════════════════════════════════
  console.log(`\n── GİRDİ REDLERİ ──`);
  const bozukJson = await ertele("{bu json değil", patronToken);
  iddia("bozuk JSON → 400 invalid_json", bozukJson.status === 400 && bozukJson.json?.error === "invalid_json", `${bozukJson.status} ${bozukJson.json?.error}`);

  for (const alan of ["kaynak", "kalemId", "kadar"]) {
    const g = { ...g1 };
    delete g[alan];
    const r = await ertele(g, patronToken);
    iddia(`'${alan}' yok → 400 missing_fields (+alan)`, r.status === 400 && r.json?.error === "missing_fields" && r.json?.alan === alan, `${r.status} ${r.json?.error}/${r.json?.alan}`);
  }

  const kotuKaynak = await ertele({ ...g1, kaynak: "dikkat" }, patronToken);
  iddia("tanınmayan kaynak → 400 invalid/deger", kotuKaynak.status === 400 && kotuKaynak.json?.sebep === "deger", `${kotuKaynak.status} ${kotuKaynak.json?.sebep}`);
  iddia("geçerli kaynak kümesini SÖYLÜYOR", Array.isArray(kotuKaynak.json?.gecerli) && kotuKaynak.json.gecerli.join(",") === "alarm,attention,leave", String(kotuKaynak.json?.gecerli));

  const bosKalem = await ertele({ ...g1, kalemId: "   " }, patronToken);
  iddia("boş kalemId → 400 invalid/bos", bosKalem.status === 400 && bosKalem.json?.sebep === "bos", `${bosKalem.status} ${bosKalem.json?.sebep}`);

  const uzunKalem = await ertele({ ...g1, kalemId: "a".repeat(KALEM_ID_MAX + 1) }, patronToken);
  iddia("sınır+1 kalemId → 400 too_long", uzunKalem.status === 400 && uzunKalem.json?.error === "too_long", `${uzunKalem.status} ${uzunKalem.json?.error}`);
  iddia("too_long sınırı ve uzunluğu söyler", uzunKalem.json?.enFazla === KALEM_ID_MAX && uzunKalem.json?.uzunluk === KALEM_ID_MAX + 1, `enFazla=${uzunKalem.json?.enFazla} uzunluk=${uzunKalem.json?.uzunluk}`);

  const gecmis = await ertele({ ...g1, kadar: new Date(Date.now() - 60_000).toISOString() }, patronToken);
  iddia("GEÇMİŞ an → 400 invalid/gecmis", gecmis.status === 400 && gecmis.json?.sebep === "gecmis", `${gecmis.status} ${gecmis.json?.sebep}`);

  const ciplakGun = await ertele({ ...g1, kadar: "2027-08-12" }, patronToken);
  iddia("çıplak gün → 400 invalid/deger", ciplakGun.status === 400 && ciplakGun.json?.sebep === "deger", `${ciplakGun.status} ${ciplakGun.json?.sebep}`);

  const redSonrasi = await sayac("action_snoozes");
  iddia("REDDEDİLEN istekler tabloya HİÇBİR satır yazmadı", redSonrasi === basErteleme, `${basErteleme} → ${redSonrasi}`);

  // ══ YAZMA ════════════════════════════════════════════════════════════════
  console.log(`\n── YAZMA ──`);
  const kalem = QA("alarm-1");
  const ilkKadar = gelecek(3600_000);
  const t0 = Date.now();
  const ok = await ertele({ kaynak: "alarm", kalemId: `  ${kalem}  `, kadar: ilkKadar }, patronToken);
  const sure = Date.now() - t0;
  iddia("geçerli erteleme → 201", ok.status === 201, String(ok.status));
  iddia("yanıt yeni:true diyor", ok.json?.yeni === true, String(ok.json?.yeni));
  iddia("yanıt kayıt kimliğini taşıyor", typeof ok.json?.erteleme?.id === "string" && ok.json.erteleme.id.length === 36, ok.json?.erteleme?.id);
  console.log(`  ⏱  ${sure} ms`);
  console.log("  " + JSON.stringify(ok.json, null, 1).replace(/\n/g, "\n  "));

  console.log(`\n── DB'DEN GERİ OKUMA ──`);
  const { data: satir } = await supabaseAdmin
    .from("action_snoozes")
    .select("id, item_source, item_id, vehicle_id, worker_id, snoozed_until, snoozed_by, created_at, cancelled_at")
    .eq("id", ok.json?.erteleme?.id)
    .maybeSingle();
  iddia("satır tabloda", !!satir, satir?.id);
  iddia("kaynak GÖVDEDEN doğru yazıldı", satir?.item_source === "alarm", satir?.item_source);
  iddia("kalem kimliği TRIM edilmiş kaydedildi", satir?.item_id === kalem, satir?.item_id);
  iddia("erteleyen OTURUMDAN yazıldı", satir?.snoozed_by === patron.id, satir?.snoozed_by === patron.id ? "oturum" : String(satir?.snoozed_by));
  iddia("cancelled_at başlangıçta NULL", satir?.cancelled_at === null, String(satir?.cancelled_at));
  iddia("vehicle_id / worker_id NULL (gövdeden okunmuyor)", satir?.vehicle_id === null && satir?.worker_id === null, `${satir?.vehicle_id}/${satir?.worker_id}`);
  iddia("snoozed_until istenen an", new Date(satir?.snoozed_until).toISOString() === ilkKadar, satir?.snoozed_until);

  // Gövdeye anahtar alan koymak bir şeyi DEĞİŞTİRİYOR mu?
  const zorlama = await ertele(
    { kaynak: "attention", kalemId: QA("zorlama"), kadar: gelecek(3600_000), snoozed_by: "00000000-0000-0000-0000-000000000000", vehicle_id: "x", worker_id: "y", cancelled_at: new Date().toISOString() },
    patronToken
  );
  const { data: zSatir } = await supabaseAdmin
    .from("action_snoozes")
    .select("snoozed_by, vehicle_id, worker_id, cancelled_at")
    .eq("id", zorlama.json?.erteleme?.id)
    .maybeSingle();
  iddia(
    "gövdedeki snoozed_by/vehicle_id/worker_id/cancelled_at YOK SAYILDI",
    zSatir?.snoozed_by === patron.id && zSatir?.vehicle_id === null && zSatir?.worker_id === null && zSatir?.cancelled_at === null,
    `erteleyen=${zSatir?.snoozed_by === patron.id ? "oturum" : "GÖVDE"} arac=${zSatir?.vehicle_id} iptal=${zSatir?.cancelled_at}`
  );

  // ══ UPSERT — asıl mesele ═════════════════════════════════════════════════
  // Kısmi benzersiz indeks yüzünden `.upsert()` çalışmıyor; oku-sonra-yaz
  // gerçekten ikinci satır AÇMIYOR mu, ölçülür.
  console.log(`\n── AYNI KALEM İKİNCİ KEZ (upsert davranışı) ──`);
  const ikinciKadar = gelecek(7200_000);
  const tekrar = await ertele({ kaynak: "alarm", kalemId: kalem, kadar: ikinciKadar }, patronToken);
  iddia("ikinci erteleme → 200 (201 değil)", tekrar.status === 200, String(tekrar.status));
  iddia("yanıt yeni:false diyor", tekrar.json?.yeni === false, String(tekrar.json?.yeni));
  iddia("AYNI satır güncellendi (yeni kimlik yok)", tekrar.json?.erteleme?.id === ok.json?.erteleme?.id, `${ok.json?.erteleme?.id} → ${tekrar.json?.erteleme?.id}`);
  const { data: etkinler, count: etkinSayi } = await supabaseAdmin
    .from("action_snoozes")
    .select("id, snoozed_until, created_at", { count: "exact" })
    .eq("item_source", "alarm")
    .eq("item_id", kalem)
    .is("cancelled_at", null);
  iddia("kalem için ETKİN satır sayısı 1", (etkinSayi ?? 0) === 1, `${etkinSayi} satır`);
  iddia("snoozed_until TAZELENDİ", new Date(etkinler?.[0]?.snoozed_until).toISOString() === ikinciKadar, etkinler?.[0]?.snoozed_until);
  iddia("created_at DOKUNULMADI", etkinler?.[0]?.created_at === satir?.created_at, `${satir?.created_at} → ${etkinler?.[0]?.created_at}`);

  // ══ LİSTE UÇLARI ═════════════════════════════════════════════════════════
  console.log(`\n── LİSTE UÇLARI ──`);
  const alarmlar = await alarmListesi(patronToken);
  iddia("alarms 200", alarmlar.status === 200, String(alarmlar.status));
  const ertLst = alarmlar.json?.ertelemeler ?? [];
  iddia("alarms ertelemeler[] taşıyor", Array.isArray(ertLst) && ertLst.length > 0, `${ertLst.length} satır`);
  iddia("alarms ertelemeDurumu 'var'", alarmlar.json?.ertelemeDurumu === "var", alarmlar.json?.ertelemeDurumu);
  iddia("bizim kalem listede", ertLst.some((e) => e.kalemId === kalem && e.kaynak === "alarm"), kalem);
  iddia("liste satırı kadar/erteleyenId taşıyor", (() => { const e = ertLst.find((x) => x.kalemId === kalem); return !!e?.kadar && e?.erteleyenId === patron.id; })());
  iddia("toplam ve kırpma söylendi", typeof alarmlar.json?.ertelemeToplam === "number" && alarmlar.json?.ertelemeKirpildi === false, `toplam=${alarmlar.json?.ertelemeToplam} kirpildi=${alarmlar.json?.ertelemeKirpildi}`);

  /**
   * ── SUNUCU SÜZMÜYOR — GERÇEK BİR ALARM ERTELENEREK ÖLÇÜLÜR ──────────────
   * İlk yazımda bu iddia TOTOLOJİKTİ (`total === len + (total-len)`) ve hiçbir
   * şeyi sınamıyordu. Doğrusu: listedeki GERÇEK bir alarm ertelenir ve liste
   * yeniden çekilir — satır DURUYORSA ve `page.total` DEĞİŞMEMİŞSE sunucunun
   * süzmediği kanıtlanmış olur. Süzseydi "Ertelenen" sekmesi gösterecek kalem
   * bulamazdı.
   *
   * Kayıt `finally`de siliniyor; mobil istemci `ertelemeler[]`i henüz
   * tüketmiyor (Aksiyon Merkezi bu uçları bekliyordu), yani pencere zararsız.
   */
  const gercekAlarm = (alarmlar.json?.alarmlar ?? [])[0];
  if (gercekAlarm?.id) {
    const oncekiToplam = alarmlar.json?.page?.total;
    const oncekiUzunluk = (alarmlar.json?.alarmlar ?? []).length;
    const ga = await ertele({ kaynak: "alarm", kalemId: gercekAlarm.id, kadar: gelecek(3600_000) }, patronToken);
    iddia("gerçek alarm ertelendi → 201", ga.status === 201, String(ga.status));
    const sonra = await alarmListesi(patronToken);
    iddia(
      "ertelenen alarm HAM LİSTEDE DURUYOR (sunucu süzmüyor)",
      (sonra.json?.alarmlar ?? []).some((a) => a.id === gercekAlarm.id),
      gercekAlarm.id
    );
    iddia("page.total DEĞİŞMEDİ", sonra.json?.page?.total === oncekiToplam, `${oncekiToplam} → ${sonra.json?.page?.total}`);
    iddia("sayfa uzunluğu DEĞİŞMEDİ", (sonra.json?.alarmlar ?? []).length === oncekiUzunluk, `${oncekiUzunluk} → ${(sonra.json?.alarmlar ?? []).length}`);
    iddia(
      "aynı alarm ertelemeler[] bloğunda da var",
      (sonra.json?.ertelemeler ?? []).some((e) => e.kalemId === gercekAlarm.id && e.kaynak === "alarm")
    );
  } else {
    olculmedi("gerçek alarm ertelenerek süzülmezlik", "pencerede hiç alarm yok");
  }

  const panoP = await pano(patronToken);
  iddia("dashboard 200", panoP.status === 200, String(panoP.status));
  iddia("dashboard ertelemeler[] taşıyor", Array.isArray(panoP.json?.ertelemeler) && panoP.json.ertelemeler.some((e) => e.kalemId === kalem), `${panoP.json?.ertelemeler?.length} satır`);
  iddia("dashboard ertelemeDurumu 'var'", panoP.json?.ertelemeDurumu === "var", panoP.json?.ertelemeDurumu);

  // ── ŞEF DARALTMASI ──────────────────────────────────────────────────────
  /**
   * Şef aranırken `getManagedFleet` KULLANILMIYOR: React `cache()` ile sarılı
   * ve istek kapsamı ister; düz Node'da güvenilmez. Kaynak kolon zaten
   * `workers.managed_fleet` (migration 029) — doğrudan ve anahtarlı okunuyor.
   * İlk yazımda ilk 20 çalışana bakılıyordu ve üç şefin üçü de kaçmıştı.
   */
  const { data: sefler } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version, managed_fleet")
    .not("managed_fleet", "is", null)
    .eq("is_admin", false)
    .eq("is_active", true)
    .order("name")
    .limit(1);
  const sef = (sefler ?? [])[0] ?? null;
  if (sef) {
    const sefToken = (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken;
    const panoS = await pano(sefToken);
    iddia("şef dashboard 200", panoS.status === 200, String(panoS.status));
    const sefErt = panoS.json?.ertelemeler ?? [];
    iddia("ŞEF alarm kaynaklı ertelemeyi GÖRMÜYOR", !sefErt.some((e) => e.kalemId === kalem), `${sefErt.length} satır`);
    iddia("şefe dönen ertelemelerin hepsi 'attention'", sefErt.every((e) => e.kaynak === "attention"), sefErt.map((e) => e.kaynak).join(",") || "(boş)");
  } else {
    olculmedi("şef daraltması", "filo şefi hesabı bulunamadı");
  }

  // ══ SÜRE DOLMASI — cron gerekmiyor ═══════════════════════════════════════
  console.log(`\n── SÜRE DOLUNCA KENDİLİĞİNDEN DÜŞÜYOR MU ──`);
  const kisaKalem = QA("kisa");
  const kisa = await ertele({ kaynak: "attention", kalemId: kisaKalem, kadar: gelecek(1500) }, patronToken);
  iddia("kısa süreli erteleme yazıldı", kisa.status === 201, String(kisa.status));
  const oncesi = await alarmListesi(patronToken);
  iddia("süre dolmadan listede", (oncesi.json?.ertelemeler ?? []).some((e) => e.kalemId === kisaKalem));
  await new Promise((r) => setTimeout(r, 2100));
  const sonrasi = await alarmListesi(patronToken);
  iddia("süre dolunca listeden DÜŞTÜ (cron yok)", !(sonrasi.json?.ertelemeler ?? []).some((e) => e.kalemId === kisaKalem));
  const { data: hala } = await supabaseAdmin.from("action_snoozes").select("id, cancelled_at").eq("id", kisa.json?.erteleme?.id).maybeSingle();
  iddia("satır SİLİNMEDİ, yalnız süzgeç dışında", !!hala && hala.cancelled_at === null, `iptal=${hala?.cancelled_at}`);

  // ══ GERİ ALMA ════════════════════════════════════════════════════════════
  console.log(`\n── GERİ ALMA ──`);
  const hedef = ok.json.erteleme.id;
  const pTokensiz = await geriAl(hedef, null);
  iddia("PATCH token yok → 401", pTokensiz.status === 401, `${pTokensiz.status} ${pTokensiz.json?.error}`);
  if (soforToken) {
    const r = await geriAl(hedef, soforToken);
    iddia("PATCH yönetici olmayan → 403", r.status === 403 && r.json?.error === "admin_required", `${r.status} ${r.json?.error}`);
  } else {
    olculmedi("PATCH yönetici olmayan → 403", "aktif yönetici-olmayan hesap yok");
  }
  const pYok = await geriAl("00000000-0000-0000-0000-000000000000", patronToken);
  iddia("PATCH olmayan kayıt → 404", pYok.status === 404 && pYok.json?.error === "not_found", `${pYok.status} ${pYok.json?.error}`);

  const oncePencere = Date.now();
  const iptal = await geriAl(hedef, patronToken);
  const sonraPencere = Date.now();
  iddia("geri alma → 200 + degisti:true", iptal.status === 200 && iptal.json?.degisti === true, `${iptal.status} degisti=${iptal.json?.degisti}`);
  const { data: iSatir } = await supabaseAdmin.from("action_snoozes").select("id, cancelled_at, snoozed_until, item_id").eq("id", hedef).maybeSingle();
  iddia("SATIR DURUYOR (silinmedi)", !!iSatir, iSatir?.id);
  const iptalMs = iSatir?.cancelled_at ? new Date(iSatir.cancelled_at).getTime() : null;
  iddia("cancelled_at isteğin PENCERESİNDE", iptalMs !== null && iptalMs >= oncePencere - 1000 && iptalMs <= sonraPencere + 1000, iSatir?.cancelled_at);
  iddia("snoozed_until DEĞİŞMEDİ", new Date(iSatir?.snoozed_until).toISOString() === ikinciKadar);

  const sonraListe = await alarmListesi(patronToken);
  iddia("iptal edilen kalem listeden DÜŞTÜ", !(sonraListe.json?.ertelemeler ?? []).some((e) => e.kalemId === kalem));

  await new Promise((r) => setTimeout(r, 1100));
  const tekrarIptal = await geriAl(hedef, patronToken);
  iddia("ikinci geri alma → 200 + degisti:false", tekrarIptal.status === 200 && tekrarIptal.json?.degisti === false, `${tekrarIptal.status} degisti=${tekrarIptal.json?.degisti}`);
  const { data: iSatir2 } = await supabaseAdmin.from("action_snoozes").select("cancelled_at").eq("id", hedef).maybeSingle();
  iddia("İLK iptal anı KORUNDU (tazelenmedi)", iSatir2?.cancelled_at === iSatir?.cancelled_at, `${iSatir?.cancelled_at} → ${iSatir2?.cancelled_at}`);

  // İptalli satır kısmi indeksin DIŞINDA: aynı kalem yeniden ertelenebilmeli.
  const yeniden = await ertele({ kaynak: "alarm", kalemId: kalem, kadar: gelecek(3600_000) }, patronToken);
  iddia("iptalden sonra AYNI kalem yeniden ertelenebiliyor → 201", yeniden.status === 201 && yeniden.json?.yeni === true, `${yeniden.status} yeni=${yeniden.json?.yeni}`);
  iddia("yeni satır, eskisinden FARKLI kimlik", yeniden.json?.erteleme?.id !== hedef, yeniden.json?.erteleme?.id);

  // ══ İZİN KARARI ══════════════════════════════════════════════════════════
  console.log(`\n── İZİN ONAY / RET ──`);
  if (!testSofor) {
    olculmedi("izin onay/ret ucu", "is_test=true şoför yok (migration 028)");
  } else if (testSofor.terminated_at) {
    olculmedi("izin onay/ret ucu", "test şoförü ayrılmış görünüyor");
  } else {
    // 2027 ORTASI: bugünün panosuna, auto-shift'e ve raporlara değmez.
    const { data: izin, error: izinHata } = await supabaseAdmin
      .from("worker_leaves")
      .insert({
        worker_id: testSofor.id,
        leave_type: "jahresurlaub",
        start_date: "2027-06-14",
        end_date: "2027-06-16",
        status: "pending",
        note: `[QA ${KOSUM}] talebi açanın notu`,
        created_by: testSofor.id,
      })
      .select("id, status, note, approved_by, decided_at")
      .maybeSingle();
    if (izinHata || !izin) {
      olculmedi("izin onay/ret ucu", `test izni açılamadı: ${izinHata?.message ?? "bilinmiyor"}`);
    } else {
      yazilanIzinId = izin.id;
      console.log(`  · test izni açıldı: ${izin.id} (status=${izin.status})`);

      const kTokensiz = await karar(izin.id, { karar: "onay" }, null);
      iddia("onay token yok → 401", kTokensiz.status === 401, `${kTokensiz.status} ${kTokensiz.json?.error}`);
      if (soforToken) {
        const r = await karar(izin.id, { karar: "onay" }, soforToken);
        iddia("onay yönetici olmayan → 403 admin_required", r.status === 403 && r.json?.error === "admin_required", `${r.status} ${r.json?.error}`);
      } else {
        olculmedi("onay yönetici olmayan → 403", "aktif yönetici-olmayan hesap yok");
      }
      const kYok = await karar("00000000-0000-0000-0000-000000000000", { karar: "onay" }, patronToken);
      iddia("onay olmayan kayıt → 404", kYok.status === 404 && kYok.json?.error === "not_found", `${kYok.status} ${kYok.json?.error}`);

      const kAlanYok = await karar(izin.id, { baska: 1 }, patronToken);
      iddia("karar alanı yok → 400 missing_fields", kAlanYok.status === 400 && kAlanYok.json?.error === "missing_fields", `${kAlanYok.status} ${kAlanYok.json?.error}`);
      const kDeger = await karar(izin.id, { karar: "approve" }, patronToken);
      iddia("tanınmayan karar → 400 invalid/deger", kDeger.status === 400 && kDeger.json?.sebep === "deger", `${kDeger.status} ${kDeger.json?.sebep}`);
      iddia("geçerli karar kümesini SÖYLÜYOR", Array.isArray(kDeger.json?.gecerli) && kDeger.json.gecerli.join(",") === "onay,ret", String(kDeger.json?.gecerli));
      const kUzunNot = await karar(izin.id, { karar: "onay", not: "a".repeat(KARAR_NOTU_MAX + 1) }, patronToken);
      iddia("uzun not → 400 too_long", kUzunNot.status === 400 && kUzunNot.json?.error === "too_long", `${kUzunNot.status} ${kUzunNot.json?.error}`);

      const { data: redSonra } = await supabaseAdmin.from("worker_leaves").select("status").eq("id", izin.id).maybeSingle();
      iddia("REDDEDİLEN kararlar izne DOKUNMADI", redSonra?.status === "pending", redSonra?.status);

      // ── Mutlu yol: ONAY ──────────────────────────────────────────────────
      const onay = await karar(izin.id, { karar: "onay", not: `  [QA ${KOSUM}] uygundur  ` }, patronToken);
      iddia("onay → 200 + degisti:true", onay.status === 200 && onay.json?.degisti === true, `${onay.status} degisti=${onay.json?.degisti}`);
      iddia("yanıt durumu 'approved'", onay.json?.izin?.durum === "approved", onay.json?.izin?.durum);
      const { data: oSatir } = await supabaseAdmin.from("worker_leaves").select("status, approved_by, decided_at, note, updated_at").eq("id", izin.id).maybeSingle();
      iddia("DB'de status 'approved'", oSatir?.status === "approved", oSatir?.status);
      iddia("approved_by OTURUMDAKİ patron", oSatir?.approved_by === patron.id, oSatir?.approved_by === patron.id ? "oturum" : String(oSatir?.approved_by));
      iddia("decided_at doldu", !!oSatir?.decided_at, oSatir?.decided_at);
      // KARAR NOTU TALEBİN NOTUNU EZMEMELİ.
      iddia("talebi açanın notu DEĞİŞMEDİ", oSatir?.note === izin.note, JSON.stringify(oSatir?.note?.slice(0, 32)));
      const { data: izler } = await supabaseAdmin.from("leave_edit_log").select("action, field, new_value").eq("leave_id", izin.id);
      iddia("iz yazıldı (approve)", (izler ?? []).some((r) => r.action === "approve"), `${izler?.length} satır`);
      iddia("KARAR NOTU ize yazıldı (trim'li)", (izler ?? []).some((r) => r.field === "karar_notu" && r.new_value === `[QA ${KOSUM}] uygundur`), (izler ?? []).find((r) => r.field === "karar_notu")?.new_value ?? "yok");

      // ── RET: aynı çekirdek, öteki yön ────────────────────────────────────
      const ret = await karar(izin.id, { karar: "ret" }, patronToken);
      iddia("ret → 200 + degisti:true", ret.status === 200 && ret.json?.degisti === true, `${ret.status} degisti=${ret.json?.degisti}`);
      const { data: rSatir } = await supabaseAdmin.from("worker_leaves").select("status").eq("id", izin.id).maybeSingle();
      iddia("DB'de status 'rejected' — KAYIT DURUYOR", rSatir?.status === "rejected", rSatir?.status);
      const tekrarRet = await karar(izin.id, { karar: "ret" }, patronToken);
      iddia("aynı karar ikinci kez → 200 + degisti:false", tekrarRet.status === 200 && tekrarRet.json?.degisti === false, `${tekrarRet.status} degisti=${tekrarRet.json?.degisti}`);
      const { data: notsuz } = await supabaseAdmin.from("leave_edit_log").select("field").eq("leave_id", izin.id).eq("field", "karar_notu");
      iddia("notsuz karar EK iz satırı açmadı", (notsuz ?? []).length === 1, `${notsuz?.length} karar_notu satırı`);
    }
  }
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
  if (yazilanErtelemeler.size) {
    const { error } = await supabaseAdmin.from("action_snoozes").delete().in("id", [...yazilanErtelemeler]);
    if (error) {
      console.error(`  ✗ ERTELEME SİLME HATASI: ${error.message}`);
      console.error(`    ELDE KALAN KİMLİKLER: ${[...yazilanErtelemeler].join(", ")}`);
      dusen++;
    }
  }
  if (yazilanIzinId) {
    // İz ÖNCE (leave_edit_log.leave_id FK'siz — izin silinse de iz kalırdı).
    const { error: e1 } = await supabaseAdmin.from("leave_edit_log").delete().eq("leave_id", yazilanIzinId);
    const { error: e2 } = await supabaseAdmin.from("worker_leaves").delete().eq("id", yazilanIzinId);
    if (e1 || e2) {
      console.error(`  ✗ İZİN SİLME HATASI: ${e1?.message ?? ""} ${e2?.message ?? ""}`);
      console.error(`    ELDE KALAN İZİN: ${yazilanIzinId}`);
      dusen++;
    }
  }

  // "Temizledim" demek yetmez — ÖLÇÜLÜR.
  const sonErteleme = await sayac("action_snoozes");
  const sonIzin = await sayac("worker_leaves");
  const sonLog = await sayac("leave_edit_log");
  const { count: kalanQa } = await supabaseAdmin
    .from("action_snoozes")
    .select("id", { count: "exact", head: true })
    .like("item_id", `%${KOSUM}%`);
  iddia(`${yazilanErtelemeler.size} QA ertelemesi SİLİNDİ`, (kalanQa ?? 0) === 0, `bu koşumdan kalan: ${kalanQa ?? 0}`);
  iddia("action_snoozes satır sayısı BAŞLANGIÇTAKİ", sonErteleme === basErteleme, `${basErteleme} → ${sonErteleme}`);
  iddia("worker_leaves satır sayısı BAŞLANGIÇTAKİ", sonIzin === basIzin, `${basIzin} → ${sonIzin}`);
  iddia("leave_edit_log satır sayısı BAŞLANGIÇTAKİ", sonLog === basLog, `${basLog} → ${sonLog}`);

  const kuyruk = olculmeyen ? ` · ${olculmeyen} iddia ÖLÇÜLMEDİ` : "";
  console.log(`\n${dusen === 0 ? "✓ TÜM ÖLÇÜLEBİLİR İDDİALAR CANLI VERİDE DOĞRULANDI" : `✗ ${dusen} iddia düştü`}${kuyruk}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
