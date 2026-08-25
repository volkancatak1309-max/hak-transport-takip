import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { getSeferById, ACIK_DURUMLAR } from "@/lib/sefer-db";
import {
  getDurak,
  patchDurak,
  deleteDurak,
  durumSifirla,
  durakGovdesi,
} from "@/lib/sefer-duraklari";
import { govdeOku } from "../../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH  /api/mobile/sefer/[id]/duraklar/[durakId] — düzenle / durumu sıfırla
 * DELETE                                          — durağı sil
 *
 * İkisi de YALNIZ yönetici. Şoförün durak üzerindeki tek yetkisi durumu
 * İLERLETMEK (`.../durum`); planı yeniden yazmak yönetimin işi.
 *
 * ── PATCH İKİ İŞ, TEK UÇ ──────────────────────────────────────────────────
 * Gövdede `durumSifirla: true` varsa durum `bekliyor`a alınır ve damgalar
 * TEMİZLENİR; yoksa plan alanları güncellenir. İkisi AYNI istekte gelemez:
 * hangi işlemin niyet edildiği belirsiz kalırdı → 400. (`PATCH /sefer/[id]`
 * içindeki iptal/düzenleme ayrımının aynı deseni.)
 *
 * ── NEDEN DURUM SIFIRLAMA VAR ─────────────────────────────────────────────
 * Şoför yanlış durağa "tamamlandı" basabilir ve durak çizgisi İLERİ yönlüdür.
 * Düzeltme yolu olmayan bir kayıt kullanıcıyı kendi hatasına kilitler. Şoför
 * ileri gider, yönetici düzeltir; iz `audit`te değil ama damgalar temizlendiği
 * için yanlış bir "vardı 14:20" ortada kalmaz.
 *
 * ── SİLME KANITI ÖLDÜRMEZ ─────────────────────────────────────────────────
 * Durağa bırakılmış teslimat kanıtı SİLİNMEZ; bağı boşalır
 * (`teslimatlar.durak_id on delete set null`). Delil plan satırından uzun yaşar.
 */

type Yol = { params: Promise<{ id: string; durakId: string }> };

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

function sayiVeyaNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Durak GERÇEKTEN bu seferin mi — yol/gövde uyuşmazlığı imkânsız olsun.
 * Başka bir seferin durağını bu yolun altından düzenlemek, kapsam denetimini
 * yanlış sefer üzerinden geçirmek olurdu.
 */
async function durakVeSefer(id: string, durakId: string) {
  const durak = await getDurak(durakId);
  if (!durak || durak.sefer_id !== id) return null;
  const sefer = await getSeferById(id);
  if (!sefer) return null;
  return { durak, sefer };
}

