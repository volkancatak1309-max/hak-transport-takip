import { requireWorker } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { viennaDayKey } from "@/lib/format";
import { getSoforSeferleri } from "@/app/actions/seferler";
import { SeferTakvimiClient } from "./SeferTakvimiClient";

export const dynamic = "force-dynamic";

/**
 * /panel/seferler — ŞOFÖRÜN KENDİ SEFERLERİ.
 *
 * ═══ NE DEĞİŞTİ (24.08.2026) ═══
 *
 * Sayfa `assignments` (006) okuyordu; o tablo canlıda 0 SATIR, yani şoför her
 * açtığında boş takvim görüyordu. Artık `seferler` (066) okunuyor ve kapsam
 * eylem katmanında: `getSoforSeferleri` KENDİ kapısını kuruyor
 * (`requireWorker`) ve sorguyu oturumun `worker_id`siyle daraltıyor — şoför
 * yalnız kendi seferlerini görür.
 *
 * ⚠️ Takip linkleri BU YÜZEYDE YOK. Link, yönetimin müşteriyle kurduğu bir
 * ilişkidir (kim, kime, ne zaman gönderdi); şoförün ekranında işi yok.
 */
export default async function SoforSeferleriSayfasi({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const session = await requireWorker();
  const { ay } = await searchParams;
  const { ay: gecerliAy, seferler } = await getSoforSeferleri(ay);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !!session.is_admin,
      }}
    >
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <SeferTakvimiClient
          ay={gecerliAy}
          seferler={seferler}
          bugun={viennaDayKey(new Date())}
        />
      </div>
    </DashboardShell>
  );
}
