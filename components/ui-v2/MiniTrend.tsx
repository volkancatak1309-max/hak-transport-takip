"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { cn } from "@/lib/utils";

/**
 * Alarm trend bar grafiği (REVEAL-GAP §3.5 — Resend ff328c72 zengin-tooltip +
 * Exa ccc4661c bar-hover + Reveal Alert Summary bar deseni). Seçili aralıkta
 * kova/kova olay sayısı; bar'a hover → tam değer; bar'a tıkla → o kovaya
 * filtre. "Koyu temaya boyanmış tablo" itirazının doğrudan panzehiri.
 */
export type TrendBucket = {
  key: string;
  /** X ekseni etiketi (kısa: "14 Tem" / "13:00"). */
  label: string;
  value: number;
  /** Kritik olay sayısı (barın kritik kısmı için). */
  critical?: number;
};

function TrendTooltip({ active, payload, criticalLabel, totalLabel }: {
  active?: boolean;
  payload?: Array<{ payload: TrendBucket }>;
  criticalLabel: string;
  totalLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="glass-pop rounded-[10px] px-3 py-2 text-xs">
      <div className="mb-1 font-medium">{b.label}</div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: "var(--accent-sky)" }} />
        <span className="text-muted-foreground">{totalLabel}</span>
        <span className="nums ml-auto font-medium">{b.value}</span>
      </div>
      {b.critical !== undefined && b.critical > 0 && (
        <div className="mt-0.5 flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: "var(--status-critical)" }} />
          <span className="text-muted-foreground">{criticalLabel}</span>
          <span className="nums ml-auto font-medium">{b.critical}</span>
        </div>
      )}
    </div>
  );
}

export function MiniTrend({
  data,
  onBucketClick,
  activeKey,
  criticalLabel = "Kritik",
  totalLabel = "Toplam",
  height = 132,
  className,
}: {
  data: TrendBucket[];
  onBucketClick?: (bucket: TrendBucket) => void;
  activeKey?: string | null;
  criticalLabel?: string;
  totalLabel?: string;
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            minTickGap={24}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.5 }}
            content={<TrendTooltip criticalLabel={criticalLabel} totalLabel={totalLabel} />}
          />
          <Bar
            dataKey="value"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            onClick={onBucketClick ? (d) => onBucketClick(d as unknown as TrendBucket) : undefined}
            cursor={onBucketClick ? "pointer" : undefined}
          >
            {data.map((b) => (
              <Cell
                key={b.key}
                fill={
                  b.critical && b.critical > 0
                    ? "var(--status-critical)"
                    : "var(--accent-sky)"
                }
                fillOpacity={activeKey && activeKey !== b.key ? 0.35 : 0.9}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
