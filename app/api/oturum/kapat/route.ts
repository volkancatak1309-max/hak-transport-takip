import { NextResponse, type NextRequest } from "next/server";
import { getSession, sessionOptions } from "@/lib/session";
import { closeLoginSession } from "@/lib/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OTURUM YIKIM KAPISI — çerezi silmenin TEK yasal yeri (17 Ağu 2026 olayı).
 *
 * ── NEDEN AYRI BİR ROUTE HANDLER ───────────────────────────────────────────
 * Next.js'te çerez YAZMAK yalnız Server Action ve Route Handler'da serbesttir.
 * `lib/session.ts`teki kapılar sayfa RENDER'ı sırasında çalışır; orada
 * `session.destroy()` çağırmak "Cookies can only be modified in a Server Action
 * or Route Handler" istisnası atar. İstisna `app/error.tsx`e düşer ve kullanıcı
 * ÇIKIŞI OLMAYAN bir döngüde kilitlenir: `/` çerezde worker_id gördüğü için
 * `/admin`e atar, `/admin` çöker, hata ekranındaki tek düğme `/`e döner.
 * Çerezi temizleyecek olan kod, çerezi temizleyemediği için çöküyordu.
 *
 * Bu uç o düğümü kesiyor: kapılar buraya YÖNLENDİRİR (yönlendirme render
 * sırasında serbesttir), silme işi burada — yasal yerde — yapılır.
 *
 * ── ÇEREZ NEDEN ELLE SİLİNİYOR ─────────────────────────────────────────────
 * `session.destroy()` yerine çerez doğrudan YANITA yazılıyor. Sebep: destroy()
 * mutasyonu `cookies()` deposuna bırakır ve Next'in onu bizim ürettiğimiz
 * yanıta birleştirmesine güvenmek gerekir. Silme işlemi bu düzeltmenin can
 * damarı — çerçeve davranışına değil, açıkça yazdığımız başlığa dayanmalı.
 * `sessionOptions.cookieOptions` aynen taşınıyor: path/secure/sameSite birebir
 * uyuşmazsa tarayıcı ESKİ çerezi silmez, yanına ikinci bir çerez yazar.
 *
 * ── NEDEN GET ──────────────────────────────────────────────────────────────
 * Kilitli kullanıcının elinde yalnız adres çubuğu var; POST'a çeviremez.
 * Bedeli: `<img src=".../api/oturum/kapat">` ile zorla çıkış (CSRF). Zararı
 * veri sızması değil, vardiya ortasında rahatsızlıktır — yine de ucuzca
 * kapatılıyor: gezinme olmayan istekler (`sec-fetch-dest` ≠ document) hiçbir
 * şey yapmadan 204 döner. Başlığı HİÇ göndermeyen eski tarayıcıda izin verilir;
 * kaçış kapısını kapamak, kapatmaya çalıştığımız rahatsızlıktan beterdir.
 */
export async function GET(req: NextRequest) {
  const dest = req.headers.get("sec-fetch-dest");
  if (dest !== null && dest !== "document") {
    return new NextResponse(null, { status: 204 });
  }

  // Açık oturum satırını kapat (045) — logoutAction'ın aynısı. Zaten kapalı
  // satıra dokunmaz (`closeLoginSession` .is("ended_at", null) ile filtreler),
  // yani "revoked" gerekçesi "logout" ile ezilmez. Hata olsa bile çıkış olur.
  const session = await getSession();
  await closeLoginSession(session.login_session_id, "logout");

  // Göreli Location bilinçli: NextResponse.redirect mutlak URL ister ve onu
  // req.url'den türetmek proxy arkasında iç adrese düşebilir.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/" } });
  res.cookies.set(sessionOptions.cookieName, "", {
    ...sessionOptions.cookieOptions,
    maxAge: 0,
  });
  return res;
}
