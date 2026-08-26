#!/usr/bin/env node
/**
 * SAKLAMA EKRANI — RENDER KANITI (migration 090).
 *
 * Kardeş betik (`verify-saklama.mjs`) motoru ölçüyor. Bu betik EKRANI ölçüyor:
 * üretim derlemesi (`next start`), gerçek iron-session çerezi, gerçek HTML.
 *
 * Dört soru:
 *   1. "Sistem otomatik silmez" cümlesi ekranda YAZILI mı?
 *   2. Uyarı görünüyor mu — ve yasal çıpa DOĞRULANMADIYSA sayı yazmıyor mu?
 *   3. 'yasal_zorunlu' veri için silme seçeneği RENDER EDİLMİYOR mu?
 *   4. Yönetici panosunun üstünde uyarı şeridi çıkıyor mu?
 *
 * ⚠️ `NEXT_PUBLIC_*` derleme anında gömülür: QA yığınına bakan bir `next start`
 * için QA env'iyle YENİDEN DERLEMEK şart (bu turda doğrulandı — üretim
 * URL'iyle derlenmiş sunucu QA anahtarını GERÇEK Supabase'e gönderdi ve
 * "Invalid API key" aldı).
 *
 * Kullanım (docs/SAKLAMA-POLITIKASI.md §Prova):
 *   set -a; . <qa env>; set +a
 *   npm run build && npx next start -p 3300 &
 *   node scripts/verify-saklama-ekran.mjs
 */
import { sealData } from "iron-session";

const TABAN = "http://127.0.0.1:3300";
const YONETICI = "aa000001-0000-4000-8000-000000000001";

let dusen = 0;
let gecen = 0;
const iddia = (b, k, kanit = "") => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (k) gecen++;
  else dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);

const cerez = await sealData(
  { worker_id: YONETICI, name: "QA Yonetici", phone: "+430000090001", is_admin: true },
  { password: process.env.SESSION_PASSWORD, ttl: 0 }
);

/**
 * 🔴 GÖRÜNEN METİN, GÖMÜLÜ SÖZLÜK DEĞİL.
 *
 * Next tüm i18n sözlüğünü `self.__next_f.push(...)` içine gömüyor. Ham HTML'de
 * arama yapmak, sözlükteki metni "ekranda var" sanır. Bu tuzağa bu projede İKİ
 * KEZ düşüldü; iddialar <script> blokları çıkarılmış metinde aranır.
 */
async function sayfa(yol) {
  const r = await fetch(TABAN + yol, {
    headers: { cookie: `hak_session=${cerez}` },
    redirect: "manual",
  });
  const ham = await r.text();
  return { durum: r.status, html: ham.replace(/<script[\s\S]*?<\/script>/g, "") };
}

async function ayarla(uyariGun, ulkeKodu) {
  const { execSync } = await import("node:child_process");
  execSync(
    `docker exec hak-qa psql -U postgres -d hak -q -c "update public.tenant_saklama set uyari_gun=${uyariGun}, ulke_kodu='${ulkeKodu}';"`,
    { stdio: "pipe" }
  );
}

async function esikYaz(sql) {
  const { execSync } = await import("node:child_process");
  execSync(`docker exec hak-qa psql -U postgres -d hak -q -c "${sql}"`, { stdio: "pipe" });
}

// ═══════════════════════════════════════════════════════════════════════

baslik("1 · OTOMATİK SİLME YOK — ekranda YAZILI");
await ayarla(90, "AT");
{
  const { durum, html } = await sayfa("/admin/saklama");
  iddia("sayfa 200 dönüyor", durum === 200, `HTTP ${durum}`);
  iddia(
    "🔑 'Sistem hiçbir veriyi otomatik silmez' yazılı",
    html.includes("otomatik silmez"),
    "tasarımın ana cümlesi"
  );
  iddia("🔑 'veri sorumlusundadır' yazılı", html.includes("veri sorumlusundadır"));
  iddia("🔑 'Galzura veri işleyendir' yazılı", html.includes("veri işleyendir"));
  iddia("otomatik silme anahtarı YOK", !html.includes("Otomatik silmeyi aç"));
  iddia("'Silme AÇIK/KAPALI' rozeti YOK", !html.includes("Silme AÇIK") && !html.includes("Silme KAPALI"));
}

