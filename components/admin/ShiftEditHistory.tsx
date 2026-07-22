"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { getShiftEditsAction } from "@/app/actions/shift";
import { formatDate, formatTime } from "@/lib/format";
import type { ShiftEditLogRow } from "@/lib/shift-edit-log";

/**
 * DÜZENLEME GEÇMİŞİ — detay çekmecesinde (22.07.2026).
 *
 * AZG raporu `started_at`, `ended_at` ve `break_minutes` alanlarından beslenir;
 * üçü de yöneticinin değiştirebildiği alanlardır. Bugüne kadar değişikliğin
 * izi ne saklanıyor ne gösteriliyordu — bir denetimde "bu saat neden değişti?"
 * sorusu cevapsız kalırdı. Burası o cevabı görünür kılar.
 *
 * Tablo yoksa (SQL çalıştırılmadıysa) action boş dizi döner ve bölüm hiç
 * render edilmez — mevcut ekranlar hiçbir şey kaybetmez.
 */
export function ShiftEditHistory({ entryId }: { entryId: string }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [rows, setRows] = useState<ShiftEditLogRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    getShiftEditsAction(entryId)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [entryId]);

  if (!rows || rows.length === 0) return null;

  /** Alan adını insan diline çevirir; bilinmeyen alan ham adıyla gösterilir. */
  const fieldLabel = (f: string) => {
    const map: Record<string, string> = {
      started_at: t("tblStart"),
      ended_at: t("tblEnd"),
      start_km: t("editStartKm"),
      end_km: t("editEndKm"),
      plate: t("tblPlate"),
      notes: t("tblNote"),
      break_minutes: t("tblBreak"),
      start_package_count: t("tblLoaded"),
      undelivered_count: t("editReturned"),
      cargo_count: t("tblCargo"),
    };
    return map[f] ?? f;
  };

  /** Zaman alanları saat olarak, diğerleri ham gösterilir. */
  const valueLabel = (field: string, v: string | null) => {
    if (v === null || v === "") return "—";
    if (field === "started_at" || field === "ended_at") {
      return `${formatDate(v, locale)} ${formatTime(v, locale)}`;
    }
    return v;
  };

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="size-3.5" aria-hidden />
        {t("editHistoryTitle")}
      </h3>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="text-xs">
            <span className="text-muted-foreground">{fieldLabel(r.field)}: </span>
            <span className="nums line-through opacity-70">
              {valueLabel(r.field, r.old_value)}
            </span>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="nums font-medium">{valueLabel(r.field, r.new_value)}</span>
            <span className="ml-1.5 text-muted-foreground">
              · {r.changed_by_name ?? "—"} ·{" "}
              {formatDate(r.changed_at, locale)} {formatTime(r.changed_at, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
