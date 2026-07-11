import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * shift_packages → time_entries.cargo_count senkronu (Şoför Paneli v2, İş 2).
 *
 * Her "+1 PAKET" dokunuşu shift_packages'a GPS'li bir satır yazar; teslim
 * sayısı da mevcut rapor/export'ların okuduğu time_entries.cargo_count'ta
 * tutulur. Drift olmasın diye artırma yerine her değişimde yeniden SAYARIZ —
 * eşzamanlı dokunuşlarda bile sonuç deterministiktir.
 */
export async function recountShiftPackages(timeEntryId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("shift_packages")
    .select("id", { count: "exact", head: true })
    .eq("time_entry_id", timeEntryId);
  if (error) throw new Error(error.message);

  const n = count ?? 0;
  const { error: upErr } = await supabaseAdmin
    .from("time_entries")
    .update({ cargo_count: n })
    .eq("id", timeEntryId);
  if (upErr) throw new Error(upErr.message);
  return n;
}
