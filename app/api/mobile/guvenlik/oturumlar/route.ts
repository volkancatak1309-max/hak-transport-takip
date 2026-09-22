import type { NextRequest } from "next/server";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  katmanDurumu,
  katmanKapaliYanit,
  sayfaBilgisi,
  sayfaCoz,
} from "@/lib/mobile-guvenlik";
import { sessionSayfasi } from "@/lib/security-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/mobile/guvenlik/oturumlar?sayfa=&limit=&sofor=&acik=
 *
 * `login_sessions` — kim, ne zaman, hangi cihaz, hangi şehir/ülke, açık mı.
 * Panelin "Oturumlar" sekmesiyle AYNI çeviriciyi kullanıyor (`sessionSayfasi`;
 * `listSessions` artık onun sayfasız sarmalayıcısı).
 *
 * ═══ 🔴 AÇIK ≠ CANLI ═══
 * `ended_at is null` bir satırın AÇIK olduğunu söyler, CANLI olduğunu değil:
 * çıkış yapmadan tarayıcı kapatılınca satır sonsuza kadar açık kalır. Bu ayrım
 * yapılmazsa çoklu-oturum işareti ilk girişten sonraki her girişte yanar ve
 * şüpheli listesi gürültüye döner. `live` ayrı bir alan (son 30 dk'da iz) ve
 * `?acik=` süzgeci ona DEĞİL `ended_at`e bakar — ikisini tek süzgeçte
 * birleştirmek eşiği ikinci kez tanımlamak olurdu.
 *
 * ═══ TEST HESABI BU LİSTEDEN ELENMEZ ═══
 * Panelin kararı (lib/security-read.ts): bu ekranın işi "kim girdi"yi eksiksiz
 * göstermek. Test hesabı gizlenseydi o hesapla yapılmış bir giriş adsız
 * görünürdü — yani ele geçirilmiş bir test hesabı tam da izlenmesi gereken
 * yerde görünmez olurdu.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 *   400 invalid (alan: sayfa | limit | offset | sofor | acik)
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();

  const url = new URL(req.url);
  const s = sayfaCoz(url);
  if (!s.ok) return mobileError(400, "invalid", { alan: s.alan, sebep: s.sebep });

  const soforHam = url.searchParams.get("sofor");
  if (soforHam !== null && !UUID.test(soforHam)) {
    return mobileError(400, "invalid", { alan: "sofor", bicim: "uuid", gelen: soforHam });
  }

  const acikHam = url.searchParams.get("acik");
  let acikMi: boolean | undefined;
  if (acikHam !== null) {
    if (acikHam !== "1" && acikHam !== "0") {
      return mobileError(400, "invalid", { alan: "acik", gecerli: ["1", "0"], gelen: acikHam });
    }
    acikMi = acikHam === "1";
  }

  const { satirlar, toplam } = await sessionSayfasi({
    limit: s.limit,
    offset: s.offset,
    workerId: soforHam,
    acikMi,
  });

  return Response.json({
    ok: true,
    ...katmanDurumu(),
    satirlar: satirlar.map((r) => ({
      id: r.id,
      soforId: r.worker_id,
      sofor: r.worker_name,
      basladi: r.started_at,
      sonIz: r.last_seen_at,
      bitti: r.ended_at,
      bitisSebebi: r.ended_reason,
      /** `ended_at is null` — bkz. başlık §AÇIK ≠ CANLI. */
      acik: r.ended_at === null,
      /** Son 30 dakikada iz bıraktı mı. Açık olup canlı OLMAYAN satır normaldir. */
      canli: r.live,
      kaynak: r.source,
      ip: r.ip,
      cihaz: r.device_hash,
      cihazMetni: r.user_agent,
      sehir: r.city,
      ulke: r.country,
      yeniCihaz: r.new_device,
      esZamanli: r.concurrent,
    })),
    page: sayfaBilgisi(s, toplam),
    /** İstemci eşiği gömmesin: "canlı" penceresi sunucu kararı. */
    sinirlar: { canliPencereDk: 30 },
  });
}
