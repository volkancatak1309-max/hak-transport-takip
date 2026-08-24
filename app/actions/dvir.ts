"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker, requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import { uploadReceipt, signedReceiptUrls } from "@/lib/storage";
import {
  listDvirMaddeleri,
  upsertDvirMadde,
  createDvirForm,
  listDvirByVehicle,
  listDvirByWorker,
  iptalDvirForm,
  type DvirMadde,
  type DvirForm,
  type YanitGirdi,
} from "@/lib/dvir-db";
import { audit } from "@/lib/security-log";

/**
 * ARAÇ KONTROL FORMU (DVIR) — sunucu eylemleri (migration 081).
 *
 * ═══ ŞOFÖR YALNIZ KENDİ ARACINA FORM DOLDURUR ═══
 *
 * Aracın "kendisinin" olması iki yoldan gelir: araç ona ATANMIŞ
 * (`vehicles.assigned_worker_id`) ya da o araçta AÇIK VARDİYASI var. İkincisi
 * şart, çünkü geçici araç kullanımı (6e8cc8b) atamayı değiştirmiyor — yalnız
 * atamaya bakan bir kural, geçici araçla çıkan şoförü kontrol formundan
 * mahrum bırakırdı.
 *
 * ⚠️ Kural SUNUCUDA. Ekran zaten yalnız kendi aracını gösteriyor ama gösterim
 * bir yetki katmanı değildir.
 */

/** Kusur fotoğraflarının özel kovası (081) — ePOD'la aynı desen, ayrı kova. */
const KOVA = "dvir-fotolari";

export type DvirSonucu =
  | { ok: true; formId: string; kusur: number; isEmri: number }
  | {
      ok: false;
      hata: "arac_senin_degil" | "madde_yok" | "kanit_yok" | "tablo_yok" | "hata";
      mesaj?: string;
    };

/** Şoförün form doldurabileceği araçlar: atanmış + açık vardiyadaki. */
async function soforunAraclari(workerId: string): Promise<{ id: string; plate: string }[]> {
  const [{ data: atanan }, { data: vardiya }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate").eq("assigned_worker_id", workerId),
    supabaseAdmin
      .from("time_entries")
      .select("vehicle_id")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .not("vehicle_id", "is", null)
      .limit(5),
  ]);
  const liste = [...((atanan ?? []) as { id: string; plate: string }[])];
  const eksik = ((vardiya ?? []) as { vehicle_id: string }[])
    .map((v) => v.vehicle_id)
    .filter((id) => !liste.some((a) => a.id === id));
  if (eksik.length > 0) {
    const { data: ek } = await supabaseAdmin.from("vehicles").select("id, plate").in("id", eksik);
    liste.push(...((ek ?? []) as { id: string; plate: string }[]));
  }
  return liste;
}

export type DvirBaslangic = {
  araclar: { id: string; plate: string }[];
  maddeler: DvirMadde[];
  tabloYok: boolean;
};

/** Şoför ekranının ihtiyacı: kendi araçları + o kontrolün maddeleri. */
export async function getDvirBaslangic(tur: "once" | "sonra"): Promise<DvirBaslangic> {
  const session = await requireWorker();
  const [araclar, { maddeler, tabloYok }] = await Promise.all([
    soforunAraclari(session.worker_id!),
    listDvirMaddeleri(true, tur),
  ]);
  return { araclar, maddeler, tabloYok };
}

/**
 * Formu doldurur. Fotoğraflar FormData'da; her kusurlu maddenin fotoğrafı
 * `foto_<maddeId>` anahtarıyla gelir.
 *
 * ⚠️ ODOMETRE TELEMETRİDEN. Formda km alanı YOK; sunucu aracın son okumasını
 * alır. Elle girdirmek, "kontrol formu" gibi bir beyanda en kolay çarpıtılacak
 * alanı kullanıcıya bırakmak olurdu.
 */
