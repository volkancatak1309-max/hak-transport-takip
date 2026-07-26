import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const t = useTranslations("errors");

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
        <div className="surface-card rounded-[14px] p-6 text-center sm:p-7">
          <p className="font-mono text-sm text-text-tertiary">404</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.01em]">
            {t("notfound_title")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("notfound_desc")}
          </p>
          <Button className="mt-6 w-full" render={<Link href="/" />}>
            {t("back_to_panel")}
          </Button>
        </div>
      </div>
    </main>
  );
}
