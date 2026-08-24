"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import {
  listBakimPlanlari,
  upsertBakimPlani,
  bakimDurumlari,
  bakimYapildi,
  tazeOdometre,
  type BakimPlani,
  type BakimDurumu,
} from "@/lib/bakim-db";
import { createIsEmri } from "@/lib/is-emri-db";
import { audit } from "@/lib/security-log";
import { getTestScope, withoutTestRows } from "@/lib/test-data";

/**
 * PERİYODİK BAKIM — sunucu eylemleri (migration 081).
 *
 * Kapsam `requireFleetView`: şef yalnız kendi filosunun bakım durumunu görür.
 * Filo geneli planlar (vehicle_id NULL) herkeste görünür ama YALNIZ kapsamdaki
 * araçlara açılır — planın kendisi filo geneli, sonucu araç bazlıdır.
 */

export type BakimPanosu = {
  planlar: BakimPlani[];
  durumlar: BakimDurumu[];
  araclar: { id: string; plate: string }[];
  tabloYok: boolean;
};

async function kapsam() {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  return { session, scope };
}

export async function getBakimPanosu(): Promise<BakimPanosu> {
  const { scope } = await kapsam();
  const test = await getTestScope();
  // Test aracı seçicide ÇIKMAZ: ona bakım kuralı kurmak, gerçek olmayan bir
  // araç için gerçek bir servis kaydı üretirdi (bkz. seferler.ts araç seçici).
  const [{ planlar, tabloYok }, durumHam, { data: v }] = await Promise.all([
    listBakimPlanlari(false),
    bakimDurumlari(),
    withoutTestRows(
      supabaseAdmin.from("vehicles").select("id, plate").neq("status", "inactive").order("plate"),
      "id",
      test.vehicleIds
    ),
  ]);
  const araclar = ((v ?? []) as { id: string; plate: string }[]).filter((x) =>
    scope.isFleetVehicle(x.id)
  );
  return {
    planlar: planlar.filter((p) => p.vehicleId === null || scope.isFleetVehicle(p.vehicleId)),
    durumlar: durumHam.durumlar.filter((d) => scope.isFleetVehicle(d.vehicleId)),
    araclar,
    tabloYok: tabloYok || durumHam.tabloYok,
  };
}

export async function bakimPlaniKaydet(p: {
  id?: string;
  vehicleId?: string | null;
  tip: string;
  aralikKm?: number | null;
  aralikAy?: number | null;
  sonBakimKm?: number | null;
  sonBakimAt?: string | null;
  uyariKm?: number;
  uyariGun?: number;
  aktif?: boolean;
}): Promise<{ ok: boolean; hata?: string }> {
  const { session, scope } = await kapsam();
  if (!p.tip.trim()) return { ok: false, hata: "tip_bos" };
  if (p.aralikKm == null && p.aralikAy == null) return { ok: false, hata: "esik_yok" };
  if (p.vehicleId && !scope.isFleetVehicle(p.vehicleId)) return { ok: false, hata: "kapsam_disi" };
  // Filo geneli plan yalnız patronun işidir: şefin açtığı "tüm filo" planı
  // kendi filosunun dışına da uygulanırdı.
  if (!p.vehicleId && scope.restricted) return { ok: false, hata: "filo_geneli_yetki" };

  const r = await upsertBakimPlani(p, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "update", `bakim_plani:${r.veri.id}`);
  revalidatePath("/admin/bakim");
  return { ok: true };
}

/**
 * Bakım yapıldı: servis kaydını yazar ve planın sayacını ileri alır.
 *
 * Bakımı işaretlemek, o plandan doğmuş AÇIK iş emrini de kapatır — aynı işi
 * iki yerde kapatmak zorunda kalmak, ikisinden birinin açık unutulmasının
 * garantisidir.
 */
