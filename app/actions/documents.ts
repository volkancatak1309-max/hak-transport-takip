"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import {
  upsertDocumentType,
  deleteDocumentType,
  upsertWorkerDocument,
  deleteWorkerDocument,
} from "@/lib/documents-db";
import { auditChange } from "@/lib/audit-change";

/**
 * ŞOFÖR BELGE TAKİBİ — yazma yolları (migration 078).
 *
 * ═══ NEDEN requireAdmin, requireFleetView DEĞİL ═══
 *
 * BELGE TÜRÜ kiracının sözlüğüdür: bir türü kapatmak TÜM filoların uyarılarını
 * susturur, filo şefinin kapsamı ise tek filo. Kapsamı olan bir kullanıcıya
 * kapsamı olmayan bir kaldıraç vermek yetki tasarımında en sık yapılan hata
 * (maliyet oranlarında da aynı gerekçeyle requireAdmin seçilmişti).
 *
 * ⚠️ KİŞİ BELGESİ de şimdilik requireAdmin: şefin kendi filosundaki şoförün
 * belgesini girmesi makul bir istek ama kapsam denetimi (bu şoför gerçekten
 * benim filomda mı) burada YOK. Kapsamsız bir yazma yolunu şefe açmak, karşı
 * filonun personeline kayıt eklemesine izin vermek olurdu. Şef yolu, kapsam
 * denetimiyle birlikte ayrı bir turda açılır.
 */

export type DocActionResult = {
  ok: boolean;
  sebep?: "tablo_yok" | "cakisma" | "gecersiz" | "hata";
  alan?: string;
  mesaj?: string;
};

/** Boş/uzun/geçersiz metni ayıklar. */
function metin(v: FormDataEntryValue | null, max: number): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return s.length <= max ? s : null;
}

/** ISO gün (YYYY-MM-DD) doğrulaması — `<input type="date">` bunu üretir. */
function tarih(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Takvimde var mı: "2026-02-30" biçime uyar ama tarih değildir.
  const t = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

export async function saveDocumentTypeAction(
  formData: FormData
): Promise<DocActionResult> {
  const session = await requireAdmin();

  const code = metin(formData.get("code"), 40);
  const label = metin(formData.get("label"), 80);
  if (!code) return { ok: false, sebep: "gecersiz", alan: "code" };
  if (!label) return { ok: false, sebep: "gecersiz", alan: "label" };
  // Kod bir makine adı: boşluk ve özel karakter, i18n/kod eşleşmelerinde
  // sessiz tuzak olur. Harf/rakam/alt tire/tire yeterli.
  if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
    return { ok: false, sebep: "gecersiz", alan: "code" };
  }

  const warnRaw = Number(String(formData.get("warn_days") ?? "").trim());
  // 078'deki CHECK ile AYNI bant. İkisi de var: burası kullanıcıya sebep
  // söyleyebilir, oradaki son hat.
  const warnDays =
    Number.isFinite(warnRaw) && warnRaw >= 1 && warnRaw <= 365 ? Math.round(warnRaw) : null;
  if (warnDays === null) return { ok: false, sebep: "gecersiz", alan: "warn_days" };

  const sortRaw = Number(String(formData.get("sort_order") ?? "100").trim());
  const sortOrder = Number.isFinite(sortRaw) ? Math.round(sortRaw) : 100;

  const idRaw = metin(formData.get("id"), 64);
  const sonuc = await upsertDocumentType(
    {
      id: idRaw ?? undefined,
      code,
      label,
      warnDays,
      requiresNumber: formData.get("requires_number") === "on",
      active: formData.get("active") !== "off",
      sortOrder,
    },
    session.worker_id ?? null
  );
  if (!sonuc.ok) return { ok: false, sebep: sonuc.sebep, mesaj: sonuc.mesaj };

  await auditChange(
    session.worker_id ?? null,
    idRaw ? "update" : "create",
    "document_type",
    sonuc.id ?? idRaw ?? null,
    null,
    { code, label, warn_days: warnDays }
  );
  revalidatePath("/admin/ayarlar");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * BELGE TÜRÜNÜ SİLER. Kullanılıyorsa silmez — çağıran ekran pasifleştirmeyi
 * önerir (bkz. lib/silme-sonucu.ts). "Ekle varsa sil de var" kuralı.
 */
export async function deleteDocumentTypeAction(
  id: string
): Promise<{ ok: boolean; sebep?: string }> {
  const session = await requireAdmin();
  if (!id.trim()) return { ok: false, sebep: "gecersiz" };
  const r = await deleteDocumentType(id);
  if (!r.ok) return { ok: false, sebep: r.sebep };
  await auditChange(session.worker_id ?? null, "delete", "document_type", id, null, null);
  revalidatePath("/admin/ayarlar");
  revalidatePath("/admin");
  return { ok: true };
}

export async function saveWorkerDocumentAction(
  formData: FormData
): Promise<DocActionResult> {
  const session = await requireAdmin();

  const workerId = metin(formData.get("worker_id"), 64);
  const typeId = metin(formData.get("type_id"), 64);
  const expiresAt = tarih(formData.get("expires_at"));
  if (!workerId) return { ok: false, sebep: "gecersiz", alan: "worker_id" };
  if (!typeId) return { ok: false, sebep: "gecersiz", alan: "type_id" };
  // ⚠️ Tarih ZORUNLU — bu kaydın varlık sebebi süre takibi. Tarihsiz bir
  // satır hiçbir uyarı üretmez ve "belge var" yanılsaması yaratır (078).
  if (!expiresAt) return { ok: false, sebep: "gecersiz", alan: "expires_at" };

  const sonuc = await upsertWorkerDocument(
    {
      workerId,
      typeId,
      expiresAt,
      documentNo: metin(formData.get("document_no"), 80),
      note: metin(formData.get("note"), 500),
    },
    session.worker_id ?? null
  );
  if (!sonuc.ok) return { ok: false, sebep: sonuc.sebep, mesaj: sonuc.mesaj };

  await auditChange(
    session.worker_id ?? null,
    "update",
    "worker_document",
    sonuc.id ?? null,
    null,
    { worker_id: workerId, type_id: typeId, expires_at: expiresAt }
  );
  // Belge kaydı Dikkat panosunu doğrudan besliyor: iki yüzey de tazelenmeli.
  revalidatePath(`/admin/workers/${workerId}`);
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteWorkerDocumentAction(
  formData: FormData
): Promise<DocActionResult> {
  const session = await requireAdmin();
  const id = metin(formData.get("id"), 64);
  const workerId = metin(formData.get("worker_id"), 64);
  if (!id) return { ok: false, sebep: "gecersiz", alan: "id" };

  const sonuc = await deleteWorkerDocument(id);
  if (!sonuc.ok) return { ok: false, sebep: sonuc.sebep, mesaj: sonuc.mesaj };

  await auditChange(session.worker_id ?? null, "delete", "worker_document", id, null, null);
  if (workerId) revalidatePath(`/admin/workers/${workerId}`);
  revalidatePath("/admin");
  return { ok: true };
}
