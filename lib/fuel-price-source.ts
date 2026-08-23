import "server-only";
import { readFirstSheet, excelSerialToISODate, splitRef, type XlsxSheet } from "@/lib/xlsx-min";

/**
 * AB WEEKLY OIL BULLETIN — yakıt fiyatı referansının kaynağı.
 *
 * ═══ NE ÇEKİYORUZ ═══
 *
 * DG ENER'in haftalık "Prices with taxes" XLSX'i. Pazartesi referanslı, Perşembe
 * yayınlanıyor (3 gün yayın gecikmesi), 27 AB ülkesini TEK dosyada veriyor.
 * Fiyatlar POMPA fiyatıdır (vergiler dâhil) ve **1000 LİTRE başına** yazılır.
 *
 * ÖLÇÜLDÜ (24.08.2026): 14.168 baytlık ZIP, 13 girdi, tek sayfa, 31 satır.
 * Avusturya dizel = 2043 → 2,043 €/L; Almanya = 2266 → 2,266 €/L.
 * 2,043 rakamı, kodda o güne dek ELLE yazılı duran sabitin birebir aynısı —
 * yani kaynağa geçmek hiçbir sayıyı oynatmıyor, yalnız güncellemeyi
 * otomatikleştiriyor.
 *
 * ═══ LİSANS — ATIF ZORUNLU, LOGO YASAK ═══
 *
 * CC BY 4.0. Dosyanın kendi telif notu: "Reproduction is authorised provided
 * the source is acknowledged. © European Communities".
 *   · Ekranda METİN atıf gösterilir (bkz. LICENSE_NOTE).
 *   · "Litre başına dönüştürülmüştür" cümlesi ZORUNLU — CC BY 4.0 Md.3(a)(1)
 *     değişiklik yapıldığının belirtilmesini istiyor ve 1000 L → 1 L bir
 *     uyarlamadır.
 *   · 🔴 AB LOGOSU/AMBLEMİ KULLANILMAZ, "AB onaylı / iş ortağı" DENMEZ.
 *     Karar 2011/833/EU Md.2(2)(a) logoları yeniden kullanım kapsamı dışında
 *     bırakıyor; CC BY 4.0 Md.2(a)(6) "No endorsement" diyor.
 *
 * ═══ BİLİNEN TUZAKLAR (araştırmada bizzat çarpıldı) ═══
 *
 * 1. Fiyatlar 1000 litre başına. Bölmeyi unutan 2043 €/L basar ve €/km bin
 *    katına çıkar. 4. muhafız (makul bant) tam olarak bunu yakalar.
 * 2. VERGİLİ ve VERGİSİZ İKİ AYRI DOSYA var. Bize gereken pompa fiyatı =
 *    VERGİLİ. Yanlış UUID sessizce daha düşük bir kolonu doldurur ve kimse
 *    fark etmez — o yüzden UUID burada, tek yerde, gerekçesiyle sabit.
 * 3. Sütun sırası SABİT VARSAYILMAZ. Dizel sütunu BAŞLIK METNİNDEN bulunur;
 *    Komisyon araya bir ürün eklerse indeks kayar ve biz benzin fiyatını
 *    dizel diye yazarız.
 * 4. UUID'nin kalıcılığı GARANTİ DEĞİL. Bugün 200 dönüyor; Komisyon dosyayı
 *    yeniden yüklerse kırılır. Kırıldığında 1. muhafız sessiz kalmaz.
 */

/** Kaynağın kimliği — DB'ye `source_key` olarak yazılır. */
export const WOB_SOURCE_KEY = "eu_wob";

/**
 * Vergili ("Prices with taxes") dosyanın sabit UUID'si.
 * ⚠️ Vergisiz dosya BAŞKA bir UUID'dir ve buraya YAZILMAZ (bkz. tuzak 2).
 */
export const WOB_URL =
  "https://energy.ec.europa.eu/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en";

/** İnsan okunur kaynak sayfası — ekranda "kaynak" bağlantısı olarak gösterilir. */
export const WOB_LANDING =
  "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en";

/**
 * Ekranda gösterilecek atıf. CC BY 4.0'ın istediği dört unsur: kaynak adı,
 * lisans adı+bağlantısı, veriye bağlantı ve DEĞİŞİKLİK BİLDİRİMİ.
 */
export const WOB_LICENSE_NOTE =
  "Avrupa Komisyonu · Weekly Oil Bulletin · CC BY 4.0 · litre başına dönüştürülmüştür";

/** Kaynak haftalık: bayatlık eşikleri bu sayıdan türetilir. */
export const WOB_PERIOD_DAYS = 7;

/** WOB ortalama yayınlar (E-Control medyan yayınlar — ikisi aynı sayı değil). */
export const WOB_STATISTIC = "mean" as const;

