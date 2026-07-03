"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, Siren } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EVENT_BADGE, eventSeverity } from "@/lib/event-ui";
import { formatDateTime } from "@/lib/format";
import type { VehicleEventWithPlate } from "@/lib/telemetry";
import { cn } from "@/lib/utils";

export function AlarmsClient({ events }: { events: VehicleEventWithPlate[] }) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Siren className="size-[18px] text-text-tertiary" />
          {t("title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col_time")}</TableHead>
                <TableHead>{t("col_vehicle")}</TableHead>
                <TableHead>{t("col_type")}</TableHead>
                <TableHead className="text-right">{t("col_speed")}</TableHead>
                <TableHead className="text-right">{t("col_map")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="nums whitespace-nowrap">
                    {formatDateTime(e.occurred_at, locale)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/araclar/${e.vehicle_id}`}
                      className="nums font-medium uppercase hover:underline"
                    >
                      {e.plate}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        EVENT_BADGE[eventSeverity(e.event_type)]
                      )}
                    >
                      {t(`type.${e.event_type}`)}
                    </span>
                  </TableCell>
                  <TableCell className="nums text-right">
                    {e.speed_kmh !== null
                      ? `${Math.round(e.speed_kmh).toLocaleString(nf)} km/h`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {e.latitude !== null && e.longitude !== null ? (
                      <a
                        href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent-sky hover:underline"
                      >
                        {t("view_on_map")}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
