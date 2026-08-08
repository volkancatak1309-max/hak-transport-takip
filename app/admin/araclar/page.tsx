import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { listLatestVehiclePositions } from "@/lib/telemetry";
import { getFleetDtc } from "@/lib/admin-dashboard";
import { AraclarClient } from "./AraclarClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export default async function AraclarPage() {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/araclar");
  // Araç formundaki "Atanmış şoför" seçimi. Bu ilişki
  // (vehicles.assigned_worker_id) şoför↔araç eşleşmesinin tek kaynağı: şoför
  // paneli ve Çalışanlar sayfası ikisi de buradan okur.
  // Pasifler de listelenir (is_active filtresi YOK): pasifleştirme atamayı
  // temizlemiyor, filtrelenirse o araç formda "Şoför yok" görünür ve yönetici
  // atamayı temizlediğini sanıp aslında ex-çalışanı geri yazar.
  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  // Patron kademesi (045) — katman kapalıysa boş kapsam, sorgu değişmez.
  const ownerScope = await getOwnerScope(session.worker_id);
  const [vehicles, driversResult, dtc, positions] = await Promise.all([
    listVehiclesWithStatus(),
    // driver-scoped: yöneticiler araca ATANAMAZ. Bu seçici, bir yöneticinin
    // vehicles.assigned_worker_id'ye yazılabildiği TEK yol — oradan da Top-10,
    // Rölanti Panosu ve Aylık Pivot'a şoför olarak sızardı (lib/analytics.ts
    // resolveDriver savunması onu "Atanmamış · PLAKA"ya düşürür ama o zaman da
    // aracın gerçek sahibi kaybolur). Kapıyı kaynağında kapatmak daha temiz.
    // is_active filtresi YOK olmaya devam ediyor — yukarıdaki gerekçe geçerli.
    // owner-filtered: withoutOwner — bugün driver-scope patronu zaten eliyor
    // (is_admin + counts_as_driver=false); bu katman o muafiyet açılırsa
    // gizlemenin delinmemesi için.
    withoutOwner(
      onlyDrivers(
        withoutTestRows(
          supabaseAdmin
            .from("workers")
            .select("id, name, is_active")
            .order("name"),
          "id",
          scope.workerIds
        ),
        "id",
        driverScope
      ),
      "id",
      ownerScope
    ),
    // Filo arıza özeti — 22.07.2026'da yönetici panosundan buraya taşındı.
    // Arıza aracın özelliğidir; panoda sayfanın ilk 420 px'ini işgal ediyordu.
    getFleetDtc(),
    // SON SİNYAL (26.07.2026 — Aboard klonu): tabloda "Son sinyal" kolonu ve
    // "Sinyalsiz" kayıtlı görünümü bunu ister. Haritanın kullandığı sorgunun
    // aynısı (araç başına indeksli limit-1).
    listLatestVehiclePositions(),
  ]);
  const lastSeen: Record<string, string> = {};
  for (const p of positions) lastSeen[p.vehicle_id] = p.recorded_at;
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
      <AraclarClient vehicles={vehicles} drivers={drivers} dtc={dtc} lastSeen={lastSeen} />
    </DashboardShell>
  );
}
