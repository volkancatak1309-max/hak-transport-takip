#!/usr/bin/env node
/**
 * GİRİŞSİZ TAKİP SAYFASI — SIZINTI MUHAFIZI.
 *
 * ═══ NEDEN VAR ═══
 *
 * 24.08.2026'da üretim derlemesi + curl ile ÖLÇÜLDÜ: /takip sayfasının kaynağı
 * 112 KB geliyordu ve içinde ürünün TÜM i18n sözlüğü vardı — "Bordo Filo" /
 * "Mavi Filo" (FİLO ADLARI), PIN kuralı metni, flespi alan ipuçları, yönetici
 * ekran etiketleri. Sebep: kök layout sözlüğün tamamını
 * `NextIntlClientProvider`a veriyor ve o da her rotanın sunucu yüküne iniyor.
 * Daraltmadan sonra 22 KB ve sıfır eşleşme.
 *
 * Bu kusur GÖZLE görünmüyordu: sayfa doğru çalışıyor, ekranda hiçbir yabancı
 * metin yok. Yalnız KAYNAĞA bakınca ortaya çıkıyor. Bir sonraki refactor
 * daraltmayı sessizce kaldırabilir — muhafız o yüzden.
 *
 * Beş denetim, hepsi KAYNAK üzerinde (veritabanı gerekmez):
 *   K1 — Girişsiz gövdenin ALAN LİSTESİ. `TakipGorunum` yalnız izinli alanları
 *        taşımalı; yeni bir alan eklemek bilinçli bir karar olmalı.
 *   K2 — Okuma yolu kimlik kolonu SEÇMEMELİ (plate/fleet/name/plaka).
 *   K3 — Şoför adı YALNIZ `TAKIP_SOFOR_ADI` dalında okunmalı (AT DSG §10).
 *   K4 — Girişsiz yüzey, kimlik taşıyan bileşen/fonksiyonları İÇE AKTARMAMALI.
 *   K5 — Kök layout'taki /takip daraltması ve proxy'nin dar matcher'ı yerinde.
 *
 * Kullanım:  npm run lint:takip
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => readFileSync(join(ROOT, p), "utf8");

const hatalar = [];
const notlar = [];

// ── K1 · GÖVDENİN ALAN LİSTESİ ─────────────────────────────────────────────
/**
 * GİRİŞSİZ GÖVDEDE İZİNLİ ALANLAR — her satır bir KARAR.
 *
 * Bu liste bir beyaz liste değil, bir KAYIT: her alanın müşteriye gitmesi
 * bilinçle kabul edilmiştir. Yeni bir alan eklendiğinde muhafız kırılır ve
 * karar yeniden verilir. (083'te tam bu oldu: dört alan eklendi ve buraya
 * gerekçesiyle yazıldı.)
 *
 *   durum         → hazirlaniyor|yolda|vardi. Beş değerli iç çizgi ÜÇE
 *                   indirilmiş; "kabul" damgası çalışan davranışıdır, çıkmaz.
 *   konum         → aracın son noktası. Özelliğin varlık sebebi.
 *   hedef         → YALNIZ geometri. 083'ten sonra DURAK bazlı linkte
 *                   müşterinin KENDİ durağı, aracın sıradakisi değil.
 *   eta           → tahmin. Kademeli ve üst sınırlı (yanlış kesinlik yok).
 *   linkBitisISO  → "bu link ne zaman kapanır" — müşterinin kendi linki.
 *   soforAdi      → YALNIZ TAKIP_SOFOR_ADI açıksa; varsayılan KAPALI (AT DSG
 *                   §10, DE BetrVG §87). K3 ayrıca bunu denetliyor.
 *   etaKaba       → tahminin güvenilirliği (koordinatsız durak vardı). Bir
 *                   NİTELİK bayrağı; hiçbir durağın verisini taşımaz.
 *   durakBagli    → linkin türü (durak mı sefer mi). Ekran dilini belirler;
 *                   müşteri zaten kendi linkinin ne olduğunu biliyor.
 *   onunuzdeDurak → "önünüzde N durak var" (Onfleet'in aynı öğesi).
 *                   ⚠️ SIRA NUMARASI ve TOPLAM DURAK SAYISI BİLEREK YOK: ikisi
 *                   rota büyüklüğünü ve müşterinin turdaki yerini ele verirdi.
 *                   TAKIP_SIRA_ESIGI üstünde null gönderilir.
 *   pencere       → müşterinin KENDİ durağının zaman aralığı. Kendi kısıtı,
 *                   başka durağın penceresi ASLA gönderilmez.
 */
