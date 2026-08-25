#!/usr/bin/env node
/**
 * CRUD EKRANLARI MUHAFIZI — "Ekle varsa Düzenle ve Sil de var".
 *
 * ═══ NEDEN VAR ═══
 *
 * Belge türleri eklenebiliyordu ama düzenlenemiyor ve silinemiyordu. Yanlış
 * girilen bir uyarı eşiği (90 yerine 30) geri alınamadı — kullanıcı kendi
 * verisine kilitlendi (Volkan, 25.08.2026). Kural bir kez söylenip her yeni
 * ekranda yeniden hatırlanacak bir şey olamaz; muhafız hatırlar.
 *
 * ═══ NE DENETLER ═══
 *
 * Bir dosya "kayıt listesi üreten CRUD ekranı" sayılır:
 *   · "use client" ile başlıyor,
 *   · `@/app/actions/...` içinden bir YAZMA eylemi içe aktarıyor,
 *   · ve bir liste render ediyor (`.map(`).
 *
 * Böyle bir dosya ya `<CrudSatirEylemleri>` render etmeli (düzenle + sil,
 * gerekiyorsa pasifleştirme) ya da MUAF listesinde GEREKÇESİYLE bulunmalı.
 * Yeni bir ekran ikisini de yapmazsa bu betik kırılır.
 *
 * ⚠️ Muafiyet listesi bir çöp kutusu değildir: her satır neden o ekranda
 * silme/düzenleme OLMADIĞINI söyler. Gerekçesi olmayan muafiyet eklenemez —
 * betik boş gerekçede de kırılır.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARANAN = ["app", "components/admin"];

/** Ortak eylem kümesi — muhafızın aradığı işaret. */
const ISARET = "CrudSatirEylemleri";

/** Yazma eylemi adı kalıpları (import edilen isimlerde aranır). */
const YAZMA = /(upsert|[Kk]aydet|^save[A-Z]|^create[A-Z]|Ekle|Olustur|Ac$|Gonder$)/;

/**
 * BİLEREK MUAF ekranlar — her biri GEREKÇELİ.
 *
 * Anahtar: repo köküne göre yol. Değer: neden bu ekranda satır düzenleme/silme
 * yok ve kullanıcının geri alma yolu ne.
 */
const MUAF = {
  "app/admin/mevzuat/MevzuatClient.tsx":
    "Kayıt listesi değil, TEK ayar satırı (tenant_mevzuat singleton). Silinecek satır yok; geri alma yolu önceki kural setini yeniden seçmektir. Ekranın ürettiği uyarı kaydı (mevzuat_uyarilari) bilerek DEĞİŞMEZDİR: gönderilmiş bir bildirimin silinmesi, gönderilmemiş gibi görünmesine yol açar ve tekil indeksin spam korumasını da bozar.",
  "app/admin/ayarlar/CostRatesForm.tsx":
    "Kayıt listesi değil, tek bir ayar formu. Geri alma yolu zaten var: alanı boşaltıp kaydetmek oranı varsayılana döndürür.",
  "app/admin/bolgeler/BolgelerClient.tsx":
    "Kendi silme yolu var (deleteGeofence) ve düzenleme haritada çizimle yapılıyor — satır menüsüne sığmaz.",
  "app/admin/mesajlar/MessagesClient.tsx":
    "Kendi arşivleme (arsivDegistir) ve düzenleme yolları var; mesaj silme bilinçli olarak YOK — konuşma kaydı iki taraflıdır.",
  "app/admin/seferler/SeferlerClient.tsx":
    "Seferin geri alma yolu SİLME değil İPTALDİR (iptalAt/iptalSebep): sefer gerçekleşmiş bir olaydır, kayıt kalmalı.",
  "app/panel/seferler/TeslimatKanitiDialog.tsx":
    "Teslimat kanıtı DEĞİŞMEZ kayıttır (080, HK080 tetikleyicisi). Düzeltme yolu yeni kanıt + iptaldir.",
  "app/panel/masraflar/ExpenseDriverClient.tsx":
    "Şoförün kendi girdisi ONAY AKIŞINDA: düzeltme yolu yöneticinin reddi (rejectExpenseEntry). ⚠️ Modül bugün kapalı (EXPENSE_ENABLED); açılırsa düzenleme/silme yeniden değerlendirilmeli.",
  "app/panel/yakit/FuelDriverClient.tsx":
    "Şoförün kendi girdisi ONAY AKIŞINDA: düzeltme yolu yöneticinin reddi (rejectFuelEntry). ⚠️ Modül bugün kapalı (FUEL_ENABLED); açılırsa düzenleme/silme yeniden değerlendirilmeli.",
  "app/panel/kontrol/KontrolFormClient.tsx":
    "Kayıt listesi değil, tek seferlik form; ürettiği kayıt DEĞİŞMEZDİR (081, HK081). Düzeltme yolu yeni form + yöneticinin iptali.",
  "components/admin/VehicleFormDialog.tsx":
    "Liste değil, AraclarClient'ın ekleme/düzenleme kutusu. Satır düzenleme ve silme o listede (deleteVehicle) zaten var.",
  "app/admin/yakit/MaintenanceAdminClient.tsx":
    "007'nin eski bakım modülü, MAINTENANCE_ENABLED ile kapalı. Yerini /admin/bakim aldı (081) ve orada düzenleme+silme var.",
};

