import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfDayViennaFromYmd } from "@/lib/format";
import {
  getSeferById,
  patchSefer,
  iptalSefer,
  acikSeferVarMi,
  seferGovdesi,
  type SeferYama,
} from "@/lib/sefer-db";
import { govdeOku } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/mobile/sefer/[id] — düzenleme + İPTAL. YALNIZ yönetici.
 *
 * ── İKİ İŞ, TEK UÇ ────────────────────────────────────────────────────────
 * Gövdede `iptal: true` varsa sefer iptal edilir; yoksa alanlar güncellenir.
 * İkisi AYNI istekte gelemez: iptal edilen bir seferin notunu aynı anda
 * değiştirmek, hangi işlemin niyet edildiğini belirsiz bırakırdı → 400.
 *
 * ── DURUM BURADAN İLERLEMEZ ───────────────────────────────────────────────
 * `durum` alanı bu uçta KABUL EDİLMEZ. Çizgiyi yalnız ATANAN ŞOFÖR ilerletir
 * (`/sefer/[id]/durum`); yönetici için tek durum eylemi İPTAL'dir. Yönetici de
 * ilerletebilseydi "şoför kabul etti" damgası şoförün eylemi olmaktan çıkardı.
 *
 * ── İPTAL YALNIZ AÇIK SEFERDE ─────────────────────────────────────────────
 * `tamamlandi` ya da zaten `iptal` bir seferi iptal etmek, bitmiş bir işin
 * kaydını geriye dönük değiştirmek olurdu → 409 `kapali_sefer`.
 *
 * ── ŞOFÖR DEĞİŞTİRİLİRSE İŞ KURALI 1 YENİDEN SINANIR ──────────────────────
 * Yeni şoförün o gün açık seferi varsa 409 `acik_sefer_var`. Aksi hâlde
 * düzenleme, POST'un kapattığı kapıdan içeri girmenin yolu olurdu.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const govde = await govdeOku(req);
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  if ("durum" in govde) {
    return mobileError(400, "durum_bu_uctan_degismez", {
      aciklama: "Durum çizgisini yalnız atanan şoför ilerletir: POST /sefer/[id]/durum",
      iptalIcin: 'PATCH gövdesinde {"iptal": true}',
    });
  }

  const mevcut = await getSeferById(id);
  if (!mevcut) return mobileError(404, "not_found");

  // ── İPTAL yolu
  const iptalIstendi = govde.iptal === true;
  const alanVar = ["tarih", "soforId", "aracId", "bolgeId", "paketHedef", "notlar"].some(
    (k) => k in govde
  );
  if (iptalIstendi && alanVar) {
    return mobileError(400, "iptal_ile_duzenleme_birlikte_olmaz");
  }
  if (iptalIstendi) {
    const r = await iptalSefer(id);
    if (!r) return mobileError(404, "not_found");
    if (!r.ok) {
      return mobileError(409, r.kod, { mevcutDurum: r.mevcut, sonrakiDurum: r.sonraki });
    }
    return Response.json({ ok: true, sefer: seferGovdesi(r.satir) });
  }

  // ── DÜZENLEME yolu
  const yama: SeferYama = {};

  if ("tarih" in govde) {
    const t = typeof govde.tarih === "string" ? govde.tarih : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !startOfDayViennaFromYmd(t)) {
      return mobileError(400, "invalid_field", { alan: "tarih", bicim: "YYYY-MM-DD" });
    }
    yama.tarih = t;
  }

  if ("soforId" in govde) {
    const w = typeof govde.soforId === "string" ? govde.soforId : "";
    if (!w) return mobileError(400, "invalid_field", { alan: "soforId", sebep: "bos" });
    const { data: kisi } = await supabaseAdmin
      .from("workers").select("id, is_active").eq("id", w).maybeSingle();
    if (!kisi) return mobileError(404, "worker_not_found", { alan: "soforId" });
    if (kisi.is_active !== true) return mobileError(409, "worker_pasif", { alan: "soforId" });
    yama.worker_id = w;
  }

  if ("aracId" in govde) {
    yama.vehicle_id = typeof govde.aracId === "string" && govde.aracId ? govde.aracId : null;
  }
  if ("bolgeId" in govde) {
    yama.zone_id = typeof govde.bolgeId === "string" && govde.bolgeId ? govde.bolgeId : null;
  }
  if ("paketHedef" in govde) {
    const v = govde.paketHedef;
    if (v === null) yama.paket_hedef = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return mobileError(400, "invalid_field", { alan: "paketHedef", sebep: "negatif_olmayan_tamsayi" });
      }
      yama.paket_hedef = n;
    }
  }
  if ("notlar" in govde) {
    yama.notlar =
      govde.notlar === null ? null : typeof govde.notlar === "string" ? govde.notlar.trim().slice(0, 500) : null;
  }

  if (Object.keys(yama).length === 0) {
    return mobileError(400, "empty_patch", {
      alanlar: ["tarih", "soforId", "aracId", "bolgeId", "paketHedef", "notlar", "iptal"],
    });
  }

  // İŞ KURALI 1 yeniden: şoför ya da tarih değiştiyse hedef gün/kişi için
  // BAŞKA bir açık sefer olmamalı (kendisi hariç).
  const yeniSofor = yama.worker_id ?? mevcut.worker_id;
  const yeniTarih = yama.tarih ?? mevcut.tarih;
  if (yeniSofor !== mevcut.worker_id || yeniTarih !== mevcut.tarih) {
    const acik = await acikSeferVarMi(yeniSofor, yeniTarih);
    if (acik && acik.id !== id) {
      return mobileError(409, "acik_sefer_var", {
        mevcutSeferId: acik.id,
        mevcutDurum: acik.durum,
        tarih: yeniTarih,
      });
    }
  }

  try {
    const satir = await patchSefer(id, yama);
    if (!satir) return mobileError(404, "not_found");
    return Response.json({ ok: true, sefer: seferGovdesi(satir) });
  } catch (e) {
    const m = String((e as Error).message);
    if (m.includes(":23503:")) {
      return mobileError(400, "invalid_field", { alan: "aracId|bolgeId|soforId", sebep: "bulunamadi" });
    }
    return mobileError(503, "db_error", { sebep: m.slice(0, 120) });
  }
}
