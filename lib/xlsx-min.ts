import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * ASGARİ XLSX OKUYUCU — tek dosya, sıfır bağımlılık.
 *
 * ═══ NEDEN PAKET EKLENMEDİ ═══
 *
 * Projenin 38 bağımlılığı var ve hiçbiri zip/xlsx okumuyor. `xlsx` ya da
 * `exceljs` eklemek, haftada bir kez 14 KB'lık tek bir dosyayı okumak için
 * yüzlerce kilobaytlık ve geniş yüzeyli bir bağımlılığı üretim sunucusuna
 * sokmak olurdu. Okunacak dosyanın YAPISI ölçüldü (24.08.2026): 13 girdili
 * bir ZIP, iki XML parçası, 31 satırlık tek sayfa. İhtiyaç bu kadar dar
 * olduğunda bağımlılık, çözdüğünden fazla yüzey açar.
 *
 * ⚠️ BU GENEL AMAÇLI BİR XLSX KÜTÜPHANESİ DEĞİLDİR ve olmaya çalışmamalıdır.
 * Desteklemediği ve desteklemeyeceği şeyler: ZIP64, şifreli/imzalı paketler,
 * inline string (`<is>`), formül sonucu olmayan hücreler, çoklu sayfa seçimi,
 * biçim/stil yorumlama, tarih hücrelerinin biçimden çözülmesi. Bunlardan biri
 * gerekirse doğru cevap burayı büyütmek değil, o gün bir paket eklemektir.
 *
 * Kaynak: AB Weekly Oil Bulletin, "Prices with taxes" XLSX.
 */

/** Bir hücre: ya sayı ya metin. Boş hücre haritada HİÇ görünmez. */
export type XlsxCell = { kind: "number"; value: number } | { kind: "text"; value: string };

/** Sayfa: "A1" gibi hücre başvurusundan değere harita. */
export type XlsxSheet = Map<string, XlsxCell>;

// ── ZIP ────────────────────────────────────────────────────────────────────

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

/**
 * Merkezî dizini okuyup girdileri döndürür.
 *
 * EOCD (End Of Central Directory) kaydı dosyanın SONUNDA ama sabit bir yerde
 * değil — arkasında değişken uzunlukta bir yorum olabilir. O yüzden sondan
 * geriye taranıyor. Tarama 66 KB ile sınırlı: ZIP yorumu en fazla 65.535 bayt
 * olabilir (+22 baytlık kayıt), yani bundan geriye bakmak anlamsız ve bozuk
 * bir dosyada sonsuza dek gezmeyi önler.
 */
function readZipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: ZIP merkezî dizin sonu (EOCD) bulunamadı");

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`xlsx: merkezî dizin imzası bozuk (girdi ${n})`);
    }
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    out.push({
      name: buf.toString("utf8", off + 46, off + 46 + nameLen),
      method,
      compressedSize,
      localOffset,
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Tek girdiyi açar. Yalnız yöntem 0 (saklanmış) ve 8 (deflate) desteklenir —
 * XLSX üreticilerinin fiilen kullandığı ikisi bunlar.
 *
 * ⚠️ Girdinin gerçek verisi YEREL başlıktan sonra başlar ve yerel başlıktaki
 * ad/ekstra uzunlukları merkezî dizindekilerden FARKLI olabilir. Merkezî
 * dizininkileri kullanmak sessizce birkaç bayt kaymış veri üretir.
 */
function extract(buf: Buffer, entries: ZipEntry[], name: string): Buffer | null {
  const e = entries.find((x) => x.name === name);
  if (!e) return null;
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRawSync(raw);
  throw new Error(`xlsx: desteklenmeyen sıkıştırma yöntemi ${e.method} (${name})`);
}

// ── XML ────────────────────────────────────────────────────────────────────

/**
 * XML varlık çözümü. XLSX'te karşılaşılan küme dar: `&amp;` `&lt;` `&gt;`
 * `&quot;` `&apos;` ve sayısal başvurular. Tam bir XML ayrıştırıcı değil —
 * ihtiyaç da o değil (bkz. dosya başlığı).
 */
function unescapeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // & EN SONA: önce yapılırsa "&amp;lt;" gibi çift kaçışlar bozulur.
    .replace(/&amp;/g, "&");
}

/**
 * sharedStrings.xml → dizin sırasına göre metin dizisi.
 *
 * Bir `<si>` içinde birden çok `<t>` olabilir (zengin metin: kalın/italik
 * parçalar ayrı çalıştırmalara bölünür). Hepsi BİRLEŞTİRİLİR — yalnız ilkini
 * almak "Gas oil automobile Automotive gas oil" gibi başlıkları yarıda keserdi
 * ve sütun bulma o başlığa dayanıyor.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = "";
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
    out.push(unescapeXml(s));
  }
  return out;
}

/** Tek sayfayı hücre haritasına çevirir. */
function parseSheet(xml: string, shared: string[]): XlsxSheet {
  const sheet: XlsxSheet = new Map();
  for (const c of xml.matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*)\/?>([\s\S]*?)<\/c>/g)) {
    const ref = c[1];
    const attrs = c[2];
    const inner = c[3];
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    if (v === undefined) continue; // boş ya da yalnız biçim taşıyan hücre
    if (type === "s") {
      const idx = Number(v);
      const text = shared[idx];
      if (text !== undefined) sheet.set(ref, { kind: "text", value: text });
      continue;
    }
    if (type === "str" || type === "inlineStr") {
      sheet.set(ref, { kind: "text", value: unescapeXml(v) });
      continue;
    }
    const n = Number(v);
    if (Number.isFinite(n)) sheet.set(ref, { kind: "number", value: n });
  }
  return sheet;
}

/**
 * XLSX baytlarından İLK sayfayı okur.
 *
 * ⚠️ "İlk sayfa" = `xl/worksheets/sheet1.xml`. workbook.xml'deki sayfa
 * sırasını çözmüyoruz; okunan dosyada tek sayfa olduğu ölçüldü. Çok sayfalı
 * bir dosya gelirse bu varsayım sessizce yanlış sayfayı okur — o yüzden
 * çağıran taraf beklediği başlığı DOĞRULAMAK zorunda (bkz. fuel-price-source).
 */
export function readFirstSheet(bytes: Buffer): XlsxSheet {
  const entries = readZipEntries(bytes);
  const sheetXml = extract(bytes, entries, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("xlsx: xl/worksheets/sheet1.xml yok");
  const ssXml = extract(bytes, entries, "xl/sharedStrings.xml");
  const shared = ssXml ? parseSharedStrings(ssXml.toString("utf8")) : [];
  return parseSheet(sheetXml.toString("utf8"), shared);
}

/**
 * Excel seri tarihi → ISO gün (YYYY-MM-DD).
 *
 * Epoch 1899-12-30, 1900-01-01 DEĞİL: Lotus 1-2-3 uyumluluğu için Excel
 * 1900'ü artık yıl sayar ve var olmayan 29 Şubat 1900'ü takvime koyar. İki
 * günlük kayma tam olarak buradan gelir ve epoch'u iki gün geriye almak
 * 1900-03-01'den SONRAKİ tüm tarihleri doğru yapar — bizim aralığımız (2005+)
 * tamamen o bölgede.
 *
 * ÖLÇÜLDÜ (24.08.2026): 46251 → 2026-08-17, kaynağın kendi yayın tarihiyle
 * birebir uyuştu.
 */
export function excelSerialToISODate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  // 1900-03-01 öncesi (serial < 61) Excel'in artık yıl hatasının İÇİNDE kalır;
  // o bölgede dönüşüm yanlıştır ve bize hiç gerekmez — reddediyoruz.
  if (serial < 61) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** "C7" → { col: "C", row: 7 }. Geçersizse null. */
export function splitRef(ref: string): { col: string; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: m[1], row: Number(m[2]) } : null;
}