function* dosyalar(dizin) {
  let girisler;
  try {
    girisler = readdirSync(dizin);
  } catch {
    return;
  }
  for (const ad of girisler) {
    if (ad === "node_modules" || ad === ".next") continue;
    const tam = join(dizin, ad);
    if (statSync(tam).isDirectory()) yield* dosyalar(tam);
    else if (ad.endsWith(".tsx")) yield tam;
  }
}

const bulgular = [];
const denetlenen = [];

for (const kok of TARANAN) {
  for (const tam of dosyalar(join(ROOT, kok))) {
    const yol = relative(ROOT, tam).split(sep).join("/");
    const kaynak = readFileSync(tam, "utf8");

    if (!kaynak.slice(0, 80).includes('"use client"')) continue;
    if (!kaynak.includes(".map(")) continue;

    const bloklar = [
      ...kaynak.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/app\/actions\/[^"]+"/gs),
    ];
    if (bloklar.length === 0) continue;

    const isimler = bloklar
      .flatMap((m) => m[1].split(","))
      .map((x) => x.replace(/\btype\b/, "").trim())
      .filter(Boolean);
    const yazanlar = isimler.filter((i) => YAZMA.test(i));
    if (yazanlar.length === 0) continue;

    denetlenen.push(yol);

    if (kaynak.includes(ISARET)) continue;

    const gerekce = MUAF[yol];
    if (typeof gerekce === "string" && gerekce.trim().length >= 20) continue;

    bulgular.push({
      yol,
      yazanlar: yazanlar.slice(0, 3),
      sebep: gerekce === undefined ? "muafiyet yok" : "muafiyet gerekçesi boş/kısa",
    });
  }
}

// Bayat muafiyet: listede olup artık taranmayan (silinmiş/yeniden adlandırılmış)
// dosyalar sessizce birikmesin.
const bayat = Object.keys(MUAF).filter((y) => !denetlenen.includes(y));

if (bulgular.length === 0 && bayat.length === 0) {
  const korumali = denetlenen.filter((y) => !MUAF[y]).length;
  console.log(
    `✓ CRUD muhafızı: ${denetlenen.length} liste ekranı · ${korumali} tanesi ${ISARET} kullanıyor · ` +
      `${Object.keys(MUAF).length} gerekçeli muaf.`
  );
  process.exit(0);
}

console.error(`\n✗ CRUD MUHAFIZI — ${bulgular.length + bayat.length} bulgu:\n`);
for (const b of bulgular) {
  console.error(`  ${b.yol}`);
  console.error(`      yazma eylemi: ${b.yazanlar.join(", ")}`);
  console.error(`      ${b.sebep}\n`);
}
for (const y of bayat) {
  console.error(`  ${y}`);
  console.error(`      MUAF listesinde ama artık bir CRUD ekranı değil — satırı SİL.\n`);
}
console.error(
  `  Çözüm: satırlara <${ISARET}> ekle (düzenle + sil, gerekiyorsa pasifleştir)\n` +
    `         ya da scripts/check-crud-ekranlari.mjs içindeki MUAF listesine\n` +
    `         GEREKÇESİYLE yaz. Gerekçesiz muafiyet kabul edilmez.\n`
);
process.exit(1);