baslik("2 · VERİ KATEGORİLERİ");
{
  const { html } = await sayfa("/admin/saklama");
  iddia("üç kategori başlığı da görünür", html.includes("Kişisel veri") && html.includes("Araç verisi") && html.includes("Yasal zorunlu"));
  iddia(
    "🔑 hukuki dayanak cümlesi yazılı",
    html.includes("şoförün kişisel verisidir") && html.includes("o an araçta kim vardı"),
    "ayrım araç/şoför değil"
  );
  iddia("🔑 yasal zorunlu 'silinemez' etiketi taşıyor", html.includes("silinemez"));
  iddia("device_telemetry kişisel olarak listeleniyor", html.includes("device_telemetry"));
  iddia("time_entries listede (yasal zorunlu)", html.includes("time_entries"));
  iddia("teslimat_kanitlari listede", html.includes("teslimat_kanitlari"));
}

baslik("3 · SİLME ARACI — yalnız silinebilir tablolar");
{
  const { html } = await sayfa("/admin/saklama");
  iddia("kuru mod düğmesi var", html.includes("Kuru mod"));
  iddia("aralık türleri var", html.includes("Hafta") && html.includes("Ay") && html.includes("İki tarih arası"));
  /**
   * 🔑 EN ÖNEMLİ İDDİA. Silme seçici YALNIZ kişisel/araç tabloları taşır.
   * 'yasal_zorunlu' bir tablo <option> olarak RENDER EDİLMEZ — "denendi ve
   * reddedildi" değil, "seçenek yok".
   */
  const secici = html.match(/<select[^>]*id="tablo"[\s\S]*?<\/select>/)?.[0] ?? "";
  iddia("tablo seçici render edildi", secici.length > 0);
  iddia("🔑 seçicide device_telemetry VAR", secici.includes("device_telemetry"));
  iddia("🔑 seçicide time_entries YOK (yasal zorunlu)", !secici.includes("time_entries"), "seçenek hiç üretilmedi");
  iddia("🔑 seçicide teslimat_kanitlari YOK", !secici.includes("teslimat_kanitlari"));
  iddia("🔑 seçicide saklama_silme_izi YOK", !secici.includes("saklama_silme_izi"));
}

baslik("4 · UYARI — çıpa DOĞRULANMAMIŞKEN sayı yazmaz");
// Kalan veri (ağustos) ~25 günlük; 5 günlük eşik GERÇEK bir uyarı üretir.
await ayarla(5, "AT");
{
  const { html } = await sayfa("/admin/saklama");
  iddia("uyarı görünür", html.includes("uyarı eşiğini geçti"));
  iddia("uyarıda satır sayısı var", /\d[\d.]*\s*satır ham konum/.test(html));
  iddia("en eski kayıt yaşı yazılı", html.includes("En eski kayıt"));
  iddia(
    "🔑 yasal çıpa DOĞRULANMADI diyor",
    html.includes("HENÜZ DOĞRULANMADI") && html.includes("bilerek sayı yazmıyoruz"),
    "uydurma sayı yok"
  );
  iddia("çıpa satırında gün sayısı YOK", !/yasal çıpa: \d+ gün/.test(html));
  // 🔑 QA render provasının yakaladığı kusur: 0 satırlı tablo uyarı olarak basılmamalı.
  // ⚠️ SAYI SINIRI ŞART: "400 satır" metni "0 satır"ı ALT DİZİ olarak
  // içeriyor. İlk yazımda bu iddia yanlış negatif verdi.
  iddia("🔑 SIFIR satırlı tablo uyarı olarak BASILMIYOR", !/(^|[^\d])0 satır ham konum/.test(html), "driver_locations 0 satır");
}

