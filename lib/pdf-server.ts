import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import zlib from "node:zlib";
import type { DocumentProps } from "@react-pdf/renderer";
import { Font, renderToStream } from "@react-pdf/renderer";

/**
 * SUNUCU TARAFI PDF ÇEKİRDEĞİ — font kaydı + akıştan buffer.
 *
 * ── NEDEN lib/pdf-font.ts KULLANILMIYOR ───────────────────────────────────
 * O dosya `"use client"` ve fontu `"/fonts/Geist-Regular.ttf"` TARAYICI YOLUYLA
 * kaydediyor. Node bu dizeyi bir DOSYA YOLU sanıyor ve `ENOENT: /fonts/...`
 * ile düşüyor — 18.08.2026'da ölçüldü. Panelin yolu doğru çalışıyor ve
 * DEĞİŞTİRİLMEDİ; sunucunun kendi kaydı burada yaşıyor.
 *
 * Font AİLE ADI bilerek AYNI ("Geist"): iki yol aynı belgeyi aynı yüzle
 * bassın. Çakışma yok — `Font` kayıt defteri süreç başına tekildir ve istemci
 * derlemesi ile sunucu derlemesi ayrı süreçlerdir.
 *
 * ── FONT PAKETE GİRİYOR (canlıda ölçüldü, 18.08.2026) ─────────────────────
 * Vercel `public/` içeriğini CDN'e yüklüyor; fonksiyon paketine de girip
 * girmediği bilinmiyordu. Spike ölçtü: lambda'da `/var/task/public/fonts/
 * Geist-Regular.ttf` VAR. Next dosya izleyicisi aşağıdaki `path.join(
 * process.cwd(), ...)` desenini statik çözüp dosyayı ize ekliyor.
 *
 * ⚠️ BU DESEN KIRILGAN: yol bir değişkenden hesaplanırsa (ör. `path.join(kok,
 * ...parcalar)`) izleyici çözemez, dosya pakete girmez ve uç ancak CANLIDA
 * düşer. Yolu sabit tutun.
 *
 * ── BUFFER DESTEKLENMİYOR ─────────────────────────────────────────────────
 * `Font.register({ src: Buffer })` v4.5.1'de patlıyor (`dataUrl.substring is
 * not a function` — ölçüldü). Geriye dosya yolu ya da `data:` URL kalıyor;
 * dosya yolu seçildi çünkü 126 KB'lık fontu base64 olarak koda gömmek paketi
 * şişirir ve fontun tek kaynağı `public/` olarak kalsın.
 */

/** Panelin `PDF_FONT` sabitiyle AYNI aile adı — iki yol aynı yüzü basar. */
export const PDF_FONT_SERVER = "Geist";

/** SABİT yol — izleyicinin statik olarak çözebilmesi için değişken YOK. */
export const SERVER_PDF_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Geist-Regular.ttf"
);

/** Font dosyası bu lambda'nın dosya sisteminde var mı? */
export function serverPdfFontHazir(): boolean {
  return existsSync(SERVER_PDF_FONT_PATH);
}

/**
 * Fontu bir kez kaydeder.
 *
 * ⚠️ SESSİZ HELVETICA DÜŞÜŞÜ YOK. Dosya yoksa FIRLATIR. Düşseydi PDF yine
 * üretilir ama ş/ğ/İ/ö/ü/ß glifleri kaybolurdu ve kimse fark etmezdi — resmî
 * bir belgede bu, hatanın en kötü türü: çıktı üretiliyor ve yanlış.
 */
export function registerServerPdfFont(): void {
  if (!serverPdfFontHazir()) {
    throw new Error(`pdf_font_missing:${SERVER_PDF_FONT_PATH}`);
  }
  Font.register({
    family: PDF_FONT_SERVER,
    fonts: [
      { src: SERVER_PDF_FONT_PATH, fontWeight: 400 },
      // Tek ağırlık gömülü: "bold" aynı dosyaya eşlenir (metin doğru kalır,
      // yalnız görsel olarak kalın değildir). Panelin kuralının aynısı.
      { src: SERVER_PDF_FONT_PATH, fontWeight: 700 },
    ],
  });
  // Kelime bölmeyi kapat — panelle aynı davranış.
  // ⚠️ `Font.clear()` bu geri çağrıyı da siliyor; her render'da yeniden
  // kurulması ŞART, yoksa kelimeler ortadan bölünür.
  Font.registerHyphenationCallback((w) => [w]);
}

