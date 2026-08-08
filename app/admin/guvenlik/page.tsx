import { requireOwner } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  listSessions,
  listOpenSessions,
  listAudit,
  listSecurityWorkers,
} from "@/lib/security-read";
import { audit } from "@/lib/security-log";
import {
  listPendingDevices,
  listPendingCountries,
  listAccessRules,
  ACCESS_DEFAULTS,
} from "@/lib/access-read";
import { getKillSwitchState } from "@/lib/kill-switch";
import {
  SECURITY_LAYER_ENABLED,
  SINGLE_SESSION,
  ACCESS_GATES_ENABLED,
} from "@/lib/tenant";
import { GuvenlikClient } from "./GuvenlikClient";

export const dynamic = "force-dynamic";

/**
 * PATRON EKRANI (045) — /admin/guvenlik.
 *
 * requireOwner() arkasında: mevcut 19 yönetici sayfası requireAdmin()'de kaldı,
 * bu ekran tek başına daha dar bir kapıya bağlı. Yetki her istekte DB'den
 * okunur (çerezden değil) ve kolon yoksa fail-closed → /admin.
 */
export default async function GuvenlikPage() {
  const session = await requireOwner();

  const [
    sessions,
    open,
    auditRows,
    workers,
    // ERİŞİM KAPILARI (046) — bayrak kapalıysa dördü de boş döner, sorgu yok.
    pendingDevices,
    pendingCountries,
    accessRules,
    killSwitch,
  ] = await Promise.all([
    listSessions(200),
    listOpenSessions(),
    listAudit(200),
    listSecurityWorkers(),
    listPendingDevices(),
    listPendingCountries(),
    listAccessRules(),
    getKillSwitchState(),
  ]);

  // Bu sayfanın kendi görüntülenmesi de ize girer — güvenlik ekranına kimin
  // baktığı, izlenen diğer her şey kadar önemlidir.
  await audit(session.worker_id ?? null, "page_view", "/admin/guvenlik");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        isOwner: true,
      }}
      title="Güvenlik"
    >
      <GuvenlikClient
        sessions={sessions}
        open={open}
        audit={auditRows}
        workers={workers}
        meId={session.worker_id!}
        layerEnabled={SECURITY_LAYER_ENABLED}
        singleSession={SINGLE_SESSION}
        gatesEnabled={ACCESS_GATES_ENABLED}
        pendingDevices={pendingDevices}
        pendingCountries={pendingCountries}
        accessRules={accessRules}
        accessDefaults={ACCESS_DEFAULTS}
        killSwitch={killSwitch}
      />
    </DashboardShell>
  );
}
