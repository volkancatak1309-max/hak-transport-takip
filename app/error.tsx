"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";

/**
 * Segment hata sınırı — kök layout (tema + i18n provider) ayakta kalır,
 * yalnızca sayfa içeriği bu ekranla değişir. Buton kasıtlı olarak <a> (Link
 * değil): tam sayfa yenileme, hata sınırını sıfırlar ve veriyi taze çeker.
 */
export default function ErrorPage({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      {/* Subtle, single soft claret wash — minimal, never dominant. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          background:
            "radial-gradient(60rem 30rem at 50% -10%, var(--accent-claret-soft), transparent 70%)",
        }}
      />
      <div className="relative z-10 w-full max-w-[400px] page-enter">
        <div className="mb-8 flex justify-center">
          <BrandLogo height={52} />
        </div>
        <div className="glass rounded-[var(--radius)] p-6 text-center sm:p-7">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">
            {t("error_title")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("error_desc")}</p>
          <Button className="mt-6 w-full" render={<a href="/" />}>
            {t("back_to_panel")}
          </Button>
        </div>
      </div>
    </main>
  );
}