/**
 * Belgeyi tam bir Buffer'a render eder.
 *
 * ── NEDEN renderToStream ──────────────────────────────────────────────────
 * `renderToBuffer` v4.5.1'in TÜR TANIMINDA var ama runtime'ında YOK
 * (`typeof === "undefined"`, ölçüldü) — yani onu çağıran kod DERLENİR ama
 * çalışmaz. `pdf(doc).toBuffer()` ise adına rağmen Buffer değil bir
 * PDFDocument AKIŞI döndürür (ölçüldü). Geriye tek dürüst yol kalıyor.
 *
 * ── NEDEN AKIŞ DOĞRUDAN Response'A VERİLMİYOR ─────────────────────────────
 * Verilebilirdi (Readable.toWeb). Verilmiyor çünkü render ORTASINDA oluşan bir
 * hata, gövde yazılmaya başladıktan sonra HTTP durumunu değiştiremez: istemci
 * 200 + yarım PDF alırdı. Tamamını toplayıp öyle göndermek, hatayı 500'e
 * çevirebilmemizi sağlıyor. Bedeli bellek: ölçülen rapor boyutları 15-60 KB.
 */
/**
 * ═══ FONT DURUMU RENDER'LAR ARASINDA KİRLENİYOR (ölçüldü, 18.08.2026) ═══
 *
 * react-pdf'in `Font` deposu MODÜL GENELİNDE ve yüklenen fontkit nesnesi
 * render'lar arasında PAYLAŞILIYOR. Sonuç ölçüldü — taze bir süreçte:
 *     1. PDF (schichtbericht) → ToUnicode TAM
 *     2. AZG                  → CMap'te 4 BOŞ girdi: `<002b><>` `<002c><>` …
 * Boş girdi demek, o glifin ToUnicode karşılığı YOK demek: harf sayfada DOĞRU
 * görünür ama METİN OLARAK ÇIKARILAMAZ — kopyalanamaz, aranamaz. Canlı örnekte
 * "k" harfi belgede 33 kez basılıydı ve hiçbiri kopyalanamıyordu
 * ("Gefahrene ❓m", "Kal❓anli").
 *
 * Bir müfettişin arayıp kopyalayacağı § 26 belgesinde bu kabul edilemez.
 *
 * SEBEP: `pdfkit` glif→unicode eşlemesini İLK KARŞILAŞMADA yazıyor
 * (`if (this.unicode[gid] == null)`); paylaşılan fontkit örneği ikinci
 * render'da bazı glifleri boş `codePoints` ile döndürünce eşleme boş yazılıyor
 * ve bir daha DÜZELMİYOR.
 *
 * ÇÖZÜM: her render'dan önce `Font.reset()` — kayıt korunur, yalnız yüklenmiş
 * font verisi düşürülür ve taze ayrıştırılır. Bedeli ölçüldü: 126 KB TTF'nin
 * yeniden ayrıştırılması, render başına ~200 ms.
 *
 * ⚠️ RENDER'LAR SIRAYA ALINIYOR. `Font.reset()` global durumu değiştirdiği
 * için eşzamanlı iki render birbirinin fontunu ayağının altından çekebilirdi.
 * Zincir, sıfırlama + render'ı bölünmez bir bütün yapıyor. PDF render'ı zaten
 * CPU-bağımlı; aynı lambda'da paralel koşturmak duvar saatini kısaltmıyor.
 */
let sira: Promise<unknown> = Promise.resolve();

export async function renderPdfToBuffer(element: ReactElement): Promise<Buffer> {
  const gorev = sira.then(() => renderTek(element));
  // Zincir hata yutmaz ama KIRILMAZ: bir render düşerse sıradaki yine çalışır.
  sira = gorev.catch(() => undefined);
  return gorev;
}

async function renderTek(element: ReactElement): Promise<Buffer> {
  await fontuTazele();
  const stream = await renderToStream(element as ReactElement<DocumentProps>);
  const parcalar: Buffer[] = [];
  for await (const parca of stream as AsyncIterable<Buffer | string>) {
    parcalar.push(Buffer.isBuffer(parca) ? parca : Buffer.from(parca));
  }
  const buf = Buffer.concat(parcalar);
  cikarilabilirMi(buf);
  return buf;
}

