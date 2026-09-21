import type { NextRequest } from "next/server";
import { requireMobileAdmin, requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  getIsEmri,
  updateIsEmri,
  deleteIsEmri,
  IS_EMRI_DURUMLARI,
  IS_EMRI_ONCELIKLERI,
  type IsEmriDurum,
  type IsEmriOncelik,
} from "@/lib/is-emri-db";
import { isEmriSatiri } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEK İŞ EMRİ — güncelleme ve silme (Faz C-1).
 *
 * Kural gövdesi `lib/is-emri-db.ts`te; panel eylemleri (`app/actions/is-emri.ts`)
 * aynı fonksiyonları çağırıyor. Burada yalnız HTTP sözleşmesi var.
 */

/** `undefined` = alan gönderilmedi (dokunma) · `null` = temizle. */
function sayiAyikla(v: unknown): { ok: true; deger: number | null } | { ok: false } {
  if (v === null || v === "") return { ok: true, deger: null };
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, deger: n };
}

/**
 * PATCH /api/mobile/is-emirleri/[id]
 *
 * Gövde alanları: `durum` · `oncelik` · `atananId` · `maliyet` · `servisAt` ·
 * `kapanisNotu`. Hepsi isteğe bağlı, gönderilmeyen alan DEĞİŞMEZ.
 *
 * ── AÇIKLAMA DEĞİŞTİRİLEMEZ (400) ─────────────────────────────────────────
 * Kusurun ne olduğu, bildirildiği andaki hâliyle kalır: DVIR yolunda o metin
 * kontrol formundaki KANITTAN doğuyor ve onu sonradan yeniden yazmak kanıtı
 * yeniden yazmak olurdu (aynı gerekçe lib/is-emri-db.ts updateIsEmri başlığında).
 * Sessizce yok saymak yerine 400: istemci yazdığının kaydedildiğini sanmasın.
 *
 * ── KAPATIRKEN NOT ZORUNLU (400) ──────────────────────────────────────────
 * "Kapandı" tek başına bir bilgi değil; ne yapıldığı kapanış notunda. Kural
 * çekirdekte, sıkılığı burada AÇIK gönderiliyor.
 * ⚠️ PANEL BUGÜN NOTSUZ KAPATABİLİYOR ve bu tur onu DEĞİŞTİRMEDİ — canlı
 * müşteride çalışan bir akışı istenmemiş bir sıkılaştırmayla kırmamak için.
 *
 * ── KAPALI EMİR YENİDEN AÇILABİLİR (409 DEĞİL, 200) ───────────────────────
 * ÖLÇÜLDÜ (21.09.2026): hem panel (`app/actions/is-emri.ts` isEmriSil başlığı)
 * hem CANLI U7 ucu (`/api/mobile/fault-reports/[id]`) yeniden açmaya izin
 * veriyor ve bu bilinçli bir karar: dvir/dtc/periyodik emirler SİLİNEMEZ, o
 * yüzden yanlış kapatmanın tek geri dönüşü yeniden açmaktır. Burada 409
 * döndürmek, aynı tabloya bakan üç yüzeyin aynı soruya iki farklı cevap
 * vermesi olurdu (Volkan kararı, 21.09.2026).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { worker, isChief, fleetScope } = guard.actor;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null) {
    return mobileError(400, "invalid", { alan: "body" });
  }
  const g = body as Record<string, unknown>;

  if (g.aciklama !== undefined) {
    return mobileError(400, "immutable_field", {
      alan: "aciklama",
      sebep: "kusur_metni_bildirildigi_gibi_kalir",
    });
  }

  const emir = await getIsEmri(id);
  if (!emir) return mobileError(404, "not_found");
  // Kapsam EMRİN KENDİ aracından okunur, istemcinin gönderdiğinden değil.
  if (isChief && !fleetScope.isFleetVehicle(emir.vehicleId)) {
    return mobileError(403, "kapsam_disi");
  }

  const yama: {
    durum?: IsEmriDurum;
    oncelik?: IsEmriOncelik;
    atananId?: string | null;
    maliyet?: number | null;
    servisAt?: string | null;
    kapanisNotu?: string | null;
  } = {};

  if (g.durum !== undefined) {
    if (!IS_EMRI_DURUMLARI.includes(g.durum as IsEmriDurum)) {
      return mobileError(400, "invalid", { alan: "durum", gecerli: IS_EMRI_DURUMLARI });
    }
    yama.durum = g.durum as IsEmriDurum;
  }
  if (g.oncelik !== undefined) {
    if (!IS_EMRI_ONCELIKLERI.includes(g.oncelik as IsEmriOncelik)) {
      return mobileError(400, "invalid", { alan: "oncelik", gecerli: IS_EMRI_ONCELIKLERI });
    }
    yama.oncelik = g.oncelik as IsEmriOncelik;
  }
  if (g.atananId !== undefined) {
    if (g.atananId !== null && typeof g.atananId !== "string") {
      return mobileError(400, "invalid", { alan: "atananId" });
    }
    yama.atananId = (g.atananId as string | null) || null;
  }
  if (g.maliyet !== undefined) {
    const m = sayiAyikla(g.maliyet);
    if (!m.ok) return mobileError(400, "invalid", { alan: "maliyet", sebep: "negatif_ya_da_sayi_degil" });
    yama.maliyet = m.deger;
  }
  if (g.servisAt !== undefined) {
    if (g.servisAt !== null && typeof g.servisAt !== "string") {
      return mobileError(400, "invalid", { alan: "servisAt" });
    }
    yama.servisAt = (g.servisAt as string | null) || null;
  }
  if (g.kapanisNotu !== undefined) {
    if (g.kapanisNotu !== null && typeof g.kapanisNotu !== "string") {
      return mobileError(400, "invalid", { alan: "kapanisNotu" });
    }
    yama.kapanisNotu = (g.kapanisNotu as string | null) || null;
  }

  if (Object.keys(yama).length === 0) {
    return mobileError(400, "missing_fields", {
      gecerli: ["durum", "oncelik", "atananId", "maliyet", "servisAt", "kapanisNotu"],
    });
  }

  const r = await updateIsEmri(id, yama, worker.id, {
    kapanisNotuZorunlu: true,
    mevcut: emir,
  });
  if (!r.ok) {
    if (r.sebep === "kapanis_notu_gerekli") {
      return mobileError(400, "missing_fields", {
        alan: "kapanisNotu",
        sebep: "kapatirken_zorunlu",
      });
    }
    return mobileError(503, "db_error", {
      sebep: r.sebep === "tablo_yok" ? "tablo_yok" : "yazma_hatasi",
    });
  }

  const guncel = await getIsEmri(id);
  return Response.json({ ok: true, emir: guncel ? isEmriSatiri(guncel) : null });
}

/**
 * DELETE /api/mobile/is-emirleri/[id] — YALNIZ elle açılmış ve AÇIK emri siler.
 *
 * Kapı `requireMobileAdmin`: şef kapatabilir ama SİLEMEZ. Silme geri alınamaz
 * ve kuyruğun kendisini değiştirir; kapatma bir operasyon kararıdır, silme bir
 * kayıt kararı (aynı ayrım docs/SEFER-KARLILIK.md'de gelir tarafı için yazılı).
 *
 * 409 iki hâlde: kaynak `elle` değil (kanıt/ölçüm zincirinin halkası) ya da emir
 * KAPANMIŞ (maliyet ve servis tarihi taşıyor). İkisinin de geri alınabilir yolu
 * SİLME değil DURUM DEĞİŞTİRMEDİR.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const emir = await getIsEmri(id);
  if (!emir) return mobileError(404, "not_found");

  const r = await deleteIsEmri(id);
  if (!r.ok) {
    if (r.sebep === "yok") return mobileError(404, "not_found");
    if (r.sebep === "silinemez") {
      return mobileError(409, "silinemez", {
        sebep: r.mesaj === "kapali" ? "emir_kapali" : "kaynak_elle_degil",
        kaynak: emir.kaynak,
        durum: emir.durum,
      });
    }
    if (r.sebep === "kullanimda") return mobileError(409, "kullanimda");
    return mobileError(503, "db_error", {
      sebep: r.sebep === "tablo_yok" ? "tablo_yok" : "silme_hatasi",
    });
  }
  return Response.json({ ok: true, silindi: id });
}