/**
 * Kapsam. Bugün AT + DE (Volkan kararı, 24.08.2026): ikisi de aynı dosyada,
 * ikinci ülkenin entegrasyon maliyeti SIFIR. CH ve TR bilinçli olarak DIŞARIDA
 * — CH bu dosyada yok (AB üyesi değil), TR'nin kaynağı hukuken açık değil.
 *
 * Anahtar = XLSX'teki ülke adı (A sütunu), değer = ISO 3166-1 alpha-2.
 */
export const WOB_COUNTRIES: Record<string, string> = {
  Austria: "AT",
  Germany: "DE",
};

/** Dizel sütunu bu ibarelerden BİRİNİ içeren başlıkta aranır. */
const DIESEL_HEADER_HINTS = ["gas oil automobile", "automotive gas oil", "dieselkraftstoff"];

/**
 * 4. MUHAFIZ — makul bant.
 *
 * Avrupa'da pompa dizeli hiçbir ülkede 0,5 €/L altına inmedi ve 5,0 €/L üstüne
 * çıkmadı. Bant bir DOĞRULAMA değil, BİRİM HATASI kapanı: 1000'e bölmeyi
 * unutmak 2043 üretir, virgül kayması 20,43 üretir — ikisi de bandın dışında.
 */
export const PRICE_MIN_EUR_PER_L = 0.5;
export const PRICE_MAX_EUR_PER_L = 5.0;

/**
 * 2. MUHAFIZ — bayatlık tavanı.
 *
 * Haftalık kaynak (7) + yayın gecikmesi (3) → sağlıklı işleyişte veri en fazla
 * 10 günlük olur. Bunu aşmak fiyat hareketinin değil, KAYNAĞIN ya da CRON'un
 * durduğunun sinyalidir ve yazma yapılmaz.
 */
export const SOURCE_MAX_AGE_DAYS = WOB_PERIOD_DAYS + 3;

export type FuelPriceRecord = {
  countryCode: string;
  fuelType: "diesel";
  referenceDate: string;
  /** €/L — kaynağın 1000 L başına değerinin 1000'e bölünmüşü. */
  price: number;
  currency: "EUR";
  priceEur: number;
  statistic: typeof WOB_STATISTIC;
  sourceKey: string;
  sourceUrl: string;
  licenseNote: string;
  expectedPeriodDays: number;
};

export type FuelSourceResult =
  | { ok: true; records: FuelPriceRecord[]; referenceDate: string; ageDays: number }
  | {
      ok: false;
      /** Hangi muhafız durdurdu — cron bunu loglar ve yanıtta döndürür. */
      guard: "http" | "parse" | "stale" | "missing_country" | "range";
      message: string;
    };

/** Gün farkı (tam gün, UTC). */
function ageInDays(isoDate: string, now: Date): number {
  const ref = Date.parse(isoDate + "T00:00:00Z");
  return Math.floor((now.getTime() - ref) / 86_400_000);
}

/**
 * Başlık satırından dizel sütununun harfini bulur.
 *
 * ⚠️ SABİT İNDEKS KULLANILMIYOR (bkz. tuzak 3). Ölçülen dosyada dizel C
 * sütununda ama bunu koda gömmek, Komisyon araya bir ürün eklediği gün
 * benzin fiyatını sessizce dizel diye yazmak demekti.
 */
function findDieselColumn(sheet: XlsxSheet): string | null {
  for (const [ref, cell] of sheet) {
    const pos = splitRef(ref);
    if (!pos || pos.row !== 1 || cell.kind !== "text") continue;
    const t = cell.value.toLowerCase();
    if (DIESEL_HEADER_HINTS.some((h) => t.includes(h))) return pos.col;
  }
  return null;
}

/**
 * Referans tarihini bulur: 2. satırdaki Excel seri tarihi.
 *
 * Ölçülen dosyada A2 = 46251 → 2026-08-17. Yine sabit hücreye bağlanmıyoruz:
 * 2. satırdaki İLK makul seri tarih alınıyor (aynı satırın geri kalanı
 * "1000 l" / "t" gibi birim METİNLERİ).
 */
function findReferenceDate(sheet: XlsxSheet): string | null {
  for (const [ref, cell] of sheet) {
    const pos = splitRef(ref);
    if (!pos || pos.row !== 2 || cell.kind !== "number") continue;
    const iso = excelSerialToISODate(cell.value);
    if (iso) return iso;
  }
  return null;
}

/** Ülke adı → satır numarası (A sütunundaki metinlerden). */
function findCountryRows(sheet: XlsxSheet): Map<string, number> {
  const out = new Map<string, number>();
  for (const [ref, cell] of sheet) {
    const pos = splitRef(ref);
    if (!pos || pos.col !== "A" || cell.kind !== "text") continue;
    out.set(cell.value.trim(), pos.row);
  }
  return out;
}

