"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale, useTranslations } from "next-intl";

export type WeeklyDatum = {
  date: string; // ISO date (yyyy-mm-dd)
  label: string;
  hours: number; // worked hours (decimal)
  workers: number;
};

export function WeeklyChart({ data }: { data: WeeklyDatum[] }) {
  const t = useTranslations("admin");
  const locale = useLocale();

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          barCategoryGap="22%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v) => `${v}h`}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.3 }}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--popover-foreground)",
            }}
            formatter={((value: unknown) => {
              const n = Number(value);
              return [`${n.toFixed(2)} ${t("chartHours")}`, t("chartHours")];
            }) as never}
            labelFormatter={((label: unknown, payload: unknown) => {
              const arr = payload as Array<{ payload?: { date?: string } }> | undefined;
              const d = arr?.[0]?.payload?.date;
              if (!d) return String(label);
              const date = new Date(d);
              return date.toLocaleDateString(locale === "de" ? "de-AT" : "tr-TR", {
                weekday: "long",
                day: "2-digit",
                month: "2-digit",
              });
            }) as never}
          />
          <Bar
            dataKey="hours"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
