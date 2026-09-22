import type { NextRequest } from "next/server";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  katmanDurumu,
  katmanKapaliYanit,
  sayfaBilgisi,
  sayfaCoz,
} from "@/lib/mobile-guvenlik";
import { auditSayfasi } from "@/lib/security-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/mobile/guvenlik/denetim?sayfa=&limit=&islem=&sofor=
 *
 * `audit_log` — kim, ne zaman, hangi eylem, hangi hedef, hangi IP + ALAN ALAN
 * değişiklik. Panelin "Eylemler" sekmesiyle AYNI çeviriciyi kullanıyor
 * (`auditSayfasi`; `listAudit` artık onun sayfasız sarmalayıcısı).
 *
 * ═══ 🔴 YALNIZ `audit_log` — PANELDEKİ BEŞ TABLO DEĞİL, VE BU SÖYLENİYOR ═══
 *
 * Panelin `listActionTimeline`i beş tabloyu birleştiriyor (audit_log +
 * worker_admin_log + shift_edit_log + leave_edit_log + login_unlock_log) ama
 * SAYFALANAMAZ: her tablodan kendi payını çekip bellekte sıralıyor, yani
 * "3. sayfa" diye tutarlı bir kavram yok — ikinci sayfada bir tablo tükenip
 * diğeri devam ederse satırlar kayar.
 *
 * Bu uç tek tabloyu sayfalıyor ve gövdede `birlesikDegil: true` +
 * `disaridaKalanKaynaklar` ile bunu SÖYLÜYOR. Sessizce eksik göstermek, izin
 * TAMAMI sanılmasına yol açardı ve bir denetim ekranında en pahalı hata bu
 * olurdu.
 *
 * ═══ `meta` HAM İNMEZ ═══
 * `pin_hash` gibi alanlar adıyla maskeli, değerler 60 karaktere kırpılı ve
 * eski→yeni ALAN ALAN veriliyor (`degisim`). Maskeleme `lib/security-read.ts`
 * `metaDegisim` içinde — burada ikinci bir kopyası yok.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 *   400 invalid (alan: sayfa | limit | offset | islem | sofor)
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();

  const url = new URL(req.url);
  const s = sayfaCoz(url);
  if (!s.ok) return mobileError(400, "invalid", { alan: s.alan, sebep: s.sebep });

  const islemHam = url.searchParams.get("islem");
  if (islemHam !== null && !/^[a-z_]{1,40}$/.test(islemHam)) {
    /**
     * `audit_log.action` ŞEMADA SERBEST METİN (045'te CHECK yok) ve bilerek
     * öyle: yeni bir eylem adı eklemek migration istemesin. Burada bir BEYAZ
     * LİSTE tutmuyoruz — tutsaydık kodda var olan ama listede olmayan bir
     * eylem süzülemezdi. Yalnız BİÇİM denetleniyor.
     */
    return mobileError(400, "invalid", {
      alan: "islem",
      bicim: "kucuk_harf_ve_alt_tire",
      gelen: islemHam,
    });
  }

  const soforHam = url.searchParams.get("sofor");
  if (soforHam !== null && !UUID.test(soforHam)) {
    return mobileError(400, "invalid", { alan: "sofor", bicim: "uuid", gelen: soforHam });
  }

  const { satirlar, toplam } = await auditSayfasi({
    limit: s.limit,
    offset: s.offset,
    islem: islemHam,
    workerId: soforHam,
  });

  return Response.json({
    ok: true,
    ...katmanDurumu(),
    satirlar: satirlar.map((r) => ({
      id: r.id,
      an: r.at,
      soforId: r.worker_id,
      sofor: r.worker_name,
      islem: r.action,
      hedef: r.target,
      ip: r.ip,
      /** Alan alan eski→yeni; maskeleme ve kırpma sunucuda yapıldı. */
      degisim: r.degisim,
      kaynak: r.kaynak,
    })),
    page: sayfaBilgisi(s, toplam),

    /** 🔴 Bu liste izin TAMAMI DEĞİL — başlık §. */
    birlesikDegil: true,
    disaridaKalanKaynaklar: [
      "worker_admin_log",
      "shift_edit_log",
      "leave_edit_log",
      "login_unlock_log",
    ],
    aciklama:
      "Yalnız audit_log sayfalanıyor. Panelin birleşik zaman çizgisi beş tabloyu " +
      "bellekte harmanlıyor ve tutarlı sayfalanamıyor; eksik kısım burada adıyla yazılı.",
  });
}
