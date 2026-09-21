#!/usr/bin/env node
/**
 * DOSYA YÜKLEME — AYRIŞMA VE YETİM MUHAFIZI.
 *
 * ═══ NEDEN VAR ═══
 *
 * Dosya yükleme üç söz veriyor ve üçü de KODUN ŞEKLİNE bağlı; çalışma anında
 * görünmüyorlar:
 *
 *   1. "Yetim dosya yok." Bugün doğru, çünkü her yükleme `yukleVeYaz` /
 *      `coklaYukleVeYaz` içinden geçiyor. Yarın biri "tek satır" diye çıplak
 *      `dosyaYukle` + `insert` yazar; yükleme çalışır, kayıt düşer, dosya
 *      kimsenin görmediği bir yerde durur. Kusur SESSİZDİR.
 *   2. "Boyut ve tip tek kuralda." İkinci bir `file.size >` karşılaştırması,
 *      panel ile mobilin farklı dosyaları kabul etmesi demektir.
 *   3. "Silme gerçekten siliyor." `storage.remove` çağrısı ikinci bir yere
 *      kopyalanırsa, biri kova adını değiştirdiğinde diğeri YANLIŞ KOVADAN
 *      silmeye başlar.
 *
 * Bu üçünü de tsc, build ya da mevcut muhafızlar yakalayamaz.
 *
 * ── SEKİZ DENETİM, HEPSİ KAYNAK ÜZERİNDE ──────────────────────────────────
 *   D1 — Storage'a YAZAN tek dosya: lib/upload-core.ts
 *   D2 — Storage'dan SİLEN tek dosya: lib/upload-core.ts
 *   D3 — Boyut/tip kuralı tek kaynakta; çağıranlarda tekrar YOK
 *   D4 — Hız sınırı `dosyaYukle` içinden geçiyor, atlanabilir değil
 *   D5 — 🔑 YETİM YOK: dosya yükleyen her yol yükle+yaz sarmalayıcısını
 *        kullanıyor (çıplak `dosyaYukle` yalnız çekirdekte ve testte)
 *   D6 — Vardiya silme dosyaları da siliyor
 *   D7 — `uploadReceipt` kendi denetimini kurmuyor (panel çekirdeğe delege)
 *   D8 — Değişmez tablolara (081/080) foto UPDATE'i denenmiyor
 *
 * Kullanım:  npm run lint:dosya-yukleme
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CEKIRDEK = "lib/upload-core.ts";

const hatalar = [];
const notlar = [];

/** Yorumları düşür — denetimler KODA bakmalı. */
const kodu = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

/** Taranan ağaçlar: uygulama kodu + kütüphane. Betikler HARİÇ (test/ölçüm). */
function dosyalar() {
  const out = [];
  const gez = (d) => {
    for (const ad of readdirSync(join(ROOT, d))) {
      const göreli = `${d}/${ad}`;
      const tam = join(ROOT, göreli);
      if (statSync(tam).isDirectory()) {
        if (ad === "node_modules" || ad === ".next") continue;
        gez(göreli);
      } else if (/\.tsx?$/.test(ad)) {
        out.push(göreli);
      }
    }
  };
  gez("app");
  gez("lib");
  return out;
}

if (!existsSync(join(ROOT, CEKIRDEK))) {
  console.error(`\n✗ DOSYA YÜKLEME MUHAFIZI — çekirdek yok: ${CEKIRDEK}\n`);
  process.exit(1);
}

const hepsi = dosyalar().map((p) => ({ p, k: kodu(readFileSync(join(ROOT, p), "utf8")) }));
const cekirdek = hepsi.find((f) => f.p === CEKIRDEK).k;