export async function bakimYapildiIsaretle(g: {
  planId: string;
  vehicleId: string;
  serviceType?: string;
  maliyet?: number | null;
  aciklama?: string | null;
}): Promise<{ ok: boolean; hata?: string }> {
  const { session, scope } = await kapsam();
  if (!scope.isFleetVehicle(g.vehicleId)) return { ok: false, hata: "kapsam_disi" };

  const { data: arac } = await supabaseAdmin
    .from("vehicles")
    .select("plate")
    .eq("id", g.vehicleId)
    .maybeSingle();
  if (!arac) return { ok: false, hata: "arac_yok" };

  /**
   * ODOMETRE SUNUCUDAN. İstemci km göndermiyor ve gönderemez: sayaç bu
   * değerden devam ediyor, elle girilen bir rakam sonraki tüm eşikleri
   * kaydırırdı. Okunamıyorsa null yazılır — plan tarih ekseninden devam eder.
   */
  const odometreKm = await tazeOdometre(g.vehicleId);

  const r = await bakimYapildi(
    { ...g, odometreKm, plaka: (arac as { plate: string }).plate },
    session.worker_id ?? null
  );
  if (!r.ok) return { ok: false, hata: r.sebep };

  // Bu plandan doğmuş açık iş emirlerini kapat.
  await supabaseAdmin
    .from("vehicle_fault_reports")
    .update({
      durum: "kapali",
      closed_at: new Date().toISOString(),
      closed_by: session.worker_id ?? null,
      kapanis_notu: "Periyodik bakım yapıldı.",
    })
    .eq("vehicle_id", g.vehicleId)
    .eq("kaynak", "periyodik")
    .neq("durum", "kapali");

  await audit(session.worker_id ?? null, "create", `bakim:${g.planId}`);
  revalidatePath("/admin/bakim");
  revalidatePath("/admin/is-emirleri");
  return { ok: true };
}

/**
 * Yaklaşan/geçmiş bakımı iş emrine çevirir (kaynak='periyodik').
 *
 * Otomatik DEĞİL, panelden tetiklenir; ayrıca cron ucu (bakim-alerts) aynı
 * fonksiyonu kullanır. Aynı araç+plan için AÇIK emir varsa ikincisi
 * yazılmaz — 057'nin "aynı durum ikinci kez YAZMAZ" kuralı.
 */
export async function bakimIsEmrineCevir(
  planId: string,
  vehicleId: string
): Promise<{ ok: boolean; id?: string; hata?: string; zatenVar?: boolean }> {
  const { session, scope } = await kapsam();
  if (!scope.isFleetVehicle(vehicleId)) return { ok: false, hata: "kapsam_disi" };

  const durum = (await bakimDurumlari()).durumlar.find(
    (d) => d.planId === planId && d.vehicleId === vehicleId
  );
  if (!durum) return { ok: false, hata: "yok" };

  const { data: mevcut } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("kaynak", "periyodik")
    .neq("durum", "kapali")
    .limit(1);
  if ((mevcut ?? []).length > 0) {
    return { ok: true, zatenVar: true, id: String((mevcut as { id: string }[])[0].id) };
  }

  const parca = [
    durum.kalanKm != null ? `${durum.kalanKm} km` : null,
    durum.kalanGun != null ? `${durum.kalanGun} gün` : null,
  ].filter(Boolean);
  const aciklama = durum.gecti
    ? `Periyodik bakım GECİKTİ: ${durum.tip} (${parca.join(" · ") || "eşik aşıldı"})`
    : `Periyodik bakım yaklaşıyor: ${durum.tip} (kalan ${parca.join(" · ")})`;

  const r = await createIsEmri(
    { vehicleId, aciklama, oncelik: durum.gecti ? "yuksek" : "normal", kaynak: "periyodik" },
    session.worker_id!
  );
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "create", `is_emri:${r.veri.id}`, { plan: planId });
  revalidatePath("/admin/is-emirleri");
  return { ok: true, id: r.veri.id };
}