/**
 * FONT ÖRNEĞİNİ TAZELE — her render kendi fontkit örneğiyle çalışsın.
 *
 * ═══ NEDEN (ölçüldü, 18.08.2026) ═══
 *
 * react-pdf'in `Font` deposu MODÜL GENELİNDE; yüklenen fontkit nesnesi
 * render'lar arasında paylaşılıyor. Ölçüm — taze bir süreçte:
 *     1. render → ToUnicode TAM
 *     2. render → CMap'te BOŞ girdiler: `<0034><>` …
 * Boş girdi = o glifin unicode karşılığı yok: harf sayfada DOĞRU görünür ama
 * METİN OLARAK ÇIKARILAMAZ (kopyalanamaz, aranamaz). Canlı örnekte "k" harfi
 * belgede 33 kez basılıydı ve hiçbiri kopyalanamıyordu ("Gefahrene ❓m",
 * "Kal❓anli"). Bir müfettişin arayacağı § 26 belgesinde bu kabul edilemez.
 *
 * SEBEP: `pdfkit` glif→unicode eşlemesini İLK KARŞILAŞMADA yazıyor
 * (`if (this.unicode[gid] == null)`); paylaşılan fontkit örneği ikinci
 * render'da bazı glifleri boş `codePoints` ile döndürünce eşleme BOŞ yazılıyor
 * ve bir daha düzelmiyor.
 *
 * ═══ ÜÇ YOL DENENDİ, İKİSİ ÖLÇÜMDE DÜŞTÜ ═══
 *   ✗ `Font.reset()` tek başına → `data`yı null yapıyor ama `FontSource.load()`
 *     `loadResultPromise` ile MEMOİZE: çözülmüş promise geri döndüğü için veri
 *     bir daha YÜKLENMİYOR → 2. istekten itibaren her PDF 500
 *     ("Cannot read properties of null (reading 'unitsPerEm')").
 *   ✗ `Font.clear()` + yeniden kayıt → react-pdf'in KENDİ standart fontlarını
 *     da siliyor → İLK istek bile "Font family not registered: Helvetica".
 *   ✓ `reset()` + memoyu düşür → veri sıfırlanır ve bir sonraki kullanımda
 *     taze ayrıştırılır; standart fontlara dokunulmaz.
 *
 * ⚠️ `loadResultPromise` react-pdf'in İÇ alanı. Kütüphane onu yeniden
 * adlandırırsa bu tazeleme SESSİZCE etkisiz kalırdı — bu yüzden çıktı ayrıca
 * `cikarilabilirMi` ile denetleniyor: kusur geri gelirse PDF üretilmez, hata
 * verilir.
 */
async function fontuTazele(): Promise<void> {
  Font.reset();
  const aile = (Font.getRegisteredFonts() as Record<string, { sources?: { loadResultPromise?: unknown }[] }>)[
    PDF_FONT_SERVER
  ];
  for (const kaynak of aile?.sources ?? []) kaynak.loadResultPromise = null;
  await Font.load({ fontFamily: PDF_FONT_SERVER, fontWeight: 400 });
  await Font.load({ fontFamily: PDF_FONT_SERVER, fontWeight: 700 });
}

/**
 * ÇIKTI MUHAFIZI — metni çıkarılamayan bir resmî belge GÖNDERİLMEZ.
 *
 * ToUnicode CMap'inde boş değerli girdi (`<xxxx><>`) varsa o glif kopyalanamaz
 * ve aranamaz. Böyle bir belgeyi 200 ile göndermek, sorunu ancak bir müfettiş
 * belgeyi aradığında ortaya çıkarırdı — yani hiç fark edilmeyecek yerde.
 *
 * Maliyeti: 60-90 KB'lık çıktıda akışları açıp tek bir düzenli ifade. Ölçülen
 * render süreleri saniyeler mertebesinde; bu denetim yanında görünmez.
 */
function cikarilabilirMi(buf: Buffer): void {
  const raw = buf.toString("latin1");
  const re = new RegExp("stream\r?\n", "g");
  const bosSatir = /^<[0-9A-Fa-f]+>\s*<\s*>$/;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const bas = m.index + m[0].length;
    const son = raw.indexOf("endstream", bas);
    if (son < 0) continue;
    let metin: string;
    try {
      metin = zlib.inflateSync(buf.subarray(bas, son)).toString("latin1");
    } catch {
      continue;
    }
    if (!metin.includes("begincmap")) continue;
    const bos = metin.split("\n").filter((l) => bosSatir.test(l.trim()));
    if (bos.length > 0) {
      throw new Error(`pdf_tounicode_bos:${bos.length}:${bos.slice(0, 4).join(",")}`);
    }
  }
}