// ── D1 · STORAGE'A YAZAN TEK DOSYA ──────────────────────────────────────────
{
  /**
   * ⚠️ TAKOGRAF GEREKÇELİ İSTİSNA (03.09.2026).
   *
   * `lib/takograf-db.ts` kendi yüklemesini yapıyor ve BUGÜNLÜK öyle kalıyor.
   * Üç noktada çekirdekten ayrılıyor ve üçü de bilinçli:
   *   • Yol deseni `yyyy/mm/<uuid>.ddd` — `workerId` YOK ("kişisel ad yol
   *     içinde geçmez", 091 kararı). Çekirdeğin deseni kişi klasörlüdür;
   *     ona geçirmek var olan arşivi iki desenli bırakırdı.
   *   • MIME `application/octet-stream` + `.ddd` uzantı denetimi — görüntü
   *     değil, sürücü kartı/araç ünitesi dökümü.
   *   • Kendi SHA256 tekilliği ve `bekliyor` durum makinesi var.
   *
   * ✅ BEDELİ ÖDENDİ (21.09.2026, Faz C-3 — takograf yükleme turu).
   *
   * Eskiden buraya "o yolda yetim koruması YOK" yazıyordu: `dosyaYukle`
   * Storage'a yazıp satırı yazamazsa dosya arşivde yetim kalıyordu. O açık
   * KAPANDI — `lib/takograf-db.ts` satır yazma dalında `dosyaSil(...)` çağırıp
   * sonucu `dosyaTemizlendi` ile taşıyor (ÇEKİRDEĞİN silme fonksiyonu; ikinci
   * bir `storage.remove` yazılmadı, D2 hâlâ tek kapıyı görüyor).
   *
   * Hız sınırı da bu turda bağlandı — ama UÇTA, çekirdeğin KENDİ
   * `hizSiniriHarca`/`hizSiniriIadeEt` fonksiyonlarıyla
   * (`app/api/mobile/takograf/route.ts`). İkinci bir sayaç yazılmadı.
   *
   * ⚠️ İSTİSNANIN KENDİSİ KALIYOR ve yukarıdaki üç gerekçe hâlâ geçerli.
   * Kaldırmak, `yukleVeYaz`ın "yazma düşerse dosyayı SİL" kuralını 3. adıma da
   * taşırdı — oysa takografta servis/ayrıştırma düşse bile dosya DA satır DA
   * KALMAK ZORUNDA (091: "ayrıştırılamasa bile SİLİNMEZ"). Ayrım adım bazında:
   * satır yokken silinir (yetim), satır varken asla.
   *
   * Bu iki şartı `scripts/check-takograf-uclari.mjs` denetliyor.
   */
  const D1_ISTISNA = new Set(["lib/takograf-db.ts"]);
  const yazanlar = hepsi
    .filter(
      (f) =>
        f.p !== CEKIRDEK &&
        !D1_ISTISNA.has(f.p) &&
        /storage[\s\S]{0,60}?\.upload\(/.test(f.k)
    )
    .map((f) => f.p);
  if (yazanlar.length) {
    hatalar.push(
      `D1 — Storage'a çekirdek DIŞINDA yazan var: ${yazanlar.join(", ")}\n` +
        "  Boyut, tip, hız sınırı ve yol deseni tek yerde uygulanmalı. İkinci bir\n" +
        `  \`storage.upload\`, o dört kuralın hiçbirinden geçmeyen bir kapıdır.`
    );
  } else {
    notlar.push("D1 ✓ Storage'a yazan tek dosya: lib/upload-core.ts (takograf gerekçeli istisna)");
  }
}

// ── D2 · STORAGE'DAN SİLEN TEK DOSYA ────────────────────────────────────────
{
  const silenler = hepsi
    .filter((f) => f.p !== CEKIRDEK && /storage[\s\S]{0,60}?\.remove\(/.test(f.k))
    .map((f) => f.p);
  if (silenler.length) {
    hatalar.push(
      `D2 — Storage'dan çekirdek DIŞINDA silen var: ${silenler.join(", ")}\n` +
        "  Silme tek yoldan geçmeli: kova adı değişince ikinci kopya YANLIŞ\n" +
        "  kovadan silmeye başlar ve bunu kimse fark etmez."
    );
  } else {
    notlar.push("D2 ✓ Storage'dan silen tek dosya: lib/upload-core.ts");
  }
}

// ── D3 · BOYUT/TİP KURALI TEK KAYNAKTA ──────────────────────────────────────
{
  if (!/YUKLEME_TAVAN_BAYT\s*=/.test(cekirdek) || !/IZINLI_TIPLER\s*=/.test(cekirdek)) {
    hatalar.push("D3 — çekirdek boyut/tip sabitlerini kaybetmiş.");
  }
  const tekrar = [];
  for (const f of hepsi) {
    if (f.p === CEKIRDEK) continue;
    /**
     * ⚠️ DESEN DARALTILDI — ilk hâli `\.size\s*>\s*\d` idi ve DÖRT yanlış
     * pozitif verdi: `aracGun.size > 0`, `zoneIds.size > 0`, `file.size > 0`
     * (boş dosya kontrolü) — hepsi KOLEKSİYON boyutu ya da boşluk denetimi,
     * yükleme tavanı değil. Aranan şey ikinci bir TAVAN: bayt cinsinden bir
     * eşikle karşılaştırma.
     */
    if (/\.size\s*>\s*(\d{4,}|\d+\s*\*\s*1024)/.test(f.k)) tekrar.push(`${f.p} (boyut tavanı)`);
    if (/\[\s*"image\/jpeg"[^\]]*\]/.test(f.k)) tekrar.push(`${f.p} (tip listesi)`);
  }
  if (tekrar.length) {
    hatalar.push(
      `D3 — boyut/tip kuralı çekirdek DIŞINDA tekrar yazılmış: ${tekrar.join(", ")}\n` +
        "  Kural lib/upload-core.ts'te; ikinci tanım panel ile mobilin farklı\n" +
        "  dosyaları kabul etmesiyle biter."
    );
  } else if (!hatalar.some((h) => h.startsWith("D3"))) {
    notlar.push("D3 ✓ boyut/tip tek kaynakta (YUKLEME_TAVAN_BAYT · IZINLI_TIPLER)");
  }
}

// ── D4 · HIZ SINIRI ATLANABİLİR DEĞİL ───────────────────────────────────────
{
  const i = cekirdek.indexOf("export async function dosyaYukle");
  const govde = i >= 0 ? cekirdek.slice(i, cekirdek.indexOf("\n}", i)) : "";
  if (!/hizSiniriHarca\(/.test(govde)) {
    hatalar.push(
      "D4 — `dosyaYukle` hız sınırını çağırmıyor.\n" +
        "  Fren yükleme yolunun İÇİNDE olmalı; dışarıda bırakılırsa her yeni\n" +
        "  çağıranın onu ayrıca hatırlaması gerekir — biri unutur."
    );
  }
  // `hizSiniri:false` YALNIZ çoklu yükleme (kota istek başına) ve testte meşru.
  const kacak = hepsi
    .filter((f) => f.p !== CEKIRDEK && /hizSiniri:\s*false/.test(f.k))
    .map((f) => f.p);
  if (kacak.length) {
    hatalar.push(
      `D4 — hız sınırı çekirdek DIŞINDA kapatılmış: ${kacak.join(", ")}\n` +
        "  `hizSiniri:false` yalnız `coklaYukleVeYaz` içinde meşru (kota orada\n" +
        "  istek başına BİR KEZ harcanıyor). Uygulama kodunda kapatmak, freni\n" +
        "  sessizce kaldırmaktır."
    );
  }
  if (!hatalar.some((h) => h.startsWith("D4"))) {
    notlar.push("D4 ✓ hız sınırı `dosyaYukle` içinde, uygulama kodunda kapatılmıyor");
  }
}

// ── D5 · 🔑 YETİM YOK ───────────────────────────────────────────────────────
{
  /**
   * `dosyaYukle` ÇIPLAK çağrılmamalı: kayıt yazma adımı ona bağlanmadığı için
   * yazma düştüğünde dosya geride kalır. Meşru istisna `lib/storage.ts`
   * (`uploadReceipt` — eski panel yolu, kendi çağıranları kaydı yazıyor) ve
   * çekirdeğin kendisi.
   */
  const IZINLI_CIPLAK = new Set([CEKIRDEK, "lib/storage.ts"]);
  /**
   * ⚠️ İMPORT KONTROLÜ ŞART — ad çakışması yanlış pozitif verdi:
   * `lib/takograf-db.ts` kendi `dosyaYukle`sini dışa aktarıyor
   * (`.ddd` arşivi) ve `app/actions/takograf.ts` onu çağırıyor. İkisinin de
   * çekirdekle ilgisi yok. Yalnız ÇEKİRDEKTEN içe aktaranlar denetlenir.
   */
  const cekirdektenAlir = (k) =>
    /import\s*\{[^}]*\bdosyaYukle\b[^}]*\}\s*from\s*["']@\/lib\/upload-core["']/.test(k);
  const ciplak = hepsi
    .filter((f) => !IZINLI_CIPLAK.has(f.p) && cekirdektenAlir(f.k) && /\bdosyaYukle\(/.test(f.k))
    .map((f) => f.p);
  if (ciplak.length) {
    hatalar.push(
      `D5 — çıplak \`dosyaYukle\` çağrısı: ${ciplak.join(", ")}\n` +
        "  Yükleme, kaydı yazan adımla BİRLİKTE sarılmalı: `yukleVeYaz` ya da\n" +
        "  `coklaYukleVeYaz`. Aksi hâlde yazma düştüğünde dosya yetim kalır ve\n" +
        "  bunu hiçbir ekran göstermez.\n" +
        "  Gerçekten gerekiyorsa bu betikteki IZINLI_CIPLAK listesine gerekçesiyle yaz."
    );
  } else {
    notlar.push("D5 ✓ yükleme yolları yükle+yaz sarmalayıcısından geçiyor (yetim yok)");
  }

  for (const ad of ["yukleVeYaz", "coklaYukleVeYaz"]) {
    const j = cekirdek.indexOf(`export async function ${ad}`);
    const g = j >= 0 ? cekirdek.slice(j) : "";
    if (!/dosyaSil\(/.test(g)) {
      hatalar.push(`D5 — \`${ad}\` yazma düştüğünde dosyayı SİLMİYOR (dosyaSil çağrısı yok).`);
    }
  }
}

// ── D6 · VARDİYA SİLME DOSYALARI DA SİLİYOR ─────────────────────────────────
{
  const shift = hepsi.find((f) => f.p === "app/actions/shift.ts");
  if (!shift) {
    hatalar.push("D6 — app/actions/shift.ts bulunamadı.");
  } else {
    const i = shift.k.indexOf("export async function deleteEntryAction");
    const g = i >= 0 ? shift.k.slice(i) : "";
    if (!/shift_photos/.test(g) || !/dosyaSil\(/.test(g)) {
      hatalar.push(
        "D6 — `deleteEntryAction` vardiya fotoğraflarını silmiyor.\n" +
          "  `shift_photos.time_entry_id` FK'si `on delete cascade`: satırlar\n" +
          "  gider, DOSYALAR kalır. Saklama politikası (090) onlara dokunmuyor."
      );
    } else {
      notlar.push("D6 ✓ vardiya silinince shift_photos dosyaları da siliniyor");
    }
  }
}

// ── D7 · PANEL YOLU ÇEKİRDEĞE DELEGE ────────────────────────────────────────
{
  const st = hepsi.find((f) => f.p === "lib/storage.ts");
  if (st) {
    if (!/dosyaYukle\(/.test(st.k)) {
      hatalar.push("D7 — `uploadReceipt` çekirdeği çağırmıyor; panel yolu ayrışmış.");
    } else if (/crypto\.randomUUID\(\)|\.upload\(/.test(st.k)) {
      hatalar.push(
        "D7 — `lib/storage.ts` hâlâ kendi yol/yükleme mantığını taşıyor.\n" +
          "  Panel ve mobil aynı deseni kullanmalı; ikinci bir yol üreteci,\n" +
          "  kovada iki desenli dosya demektir."
      );
    } else {
      notlar.push("D7 ✓ panel yolu (uploadReceipt) çekirdeğe delege ediyor");
    }
  }
}

// ── D8 · DEĞİŞMEZ TABLOLARA FOTO UPDATE'İ YOK ───────────────────────────────
{
  /**
   * `dvir_yanitlari` (081) ve `teslimat_fotograflari` (080) UPDATE'e KAPALI.
   * Bir gün biri "fotoğrafı değiştir" ucu yazarsa canlıda HK080/HK081 ile
   * reddedilir — ama ancak ÇALIŞMA ANINDA. Bu denetim onu kodda yakalar.
   */
  const suclu = [];
  for (const f of hepsi) {
    for (const t of ["dvir_yanitlari", "teslimat_fotograflari"]) {
      const re = new RegExp(`from\\(\\s*["']${t}["']\\s*\\)[\\s\\S]{0,120}?\\.update\\(`);
      if (re.test(f.k)) suclu.push(`${f.p} → ${t}`);
    }
  }
  if (suclu.length) {
    hatalar.push(
      `D8 — DEĞİŞMEZ tabloya update deneniyor: ${suclu.join(", ")}\n` +
        "  `dvir_yanitlari` 081'de KOŞULSUZ değişmez (trg_dvir_yanit_degismez),\n" +
        "  `teslimat_fotograflari` 080'de (trg_teslimat_foto_degismez). Fotoğraf\n" +
        "  ancak kayıt YAZILIRKEN konabilir; düzeltmenin yolu yeni kayıttır."
    );
  } else {
    notlar.push("D8 ✓ değişmez tablolara foto update'i denenmiyor");
  }
}

// ── SONUÇ ───────────────────────────────────────────────────────────────────
if (hatalar.length > 0) {
  console.error(`\n✗ DOSYA YÜKLEME MUHAFIZI — ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}
console.log(`✓ dosya yükleme muhafızı: 8 denetim geçti (${hepsi.length} dosya tarandı).`);
for (const n of notlar) console.log("  " + n);
void relative;
