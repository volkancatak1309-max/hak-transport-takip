#!/usr/bin/env node
/**
 * İŞ EMRİ UÇLARI — CANLI KANIT (yalnız galzura-demo).
 *
 * ═══ NEDEN HTTP, NEDEN lib ÇAĞRISI DEĞİL ═══
 *
 * Kanıtlanan şeyler DURUM KODLARI: 201 · 400 · 401 · 403 · 404 · 409. Bunlar
 * route dosyasının sözleşmesi; `lib`i doğrudan çağıran bir betik onları hiç
 * görmez ve "uç çalışıyor" demiş olmaz. Bu yüzden ÜRETİM DERLEMESİ
 * (`next start`) ayağa kaldırılır ve GERÇEK demo veritabanına bakan gerçek
 * istekler atılır (giriş kilidi turunun üretim-build QA tekniği).
 *
 * ⚠️ YALNIZ galzura-demo. Proje referansı doğrulanır; HAK61/Sendigo'da DURUR.
 *
 * Kullanım (uygulama ayrı bir kabukta ayakta olmalı):
 *   ENV_FILE=.env.galzura-demo BASE=http://127.0.0.1:3400 \
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-is-emri-uclari.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { mobilJeton } from "./_odul-jeton.mjs";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede; bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supaUrl.includes(DEMO_REF)) {
  console.error(`✗ DURDURULDU — hedef galzura-demo DEĞİL (${supaUrl}).`);
  process.exit(1);
}

const BASE = process.env.BASE ?? "http://127.0.0.1:3400";

// Demo kadrosu — ölçülerek seçildi (21.09.2026).
const ADMIN = "fd942dc6-b354-4119-9650-c71439ca0186"; // Volkan Çatak
const SOFOR = "a4407047-7dc8-4937-a0eb-69a60c98a8de"; // Max Huber
const SOFOR_ARAC = "86a3ac32-9af8-451a-85c1-804d5b614560"; // W-GF-101 (Max'a atanmış)
const YABANCI_ARAC = "c780d46f-1bab-49ed-85a9-b3e79f4ac2fd"; // W-GF-103 (Thomas'a atanmış)

const DAMGA = "[QA is-emri]";
let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);

async function cagir(yol, { jeton, yontem = "GET", govde } = {}) {
  const r = await fetch(`${BASE}${yol}`, {
    method: yontem,
    headers: {
      ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      ...(govde ? { "content-type": "application/json" } : {}),
    },
    ...(govde ? { body: JSON.stringify(govde) } : {}),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* gövdesiz yanıt */
  }
  return { durum: r.status, j };
}

const yaratilan = [];
const ac = async (jeton, govde) => {
  const r = await cagir("/api/mobile/is-emirleri", { jeton, yontem: "POST", govde });
  if (r.j?.emir?.id) yaratilan.push(r.j.emir.id);
  return r;
};

console.log("\n═══ İŞ EMRİ UÇLARI — CANLI KANIT (galzura-demo) ═══");
console.log(`     hedef: ${BASE}`);

const adminJeton = await mobilJeton(ADMIN, true);
const soforJeton = await mobilJeton(SOFOR, false);

// ── ÖN DENETİM · SUNUCU HANGİ VERİTABANINA BAKIYOR ─────────────────────────
/**
 * 🔴 EN TEHLİKELİ NOKTA. Bu betik demo verisine YAZIYOR. Sunucu süreci yanlış
 * kiracıya bakıyorsa (Next `.env.local`i de yüklüyor ve orada HAK61 var), QA
 * satırları CANLI MÜŞTERİ veritabanına düşerdi.
 *
 * Bu yüzden İLK YAZMADAN ÖNCE kimliği kanıtlıyoruz: demo yöneticisinin
 * kimliğiyle mühürlenmiş jeton `/api/mobile/me`de ÇÖZÜLÜYORSA sunucu o kaydı
 * kendi veritabanında bulmuş demektir. HAK61'de bu UUID yok; orada 401 döner
 * ve betik yazmadan durur.
 */
