"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Wrench, ChevronRight, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FleetDtcRow } from "@/lib/admin-dashboard";

/**
 * Filo geneli arıza özeti (Yönetici). Reveal tile dili: sabit başlık + scope
 * şeridi, satırlar plaka-öncelikli sıralama. Satır → araç detayındaki arıza
 * bölümü (#dtc).
 *
 * ŞİDDET GÖSTERİLMEZ — bilinçli. `vehicle_dtc`'de severity kolonu yok,
 * `lib/dtc-codes.ts` sözlüğünde de karşılaştırılabilir seviye alanı yok (yalnız
 * düz metin `risk` açıklaması). "En kritik kod" uydurmak yerine veriden gerçekten
 * türeyen aciliyet sinyalini veriyoruz: en uzun süredir açık kod. Renk yalnız
 * arıza SAYISINA bağlı (3+ = kritik) — bu da veri, tahmin değil.
 */
export function FleetDtcCard({ rows }: { rows: FleetDtcRow[] }) {
  const t = useTranslations("admin.dash");
  const locale = useLocale();

  const daysSince = (iso: string) =>
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

  return (
    <section className="glass rounded-[10px] p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold leading-none">
          <Wrench className="size-4 text-muted-foreground" aria-hidden />
          {t("dtc_title")}
        </h3>
        {rows.length > 0 && (
          <span className="nums text-[11px] font-semibold text-muted-foreground tabular-nums">
            {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="flex items-center gap-1.5 py-6 text-sm text-accent-green">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {t("dtc_none")}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => {
            const days = r.oldest_since ? daysSince(r.oldest_since) : null;
            return (
              <li key={r.vehicle_id}>
                <Link
                  href={`/admin/araclar/${r.vehicle_id}#dtc`}
                  className="group flex items-center gap-3 py-2 transition-colors hover:bg-surface-2/60"
                >
                  <span className="nums w-[92px] shrink-0 text-[13px] font-semibold tabular-nums">
                    {r.plate}
                  </span>

                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      r.count >= 3
                        ? "bg-destructive/15 text-destructive"
                        : "bg-accent-gold/15 text-accent-gold"
                    )}
                  >
                    {t("dtc_count", { count: r.count })}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {r.oldest_code ? (
                      <>
                        <span className="nums font-medium text-foreground">
                          {r.oldest_code}
                        </span>
                        {" · "}
                        {days === null
                          ? null
                          : days === 0
                          ? t("dtc_today")
                          : t("dtc_days", { days })}
                        {r.oldest_since && (
                          <span className="hidden md:inline">
                            {" · "}
                            {formatDate(r.oldest_since, locale)}
                          </span>
                        )}
                      </>
                    ) : (
                      t("dtc_unknown")
                    )}
                  </span>

                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
        {t("dtc_scope")}
      </div>
    </section>
  );
}