export async function dvirFormGonder(formData: FormData): Promise<DvirSonucu> {
  const session = await requireWorker();
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const tur = String(formData.get("tur") ?? "once") as "once" | "sonra";

  const araclar = await soforunAraclari(session.worker_id!);
  if (!araclar.some((a) => a.id === vehicleId)) {
    return { ok: false, hata: "arac_senin_degil" };
  }

  let yanitlar: YanitGirdi[];
  try {
    yanitlar = JSON.parse(String(formData.get("yanitlar") ?? "[]")) as YanitGirdi[];
  } catch {
    return { ok: false, hata: "madde_yok" };
  }
  if (yanitlar.length === 0) return { ok: false, hata: "madde_yok" };

  // Kusurlu maddelerin fotoğrafları — her biri ayrı dosya alanında.
  for (const y of yanitlar) {
    if (y.durum !== "kusurlu") continue;
    const dosya = formData.get(`foto_${y.maddeId}`) as File | null;
    if (!dosya || dosya.size === 0) return { ok: false, hata: "kanit_yok", mesaj: y.maddeId };
    const up = await uploadReceipt(KOVA, session.worker_id!, dosya);
    if (!up.ok) return { ok: false, hata: "hata", mesaj: up.error };
    y.fotoYolu = up.path;
  }

  // ODOMETRE: aracın son telemetri okuması (72 saatten taze).
  const { data: odo } = await supabaseAdmin
    .from("device_telemetry")
    .select("odometer_km")
    .eq("vehicle_id", vehicleId)
    .not("odometer_km", "is", null)
    .gte("recorded_at", new Date(Date.now() - 72 * 3600_000).toISOString())
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sayi = (v: FormDataEntryValue | null) => {
    if (v === null) return null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  };

  const r = await createDvirForm({
    vehicleId,
    workerId: session.worker_id!,
    seferId: (formData.get("seferId") as string) || null,
    tur,
    odometreKm: odo ? Number((odo as { odometer_km: number }).odometer_km) : null,
    latitude: sayi(formData.get("lat")),
    longitude: sayi(formData.get("lng")),
    dogrulukM: sayi(formData.get("accuracy")),
    yanitlar,
  });
  if (!r.ok) return { ok: false, hata: r.sebep === "cakisma" ? "hata" : r.sebep, mesaj: r.mesaj };

  await audit(session.worker_id ?? null, "create", `dvir:${r.veri.formId}`);
  revalidatePath("/panel/kontrol");
  return { ok: true, formId: r.veri.formId, kusur: r.veri.kusur, isEmri: r.veri.isEmri };
}

// ── OKUMA ─────────────────────────────────────────────────────────────────

export type DvirGorunum = Omit<DvirForm, "yanitlar"> & {
  plaka: string;
  soforAd: string;
  yanitlar: (DvirForm["yanitlar"][number] & { fotoUrl: string | null })[];
};

async function zenginlestir(formlar: DvirForm[]): Promise<DvirGorunum[]> {
  if (formlar.length === 0) return [];
  const aracIds = [...new Set(formlar.map((f) => f.vehicleId))];
  const kisiIds = [...new Set(formlar.map((f) => f.workerId))];
  const yollar = formlar.flatMap((f) =>
    f.yanitlar.map((y) => y.fotoYolu).filter(Boolean)
  ) as string[];

  const [{ data: v }, { data: w }, urlMap] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate").in("id", aracIds),
    supabaseAdmin.from("workers").select("id, name").in("id", kisiIds),
    yollar.length ? signedReceiptUrls(KOVA, yollar) : Promise.resolve(new Map<string, string>()),
  ]);
  const plaka = new Map(((v ?? []) as { id: string; plate: string }[]).map((x) => [x.id, x.plate]));
  const ad = new Map(((w ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));

  return formlar.map((f) => ({
    ...f,
    plaka: plaka.get(f.vehicleId) ?? "—",
    soforAd: ad.get(f.workerId) ?? "—",
    yanitlar: f.yanitlar.map((y) => ({
      ...y,
      fotoUrl: y.fotoYolu ? (urlMap.get(y.fotoYolu) ?? null) : null,
    })),
  }));
}

/** Şoförün kendi formları — başkasınınki BU YOLDAN DA gelmez. */
export async function getSoforDvirGecmisi(): Promise<{ formlar: DvirGorunum[]; tabloYok: boolean }> {
  const session = await requireWorker();
  const { formlar, tabloYok } = await listDvirByWorker(session.worker_id!, 10);
  return { formlar: await zenginlestir(formlar), tabloYok };
}

/** Yönetici/şef: bir aracın kontrol geçmişi (kapsam denetimiyle). */
export async function getAracDvirGecmisi(
  vehicleId: string
): Promise<{ formlar: DvirGorunum[]; tabloYok: boolean }> {
  const { fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  if (!scope.isFleetVehicle(vehicleId)) return { formlar: [], tabloYok: false };
  const { formlar, tabloYok } = await listDvirByVehicle(vehicleId, 20);
  return { formlar: await zenginlestir(formlar), tabloYok };
}

// ── MADDE SÖZLÜĞÜ (yönetici) ──────────────────────────────────────────────

export async function getDvirMaddeleri(): Promise<{ maddeler: DvirMadde[]; tabloYok: boolean }> {
  await requireFleetView();
  return listDvirMaddeleri(false);
}

export async function dvirMaddeKaydet(m: {
  id?: string;
  kod: string;
  etiket: string;
  aciklama?: string | null;
  tur: DvirMadde["tur"];
  aracTipi?: string | null;
  sira: number;
  aktif: boolean;
}): Promise<{ ok: boolean; hata?: string }> {
  const { session } = await requireFleetView();
  if (!m.kod.trim() || !m.etiket.trim()) return { ok: false, hata: "eksik_alan" };
  const r = await upsertDvirMadde(m, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.sebep };
  revalidatePath("/admin/ayarlar");
  return { ok: true };
}

export async function dvirFormIptal(
  formId: string,
  sebep: string
): Promise<{ ok: boolean; hata?: string }> {
  const { session } = await requireFleetView();
  const r = await iptalDvirForm(formId, sebep, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "update", `dvir_iptal:${formId}`);
  revalidatePath("/admin/araclar");
  return { ok: true };
}
