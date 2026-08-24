"use server";

import { revalidatePath } from "next/cache";
import { requireWorker, requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import { getSeferById, ACIK_DURUMLAR } from "@/lib/sefer-db";
import { uploadReceipt, signedReceiptUrls } from "@/lib/storage";
import {
  createTeslimat,
  addTeslimatFoto,
  listTeslimatBySefer,
  getTeslimat,
  iptalTeslimat,
  TESLIMAT_KOVASI,
  type Teslimat,
} from "@/lib/teslimat-db";
import { audit } from "@/lib/security-log";

/**
 * TESLİMAT KANITI (ePOD) — sunucu eylemleri (migration 080).
 *
 * ═══ İKİ YÜZEY, İKİ KAPI ═══
 *
 * ŞOFÖR (`requireWorker`) kanıt BIRAKIR ve yalnız KENDİ seferine bırakabilir.
 * YÖNETİCİ/ŞEF (`requireFleetView`) kanıt OKUR ve gerekirse GEÇERSİZ İLAN
 * EDER; kanıt yazamaz — teslimatı yapan kişi kanıtı da bırakan kişidir, aksi
 * hâlde delilin kaynağı bulanıklaşır.
 *
 * ═══ FOTOĞRAFLAR TEK TEK YÜKLENİR ═══
 *
 * Önce kanıt kaydı açılır, sonra her fotoğraf AYRI istekte ona bağlanır.
 * Sebebi ölçülebilir: Next sunucu eylemi gövdesini varsayılan olarak ~1 MB'de
 * kesiyor (lib/image-resize.ts notu) ve ePOD birden fazla fotoğraf kabul
 * ediyor. Üç fotoğrafı tek gövdeye koymak o sınırı aşardı; sınırı global
 * olarak yükseltmek ise HER sunucu eylemini etkileyen bir karar olurdu.
 */

export type KanitSonuc =
  | { ok: true; id: string }
  | {
      ok: false;
      hata: "sefer_yok" | "sefer_senin_degil" | "sefer_kapali" | "kanit_yok" | "durak_dolu" | "tablo_yok" | "hata";
      mesaj?: string;
    };

function sayi(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * ŞOFÖR: seferine kanıt bırakır.
 *
 * ⚠️ SEFERİN SAHİBİ DENETLENİYOR. Yol parametresi değil, veritabanındaki
 * `worker_id` konuşuyor: başka birinin seferine kanıt bırakmak, o teslimatı
 * yapmış gibi görünmektir.
 *
 * ⚠️ KAPANMIŞ SEFERE KANIT YOK. Tamamlanmış/iptal edilmiş bir sefere sonradan
 * kanıt eklemek, olayın kendisinden sonra delil üretmektir.
 */
export async function teslimatKanitiBirak(formData: FormData): Promise<KanitSonuc> {
  const session = await requireWorker();
  const seferId = String(formData.get("seferId") ?? "");
  if (!seferId) return { ok: false, hata: "sefer_yok" };

  const sefer = await getSeferById(seferId);
  if (!sefer) return { ok: false, hata: "sefer_yok" };
  if (sefer.worker_id !== session.worker_id) return { ok: false, hata: "sefer_senin_degil" };
  if (!ACIK_DURUMLAR.includes(sefer.durum)) return { ok: false, hata: "sefer_kapali" };

  const fotoSayisi = Number(formData.get("fotoSayisi") ?? 0);

  const r = await createTeslimat(
    {
      seferId,
      workerId: session.worker_id!,
      durakNo: 1,
      zoneId: sefer.zone_id,
      aliciAd: (formData.get("aliciAd") as string) ?? null,
      notlar: (formData.get("notlar") as string) ?? null,
      imzaSvg: (formData.get("imzaSvg") as string) ?? null,
      latitude: sayi(formData.get("lat")),
      longitude: sayi(formData.get("lng")),
      dogrulukM: sayi(formData.get("accuracy")),
    },
    fotoSayisi > 0
  );
  if (!r.ok) return { ok: false, hata: r.sebep, mesaj: r.mesaj };

  await audit(session.worker_id ?? null, "create", `teslimat:${r.id}`);
  revalidatePath("/panel/seferler");
  return { ok: true, id: r.id };
}

/** ŞOFÖR: kanıta bir fotoğraf ekler (her fotoğraf ayrı istek). */
export async function teslimatFotoEkle(formData: FormData): Promise<KanitSonuc> {
  const session = await requireWorker();
  const teslimatId = String(formData.get("teslimatId") ?? "");
  const kanit = teslimatId ? await getTeslimat(teslimatId) : null;
  if (!kanit) return { ok: false, hata: "sefer_yok" };
  // Kanıtı bırakan kişi DEĞİLSE fotoğraf ekleyemez.
  if (kanit.workerId !== session.worker_id) return { ok: false, hata: "sefer_senin_degil" };

  const file = formData.get("foto") as File | null;
  if (!file || file.size === 0) return { ok: false, hata: "kanit_yok", mesaj: "no_file" };

  const up = await uploadReceipt(TESLIMAT_KOVASI, session.worker_id!, file);
  if (!up.ok) return { ok: false, hata: "hata", mesaj: up.error };

  const r = await addTeslimatFoto(teslimatId, up.path, {
    latitude: sayi(formData.get("lat")),
    longitude: sayi(formData.get("lng")),
    dogrulukM: sayi(formData.get("accuracy")),
  });
  if (!r.ok) return { ok: false, hata: r.sebep, mesaj: r.mesaj };

  revalidatePath("/panel/seferler");
  return { ok: true, id: r.id };
}

// ── OKUMA ─────────────────────────────────────────────────────────────────

export type KanitGorunum = Omit<Teslimat, "fotograflar"> & {
  fotograflar: (Teslimat["fotograflar"][number] & { url: string | null })[];
};

/**
 * Fotoğraf yolları KISA ÖMÜRLÜ imzalı URL'e çevrilir.
 *
 * Kova özel; kalıcı bir adres vermek, linki eline geçiren herkese süresiz
 * erişim vermek olurdu. Toplu imzalama tek istekte (lib/storage.ts).
 */
async function imzali(teslimatlar: Teslimat[]): Promise<KanitGorunum[]> {
  const yollar = teslimatlar.flatMap((t) => t.fotograflar.map((f) => f.storagePath));
  const harita = yollar.length ? await signedReceiptUrls(TESLIMAT_KOVASI, yollar) : new Map();
  return teslimatlar.map((t) => ({
    ...t,
    fotograflar: t.fotograflar.map((f) => ({ ...f, url: harita.get(f.storagePath) ?? null })),
  }));
}

/** ŞOFÖR: kendi seferinin kanıtları. */
export async function getSoforTeslimatlari(
  seferId: string
): Promise<{ kanitlar: KanitGorunum[]; tabloYok: boolean }> {
  const session = await requireWorker();
  const sefer = await getSeferById(seferId);
  if (!sefer || sefer.worker_id !== session.worker_id) {
    return { kanitlar: [], tabloYok: false };
  }
  const { teslimatlar, tabloYok } = await listTeslimatBySefer(seferId);
  return { kanitlar: await imzali(teslimatlar), tabloYok };
}

/** YÖNETİCİ/ŞEF: seferin kanıtları (kapsam denetimiyle). */
export async function getSeferTeslimatlari(
  seferId: string
): Promise<{ kanitlar: KanitGorunum[]; tabloYok: boolean }> {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  const sefer = await getSeferById(seferId);
  if (!sefer || !scope.isFleetWorker(sefer.worker_id)) {
    return { kanitlar: [], tabloYok: false };
  }
  const { teslimatlar, tabloYok } = await listTeslimatBySefer(seferId);
  await audit(session.worker_id ?? null, "page_view", `teslimat:sefer:${seferId}`);
  return { kanitlar: await imzali(teslimatlar), tabloYok };
}

/**
 * YÖNETİCİ/ŞEF: kanıtı geçersiz ilan eder.
 *
 * Silme YOK — ne burada ne veri katmanında. Yanlış bir kanıt, olmamış bir
 * kanıttan farklıdır: ilki sebebiyle birlikte kayıtta kalır.
 */
export async function teslimatIptalEt(
  teslimatId: string,
  sebep: string
): Promise<{ ok: boolean; hata?: string }> {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  const kanit = await getTeslimat(teslimatId);
  if (!kanit) return { ok: false, hata: "yok" };
  const sefer = await getSeferById(kanit.seferId);
  if (!sefer || !scope.isFleetWorker(sefer.worker_id)) return { ok: false, hata: "kapsam_disi" };

  const r = await iptalTeslimat(teslimatId, sebep, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "update", `teslimat_iptal:${teslimatId}`);
  revalidatePath("/admin/seferler");
  return { ok: true };
}