const IZINLI_ALANLAR = [
  "durum",
  "konum",
  "hedef",
  "eta",
  "linkBitisISO",
  "soforAdi",
  "etaKaba",
  "durakBagli",
  "onunuzdeDurak",
  "pencere",
];

const dbKaynak = oku("lib/takip-db.ts");
const tipBlok = dbKaynak.slice(
  dbKaynak.indexOf("export type TakipGorunum = {"),
  dbKaynak.indexOf("export type TakipOkuma")
);
if (!tipBlok) {
  hatalar.push("K1 — TakipGorunum tipi bulunamadı (lib/takip-db.ts değişmiş).");
} else {
  const alanlar = [...tipBlok.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)[?]?:/gm)].map((m) => m[1]);
  const fazla = alanlar.filter((a) => !IZINLI_ALANLAR.includes(a));
  if (fazla.length > 0) {
    hatalar.push(
      `K1 — girişsiz gövdeye YENİ ALAN eklenmiş: ${fazla.join(", ")}\n` +
        "  Bu alan linke tıklayan HERKESE gider. Gerçekten şart mı? Şartsa\n" +
        "  scripts/check-takip-sizinti.mjs içindeki IZINLI_ALANLAR listesine ekleyin."
    );
  } else {
    notlar.push(`K1 ✓ gövde ${alanlar.length} alan taşıyor, hepsi izinli: ${alanlar.join(", ")}`);
  }
}

// ── K2 · KİMLİK KOLONU SEÇİLMİYOR ──────────────────────────────────────────
// Girişsiz okuma fonksiyonunun gövdesindeki HER `.select("…")` denetlenir.
const okumaBlok = dbKaynak.slice(
  dbKaynak.indexOf("export async function readTakipByToken"),
  dbKaynak.indexOf("export async function takipVurusKaydet")
);
const YASAK_KOLON = ["plate", "plaka", "fleet", "imei", "vin", "phone"];
const secimler = [...okumaBlok.matchAll(/\.select\(\s*"([^"]+)"/g)].map((m) => m[1]);
const kirli = secimler.filter((s) =>
  YASAK_KOLON.some((k) => new RegExp(`\\b${k}\\b`).test(s))
);
if (kirli.length > 0) {
  hatalar.push(`K2 — girişsiz okuma KİMLİK kolonu seçiyor: ${kirli.join(" | ")}`);
} else {
  notlar.push(`K2 ✓ ${secimler.length} select, hiçbirinde plaka/filo/imei/vin/telefon yok.`);
}

// ── K3 · ŞOFÖR ADI YALNIZ BAYRAK ALTINDA ───────────────────────────────────
const adOkumasi = okumaBlok.includes('.select("name")');
const bayrakli = /if\s*\(\s*TAKIP_SOFOR_ADI\s*\)/.test(okumaBlok);
if (adOkumasi && !bayrakli) {
  hatalar.push(
    "K3 — şoför adı TAKIP_SOFOR_ADI bayrağı OLMADAN okunuyor.\n" +
      "  Şoför adını müşteriye göstermek DACH'ta çalışan izleme kapsamındadır\n" +
      "  (AT DSG §10, DE BetrVG §87). Varsayılan KAPALI olmak zorunda."
  );
} else {
  notlar.push(`K3 ✓ şoför adı ${adOkumasi ? "yalnız TAKIP_SOFOR_ADI dalında okunuyor" : "hiç okunmuyor"}.`);
}
if (!/TAKIP_SOFOR_ADI = envBool\(process\.env\.TAKIP_SOFOR_ADI, false\)/.test(oku("lib/tenant.ts"))) {
  hatalar.push("K3 — TAKIP_SOFOR_ADI varsayılanı `false` değil (lib/tenant.ts).");
}

// ── K4 · GİRİŞSİZ YÜZEYİN İÇE AKTARMALARI ──────────────────────────────────
const YASAK_IMPORT = [
  ["FleetMap", "filo haritası — tüm araçları, plakayı ve filo rengini çizer"],
  ["listLatestVehiclePositions", "plaka + filo alanlarını döndürür"],
  ["FLEET_STYLE", "filo kimliğinin renk sözlüğü"],
  ["WORKER_PUBLIC_COLUMNS", "personel alanları kümesi"],
];
const yuzeyler = [];
for (const dizin of ["app/takip", "app/api/takip", "components/takip"]) {
  const tam = join(ROOT, dizin);
  if (!existsSync(tam)) continue;
  const gez = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (/\.tsx?$/.test(e.name)) yuzeyler.push(p);
    }
  };
  gez(tam);
}
if (yuzeyler.length === 0) {
  hatalar.push("K4 — girişsiz yüzey dosyaları bulunamadı (app/takip yok mu?).");
}
/**
 * ⚠️ YORUMLAR ÇIKARILIR — ilk sürüm çıkarmıyordu ve muhafız kendi yazdığımız
 * gerekçeyi kusur sandı: `TakipMap.tsx` "NEDEN FleetMap DEĞİL" diye anlatıyor,
 * denetim de o cümledeki adı yakalıyordu. Aranan şey ADIN GEÇMESİ değil,
 * KULLANILMASI.
 */
