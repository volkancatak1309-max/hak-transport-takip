import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * VARDİYA DÜZENLEME İZİ (22.07.2026).
 *
 * Neden gerekli: AZG raporu (`app/actions/azg-report.ts`) yalnız üç alandan
 * beslenir — `started_at`, `ended_at`, `break_minutes` — ve ÜÇÜ DE yöneticinin
 * serbestçe değiştirebildiği alanlardır. Bugüne kadar `time_entries` yalnız
 * "en son kim, ne zaman" (updated_at/updated_by) tutuyordu; eski değer hiçbir
 * yerde saklanmıyordu ve bu bilgi hiçbir ekranda gösterilmiyordu. Yani bir
 * denetimde "bu çalışma saati neden değişti?" sorusu cevapsız kalırdı.
 *
 * Tasarım kararı: düzenlemeyi YASAKLAMIYORUZ — gerçek hatalar düzeltilebilmeli.
 * Yaptığımız şey düzeltmeyi görünür ve geri izlenebilir kılmak.
 *
 * Tablo yoksa (SQL henüz çalıştırılmadıysa) her şey eskisi gibi çalışır:
 * yazma sessizce düşer, okuma boş döner. Projedeki diğer migration-öncesi
 * dayanıklılık desenleriyle aynı.
 */

/** İzlenen alanlar — yalnız anlamı olanlar; updated_at gibi teknik alanlar hariç. */
const TRACKED = [
  "started_at",
  "ended_at",
  "start_km",
  "end_km",
  "plate",
  "notes",
  "break_minutes",
  "start_package_count",
  "undelivered_count",
  "cargo_count",
] as const;

export type ShiftEditLogRow = {
  id: string;
  time_entry_id: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_name?: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  /** 087 — düzeltmenin SEBEBİ. 087 öncesi satırlarda null. */
  reason?: string | null;
  /** 087 — tek düzeltmenin alan satırlarını bağlar. */
  edit_group?: string | null;
  /** 087 — 'duzeltme' | 'kapatma' | 'km'. Eski satırlarda null. */
  kaynak?: string | null;
};

/** Düzeltmeyi yazan yol — denetimde "hangi işlemle" sorusunun cevabı. */
export type EditKaynak = "duzeltme" | "kapatma" | "km";

export type EditIz = {
  /** ZORUNLU (087). Sunucu eylemi sebepsiz düzeltmeyi reddeder. */
  reason: string;
  kaynak: EditKaynak;
};

function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Değişen HER alan için bir satır yazar. Best-effort: log yazılamazsa
 * düzenlemenin kendisi geri alınmaz (kayıt düzeltmek izden önce gelir).
 */
