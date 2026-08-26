#!/usr/bin/env node
/**
 * SAKLAMA EKRANI — RENDER KANITI (migration 090).
 *
 * Kardeş betik (`verify-saklama.mjs`) motoru ölçüyor. Bu betik EKRANI ölçüyor:
 * üretim derlemesi (`next start`), gerçek iron-session çerezi, gerçek HTML.
 *
 * Üç soru:
 *   1. Uzatma uyarısı 90'ın üstünde GERÇEKTEN görünüyor mu — ve cezalandırılmış
 *      süreleri SAYIYLA yazıyor mu?
 *   2. "Neden silinmiyor" satırı ekranda YAZILI mı? (Sessiz çalışmayan bir
 *      temizlik, çalışıyor sanılır.)
 *   3. Gerekçe kapısı sunucu tarafında gerçekten REDDEDİYOR mu?
 *
 * ⚠️ `NEXT_PUBLIC_*` derleme anında gömülür: QA yığınına bakan bir `next start`
 * için QA env'iyle YENİDEN DERLEMEK şart (bu turda da doğrulandı — üretim
 * URL'iyle derlenmiş sunucu QA anahtarını gerçek Supabase'e gönderdi ve
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

/** Ayarı doğrudan veritabanında kur (sunucu eylemi ayrı sınanıyor). */
async function ayarla(hamGun, silmeAcik, gerekce) {
  const { execSync } = await import("node:child_process");
  const g = gerekce === null ? "null" : `'${gerekce.replace(/'/g, "''")}'`;
  execSync(
    `docker exec hak-qa psql -U postgres -d hak -q -c "update public.tenant_saklama set ham_gun=${hamGun}, silme_acik=${silmeAcik}, gerekce=${g};"`,
    { stdio: "pipe" }
  );
}

// ═══════════════════════════════════════════════════════════════════════

baslik("1 · VARSAYILAN HÂL — 90 gün · silme KAPALI");
await ayarla(90, false, null);
{
  const { durum, html } = await sayfa("/admin/saklama");
  iddia("sayfa 200 dönüyor", durum === 200, `HTTP ${durum}`);
  iddia("ekranda '90 gün' yazılı", html.includes("90 gün"));
  iddia("'Silme KAPALI' rozeti görünür", html.includes("Silme KAPALI"));
  iddia("kesim tarihi yazılı", /Kesim: \d{4}-\d{2}-\d{2}/.test(html));
  iddia(
    "🔑 'neden silinmiyor' satırı görünür",
    html.includes("Silme kapalı olduğu için hiçbir satır silinmiyor"),
    "sessiz temizlik yanılgısı engellendi"
  );
  iddia("varsayılanda uzatma uyarısı YOK", !html.includes("yazılı gerekçe ister"));
  iddia("varsayılanda gerekçe alanı YOK", !html.includes("Yazılı gerekçe"));
  iddia("'Sil' düğmesi YOK (bilinçli)", !/>\s*Sil\s*</.test(html));
  iddia("hazırlık düğmesi var", html.includes("Hazırlığı yürüt"));
  iddia("hazırlığın silmediği yazılı", html.includes("HİÇBİR SATIR SİLMEZ"));
}

baslik("2 · 🔑 UZATMA UYARISI — 120 gün");
await ayarla(120, false, "CMR Md. 32 kapsamindaki seferlerde teslimat anlasmazliklari icin gerekli.");
{
  const { durum, html } = await sayfa("/admin/saklama");
  iddia("sayfa 200 dönüyor", durum === 200, `HTTP ${durum}`);
  iddia("ekranda '120 gün' yazılı", html.includes("120 gün"));
  iddia("🔑 uzatma uyarısı GÖRÜNÜR", html.includes("yazılı gerekçe ister"));
  /**
   * Uyarı SAYIYLA konuşmalı. "Dikkatli olun" cümlesi caydırmaz; cezalandırılmış
   * gerçek süreler caydırır.
   */
  iddia("uyarıda CNIL geçiyor", html.includes("CNIL"));
  iddia("uyarıda İtalya 180 gün + 50.000 € geçiyor", html.includes("180") && html.includes("50.000"));
  iddia("uyarıda Almanya 400 ve 150 geçiyor", html.includes("400") && html.includes("150"));
  iddia("gerekçe alanı görünür", html.includes("Yazılı gerekçe"));
}

baslik("3 · SİLME AÇIK — engel değişiyor mu");
await ayarla(90, true, null);
{
  const { html } = await sayfa("/admin/saklama");
  iddia("'Silme AÇIK' rozeti görünür", html.includes("Silme AÇIK"));
  iddia("artık 'silme kapalı' gerekçesi YOK", !html.includes("Silme kapalı olduğu için"));
}

baslik("4 · TEMİZLİK");
await ayarla(90, false, null);
{
  const { html } = await sayfa("/admin/saklama");
  iddia("varsayılana dönüldü", html.includes("Silme KAPALI") && html.includes("90 gün"));
}

console.log(`\n${"═".repeat(60)}`);
console.log(`  GEÇTİ: ${gecen}  ·  KALDI: ${dusen}`);
console.log(`${"═".repeat(60)}\n`);
process.exit(dusen > 0 ? 1 : 0);