/**
 * Kaynağı çeker, ayrıştırır ve DÖRT MUHAFIZI uygular.
 *
 * Hiçbir muhafız "sessizce boş dön" demez — her biri SEBEBİYLE birlikte
 * `ok:false` döndürür. Projenin kuralı: sessiz eksik YASAK.
 */
export async function fetchWobDieselPrices(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<FuelSourceResult> {
  // ── 1. MUHAFIZ: HTTP ────────────────────────────────────────────────
  let bytes: Buffer;
  try {
    const res = await fetchImpl(WOB_URL, {
      // Statik dosya; Next'in fetch önbelleğine girmesin — cron her gün TAZE
      // istemeli, yoksa "kaynak durdu" hiç fark edilmez.
      cache: "no-store",
      headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
    if (res.status !== 200) {
      return { ok: false, guard: "http", message: `HTTP ${res.status} — ${WOB_URL}` };
    }
    bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1000) {
      return { ok: false, guard: "http", message: `gövde çok küçük (${bytes.length} bayt)` };
    }
  } catch (e) {
    return { ok: false, guard: "http", message: `indirilemedi: ${(e as Error).message}` };
  }

  // ── AYRIŞTIRMA ──────────────────────────────────────────────────────
  let sheet: XlsxSheet;
  try {
    sheet = readFirstSheet(bytes);
  } catch (e) {
    return { ok: false, guard: "parse", message: `XLSX okunamadı: ${(e as Error).message}` };
  }

  const dieselCol = findDieselColumn(sheet);
  if (!dieselCol) {
    return {
      ok: false,
      guard: "parse",
      message: `dizel sütunu başlıktan bulunamadı (aranan: ${DIESEL_HEADER_HINTS.join(" / ")})`,
    };
  }

  const referenceDate = findReferenceDate(sheet);
  if (!referenceDate) {
    return { ok: false, guard: "parse", message: "referans tarihi (2. satır seri tarihi) okunamadı" };
  }

  // ── 2. MUHAFIZ: BAYATLIK ────────────────────────────────────────────
  const ageDays = ageInDays(referenceDate, now);
  if (ageDays > SOURCE_MAX_AGE_DAYS) {
    return {
      ok: false,
      guard: "stale",
      message: `kaynak durmuş görünüyor: referans ${referenceDate}, yaş ${ageDays} gün (tavan ${SOURCE_MAX_AGE_DAYS})`,
    };
  }
  if (ageDays < 0) {
    return {
      ok: false,
      guard: "stale",
      message: `referans tarihi gelecekte: ${referenceDate}`,
    };
  }

  // ── 3. MUHAFIZ: ÜLKE SATIRI ─────────────────────────────────────────
  const rows = findCountryRows(sheet);
  const records: FuelPriceRecord[] = [];
  for (const [name, code] of Object.entries(WOB_COUNTRIES)) {
    const row = rows.get(name);
    if (row === undefined) {
      return {
        ok: false,
        guard: "missing_country",
        message: `beklenen ülke satırı yok: "${name}" (${code}) — dosya yapısı değişmiş olabilir`,
      };
    }
    const cell = sheet.get(`${dieselCol}${row}`);
    if (!cell || cell.kind !== "number") {
      return {
        ok: false,
        guard: "missing_country",
        message: `"${name}" satırında dizel hücresi (${dieselCol}${row}) boş ya da sayı değil`,
      };
    }

    // ⚠️ 1000 LİTRE → LİTRE. Bu bölme atlanırsa 4. muhafız yakalar.
    const perLitre = cell.value / 1000;

    // ── 4. MUHAFIZ: MAKUL BANT ────────────────────────────────────────
    if (perLitre < PRICE_MIN_EUR_PER_L || perLitre > PRICE_MAX_EUR_PER_L) {
      return {
        ok: false,
        guard: "range",
        message: `"${name}" dizel ${perLitre} €/L — makul bandın (${PRICE_MIN_EUR_PER_L}-${PRICE_MAX_EUR_PER_L}) dışında; birim hatası olabilir`,
      };
    }

    // 4 ondalık: DB kolonu numeric(12,4). Kaynak zaten 3 basamak veriyor.
    const price = Math.round(perLitre * 10_000) / 10_000;
    records.push({
      countryCode: code,
      fuelType: "diesel",
      referenceDate,
      price,
      currency: "EUR",
      // Kaynak EUR yayınlıyor → çevrim yok, fx_rate null kalır.
      priceEur: price,
      statistic: WOB_STATISTIC,
      sourceKey: WOB_SOURCE_KEY,
      sourceUrl: WOB_LANDING,
      licenseNote: WOB_LICENSE_NOTE,
      expectedPeriodDays: WOB_PERIOD_DAYS,
    });
  }

  return { ok: true, records, referenceDate, ageDays };
}
