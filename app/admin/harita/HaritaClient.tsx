"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPinned } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActiveDriver } from "@/lib/types";

const FleetMap = dynamic(
  () => import("@/components/FleetMap").then((m) => m.FleetMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[70vh] w-full rounded-lg" />,
  }
);

const REFRESH_MS = 30_000;

export function HaritaClient({ drivers }: { drivers: ActiveDriver[] }) {
  const t = useTranslations("map");
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPinned className="size-5 text-primary" />
          {t("title")}
        </CardTitle>
        <span className="text-xs text-muted-foreground nums">
          {drivers.length}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative h-[70vh] w-full overflow-hidden rounded-b-lg">
          <FleetMap drivers={drivers} />
          {drivers.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
              <span className="rounded-md bg-background/90 px-4 py-2 text-sm text-muted-foreground shadow-sm">
                {t("no_active")}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
