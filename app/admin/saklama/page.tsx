import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getSaklamaPanosu } from "@/app/actions/saklama";
import { SaklamaClient } from "./SaklamaClient";

export const dynamic = "force-dynamic";

/**
 * /admin/saklama — HAM TELEMETRİ SAKLAMA POLİTİKASI (migration 090).
 *
 * ═══ NEDEN AYRI SAYFA, /admin/ayarlar İÇİNE GÖMÜLMEDİ ═══
 *
 * Bu bir AYAR değil, bir BEYAN. Dışarıya (müşteriye, iş müfettişliğine,
 * veri koruma otoritesine) gösterilecek sayı burada duruyor ve yanında
 * gerekçesi yazılı. `/admin/ayarlar` içindeki bir satır olsaydı, denetimde
 * "politikanız nerede yazılı" sorusunun cevabı bir alt sekme olurdu.
 *
 * Aynı gerekçe CO₂ panosunda da yazılı (/admin/co2): operasyon ekranı ile
 * beyan ekranı ayrı şeylerdir.
 *
 * ═══ BAYRAK YOK ═══
 *
 * Saklama politikası bir modül değil; kapatılabilir olması anlamsız.
 */
export default async function SaklamaSayfasi() {
  const session = await requireAdmin();
  const [pano, t] = await Promise.all([getSaklamaPanosu(), getTranslations("retention")]);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        <SaklamaClient pano={pano} />
      </div>
    </DashboardShell>
  );
}
