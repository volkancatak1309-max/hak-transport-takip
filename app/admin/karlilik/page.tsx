import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getKarlilikPanosu } from "@/app/actions/karlilik";
import { KarlilikClient } from "./KarlilikClient";

export const dynamic = "force-dynamic";

const GUN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /admin/karlilik — SEFER BAZLI KÂRLILIK (migration 085).
 *
 * ═══ BU EKRANIN TEK İDDİASI ═══
 *
 * "Hangi müşteri kazandırıyor, hangisi kaybettiriyor." Bunu söyleyebilmek
 * için gösterdiği HER sayının kaynağını da söylemesi gerekiyor:
 *
 *   · gelir       → kullanıcı girdi (model + birim fiyat + miktar görünür)
 *   · yakıt       → ölçülen km × L/100km × €/L
 *   · işçilik     → seferin penceresi × €/saat
 *   · sabit gider → ATFEDİLEMEZ, ayrı satırda, dağıtılmadan
 *
 * Ölçülemeyen kalem 0 GÖSTERİLMEZ, "ölçülemedi" gösterilir. Kârlılıkta eksik
 * maliyet, kârı şişirir — yani yanlış yönde yanılır.
 */
export default async function KarlilikSayfasi({
  searchParams,
}: {
  searchParams: Promise<{ bas?: string; bit?: string }>;
}) {
  const { session } = await requireFleetView();
  const { bas, bit } = await searchParams;

  const [pano, t] = await Promise.all([
    getKarlilikPanosu(bas && GUN.test(bas) ? bas : undefined, bit && GUN.test(bit) ? bit : undefined),
    getTranslations("karlilik"),
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
        <KarlilikClient pano={pano} yazabilir={Boolean(session.is_admin)} />
      </div>
    </DashboardShell>
  );
}
