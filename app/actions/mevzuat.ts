"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireFleetView } from "@/lib/session";
import { audit } from "@/lib/security-log";
import {
  mevzuatAyariYaz,
  mevzuatPanosu,
  uyariGecmisi,
  type MevzuatPanosu,
  type UyariKaydi,
} from "@/lib/mevzuat-db";
import type { KademeAyari, KuralSeti } from "@/lib/mevzuat";

/**
 * MEVZUAT ERKEN UYARI — sunucu eylemleri (migration 086).
 *
 * ═══ İKİ KAPI ═══
 *   OKUMA → `requireFleetView` (yönetici + filo şefi). Şef sahadaki ekibin
 *           yasal durumunu görmeli; sevkiyatı o planlıyor.
 *   AYAR  → `requireAdmin`. Kural setini değiştirmek, filonun tabi olduğu
 *           HUKUKU değiştirir; şefe açık değil.
 */

export type MevzuatGorunum = MevzuatPanosu & {
  gecmis: UyariKaydi[];
  gecmisTabloYok: boolean;
  /** Şoför adları — geçmiş satırlarını okunur kılmak için. */
  adlar: Record<string, string>;
};

export async function getMevzuatPanosu(): Promise<MevzuatGorunum> {
  const { session } = await requireFleetView();
  await audit(session.worker_id ?? null, "page_view", "/admin/mevzuat");

  const [pano, gecmisSonuc] = await Promise.all([mevzuatPanosu(), uyariGecmisi(7)]);

  const adlar: Record<string, string> = {};
  for (const s of pano.satirlar) adlar[s.workerId] = s.ad;

  // Geçmişte artık sahada olmayan şoförlerin adı panodan gelmez.
  const eksik = [...new Set(gecmisSonuc.satirlar.map((g) => g.workerId))].filter((id) => !adlar[id]);
  if (eksik.length > 0) {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data } = await supabaseAdmin.from("workers").select("id, name").in("id", eksik);
    for (const w of (data ?? []) as { id: string; name: string }[]) adlar[w.id] = w.name;
  }

  return {
    ...pano,
    gecmis: gecmisSonuc.satirlar,
    gecmisTabloYok: gecmisSonuc.tabloYok,
    adlar,
  };
}

export type AyarSonuc = { ok: true } | { ok: false; hata: string };

export async function mevzuatAyarKaydet(girdi: {
  kuralSeti: KuralSeti;
  surusTahmini: boolean;
  kademe: KademeAyari;
}): Promise<AyarSonuc> {
  const session = await requireAdmin();

  const r = await mevzuatAyariYaz(girdi, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.hata ?? "hata" };

  await audit(
    session.worker_id ?? null,
    "update",
    `mevzuat_ayari:${girdi.kuralSeti}:${girdi.surusTahmini ? "surus" : "calisma"}`
  );
  revalidatePath("/admin/mevzuat");
  return { ok: true };
}