baslik("Ön denetim · sunucu demo veritabanında mı");
{
  const { data: beklenen } = await supabaseAdmin
    .from("workers")
    .select("name")
    .eq("id", ADMIN)
    .maybeSingle();
  const r = await cagir("/api/mobile/me", { jeton: adminJeton });
  const ad = r.j?.user?.adSoyad ?? null;
  const kiraci = r.j?.tenant?.kod ?? null;
  const uyusuyor = r.durum === 200 && !!beklenen?.name && ad === beklenen.name;
  iddia(
    "sunucu DEMO veritabanını görüyor (yönetici kimliği çözüldü)",
    uyusuyor,
    `${r.durum} · uçtan "${ad}" · demoDB "${beklenen?.name ?? "?"}"`
  );
  // Kiracı KODU env'den gelir, kimlik ise VERİTABANINDAN. İkisini ayrı
  // basıyoruz: kod yanlışsa marka/ayar katmanı başka kiracıya bakıyordur.
  console.log(`     kiracı kodu (env): ${kiraci}`);
  if (!uyusuyor) {
    console.error("");
    console.error("✗ DURDURULDU — sunucunun hangi kiracıya baktığı KANITLANAMADI.");
    console.error("  Hiçbir yazma denenmedi. BASE sunucusunu demo env'iyle başlatın.");
    console.error("");
    process.exit(1);
  }
}

// ── 0 · KİMLİK ──────────────────────────────────────────────────────────────
baslik("0 · Kimlik kapıları");
{
  const r = await cagir("/api/mobile/is-emirleri");
  iddia("jetonsuz GET → 401", r.durum === 401, `${r.durum} ${r.j?.error ?? ""}`);
  const p = await cagir("/api/mobile/is-emirleri", {
    yontem: "POST",
    govde: { aracId: SOFOR_ARAC, aciklama: "x" },
  });
  iddia("jetonsuz POST → 401", p.durum === 401, String(p.durum));
  const d = await cagir("/api/mobile/is-emirleri/00000000-0000-0000-0000-000000000000", {
    yontem: "DELETE",
  });
  iddia("jetonsuz DELETE → 401", d.durum === 401, String(d.durum));
}

// ── 1 · AÇ → ÖNCELİK/ATAMA → SERVİSTE → KAPAT ──────────────────────────────
baslik("1 · Yaşam döngüsü (yönetici)");
let emirId = null;
{
  const r = await ac(adminJeton, { aracId: SOFOR_ARAC, aciklama: `${DAMGA} fren sesi` });
  emirId = r.j?.emir?.id ?? null;
  iddia("POST aç → 201", r.durum === 201, String(r.durum));
  iddia("kaynak 'elle'", r.j?.emir?.kaynak === "elle", r.j?.emir?.kaynak);
  iddia("durum 'acik'", r.j?.emir?.durum === "acik", r.j?.emir?.durum);
  iddia("öncelik varsayılan 'normal'", r.j?.emir?.oncelik === "normal", r.j?.emir?.oncelik);
  iddia(
    "plaka çözüldü",
    typeof r.j?.emir?.plaka === "string" && r.j.emir.plaka !== "—",
    r.j?.emir?.plaka
  );
  iddia(
    "bildiren adı çözüldü",
    !!r.j?.emir?.bildiren && r.j.emir.bildiren !== "—",
    r.j?.emir?.bildiren
  );
}
{
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { oncelik: "kritik", atananId: SOFOR },
  });
  iddia("PATCH öncelik+atanan → 200", r.durum === 200, String(r.durum));
  iddia("öncelik 'kritik' yazıldı", r.j?.emir?.oncelik === "kritik", r.j?.emir?.oncelik);
  iddia(
    "atanan id+ad döndü",
    r.j?.emir?.atanan?.id === SOFOR && !!r.j?.emir?.atanan?.ad,
    JSON.stringify(r.j?.emir?.atanan)
  );
}
{
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { durum: "serviste", maliyet: 120.5, servisAt: "2026-09-25" },
  });
  iddia("PATCH serviste → 200", r.durum === 200, String(r.durum));
  iddia("durum 'serviste'", r.j?.emir?.durum === "serviste", r.j?.emir?.durum);
  iddia("maliyet yazıldı", Number(r.j?.emir?.maliyet) === 120.5, String(r.j?.emir?.maliyet));
  iddia(
    "servis tarihi yazıldı",
    String(r.j?.emir?.servisAt ?? "").startsWith("2026-09-25"),
    r.j?.emir?.servisAt
  );
}
{
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { durum: "kapali" },
  });
  iddia("kapanış notu YOKKEN kapatma → 400", r.durum === 400, `${r.durum} ${r.j?.error ?? ""}`);
  iddia(
    "400 alan adıyla söyleniyor",
    r.j?.alan === "kapanisNotu" || r.j?.sebep === "kapatirken_zorunlu",
    JSON.stringify(r.j)
  );
}
{
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { durum: "kapali", kapanisNotu: "Balata degisti." },
  });
  iddia("notla kapatma → 200", r.durum === 200, String(r.durum));
  iddia("durum 'kapali'", r.j?.emir?.durum === "kapali", r.j?.emir?.durum);
  iddia("kapanış damgası düştü", !!r.j?.emir?.kapanis, r.j?.emir?.kapanis);
  iddia(
    "kapanış notu döndü",
    r.j?.emir?.kapanisNotu === "Balata degisti.",
    r.j?.emir?.kapanisNotu
  );
}