function yorumsuz(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

for (const dosya of yuzeyler) {
  const src = yorumsuz(readFileSync(dosya, "utf8"));
  for (const [ad, neden] of YASAK_IMPORT) {
    if (new RegExp(`\\b${ad}\\b`).test(src)) {
      hatalar.push(
        `K4 — ${dosya.replace(ROOT, "").replace(/\\/g, "/")} içinde \`${ad}\` geçiyor: ${neden}.`
      );
    }
  }
}
if (!hatalar.some((h) => h.startsWith("K4"))) {
  notlar.push(`K4 ✓ ${yuzeyler.length} girişsiz dosyanın hiçbiri kimlik taşıyan modülü çağırmıyor.`);
}

// ── K5 · DARALTMA VE MATCHER YERİNDE ───────────────────────────────────────
const layout = oku("app/layout.tsx");
const daraltma =
  layout.includes('yol.startsWith("/takip")') && /takip:\s*\(tumMesajlar/.test(layout);
if (!daraltma) {
  hatalar.push(
    "K5 — kök layout'taki /takip sözlük daraltması KALKMIŞ.\n" +
      "  Kalkarsa girişsiz sayfa ürünün tüm sözlüğünü (filo adları, PIN kuralları,\n" +
      "  yönetici etiketleri) yeniden sızdırır: 112 KB ↔ 22 KB, ölçüldü 24.08.2026."
  );
} else {
  notlar.push("K5 ✓ kök layout /takip için sözlüğü daraltıyor.");
}
if (!existsSync(join(ROOT, "proxy.ts"))) {
  hatalar.push("K5 — proxy.ts yok; layout yolu okuyamaz, daraltma sessizce devre dışı kalır.");
} else {
  const proxy = oku("proxy.ts");
  const dar = /matcher:\s*\[\s*"\/takip\/:path\*"\s*\]/.test(proxy);
  if (!dar) {
    hatalar.push(
      "K5 — proxy matcher'ı yalnız /takip DEĞİL.\n" +
        "  Genişletmek uygulamanın tamamını proxy'den geçirir: gecikme ve risk,\n" +
        "  tek bir girişsiz sayfa için ödenemez."
    );
  } else {
    notlar.push("K5 ✓ proxy yalnız /takip yolunda çalışıyor.");
  }
}

// ── SONUÇ ──────────────────────────────────────────────────────────────────
if (hatalar.length > 0) {
  console.error(`\n✗ TAKİP SIZINTI MUHAFIZI — ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}
console.log(`✓ takip sızıntı muhafızı: 5 denetim geçti (${yuzeyler.length} girişsiz dosya tarandı).`);
for (const n of notlar) console.log("  " + n);
