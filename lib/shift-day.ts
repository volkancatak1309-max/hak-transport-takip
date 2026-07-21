import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna } from "@/lib/format";

/**
 * GÜNDE TEK VARDİYA kuralı (Volkan, 21.07.2026).
 *
 * Bir şoför Viyana takvim gününde EN FAZLA BİR vardiya açabilir. Vardiya
 * kapandıktan sonra aynı gün yenisi açılmaz — ne panelden, ne kontaktan.
 * Kaynak sorun: kontak açılıp kapandıkça otomatik vardiya üretiliyor, gün
 * içinde 5-10 satırlık çöp birikiyordu (canlı ölçüm: kapanmış onaysız
 * vardiyaların yarısı 25 dakikadan kısaydı).
 *
 * Kural `started_at`'a bakar, `ended_at`'a değil:
 *  • Bugün açılmış AÇIK vardiya   → zaten "aktif vardiya" guard'ı engeller.
 *  • Bugün açılmış KAPALI vardiya → bu modülün engellediği durum.
 *  • Dün açılıp bugün kapanan gece vardiyası → BUGÜN vardiya açılmamış sayılır,
 *    şoför bugünkü vardiyasını açabilir. Bilinçli: gece vardiyası tek bir iş
 *    günüdür, ertesi günün hakkını yakmamalı.
 *
 * DB tarafında karşılığı YOK — bilinçli: Postgres'te `AT TIME ZONE 'Europe/
 * Vienna'` STABLE'dır (IMMUTABLE değil), yani "şoför + Viyana günü" üzerine
 * partial unique index KURULAMAZ. Tekillik bu yüzden uygulama katmanında,
 * vardiya açan ÜÇ yolun hepsinde ayrı ayrı korunur (manuel panel, otomatik
 * kontak, çevrimdışı kuyruk replay'i).
 */

/** Bu şoför bugün (Viyana günü) vardiya açmış mı? Açık/kapalı fark etmez. */
export async function hasShiftToday(workerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", workerId)
    .gte("started_at", startOfTodayVienna().toISOString())
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Bugün vardiya açmış TÜM şoförlerin kümesi — tek sorguda. Otomatik vardiya
 * motoru araç döngüsünde şoför başına sorgu atmasın diye toplu okunur.
 */
export async function workersWithShiftToday(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("worker_id")
    .gte("started_at", startOfTodayVienna().toISOString());
  const out = new Set<string>();
  for (const r of (data ?? []) as { worker_id: string | null }[]) {
    if (r.worker_id) out.add(r.worker_id);
  }
  return out;
}
