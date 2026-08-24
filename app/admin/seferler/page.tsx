import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getSeferGunu, getSeferSecenekleri } from "@/app/actions/seferler";
import { SeferlerClient } from "./SeferlerClient";

export const dynamic = "force-dynamic";

/**
 * /admin/seferler — GÜNÜN SEFERLERİ.
 *
 * ═══ NE DEĞİŞTİ (24.08.2026) ═══
 *
 * Bu sayfa `assignments` (006) tablosunu okuyordu ve o tablo canlıda BOŞ:
 * ölçüldü, 0 satır. Sefer sistemi (066) 11 satır taşıyordu ama panelde hiçbir
 * yüzeyi yoktu — yönetici boş bir ekran görüyor, seferler yalnız mobilden
 * yönetiliyordu. Sayfa artık `seferler`i okuyor; eski görev ekranı
 * (AdminAssignmentsClient / AssignmentForm) SİLİNDİ.
 *
 * ═══ KAPI: requireAdmin DEĞİL, requireFleetView ═══
 *
 * Şef kendi filosunun günlük dağıtımını kurabilmeli. Kapsam eylem katmanında
 * İKİ EKSENDE uygulanıyor (şoför + araç) — bkz. app/actions/seferler.ts.
 */
export default async function SeferlerPage({
  searchParams,
}: {
  searchParams: Promise<{ tarih?: string }>;
}) {
  const { session } = await requireFleetView();
  const { tarih } = await searchParams;

  // Gün ve seçenekler AYNI kapıdan geçiyor; sayfa kendi başına sorgu atmıyor.
  const [gun, secenekler, t] = await Promise.all([
    getSeferGunu(tarih),
    getSeferSecenekleri(),
    getTranslations("seferler"),
  ]);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: Boolean(session.is_admin),
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <SeferlerClient gun={gun} secenekler={secenekler} />
      </div>
    </DashboardShell>
  );
}