export async function logShiftEdit(
  timeEntryId: string,
  changedBy: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  /**
   * 087 — SEBEP + KAYNAK. Geriye dönük uyumluluk için opsiyonel: 087 öncesi
   * çağıranlar (ve migration uygulanmamış kurulumlar) eskisi gibi çalışır.
   * Yeni yollarda sunucu eylemi sebebi ZORUNLU kılar; buraya sebepsiz
   * gelinmesi artık kod hatası olur, veri kaybı değil.
   */
  iz?: EditIz
): Promise<void> {
  if (!before) return;
  const rows: Record<string, unknown>[] = [];
  const changedAt = new Date().toISOString();
  /**
   * Grup kimliği ÇAĞRI BAŞINA bir kez üretilir: bir düzeltmenin üç alanı
   * aynı gruba, aynı sebebe bağlanır. `changed_at` ile gruplamak yanlıştı —
   * aynı saniyeye düşen iki ayrı düzeltme birbirine karışırdı.
   */
  const grup = iz ? crypto.randomUUID() : null;

  for (const field of TRACKED) {
    if (!(field in after)) continue;
    const oldV = norm(before[field]);
    const newV = norm(after[field]);
    if (oldV === newV) continue;
    // Zaman alanlarında saniye/ms farkı gerçek değişiklik sayılmasın.
    if (
      (field === "started_at" || field === "ended_at") &&
      oldV &&
      newV &&
      Math.abs(new Date(oldV).getTime() - new Date(newV).getTime()) < 1000
    ) {
      continue;
    }
    rows.push({
      time_entry_id: timeEntryId,
      changed_at: changedAt,
      changed_by: changedBy,
      field,
      old_value: oldV,
      new_value: newV,
      ...(iz ? { reason: iz.reason, edit_group: grup, kaynak: iz.kaynak } : {}),
    });
  }
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from("shift_edit_log").insert(rows);
  if (!error) return;

  /**
   * 087 UYGULANMAMIŞ KURULUMDA GERİ DÜŞ.
   *
   * `reason/edit_group/kaynak` kolonları yoksa PostgREST PGRST204 döner.
   * Bu durumda izin TAMAMI kaybolmamalı: sebepsiz de olsa eski biçimde
   * yazılır. Sessizce hiç yazmamak, denetim kaydını 087 gecikmesine kurban
   * etmek olurdu.
   */
  const kolonYok = error.code === "PGRST204" || /column .* does not exist/i.test(error.message ?? "");
  if (!kolonYok) return;
  /**
   * 087 kolonlarını AT — `delete` ile, yıkımla değil: yıkım kullanılmayan
   * değişken üretiyor ve ESLint tabanını üç uyarı yükseltiyordu.
   */
  const sade = rows.map((r) => {
    const kalan = { ...r };
    delete kalan.reason;
    delete kalan.edit_group;
    delete kalan.kaynak;
    return kalan;
  });
  await supabaseAdmin.from("shift_edit_log").insert(sade);
}

/** Bir vardiyanın düzenleme geçmişi (yeni → eski). Tablo yoksa boş dizi. */
export async function listShiftEdits(timeEntryId: string): Promise<ShiftEditLogRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("shift_edit_log")
      .select("id, time_entry_id, changed_at, changed_by, field, old_value, new_value, reason, edit_group, kaynak")
      .eq("time_entry_id", timeEntryId)
      .order("changed_at", { ascending: false })
      .limit(50);
    /**
     * 087 UYGULANMAMIŞSA KOLONSUZ TEKRAR DENE — geçmiş yine görünsün.
     */
    let satirlar = data as ShiftEditLogRow[] | null;
    if (error) {
      const { data: eski } = await supabaseAdmin
        .from("shift_edit_log")
        .select("id, time_entry_id, changed_at, changed_by, field, old_value, new_value")
        .eq("time_entry_id", timeEntryId)
        .order("changed_at", { ascending: false })
        .limit(50);
      satirlar = (eski as ShiftEditLogRow[] | null) ?? null;
    }
    if (!satirlar) return [];
    const rows = satirlar;

    const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
    if (ids.length === 0) return rows;
    const { data: workers } = await supabaseAdmin
      .from("workers")
      .select("id, name")
      .in("id", ids);
    const names = new Map(
      ((workers ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name])
    );
    return rows.map((r) => ({
      ...r,
      changed_by_name: r.changed_by ? names.get(r.changed_by) ?? null : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Verilen vardiyalardan hangileri elle düzeltilmiş? Liste rozeti ve AZG
 * dipnotu bunu kullanır. Tablo yoksa boş küme.
 */
export async function listEditedEntryIds(entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  try {
    const out = new Set<string>();
    // URL uzunluğu taşmasın diye parçalayarak sorgulanır.
    const CHUNK = 200;
    for (let i = 0; i < entryIds.length; i += CHUNK) {
      const slice = entryIds.slice(i, i + CHUNK);
      const { data, error } = await supabaseAdmin
        .from("shift_edit_log")
        .select("time_entry_id")
        .in("time_entry_id", slice);
      if (error || !data) continue;
      for (const r of data as { time_entry_id: string }[]) out.add(r.time_entry_id);
    }
    return out;
  } catch {
    return new Set();
  }
}
