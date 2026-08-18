import type { NextRequest } from "next/server";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement as e } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToStream,
} from "@react-pdf/renderer";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/spike — TEK ATIMLIK SPIKE, ÜRÜN UCU DEĞİL.
 *
 * ── NEYİ ÖLÇÜYOR ──────────────────────────────────────────────────────────
 * Tek bir soruyu, canlıda: **@react-pdf/renderer bir Next Route Handler'ının
 * içinde, Vercel'in serverless paketlemesinden geçtikten sonra çalışıyor mu?**
 * Yerelde düz Node'da çalıştığı 18.08.2026'da ölçüldü (AZG hacminde 902 ms /
 * ~10 sayfa). Ölçülemeyen tek şey PAKETLEMEYDİ ve onu ölçmenin tek yolu deploy
 * etmekti. Bu dosya o ölçümün aracıdır.
 *
 * Cevap alındıktan sonra SİLİNİR ya da gerçek rapor ucuna dönüşür. Hiçbir ekran
 * buna bağlanmamalı: sabit metin basar, veritabanına hiç bakmaz, panelin PDF
 * yoluna dokunmaz.
 *
 * ── NEDEN `.ts` + createElement, `.tsx` DEĞİL ─────────────────────────────
 * `.tsx` sürümü ÖLÇÜLDÜ ve ESLint tabanını 28 → 32 hataya çıkardı: React
 * derleyici kuralları (`react-hooks/purity`, "Avoid constructing JSX within
 * try/catch") dosyayı bileşen modülü sanıyor — çünkü dışa verilen `GET` adı
 * BÜYÜK HARFLE başlıyor ve bileşen sezgisine takılıyor. Yani her `.tsx` route
 * handler bu kurallara yakalanır. JSX'i `createElement`e çevirmek tabanı
 * bozulmadan bırakır; okunabilirlik bedeli bilinçli.
 *
 * ── ÖLÇÜLEN ÜÇ ŞEY ────────────────────────────────────────────────────────
 *  1. Paketleme  — uç 200 + `application/pdf` mi, yoksa modül çözümleme
 *                  hatasıyla 500 mü.
 *  2. FONT       — `public/fonts/Geist-Regular.ttf` lambda'nın DOSYA
 *                  SİSTEMİNDE var mı. Vercel `public/` içeriğini CDN'e
 *                  yüklüyor; fonksiyon paketine de girip girmediği AYRI bir
 *                  sorudur ve buranın asıl bilinmeyeni budur.
 *                  (Yerel `next build` izinde göründü — canlıda teyit edilecek.)
 *  3. Süre/boyut — canlı soğuk ve sıcak çağrı.
 *
 * ── FONT BULUNAMAZSA SESSİZCE HELVETICA'YA DÜŞMEZ ─────────────────────────
 * Düşseydi PDF yine üretilir, ş/ğ/İ/ö/ü/ß glifleri kaybolur ve spike
 * "çalışıyor" derdi — ölçmek istediği şeyi tam da kaçırarak. Bu yüzden font
 * yoksa uç 500 `font_missing` döner ve aradığı yolu SÖYLER. Resmî AZG
 * belgesinde glif kaybı kabul edilemez; spike de aynı çıtayı uygular.
 *
 * ── `?tani=1` ─────────────────────────────────────────────────────────────
 * PDF yerine ortam teşhisi (cwd, aranan yol, dizin listesi) JSON döner. Tek
 * deploy'dan iki cevap alınsın diye: PDF düşerse SEBEBİNİ ikinci bir tur
 * beklemeden görürüz.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Diğer 34 mobil uçla aynı kapı. Spike bile olsa kapısız bir uç açılmaz —
 * `?tani=1` sunucunun dosya sistemi hakkında bilgi döndürüyor.
 *
 * ── renderToBuffer YOK; toBuffer() DE BUFFER DÖNDÜRMÜYOR ──────────────────
 * `renderToBuffer` v4.5.1'in tür tanımında var ama runtime'ında YOK (ölçüldü:
 * `typeof === "undefined"`). `pdf(doc).toBuffer()` ise adına rağmen Buffer
 * değil, bir PDFDocument AKIŞI döndürür (ölçüldü). Geriye tek doğru yol
 * kalıyor: `renderToStream` + akışı elde toplamak.
 */

const FONT_PATH = path.join(process.cwd(), "public", "fonts", "Geist-Regular.ttf");

/** Türkçe + Almanca glif kümesi. Helvetica'ya düşülürse burası bozulur. */
const GLIF_TESTI = "ŞĞİÖÇÜ şğıöçü — ÄÖÜß äöüß — Verstöße · Şoför · Grüße";

let fontKayitli = false;
function fontKaydet() {
  if (fontKayitli) return;
  Font.register({
    family: "GeistSpike",
    fonts: [
      { src: FONT_PATH, fontWeight: 400 },
      { src: FONT_PATH, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((w) => [w]);
  fontKayitli = true;
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 11, fontFamily: "GeistSpike" },
  h1: { fontSize: 20, marginBottom: 12 },
  h2: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  p: { marginBottom: 4, lineHeight: 1.4 },
  kutu: { borderWidth: 1, borderColor: "#999999", padding: 10, marginTop: 10 },
  mono: { fontSize: 9, color: "#444444" },
});

/** Sabit iki sayfalık deneme belgesi. Veri kaynağı YOK — bilerek. */
function spikeBelgesi(an: string) {
  return e(
    Document,
    { title: "HAK61 PDF Spike" },
    e(
      Page,
      { size: "A4", style: s.page },
      e(Text, { style: s.h1 }, "Sunucu tarafı PDF — Spike (Sayfa 1/2)"),
      e(
        Text,
        { style: s.p },
        "Bu belge bir Next.js Route Handler içinde, Vercel serverless fonksiyonunda üretildi. Panelin PDF yoluna DOKUNULMADI."
      ),
      e(Text, { style: s.h2 }, "Glif testi — gömülü font doğrulaması"),
      e(Text, { style: s.p }, GLIF_TESTI),
      e(Text, { style: s.p }, "Ünlü şoför çığlığı: İstanbul, Iğdır, Şırnak, Öğüt, Üçüncü."),
      e(Text, { style: s.p }, "Amtsdeutsch: Verstöße gegen § 9 Abs. 1 AZG, Straße, Grüße, groß."),
      e(
        View,
        { style: s.kutu },
        e(Text, { style: s.mono }, `font: ${FONT_PATH}`),
        e(Text, { style: s.mono }, `üretim anı: ${an}`)
      )
    ),
    e(
      Page,
      { size: "A4", style: s.page },
      e(Text, { style: s.h1 }, "Sayfa 2/2"),
      e(
        Text,
        { style: s.p },
        "İkinci sayfa, çok sayfalı belgenin sayfa kırılımının sunucuda da çalıştığını gösterir."
      ),
      e(Text, { style: s.p }, GLIF_TESTI)
    )
  );
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const fontVar = existsSync(FONT_PATH);

  if (url.searchParams.get("tani") === "1") {
    const listele = (p: string) => {
      try {
        return readdirSync(p).slice(0, 40);
      } catch (err) {
        return [`<okunamadı: ${(err as Error).message}>`];
      }
    };
    return Response.json({
      ok: true,
      cwd: process.cwd(),
      fontYolu: FONT_PATH,
      fontVar,
      cwdIcerigi: listele(process.cwd()),
      publicIcerigi: listele(path.join(process.cwd(), "public")),
      fontsIcerigi: listele(path.join(process.cwd(), "public", "fonts")),
      node: process.version,
      bolge: process.env.VERCEL_REGION ?? null,
    });
  }

  // Sessiz düşüş YOK: font yoksa Helvetica'ya inip "çalıştı" demeyiz.
  if (!fontVar) {
    return mobileError(500, "font_missing", { fontYolu: FONT_PATH, cwd: process.cwd() });
  }

  // Belge try'dan ÖNCE kuruluyor: React ağacı kurmak ile RENDER etmek ayrı
  // anlar, try yalnız render/akış hatalarını yakalamalı.
  const baslangic = Date.now();
  const belge = spikeBelgesi(new Date().toISOString());
  try {
    fontKaydet();
    const stream = await renderToStream(belge);
    const parcalar: Buffer[] = [];
    for await (const parca of stream as AsyncIterable<Buffer | string>) {
      parcalar.push(Buffer.isBuffer(parca) ? parca : Buffer.from(parca));
    }
    const buf = Buffer.concat(parcalar);
    const ms = Date.now() - baslangic;

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(buf.length),
        "content-disposition": 'inline; filename="hak61-spike.pdf"',
        // Ölçüm başlıkları — istemci indirmeden süreyi/boyutu görebilsin.
        "x-spike-render-ms": String(ms),
        "x-spike-bytes": String(buf.length),
        "x-spike-region": process.env.VERCEL_REGION ?? "local",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Paketleme hatası burada görünür — sebebi YUTULMAZ.
    const hata = err as Error;
    return mobileError(500, "render_failed", {
      mesaj: hata.message,
      ad: hata.name,
      yigin: (hata.stack ?? "").split("\n").slice(0, 6),
      gecenMs: Date.now() - baslangic,
    });
  }
}