export async function PATCH(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id, durakId } = await params;

  const bulunan = await durakVeSefer(id, durakId);
  if (!bulunan) return mobileError(404, "not_found");
  if (!ACIK_DURUMLAR.includes(bulunan.sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: bulunan.sefer.durum });
  }

  const govde = await govdeOku(req);
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  if ("durum" in govde) {
    return mobileError(400, "durum_bu_uctan_degismez", {
      aciklama: "Durak çizgisini atanan şoför ilerletir: POST /duraklar/[durakId]/durum",
      sifirlamakIcin: '{"durumSifirla": true}',
    });
  }

  const sifirla = govde.durumSifirla === true;
  const alanlar = ["ad", "bolgeId", "adres", "lat", "lng", "yaricapM", "pencereBas", "pencereBit", "tahminiSureDk", "notlar"];
  const alanVar = alanlar.some((k) => k in govde);
  if (sifirla && alanVar) return mobileError(400, "sifirlama_ile_duzenleme_birlikte_olmaz");

  if (sifirla) {
    const r = await durumSifirla(durakId);
    if (!r.ok) {
      if (r.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "082" });
      return mobileError(404, "not_found");
    }
    return Response.json({ ok: true, durak: durakGovdesi(r.durak) });
  }

  if (!alanVar) return mobileError(400, "empty_patch", { alanlar: [...alanlar, "durumSifirla"] });

  // KISMİ YAMA: verilmeyen alan MEVCUT değerini korur. `patchDurak` tam satır
  // yazdığı için birleştirme burada yapılıyor.
  const d = bulunan.durak;
  const ad = "ad" in govde ? String(govde.ad ?? "").trim() : d.ad;
  if (!ad) return mobileError(400, "invalid_field", { alan: "ad" });

  const bolgeId = "bolgeId" in govde
    ? (typeof govde.bolgeId === "string" && govde.bolgeId ? govde.bolgeId : null)
    : d.zone_id;
  const lat = "lat" in govde ? sayiVeyaNull(govde.lat) : d.latitude;
  const lng = "lng" in govde ? sayiVeyaNull(govde.lng) : d.longitude;
  if ((lat === null) !== (lng === null)) return mobileError(400, "invalid_field", { alan: "lat|lng" });

  const yaricap = "yaricapM" in govde ? sayiVeyaNull(govde.yaricapM) : d.yaricap_m;
  if (yaricap !== null && (yaricap < 50 || yaricap > 5000)) {
    return mobileError(400, "invalid_field", { alan: "yaricapM", aralik: "50-5000" });
  }

  const bas = "pencereBas" in govde
    ? (typeof govde.pencereBas === "string" && govde.pencereBas ? govde.pencereBas : null)
    : d.pencere_bas;
  const bit = "pencereBit" in govde
    ? (typeof govde.pencereBit === "string" && govde.pencereBit ? govde.pencereBit : null)
    : d.pencere_bit;
  if (bas && !SAAT.test(bas.slice(0, 5))) return mobileError(400, "invalid_field", { alan: "pencereBas" });
  if (bit && !SAAT.test(bit.slice(0, 5))) return mobileError(400, "invalid_field", { alan: "pencereBit" });

  const sure = "tahminiSureDk" in govde ? sayiVeyaNull(govde.tahminiSureDk) : d.tahmini_sure_dk;
  if (sure !== null && (!Number.isInteger(sure) || sure < 1 || sure > 1440)) {
    return mobileError(400, "invalid_field", { alan: "tahminiSureDk", aralik: "1-1440" });
  }

  const r = await patchDurak(durakId, {
    ad,
    zoneId: bolgeId,
    adres: "adres" in govde ? (typeof govde.adres === "string" ? govde.adres : null) : d.adres,
    latitude: lat,
    longitude: lng,
    yaricapM: yaricap,
    pencereBas: bas ? bas.slice(0, 5) : null,
    pencereBit: bit ? bit.slice(0, 5) : null,
    tahminiSureDk: sure,
    notlar: "notlar" in govde ? (typeof govde.notlar === "string" ? govde.notlar : null) : d.notlar,
  });
  if (!r.ok) {
    if (r.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "082" });
    return mobileError(400, "invalid_field", { alan: r.mesaj ?? "durak" });
  }
  return Response.json({ ok: true, durak: durakGovdesi(r.durak) });
}

export async function DELETE(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id, durakId } = await params;

  const bulunan = await durakVeSefer(id, durakId);
  if (!bulunan) return mobileError(404, "not_found");
  if (!ACIK_DURUMLAR.includes(bulunan.sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: bulunan.sefer.durum });
  }

  const r = await deleteDurak(durakId);
  if (!r.ok) {
    if (r.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "082" });
    if (r.sebep === "kullanimda") return mobileError(409, "kullanimda");
    if (r.sebep === "yok") return mobileError(404, "not_found");
    return mobileError(503, "db_error", { sebep: r.mesaj?.slice(0, 120) });
  }
  // Silinen durağın ardından sıra 1..N olarak yeniden yazılır (lib katmanı).
  return Response.json({ ok: true, silindi: durakId });
}
