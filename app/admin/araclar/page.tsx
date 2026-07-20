import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { AraclarClient } from "./AraclarClient";

export const dynamic = "force-dynamic";

export default async function AraclarPage() {
  const session = await requireAdmin();
  // Araç formundaki "Atanmış şoför" seçimi. Bu ilişki
  // (vehicles.assigned_worker_id) şoför↔araç eşleşmesinin tek kaynağı: şoför
  // paneli ve Çalışanlar sayfası ikisi de buradan okur.
  // Pasifler de listelenir (is_active filtresi YOK): pasifleştirme atamayı
  // temizlemiyor, filtrelenirse o araç formda "Şoför yok" görünür ve yönetici
  // atamayı temizlediğini sanıp aslında ex-çalışanı geri yazar.
  const [vehicles, driversResult] = await Promise.all([
    listVehiclesWithStatus(),
    supabaseAdmin
      .from("workers")
      .select("id, name, is_active")
      .order("name"),
  ]);
  const drivers = (driversResult.data ?? []) as {
    id: string;
    name: string;
    is_active: boolean;
  }[];

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
      <AraclarClient vehicles={vehicles} drivers={drivers} />
    </DashboardShell>
  );
}
