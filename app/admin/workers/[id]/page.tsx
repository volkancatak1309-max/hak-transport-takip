import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin, effectiveViewerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { WorkerDetailClient } from "./WorkerDetailClient";
import { WorkerDocuments } from "./WorkerDocuments";
import { listWorkerDocuments, listDocumentTypes } from "@/lib/documents-db";
import {
  formatDate,
  startOfMonthVienna,
  workedMs,
} from "@/lib/format";
import { markKmMeasured, kmCoverage } from "@/lib/km-quality";
import { licenseState, LICENSE_BADGE } from "@/lib/worker-ui";
import { getLoginLockState } from "@/lib/login-lock";
import type { WorkerPublic, TimeEntry } from "@/lib/types";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import { getOwnerScope } from "@/lib/owner-scope";
import { getLocale, getTranslations } from "next-intl/server";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export default async function WorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/workers/[id]");
  const { id } = await params;
  const t = await getTranslations("workers");
  const tc = await getTranslations("common");
  const ta = await getTranslations("admin");
  const locale = await getLocale();

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select(WORKER_PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!worker) notFound();
  // Patron dosyası is_owner olmayana KAPALI (045). Liste gizlemesi tek başına
  // yetmez: id bir kez öğrenildiğinde bu sayfa doğrudan açılabilir. "Yok" demek
  // "yasak" demekten iyidir — 403 kaydın VAR olduğunu doğrulardı.
  const ownerScope = await getOwnerScope(effectiveViewerId(session));
  if (!ownerScope.isVisible(id)) notFound();
  const w = worker as WorkerPublic;

  // Plaka tek kaynaktan: vehicles.assigned_worker_id (şoför paneliyle aynı
  // sorgu). workers.plate artık yalnız eski kayıtlar için tutulan bir aynadır.
  const { data: assignedVeh } = await supabaseAdmin
    .from("vehicles")
    .select("plate")
    .eq("assigned_worker_id", id)
    .neq("status", "inactive")
    .order("plate")
    .limit(1)
    .maybeSingle();
  const assignedPlate = (assignedVeh?.plate as string) ?? null;

  const monthStart = startOfMonthVienna();
  // Telefon GPS'i kaldırıldı (21.07.2026): "bugünkü rota" haritası
  // driver_locations'tan besleniyordu. Rota takibi artık yalnız araç
  // cihazından (FMC003) gelir — araç detayındaki rota sayfası korunuyor.
  // Giriş kilidi: düğme YALNIZ gerçekten kilitliyken basılır (boşuna durmasın).
  // Okuma ucuz ve hata durumunda "kilitli değil"e düşer — sayfa etkilenmez.
  const [loginLock, [monthEntriesResult, allEntriesResult]] = await Promise.all([
    getLoginLockState(w.phone),
    Promise.all([
    supabaseAdmin
      .from("time_entries")
      .select("*")
      .eq("worker_id", id)
      .gte("started_at", monthStart.toISOString()),
    supabaseAdmin
      .from("time_entries")
      .select("*")
      .eq("worker_id", id)
      .order("started_at", { ascending: false })
      .limit(200),
    ]),
  ]);

  // km_measured: cihazı sessiz vardiyanın 0 km'si bir ÖLÇÜM DEĞİL. İki liste de
  // işaretlenir; aylık toplam artık kaç vardiyanın ölçülemediğini de taşır,
  // çünkü sessizce eksilen bir toplam yöneticiye "az km yapmış" diye okunuyordu.
  const [monthEntries, allEntries] = await Promise.all([
    markKmMeasured((monthEntriesResult.data ?? []) as TimeEntry[]),
    markKmMeasured((allEntriesResult.data ?? []) as TimeEntry[]),
  ]);
  let monthMs = 0;
  let monthCargo = 0;
  for (const e of monthEntries) {
    monthMs += workedMs(e);
    monthCargo += e.cargo_count ?? 0;
  }
  const monthKmCoverage = kmCoverage(monthEntries);
  const monthKm = monthKmCoverage.km;

  // Belge takibi (078). İki küçük okuma; tablo yoksa ikisi de boş döner ve
  // bölüm "migration bekliyor" der — sayfanın geri kalanı etkilenmez.
  const [belgeler, belgeTurleri] = await Promise.all([
    listWorkerDocuments(w.id),
    listDocumentTypes(),
  ]);
  // Kalan gün SUNUCUDA ölçülür: istemcide `Date.now()` çağırmak render'ı saf
  // olmaktan çıkarır ve gece yarısını geçen bir istekte sunucu/istemci farklı
  // sonuç üretebilir.
  const bugunUTC = (() => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  })();
  const belgeSatirlari = belgeler.docs.map((d) => ({
    ...d,
    days: Math.round(
      (Date.parse(d.expiresAt + "T00:00:00Z") - bugunUTC) / 86_400_000
    ),
  }));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/workers">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="size-4" />
              {t("title")}
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <UserAvatar name={w.name} size="lg" />
                <div>
                  <CardTitle className="text-2xl">{w.name}</CardTitle>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="nums">{w.phone}</span>
                    <span>•</span>
                    <span className="nums uppercase">{assignedPlate ?? "—"}</span>
                    <span>•</span>
                    <span>{w.is_admin ? tc("admin") : tc("worker")}</span>
                  </div>
                </div>
              </div>
              {w.is_active ? (
                <Badge variant="default">{tc("active")}</Badge>
              ) : (
                <Badge variant="outline">{tc("passive")}</Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Personel dosyası (migration 025) — kâğıt formdaki bilgiler artık
            sistemde. Boş alan "girilmedi" (—): formlar eksik gelebiliyor. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("profileTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {(
              [
                {
                  title: ta("secPersonal"),
                  fields: [
                    {
                      label: ta("birthDate"),
                      value: w.birth_date ? formatDate(w.birth_date, locale) : null,
                    },
                    { label: ta("ssn"), value: w.social_security_no, nums: true },
                    { label: ta("email"), value: w.email },
                    { label: ta("address"), value: w.address },
                  ],
                },
                {
                  title: ta("secEmployment"),
                  fields: [
                    {
                      label: ta("employmentStart"),
                      value: w.employment_start
                        ? formatDate(w.employment_start, locale)
                        : null,
                    },
                    {
                      label: ta("employmentType"),
                      value: w.employment_type
                        ? ta(`employment_${w.employment_type}`)
                        : null,
                    },
                  ],
                },
                {
                  title: ta("secLicense"),
                  fields: [
                    { label: ta("licenseNo"), value: w.license_no, nums: true },
                    {
                      label: ta("licenseExpiry"),
                      value: w.license_expiry
                        ? formatDate(w.license_expiry, locale)
                        : null,
                      badge: licenseState(w.license_expiry),
                    },
                  ],
                },
                {
                  title: ta("secEmergency"),
                  fields: [
                    { label: ta("emergencyName"), value: w.emergency_contact_name },
                    {
                      label: ta("emergencyRelation"),
                      value: w.emergency_contact_relation,
                    },
                    {
                      label: ta("emergencyPhone"),
                      value: w.emergency_contact_phone,
                      nums: true,
                    },
                  ],
                },
              ] as {
                title: string;
                fields: {
                  label: string;
                  value: string | null;
                  nums?: boolean;
                  badge?: ReturnType<typeof licenseState>;
                }[];
              }[]
            ).map((sec) => (
              <div key={sec.title}>
                <p className="mb-2 text-[12px] sm:text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
                  {sec.title}
                </p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {sec.fields.map((f) => (
                    <div key={f.label} className="flex items-baseline justify-between gap-3 sm:justify-start">
                      <dt className="w-40 shrink-0 text-sm text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd
                        className={`text-sm ${f.nums ? "nums " : ""}${f.value ? "" : "text-text-tertiary"}`}
                      >
                        {f.value ?? "—"}
                        {f.badge && (
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 text-[12px] sm:text-[11px] font-semibold ${LICENSE_BADGE[f.badge.state]}`}
                          >
                            {f.badge.state === "expired"
                              ? t("licenseExpired")
                              : t("licenseExpiring", { days: f.badge.days })}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Belge takibi (078) — ehliyetin YANINDA ama ondan AYRI eksen. */}
        <WorkerDocuments
          workerId={w.id}
          docs={belgeSatirlari}
          types={belgeTurleri.types}
          tabloYok={belgeler.tabloYok || belgeTurleri.tabloYok}
        />
        <WorkerDetailClient
          worker={w}
          loginLock={loginLock}
          entries={allEntries}
          monthSummary={{
            shifts: monthEntries.length,
            ms: monthMs,
            km: monthKm,
            kmUnmeasured: monthKmCoverage.sinyalsiz,
            cargo: monthCargo,
          }}
        />
      </div>
    </DashboardShell>
  );
}
