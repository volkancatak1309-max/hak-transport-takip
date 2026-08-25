"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import {
  listIsEmirleri,
  getIsEmri,
  createIsEmri,
  updateIsEmri,
  deleteIsEmri,
  type IsEmri,
  type IsEmriDurum,
  type IsEmriOncelik,
} from "@/lib/is-emri-db";
import { audit } from "@/lib/security-log";
import { getTestScope, withoutTestRows } from "@/lib/test-data";

/**
 * İŞ EMRİ — sunucu eylemleri (migration 081).
 *
 * KAPSAM: `requireFleetView` — patron her aracı, filo şefi yalnız kendi
 * filosunu görür ve kapatır. Kapsam denetimi HER eylemde tekrar yapılır;
 * listeyi filtrelemiş olmak, tek bir emri kimliğiyle kapatmayı engellemez.
 */

export type IsEmriListe = {
  emirler: IsEmri[];
  tabloYok: boolean;
  /** Atama kutusu için: kapsamdaki çalışanlar. */
  personel: { id: string; ad: string }[];
};

async function kapsam() {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  return { session, scope };
}

export async function getIsEmirleri(yalnizAcik = true): Promise<IsEmriListe> {
  const { scope } = await kapsam();
  const test = await getTestScope();
  /**
   * ⚠️ ATAMA seçici test hesabını ELER, ama EMİR LİSTESİ elemez — bilerek.
   * Test aracında açılmış bir emir yöneticinin listesinde GÖRÜNMELİ: kontrol
   * formu → iş emri zincirinin uçtan uca çalıştığı ancak orada doğrulanabilir.
   * Elenmesi gereken şey gerçek bir işin test hesabına ATANMASI.
   */
  const [{ emirler, tabloYok }, { data: w }] = await Promise.all([
    listIsEmirleri({ vehicleIds: scope.restricted ? scope.vehicleIds : null, yalnizAcik }),
    withoutTestRows(
      supabaseAdmin.from("workers").select("id, name").eq("is_active", true).order("name"),
      "id",
      test.workerIds
    ),
  ]);
  const personel = ((w ?? []) as { id: string; name: string }[])
    .filter((x) => (scope.restricted ? scope.isFleetWorker(x.id) : true))
    .map((x) => ({ id: x.id, ad: x.name }));
  return { emirler, tabloYok, personel };
}

export async function isEmriAc(g: {
  vehicleId: string;
  aciklama: string;
  oncelik?: IsEmriOncelik;
  atananId?: string | null;
}): Promise<{ ok: boolean; id?: string; hata?: string }> {
  const { session, scope } = await kapsam();
  if (!scope.isFleetVehicle(g.vehicleId)) return { ok: false, hata: "kapsam_disi" };
  if (!g.aciklama.trim()) return { ok: false, hata: "aciklama_bos" };
  const r = await createIsEmri({ ...g, kaynak: "elle" }, session.worker_id!);
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "create", `is_emri:${r.veri.id}`);
  revalidatePath("/admin/is-emirleri");
  return { ok: true, id: r.veri.id };
}

/**
 * Emri günceller. Kapsam denetimi emrin KENDİ aracından okunur — istemcinin
 * gönderdiği araç kimliğine değil, kayıttaki değere bakılır.
 */
export async function isEmriGuncelle(
  id: string,
  yama: {
    durum?: IsEmriDurum;
    oncelik?: IsEmriOncelik;
    atananId?: string | null;
    maliyet?: number | null;
    servisAt?: string | null;
    kapanisNotu?: string | null;
  }
): Promise<{ ok: boolean; hata?: string }> {
  const { session, scope } = await kapsam();
  const emir = await getIsEmri(id);
  if (!emir) return { ok: false, hata: "yok" };
  if (!scope.isFleetVehicle(emir.vehicleId)) return { ok: false, hata: "kapsam_disi" };

  const r = await updateIsEmri(id, yama, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "update", `is_emri:${id}`, {
    durum: yama.durum ?? null,
  });
  revalidatePath("/admin/is-emirleri");
  revalidatePath("/admin/araclar");
  return { ok: true };
}

/**
 * İŞ EMRİNİ SİLER — yalnız ELLE açılmış ve henüz kapanmamış olanı.
 *
 * Kontrol formundan/DTC'den/bakımdan doğan emirler silinmez: onlar bir kanıt
 * ya da ölçüm zincirinin halkası (bkz. lib/is-emri-db.ts). O emirlerde geri
 * alınabilir yol DURUM DEĞİŞTİRMEDİR — kapatılan emir yeniden açılabilir.
 */
export async function isEmriSil(id: string): Promise<{ ok: boolean; hata?: string }> {
  const { session, scope } = await kapsam();
  const emir = await getIsEmri(id);
  if (!emir) return { ok: false, hata: "yok" };
  if (!scope.isFleetVehicle(emir.vehicleId)) return { ok: false, hata: "kapsam_disi" };

  const r = await deleteIsEmri(id);
  if (!r.ok) return { ok: false, hata: r.sebep === "silinemez" ? `silinemez_${r.mesaj}` : r.sebep };
  await audit(session.worker_id ?? null, "delete", `is_emri:${id}`);
  revalidatePath("/admin/is-emirleri");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Açık bir DTC kodunu iş emrine çevirir.
 *
 * ⚠️ Şema düzeyinde FK YOK (bkz. 081 başlığı, 3. ölçüm): DTC bir BELİRTİ,
 * iş emri bir KARARDIR. 1008 kaydın hepsini otomatik emre çevirmek, kimsenin
 * kapatmadığı bir kuyruk üretirdi. Dönüşüm yöneticinin elidir.
 */
export async function dtcIsEmrineCevir(
  dtcId: string,
  oncelik: IsEmriOncelik = "yuksek"
): Promise<{ ok: boolean; id?: string; hata?: string }> {
  const { session, scope } = await kapsam();
  const { data, error } = await supabaseAdmin
    .from("vehicle_dtc")
    .select("id, vehicle_id, code, description")
    .eq("id", dtcId)
    .maybeSingle();
  if (error || !data) return { ok: false, hata: "yok" };

  const d = data as { vehicle_id: string; code: string; description: string | null };
  if (!scope.isFleetVehicle(d.vehicle_id)) return { ok: false, hata: "kapsam_disi" };

  const r = await createIsEmri(
    {
      vehicleId: d.vehicle_id,
      aciklama: `DTC ${d.code}${d.description ? `: ${d.description}` : ""}`,
      oncelik,
      kaynak: "dtc",
    },
    session.worker_id!
  );
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "create", `is_emri:${r.veri.id}`, { dtc: dtcId });
  revalidatePath("/admin/is-emirleri");
  return { ok: true, id: r.veri.id };
}
