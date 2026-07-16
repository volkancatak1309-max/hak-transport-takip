import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { AraclarClient } from "./AraclarClient";

export const dynamic = "force-dynamic";

export default async function AraclarPage() {
  const session = await requireAdmin();
  const vehicles = await listVehiclesWithStatus();

  // Başlık artık içerikte (klon A2 bloğu: H1 + açıklama). Kabuğa `title`
  // geçmiyoruz: prop verilmezse kabuk zaten nav'daki aktif etiketi ("Araçlar")
  // kullanıyor — aynı sonuç, gereksiz prop yok.
  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <AraclarClient vehicles={vehicles} />
    </DashboardShell>
  );
}
