"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Wrench,
  MapPinOff,
  PackageX,
  HelpCircle,
  CheckCircle2,
  Loader2,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolveDriverReportAction } from "@/app/actions/driver-panel";
import { formatDate, formatTime } from "@/lib/format";
import type { DriverReportType } from "@/lib/types";

/** Open driver problem report (SORUN BİLDİR) prepared for the admin list. */
export type AdminDriverReport = {
  id: string;
  worker_name: string;
  report_type: DriverReportType;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

const TYPE_META: Record<DriverReportType, { icon: LucideIcon; tkey: string }> = {
  vehicle_fault: { icon: Wrench, tkey: "reportTypeVehicleFault" },
  address_issue: { icon: MapPinOff, tkey: "reportTypeAddressIssue" },
  damaged_package: { icon: PackageX, tkey: "reportTypeDamagedPackage" },
  other: { icon: HelpCircle, tkey: "reportTypeOther" },
};

/**
 * İş 2 kapanışı — şoför "SORUN BİLDİR" kayıtlarının admin tarafındaki dikkat
 * listesi. Açık (resolved_at null) bildirimleri gösterir; "Çözüldü" ile
 * resolveDriverReportAction çağrılır ve kayıt listeden düşer.
 */
export function DriverReportsCard({ reports }: { reports: AdminDriverReport[] }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState<string | null>(null);

  function resolve(id: string) {
    setResolving(id);
    startTransition(async () => {
      const r = await resolveDriverReportAction(id);
      if (r.ok) {
        toast.success(t("reportResolved"));
        router.refresh();
      } else {
        toast.error(t("reportResolveErr"));
        setResolving(null);
      }
    });
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-muted-foreground" />
            {t("reportsTitle")}
          </span>
          {reports.length > 0 && (
            <span className="nums rounded-full bg-accent-gold/15 px-2 py-0.5 text-[11px] font-semibold text-accent-gold-text">
              {reports.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {reports.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <CheckCircle2 className="size-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("reportsEmpty")}</p>
          </div>
        ) : (
          <ul className="-mx-1 max-h-[320px] space-y-1 overflow-y-auto">
            {reports.map((r) => {
              const meta = TYPE_META[r.report_type] ?? TYPE_META.other;
              const Icon = meta.icon;
              const hasCoords = r.latitude !== null && r.longitude !== null;
              const busy = pending && resolving === r.id;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-surface-2/60"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-gold/15 text-accent-gold-text">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-medium">{r.worker_name}</span>{" "}
                      <span className="text-muted-foreground">· {t(meta.tkey)}</span>
                    </div>
                    <div className="nums flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>
                        {formatDate(r.created_at, locale)} {formatTime(r.created_at, locale)}
                      </span>
                      {hasCoords && (
                        <a
                          href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-accent-sky hover:underline"
                        >
                          <MapPin className="size-3" />
                          {t("reportMap")}
                        </a>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resolve(r.id)}
                    disabled={busy}
                    className="shrink-0 text-accent-green hover:text-accent-green"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    <span className="hidden sm:inline">{t("reportResolve")}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