// ── 2 · YENİDEN AÇMA — PANEL KURALI (Volkan kararı 21.09.2026) ─────────────
baslik("2 · Yeniden açma SERBEST (panel paritesi)");
{
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { durum: "acik" },
  });
  iddia("kapalı emri yeniden aç → 200 (409 DEĞİL)", r.durum === 200, String(r.durum));
  iddia("durum 'acik'", r.j?.emir?.durum === "acik", r.j?.emir?.durum);
  iddia("kapanış damgası TEMİZLENDİ", r.j?.emir?.kapanis === null, String(r.j?.emir?.kapanis));
}

// ── 3 · SÜZGEÇ VE SIRA ──────────────────────────────────────────────────────
baslik("3 · Süzgeç ve sıralama");
let dusukId = null;
{
  const r = await ac(adminJeton, {
    aracId: SOFOR_ARAC,
    aciklama: `${DAMGA} silecek lastigi`,
    oncelik: "dusuk",
  });
  dusukId = r.j?.emir?.id ?? null;
  iddia("ikinci emir (düşük öncelik) → 201", r.durum === 201, String(r.durum));
}
{
  const r = await cagir("/api/mobile/is-emirleri?durum=acik&limit=200", { jeton: adminJeton });
  const ids = (r.j?.emirler ?? []).map((e) => e.id);
  iddia("GET durum=acik → 200", r.durum === 200, String(r.durum));
  iddia(
    "page bloğu var (limit/offset/total/hasMore)",
    ["limit", "offset", "total", "hasMore"].every((k) => k in (r.j?.page ?? {})),
    JSON.stringify(r.j?.page)
  );
  const vars = await cagir("/api/mobile/is-emirleri", { jeton: adminJeton });
  iddia("varsayılan limit 50", vars.j?.page?.limit === 50, String(vars.j?.page?.limit));
  iddia("kritik emir listede", ids.includes(emirId));
  iddia("düşük emir listede", ids.includes(dusukId));
  iddia(
    "SIRA: kritik, düşükten ÖNCE",
    ids.indexOf(emirId) >= 0 && ids.indexOf(emirId) < ids.indexOf(dusukId),
    `kritik#${ids.indexOf(emirId)} < dusuk#${ids.indexOf(dusukId)}`
  );
}
{
  const r = await cagir("/api/mobile/is-emirleri?durum=kapali&limit=200", { jeton: adminJeton });
  const ids = (r.j?.emirler ?? []).map((e) => e.id);
  iddia("durum=kapali süzgeci açık emri GETİRMİYOR", !ids.includes(emirId), `kapali=${ids.length}`);
}
{
  const r = await cagir(`/api/mobile/is-emirleri?durum=hepsi&arac=${SOFOR_ARAC}&limit=200`, {
    jeton: adminJeton,
  });
  const hepsi = r.j?.emirler ?? [];
  iddia(
    "arac= süzgeci tek araca iniyor",
    hepsi.length > 0 && hepsi.every((e) => e.aracId === SOFOR_ARAC),
    `${hepsi.length} satır`
  );
  const k = await cagir("/api/mobile/is-emirleri?oncelik=kritik&durum=hepsi&limit=200", {
    jeton: adminJeton,
  });
  iddia(
    "oncelik= süzgeci çalışıyor",
    (k.j?.emirler ?? []).every((e) => e.oncelik === "kritik"),
    `${(k.j?.emirler ?? []).length} satır`
  );
  const g = await cagir("/api/mobile/is-emirleri?durum=uydurma", { jeton: adminJeton });
  iddia("geçersiz durum SESSİZCE yok sayılmıyor → 400", g.durum === 400, String(g.durum));
}

