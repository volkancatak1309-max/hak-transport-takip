"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HelpCircle, Loader2, MapPinOff, PackageX, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reportProblemAction } from "@/app/actions/driver-panel";
import { tryServerAction } from "@/lib/offline-aware";
import { getGeoFix } from "./geo";
import type { DriverReportType } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const OPTIONS: { type: DriverReportType; tkey: string; icon: typeof Wrench }[] = [
  { type: "vehicle_fault", tkey: "v2ReportVehicle", icon: Wrench },
  { type: "address_issue", tkey: "v2ReportAddress", icon: MapPinOff },
  { type: "damaged_package", tkey: "v2ReportPackage", icon: PackageX },
  { type: "other", tkey: "v2ReportOther", icon: HelpCircle },
];

/**
 * İş 2 — "SORUN BİLDİR": 4 dev ikonlu hazır seçenek, yazı yazma zorunluluğu
 * yok. Seçim yöneticiye kayıt düşer (driver_reports + Telegram). Çevrimdışıysa
 * kuyruğa alınır ve bağlantı gelince gönderilir.
 */
export function ProblemReportDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("panel");
  const tOffline = useTranslations("offline");
  const [sending, setSending] = useState<DriverReportType | null>(null);

  async function send(type: DriverReportType) {
    if (sending) return;
    setSending(type);
    try {
      const clientTime = new Date().toISOString();
      const fix = await getGeoFix();
      const payload = {
        report_type: type,
        lat: fix.lat,
        lng: fix.lng,
      };
      const r = await tryServerAction("report", payload, clientTime, () =>
        reportProblemAction({ type, lat: fix.lat, lng: fix.lng, clientTime })
      );
      if (r.queued) {
        toast.warning(tOffline("queued_toast"));
        onOpenChange(false);
        return;
      }
      if (r.result.ok) {
        toast.success(t("v2ReportSent"));
        onOpenChange(false);
      } else {
        toast.error(t("v2ReportErr"));
      }
    } finally {
      setSending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("v2ReportTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const busy = sending === o.type;
            return (
              <button
                key={o.type}
                type="button"
                onClick={() => send(o.type)}
                disabled={sending !== null}
                className="glass-field flex h-32 flex-col items-center justify-center gap-3 rounded-2xl text-center transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-white/[0.06] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="size-9 animate-spin text-accent-sky-text" aria-hidden />
                ) : (
                  <Icon className="size-9 text-accent-sky-text" aria-hidden />
                )}
                <span className="px-2 text-sm font-semibold leading-tight text-foreground">
                  {t(o.tkey)}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
