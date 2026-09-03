import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError, issueTokens } from "@/lib/mobile-auth";
import { clientIpFromHeaders } from "@/lib/auth-core";
import { changeOwnPin } from "@/lib/worker-account-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/me/pin — KULLANICI KENDİ PIN'İNİ DEĞİŞTİRİR.
 *
 * Gövde: `{ "mevcutPin": "418302", "yeniPin": "740193", "yeniPinTekrar": "740193" }`
 *
 * ═══ NE ÇÖZÜYOR, NE ÇÖZMÜYOR ═══════════════════════════════════════════════
 *
 * ÇÖZDÜĞÜ: PIN'ini BİLEN kullanıcı onu telefondan değiştirebiliyor; ve
 * `must_change_pin` bayrağıyla gelen kullanıcı (yönetici geçici PIN atadı)
 * zorunlu değişimi uygulamada tamamlayabiliyor. Bugüne dek ikisi de yalnız web
 * panelinden yapılabiliyordu (app/(auth)/change-pin.tsx: "Bu ekran yakında").
 *
 * ⚠️ ÇÖZMEDİĞİ: PIN'İNİ UNUTAN kullanıcı. O kişinin geçerli bir token'ı da
 * yoktur (giremez), dolayısıyla bu uca da erişemez. Onun tek kurtarma yolu
 * yöneticinin PIN sıfırlamasıdır (`POST /api/mobile/workers/[id]/pin` ya da
 * panelde "PIN Belirle") ve öyle kalmalı: unutulmuş bir PIN'i sıfırlayan
 * girişsiz bir yol, hesabın kendisini girişsiz yapardı.
 *
 * ── KAPI: HERKES, KENDİSİ İÇİN ─────────────────────────────────────────────
 * `requireMobileWorker` — şoför, filo şefi, yönetici, patron. Hedef GÖVDEDEN
 * GELMEZ; değişen PIN token'daki kişinin PIN'idir. Kardeş uçlardaki
 * "yönetici muafiyeti" (`counts_as_driver`) cümlesi BURADA YOK ve olmamalı:
 * bu bir ŞOFÖR işi değil, KİMLİK işidir — direksiyona geçmeyen yönetici de
 * kendi PIN'ini değiştirebilmeli.
 *
 * ── MEVCUT PIN GİRİŞ SAYACINA YAZILIR ──────────────────────────────────────
 * Yanlış mevcut PIN `login_attempts`e AYNI satıra (ip|telefon) yazılır ve
 * kilit merdivenini AYNI şekilde ilerletir — 10 deneme, 15 sn tabanlı kademe
 * (lib/login-lock.ts). Ayrı bir sayaç kursaydık, çalınmış bir access token
 * sınırsız PIN denemesi yapabilen bir sözlük saldırısı aracına dönerdi: giriş
 * ekranı 10 denemede kilitlenirken bu uç sonsuza kadar cevap verirdi.
 * Doğru mevcut PIN sayacı SIFIRLAR — girişin başarı davranışıyla aynı.
 *
 * ── 🔴 YANLIŞ PIN 403 DÖNER, 401 DEĞİL ─────────────────────────────────────
 * 401 bu ucun sözlüğünde YALNIZ "token geçersiz" demektir (ortak kapı) ve
 * mobil istemciler 401'de oturumu düşürür. Yanlış yazılmış bir mevcut PIN'e
 * 401 demek, kullanıcıyı bir yazım hatası yüzünden uygulamadan ATARDI.
 * 403 = "kimliğin geçerli, bu isteği yapamazsın" — doğru cümle budur.
 *
 * ── TOKEN: DİĞER CİHAZLAR DÜŞER, BU CİHAZ DÜŞMEZ ───────────────────────────
 * `bumpTokenVersion` çağrılır (panelin `changePinAction`ı da çağırıyor): PIN
 * değişince o kişinin TÜM mobil anahtarları ölür. Bu, PIN'i ele geçirilmiş
 * kullanıcının ikinci cihazı düşürmesinin tek yolu ve karar bilinçli.
 *
 * Ama iptal ÇAĞIRAN CİHAZI da kapsıyor: uç, yeni sürümle mühürlenmiş YENİ bir
 * token çifti döndürerek onu geri verir. Aksi hâlde kullanıcı PIN'ini
 * değiştirir değiştirmez kendi telefonundan atılırdı — "değiştirdim, sonra
 * çıkış yaptım" gibi görünen bu davranış, güvenlik kazancı olmadan yalnız
 * güveni bozardı (yeni PIN'le hemen tekrar girebilirdi).
 * İstemci yanıttaki `accessToken`/`refreshToken` ile ESKİLERİ DEĞİŞTİRMELİ.
 *
 * Migration 044 yoksa `tokenIptal:false` döner: sürüm kolonu olmayan
 * kurulumda diğer cihazlar DÜŞMEZ ve bunu yanıt açıkça söyler — sessizce
 * "iptal edildi" demek, yapılmamış bir iptali yapılmış göstermek olurdu.
 *
 * ── HATA KODLARI ───────────────────────────────────────────────────────────
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   400 invalid_json · missing_fields · mevcut_pin_gecersiz
 *       yeni_pin_gecersiz (+ `sebep`: errPin | errPinWeak | errPinMismatch)
 *       ayni_pin
 *   403 mevcut_pin_hatali
 *   404 not_found            — kayıt okunamadı
 *   429 kilitli              + Retry-After (giriş ucuyla AYNI biçim)
 *   503 db_error
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "invalid", { alan: "govde", sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  // Üçü de ZORUNLU. `yeniPinTekrar` panelin `pin_confirm` alanının karşılığı:
  // eşleşme denetimi `changePinSchema`da, yani panelle TEK kural. İstemcinin
  // kendi ekranında iki kutu göstermesi yeterli sayılmadı — sunucu son sözü
  // söyler ve iki taraf aynı şemadan geçer.
  for (const alan of ["mevcutPin", "yeniPin", "yeniPinTekrar"] as const) {
    if (!(alan in g)) return mobileError(400, "missing_fields", { alan });
    if (typeof g[alan] !== "string") {
      return mobileError(400, "invalid", { alan, sebep: "metin_degil" });
    }
  }

  const r = await changeOwnPin({
    workerId: worker.id,
    mevcutPin: g.mevcutPin,
    yeniPin: g.yeniPin,
    yeniPinTekrar: g.yeniPinTekrar,
    ip: clientIpFromHeaders(req.headers),
  });

  if (!r.ok) {
    if (r.sebep === "kilitli") {
      return Response.json(
        {
          ok: false,
          error: "kilitli",
          retryAfter: r.retryAfter,
          lockedUntil: r.lockedUntil,
        },
        { status: 429, headers: { "Retry-After": String(r.retryAfter ?? 1) } }
      );
    }
    if (r.sebep === "mevcut_pin_hatali") return mobileError(403, "mevcut_pin_hatali");
    if (r.sebep === "mevcut_pin_gecersiz") {
      return mobileError(400, "mevcut_pin_gecersiz", { alan: "mevcutPin" });
    }
    if (r.sebep === "yeni_pin_gecersiz") {
      // Şemanın kendi mesaj anahtarı aynen taşınır — istemci HANGİ kuralın
      // çiğnendiğini bilsin (kardeş PIN ucuyla aynı desen).
      return mobileError(400, "yeni_pin_gecersiz", {
        alan: "yeniPin",
        sebep: r.pinKod ?? "errPin",
      });
    }
    if (r.sebep === "ayni_pin") return mobileError(400, "ayni_pin");
    if (r.sebep === "not_found") return mobileError(404, "not_found");
    return mobileError(503, "db_error", { sebep: "yazma_hatasi" });
  }

  // Yeni anahtarlar — iptal edilen sürümün ÜSTÜNDEKİ sürümle mühürlü.
  // 044 yoksa `tokenSurumu` null gelir; 0 ile mühürlemek doğru davranıştır,
  // çünkü o kurulumda sürüm denetimi zaten atlanıyor (lib/mobile-auth.ts).
  const tokens = await issueTokens(worker.id, worker.is_admin, r.tokenSurumu ?? 0);

  // Panelin personel sayfası `must_change_pin` durumunu gösteriyor. try/catch:
  // tazeleme başarısız olsa da PIN DEĞİŞTİ — 503 dönmek kullanıcıya "olmadı"
  // der ve aynı değişimi ikinci kez denetirdi (kardeş uçlardaki desen).
  let panelTazelendi = true;
  try {
    revalidatePath("/admin/workers");
    revalidatePath(`/admin/workers/${worker.id}`);
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    /** PIN GÖVDEDE DÖNMEZ — kardeş uçla aynı karar. */
    mustChangePin: false,
    /** false → migration 044 yok; DİĞER cihazlardaki anahtarlar ölmedi. */
    tokenIptal: r.tokenIptal,
    ...tokens,
    panelTazelendi,
  });
}
