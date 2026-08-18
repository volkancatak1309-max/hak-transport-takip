import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
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

let kayitli = false;

/**
 * Fontu bir kez kaydeder.
 *
 * ⚠️ SESSİZ HELVETICA DÜŞÜŞÜ YOK. Dosya yoksa FIRLATIR. Düşseydi PDF yine
 * üretilir ama ş/ğ/İ/ö/ü/ß glifleri kaybolurdu ve kimse fark etmezdi — resmî
 * bir belgede bu, hatanın en kötü türü: çıktı üretiliyor ve yanlış.
 */
export function registerServerPdfFont(): void {
  if (kayitli) return;
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
  Font.registerHyphenationCallback((w) => [w]);
  kayitli = true;
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
export async function renderPdfToBuffer(element: ReactElement): Promise<Buffer> {
  /**
   * TÜR DARALTMASI BİLEREK GEVŞETİLİYOR. `renderToStream`in imzası
   * `ReactElement<DocumentProps>` istiyor, yani KÖKÜN doğrudan `<Document>`
   * olmasını. Gerçekte bir SARMALAYICI bileşen de geçerlidir — panelin kendi
   * `pdf(<Doc …/>)` çağrısı da tam olarak öyle çalışıyor ve react-pdf
   * uzlaştırıcısı ağacı çözerken `<Document>`ı buluyor. İmzayı olduğu gibi
   * kabul etseydik her çağıran belgesini `<Document>` döndüren bir değişkene
   * açmak zorunda kalırdı; kazanılan tip güvenliği sahte olurdu, çünkü asıl
   * denetim zaten çalışma anında (Document yoksa react-pdf fırlatır).
   */
  const stream = await renderToStream(element as ReactElement<DocumentProps>);
  const parcalar: Buffer[] = [];
  for await (const parca of stream as AsyncIterable<Buffer | string>) {
    parcalar.push(Buffer.isBuffer(parca) ? parca : Buffer.from(parca));
  }
  return Buffer.concat(parcalar);
}