// ── 4 · AÇIKLAMA DEĞİŞMEZ ───────────────────────────────────────────────────
baslik("4 · Açıklama değiştirilemez");
{
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { aciklama: "baska bir sey" },
  });
  iddia("PATCH aciklama → 400", r.durum === 400, `${r.durum} ${r.j?.error ?? ""}`);
  iddia("hata kodu immutable_field", r.j?.error === "immutable_field", r.j?.error);
}

// ── 5 · ŞOFÖR ───────────────────────────────────────────────────────────────
baslik("5 · Şoför yolu");
let soforEmirId = null;
{
  const r = await ac(soforJeton, { aracId: SOFOR_ARAC, aciklama: `${DAMGA} sofor bildirimi` });
  soforEmirId = r.j?.emir?.id ?? null;
  iddia("şoför kendi aracına POST → 201", r.durum === 201, String(r.durum));
  iddia("kaynak 'surucu' (roldan türedi)", r.j?.emir?.kaynak === "surucu", r.j?.emir?.kaynak);
}
{
  const r = await cagir("/api/mobile/is-emirleri", {
    jeton: soforJeton,
    yontem: "POST",
    govde: { aracId: SOFOR_ARAC, aciklama: `${DAMGA} oncelikli`, oncelik: "kritik" },
  });
  iddia("şoför öncelik gönderince → 400", r.durum === 400, String(r.durum));
  iddia("hata kodu forbidden_fields", r.j?.error === "forbidden_fields", r.j?.error);
  const a = await cagir("/api/mobile/is-emirleri", {
    jeton: soforJeton,
    yontem: "POST",
    govde: { aracId: SOFOR_ARAC, aciklama: `${DAMGA} atamali`, atananId: SOFOR },
  });
  iddia("şoför atanan gönderince → 400", a.durum === 400, String(a.durum));
}
{
  const r = await cagir("/api/mobile/is-emirleri", {
    jeton: soforJeton,
    yontem: "POST",
    govde: { aracId: YABANCI_ARAC, aciklama: `${DAMGA} baska arac` },
  });
  iddia("şoför BAŞKA araca POST → 403", r.durum === 403, `${r.durum} ${r.j?.error ?? ""}`);
}
{
  const r = await cagir("/api/mobile/is-emirleri", { jeton: soforJeton });
  iddia("şoför liste GET → 403", r.durum === 403, `${r.durum} ${r.j?.error ?? ""}`);
  const p = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: soforJeton,
    yontem: "PATCH",
    govde: { durum: "serviste" },
  });
  iddia("şoför PATCH → 403", p.durum === 403, `${p.durum} ${p.j?.error ?? ""}`);
  const d = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: soforJeton,
    yontem: "DELETE",
  });
  iddia("şoför DELETE → 403", d.durum === 403, `${d.durum} ${d.j?.error ?? ""}`);
}

