"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatDate,
  formatTime,
  formatDurationShort,
  workedMs,
  kmDiff,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

type Props = {
  /** km_measured: cihazı sessiz vardiyada km bir ölçüm değil (lib/km-quality.ts). */
  entries: (TimeEntry & { km_measured?: boolean })[];
  page: number;
  totalPages: number;
  from: string;
  to: string;
};

export function HistoryClient({ entries, page, totalPages, from, to }: Props) {
  const t = useTranslations("history");
  const tp = useTranslations("panel");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const u = new URLSearchParams(params.toString());
    if (value) u.set(key, value);
    else u.delete(key);
    if (key !== "page") u.set("page", "1");
    router.push(`/panel/gecmis?${u.toString()}`);
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="from">{t("from")}</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setParam("from", e.target.value)}
              className="h-11 nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">{t("to")}</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setParam("to", e.target.value)}
              className="h-11 nums"
            />
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {tp("noHistory")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tp("tblDate")}</TableHead>
                    <TableHead>{tp("tblStart")}</TableHead>
                    <TableHead>{tp("tblEnd")}</TableHead>
                    <TableHead>{tp("tblWorked")}</TableHead>
                    <TableHead>{tp("tblBreak")}</TableHead>
                    <TableHead>{tp("tblKm")}</TableHead>
                    <TableHead>{tp("tblCargo")}</TableHead>
                    <TableHead>{tp("tblPlate")}</TableHead>
                    <TableHead>{tp("tblNote")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => {
                    const w = workedMs(e);
                    const km = kmDiff(e);
                    return (
                      <TableRow key={e.id}>
                        <TableCell>{formatDate(e.started_at, locale)}</TableCell>
                        <TableCell className="nums">{formatTime(e.started_at, locale)}</TableCell>
                        <TableCell className="nums">{formatTime(e.ended_at, locale)}</TableCell>
                        <TableCell>{formatDurationShort(w, locale)}</TableCell>
                        <TableCell className="nums">{e.break_minutes ?? 0}</TableCell>
                        <TableCell className="nums">
                          {km !== null ? (
                            km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")
                          ) : (
                            /* "—" iki sebepten olur: vardiya açık ya da cihaz
                               sessizdi. İkincisinde sebep başlıkta yazar —
                               şoför 0 km'yi gerçek sanmasın. */
                            <span
                              title={
                                e.km_measured === false ? tp("kmNoSignal") : undefined
                              }
                            >
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="nums">{e.cargo_count ?? "—"}</TableCell>
                        <TableCell className="nums">{e.plate ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate" title={e.notes ?? ""}>
                          {e.notes ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground nums">
                {t("page")} {page} {t("of")} {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="min-h-[44px] rounded-full px-4"
                  disabled={page <= 1}
                  onClick={() => setParam("page", String(page - 1))}
                >
                  <ChevronLeft className="size-4" />
                  {t("prev")}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px] rounded-full px-4"
                  disabled={page >= totalPages}
                  onClick={() => setParam("page", String(page + 1))}
                >
                  {t("next")}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