baslik("5 · YÖNETİCİ PANOSU ŞERİDİ");
{
  const { durum, html } = await sayfa("/admin");
  iddia("/admin 200 dönüyor", durum === 200, `HTTP ${durum}`);
  iddia("🔑 uyarı şeridi panoda görünür", html.includes("uyarı eşiğini geçti"));
  // ⚠️ ÖZNİTELİK SIRASI VARSAYILMAZ: Next `class`i `href`ten ÖNCE
  // basıyor. İlk yazımda href-önce varsayan regex eşleşmedi.
  const seritler = html.match(/<a[^>]*>[\s\S]*?<\/a>/g) ?? [];
  const serit = seritler.find((a) => a.includes('href="/admin/saklama"') && a.includes("amber")) ?? "";
  iddia("şerit bir BAĞLANTI ve /admin/saklama'ya gidiyor", serit.length > 0, "nav bağlantısı değil, şeridin kendisi");
  iddia("şeritte de çıpa 'doğrulanmadı' diyor", serit.includes("HENÜZ DOĞRULANMADI"));
}

baslik("6 · ÇIPA DOĞRULANINCA SAYI ÇIKAR");
{
  /**
   * Eşik tablosuna KAYNAKLI bir satır yazınca ekranın davranışı değişmeli.
   * ⚠️ Bu satır YALNIZ QA'da yazılıyor ve testin sonunda siliniyor —
   * migration hâlâ boş kuruluyor.
   */
  await esikYaz(
    "insert into saklama_esikleri (ulke_kodu, veri_turu, esik_gun, yasal_dayanak, kaynak_url, dogrulanma_tarihi) " +
      "values ('AT','ham_konum',60,'QA TEST DAYANAK','https://example.invalid/qa','2026-08-26') " +
      "on conflict (ulke_kodu, veri_turu) do update set esik_gun=60"
  );
  const { html } = await sayfa("/admin/saklama");
  iddia("🔑 çıpa doğrulanınca SAYI çıkıyor", html.includes("60 gün"), "60 gün");
  iddia("çıpayla birlikte DAYANAK da yazılı", html.includes("QA TEST DAYANAK"));
  iddia("artık 'doğrulanmadı' YAZMIYOR", !html.includes("HENÜZ DOĞRULANMADI"));

  // CHECK kısıtı: kaynaksız eşik YAZILAMAZ
  let reddedildi = false;
  try {
    await esikYaz(
      "insert into saklama_esikleri (ulke_kodu, veri_turu, esik_gun) values ('DE','ham_konum',90)"
    );
  } catch {
    reddedildi = true;
  }
  iddia("🔑 KAYNAKSIZ eşik veritabanınca REDDEDİLDİ", reddedildi, "CHECK saklama_esikleri_kaynakli");

  await esikYaz("delete from saklama_esikleri;");
}

baslik("7 · DENETİM İZİ EKRANDA");
{
  const { html } = await sayfa("/admin/saklama");
  iddia("denetim izi bölümü var", html.includes("Silme denetim izi"));
  iddia("🔑 yapılan silme izde görünüyor", html.includes("QA Sofor Bir") && html.includes("device_telemetry"));
  iddia("izde sebep görünüyor", html.includes("QA provasi"));
}

baslik("8 · TEMİZLİK");
await ayarla(90, "AT");
{
  const { html } = await sayfa("/admin/saklama");
  iddia("varsayılana dönüldü", html.includes("90"));
}

console.log(`\n${"═".repeat(60)}`);
console.log(`  GEÇTİ: ${gecen}  ·  KALDI: ${dusen}`);
console.log(`${"═".repeat(60)}\n`);
process.exit(dusen > 0 ? 1 : 0);
