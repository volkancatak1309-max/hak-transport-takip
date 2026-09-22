import type { NextRequest } from "next/server";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { katmanDurumu, katmanKapaliYanit, kapilarKapaliYanit } from "@/lib/mobile-guvenlik";
import { listPendingCountries, listPendingDevices, ACCESS_DEFAULTS } from "@/lib/access-read";
import { ACCESS_GATES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/guvenlik/onaylar — bekleyen CİHAZ + ÜLKE onayları.
 *
 * Panelin "Onaylar" sekmesiyle aynı iki çekirdek (`listPendingDevices`,
 * `listPendingCountries`), aynı tavan (100) ve aynı sıra (en yeni önce).
 *
 * ═══ 🔴 KAPILAR KAPALIYSA BOŞ LİSTE DEĞİL, `kapilar:"kapali"` ═══
 * İki çekirdek `ACCESS_GATES_ENABLED` kapalıyken boş dizi döndürüyor. Bir API
 * için bu yalan: "bekleyen onay yok" ile "onay mekanizması hiç çalışmıyor"
 * aynı şey değil. Birinde beklenir, diğerinde kurulum yapılır.
 *
 * ═══ RED ≠ BEKLET — İKİ KAPI NEDEN BURADA ═══
 * Cihaz ve ülke kapıları oturumu KURAR ama `access_gate` ile işaretler;
 * kullanıcı yalnız `/erisim` ekranını görür (046). Anahtar ve saat kapıları
 * ise oturumu HİÇ kurmaz. Yani bu listede bekleyen biri "giriş yapmış ama
 * içeri alınmamış" kişidir — karar verilene kadar bekliyor.
 *
 * ⚠️ MOBİLDE "BEKLET" HÂLİ YOK: token vermek tüm uçları açmak demek, bu
 * yüzden mobil tarafta her kapı REDDEDER (lib/access-gates.ts). Bu liste yine
 * de mobilden görülebilir — patron kararı telefonundan verebilsin.
 *
 * ═══ SAYFALAMA YOK, BİLİNÇLİ ═══
 * Çekirdek 100 satır tavanıyla çalışıyor ve bekleyen onay sayısı tanım gereği
 * küçük (karar verilince satır listeden düşer). Sayfalama eklemek, panelde
 * olmayan bir tavanı mobilde uydurmak olurdu; gövde `tavan: 100` taşıyor ki
 * istemci kırpılmayı GÖREBİLSİN.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();
  if (!ACCESS_GATES_ENABLED) return kapilarKapaliYanit();

  const [cihaz, ulke] = await Promise.all([listPendingDevices(), listPendingCountries()]);

  return Response.json({
    ok: true,
    ...katmanDurumu(),

    cihaz: cihaz.map((d) => ({
      id: d.id,
      tur: "cihaz" as const,
      soforId: d.worker_id,
      sofor: d.worker_name,
      cihaz: d.device_hash,
      istendi: d.requested_at,
      ilkIp: d.first_ip,
      ilkSehir: d.first_city,
      ilkUlke: d.first_country,
      cihazMetni: d.user_agent,
    })),

    ulke: ulke.map((c) => ({
      id: c.id,
      tur: "ulke" as const,
      soforId: c.worker_id,
      sofor: c.worker_name,
      ulke: c.country,
      istendi: c.requested_at,
    })),

    toplam: { cihaz: cihaz.length, ulke: ulke.length },

    /** Serbest ülkelerin kiracı varsayılanı — "neden onay istendi"nin cevabı. */
    varsayilanUlkeler: ACCESS_DEFAULTS.countries,

    /**
     * Çekirdeğin tavanı. Liste bu sayıya DAYANDIYSA kırpılmış olabilir —
     * sessiz kırpma yasak (PostgREST 1000 satır dersi).
     */
    tavan: 100,
    kirpildi: { cihaz: cihaz.length >= 100, ulke: ulke.length >= 100 },

    /** Karar ucu — istemci yolu gömmesin. */
    kararUcu: "/api/mobile/guvenlik/onaylar/[id]",
  });
}