// ── 6 · ARIZA BİLDİR UCU DA ŞOFÖRE AÇIK ────────────────────────────────────
baslik("6 · ariza-bildir ucu (aynı kural)");
{
  const r = await cagir(`/api/mobile/vehicles/${SOFOR_ARAC}/ariza-bildir`, {
    jeton: soforJeton,
    yontem: "POST",
    govde: { aciklama: `${DAMGA} ariza-bildir sofor` },
  });
  if (r.j?.bildirim?.id) yaratilan.push(r.j.bildirim.id);
  iddia("şoför kendi aracına ariza-bildir → 201", r.durum === 201, String(r.durum));
  const y = await cagir(`/api/mobile/vehicles/${YABANCI_ARAC}/ariza-bildir`, {
    jeton: soforJeton,
    yontem: "POST",
    govde: { aciklama: `${DAMGA} yabanci` },
  });
  iddia("şoför BAŞKA araca ariza-bildir → 403", y.durum === 403, `${y.durum} ${y.j?.error ?? ""}`);
  const a = await cagir(`/api/mobile/vehicles/${YABANCI_ARAC}/ariza-bildir`, {
    jeton: adminJeton,
    yontem: "POST",
    govde: { aciklama: `${DAMGA} yonetici her araca` },
  });
  if (a.j?.bildirim?.id) yaratilan.push(a.j.bildirim.id);
  iddia("yönetici her araca ariza-bildir → 201", a.durum === 201, String(a.durum));
}

// ── 7 · SİLME ───────────────────────────────────────────────────────────────
baslik("7 · Silme kuralları");
{
  const r = await cagir(`/api/mobile/is-emirleri/${dusukId}`, {
    jeton: adminJeton,
    yontem: "DELETE",
  });
  iddia("elle + açık emri sil → 200", r.durum === 200, String(r.durum));
  const g = await cagir(`/api/mobile/is-emirleri/${dusukId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { oncelik: "normal" },
  });
  iddia("silinen emir artık 404", g.durum === 404, String(g.durum));
}
{
  const r = await cagir(`/api/mobile/is-emirleri/${soforEmirId}`, {
    jeton: adminJeton,
    yontem: "DELETE",
  });
  iddia("kaynak 'surucu' emir SİLİNMİYOR → 409", r.durum === 409, `${r.durum} ${r.j?.sebep ?? ""}`);
  iddia("409 sebebi kaynak", r.j?.sebep === "kaynak_elle_degil", r.j?.sebep);
}
{
  const kapat = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "PATCH",
    govde: { durum: "kapali", kapanisNotu: "QA kapanis." },
  });
  const r = await cagir(`/api/mobile/is-emirleri/${emirId}`, {
    jeton: adminJeton,
    yontem: "DELETE",
  });
  iddia(
    "KAPALI emir SİLİNMİYOR → 409",
    kapat.durum === 200 && r.durum === 409,
    `kapat=${kapat.durum} sil=${r.durum}`
  );
  iddia("409 sebebi kapalı", r.j?.sebep === "emir_kapali", r.j?.sebep);
}

// ── TEMİZLİK ────────────────────────────────────────────────────────────────
// ⚠️ Ürün yolu DEĞİL: kalan satırlar 'surucu'/'kapali' olduğu için uçtan
// silinemiyor (kural doğru çalışıyor, kanıtı yukarıda). Demo veritabanını
// kirletmemek için service-role ile kaldırılıyorlar.
baslik("Temizlik (service-role, ürün yolu değil)");
{
  /**
   * ⚠️ TOPLANAN KİMLİKLER YETMİYOR. İlk koşum `| head` ile kesilince süreç
   * temizliğe hiç gelmedi ve iki satır demo veritabanında kaldı; ikinci koşum
   * yalnız KENDİ kimliklerini sildiği için onları göremedi. Silme artık
   * DAMGAYA göre: betiğin yazdığı her satır, hangi koşumdan kalırsa kalsın
   * gider. (Damga yalnız bu betiğin açıklamalarında var.)
   */
  const { error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .delete()
    .like("aciklama", `${DAMGA}%`);
  const { data } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id")
    .like("aciklama", `${DAMGA}%`);
  iddia("QA satırları temizlendi", !error && (data ?? []).length === 0, `kalan ${(data ?? []).length}`);
}

console.log(
  dusen === 0
    ? "\n✓ İŞ EMRİ UÇLARI — tüm iddialar geçti (canlı galzura-demo).\n"
    : `\n✗ ${dusen} iddia DÜŞTÜ.\n`
);
process.exit(dusen === 0 ? 0 : 1);
