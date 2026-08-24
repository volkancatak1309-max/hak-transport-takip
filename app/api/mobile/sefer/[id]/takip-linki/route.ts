import { NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import {
  createTakipLink,
  listTakipLinks,
  revokeTakipLink,
} from "@/lib/takip-db";
import { TAKIP_LINK_TTL_MIN } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SEFERİN MÜŞTERİ TAKİP LİNKLERİ — yönetici yüzeyi (migration 079).
 *
 *   GET    /api/mobile/sefer/[id]/takip-linki            — seferin linkleri
 *   POST   /api/mobile/sefer/[id]/takip-linki            — yeni link üret
 *   DELETE /api/mobile/sefer/[id]/takip-linki?link=<id>  — linki iptal et
 *
 * ── NEDEN MOBİLDE DE VAR ──────────────────────────────────────────────────
 * Bu uç yazıldığında (24.08.2026 öğleden önce) `/admin/seferler` sayfası SEFER
 * ekranı DEĞİLDİ: eski `assignments` (görev) ekranını render ediyordu ve sefer
 * sisteminin panelde hiçbir yüzeyi yoktu. Link üretimi bu yüzden seferin
 * gerçekten yönetildiği tek yere, mobil uca konuldu.
 *
 * ⚠️ AYNI GÜN PANEL EKRANI DA GELDİ (`app/actions/seferler.ts`). İki yüzey
 * ARTIK BİRLİKTE yaşıyor ve bu bilinçli: yönetici sahadayken telefondan,
 * masasındayken panelden link üretebilmeli. İkisi de `lib/takip-db.ts`
 * çağırıyor — kural tek yerde, yalnız kapı farklı (jeton ↔ çerez).
 *
 * ── KAPI: YALNIZ YÖNETİCİ ─────────────────────────────────────────────────
 * `requireMobileAdmin`. Şoför kendi seferinin linkini üretemez: link müşteriyle
 * kurulan bir ilişkidir ve kimin neyi paylaştığı yönetimin kararıdır. Filo
 * şefi de üretemez (sefer oluşturma da yalnız yöneticide — 066 kararı).
 *
 * ── TAM URL SUNUCUDA KURULUYOR ────────────────────────────────────────────
 * İstemciye yalnız token verip "başına alan adını ekle" demek, mobil ile web
 * arasında ikinci bir gerçek doğururdu. Tam adres burada kuruluyor; taban
 * `NEXT_PUBLIC_APP_URL`, o da yoksa isteğin kendi kaynağı.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function taban(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

function govde(link: { id: string; token: string; expiresAt: string; revokedAt: string | null; aliciNot: string | null; createdAt: string; hitCount: number }, base: string) {
  return {
    id: link.id,
    url: `${base}/takip/${link.token}`,
    bitis: link.expiresAt,
    iptalEdildi: link.revokedAt !== null,
    iptalAn: link.revokedAt,
    aliciNot: link.aliciNot,
    olusturuldu: link.createdAt,
    acilma: link.hitCount,
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const kapi = await requireMobileAdmin(req);
  if (!kapi.ok) return kapi.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, sebep: "gecersiz_sefer" }, { status: 400 });

  const { linkler, tabloYok } = await listTakipLinks(id);
  if (tabloYok) {
    return NextResponse.json(
      { ok: false, sebep: "tablo_yok", mesaj: "migration 079 çalıştırılmamış" },
      { status: 503 }
    );
  }
  const base = taban(req);
  return NextResponse.json({ ok: true, linkler: linkler.map((l) => govde(l, base)) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const kapi = await requireMobileAdmin(req);
  if (!kapi.ok) return kapi.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, sebep: "gecersiz_sefer" }, { status: 400 });

  let aliciNot: string | null = null;
  try {
    const j = (await req.json()) as { aliciNot?: unknown } | null;
    const ham = typeof j?.aliciNot === "string" ? j.aliciNot.trim() : "";
    aliciNot = ham ? ham.slice(0, 80) : null;
  } catch {
    // Gövdesiz POST geçerli: not opsiyonel.
  }

  const r = await createTakipLink(id, kapi.actor.worker.id, aliciNot);
  if (!r.ok) {
    const durum =
      r.sebep === "tablo_yok" ? 503 : r.sebep === "sefer_yok" ? 404 : r.sebep === "sefer_kapali" ? 409 : 500;
    return NextResponse.json({ ok: false, sebep: r.sebep, mesaj: r.mesaj }, { status: durum });
  }
  return NextResponse.json(
    { ok: true, link: govde(r.veri, taban(req)), ttlDk: TAKIP_LINK_TTL_MIN },
    { status: 201 }
  );
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const kapi = await requireMobileAdmin(req);
  if (!kapi.ok) return kapi.response;
  const { id } = await ctx.params;
  const linkId = new URL(req.url).searchParams.get("link") ?? "";
  if (!UUID.test(id) || !UUID.test(linkId)) {
    return NextResponse.json({ ok: false, sebep: "gecersiz_kimlik" }, { status: 400 });
  }

  /**
   * ⚠️ LİNK GERÇEKTEN BU SEFERİN Mİ — iptal etmeden önce doğrulanıyor.
   * Kapı yalnız yöneticiye açık olsa bile, yol parametresiyle gövdenin
   * uyuşmasını denetlemek "yanlış seferin linkini iptal ettim" hatasını
   * imkânsız kılar.
   */
  const { linkler, tabloYok } = await listTakipLinks(id);
  if (tabloYok) {
    return NextResponse.json({ ok: false, sebep: "tablo_yok" }, { status: 503 });
  }
  if (!linkler.some((l) => l.id === linkId)) {
    return NextResponse.json({ ok: false, sebep: "link_bu_sefere_ait_degil" }, { status: 404 });
  }

  const r = await revokeTakipLink(linkId, kapi.actor.worker.id);
  if (!r.ok) {
    return NextResponse.json({ ok: false, sebep: r.sebep, mesaj: r.mesaj }, { status: r.sebep === "tablo_yok" ? 503 : 500 });
  }
  // `etkilenen: 0` = zaten iptalliydi. Hata DEĞİL: sonuç istenen durumdur.
  return NextResponse.json({ ok: true, zatenIptalliydi: r.veri.etkilenen === 0 });
}
