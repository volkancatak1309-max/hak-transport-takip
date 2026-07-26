import { useTranslations } from "next-intl";
import { requirePinChange } from "@/lib/session";
import { ChangePinForm } from "./ChangePinForm";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

// Same minimal shell as the login page (app/page.tsx) — the driver is NOT yet
// "inside", so no DashboardShell/nav until the temp PIN has been changed.
function ChangePinShell() {
  const t = useTranslations("changePin");
  return (
    <div className="w-full max-w-[400px] page-enter">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLogo height={68} className="mb-7" />
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Giriş ekranıyla AYNI kabuk — şoför henüz "içeride" değil. */}
      <div className="glass-panel rounded-[20px] p-6 sm:p-8">
        <ChangePinForm />
      </div>

      <p className="mt-6 text-center text-xs text-text-tertiary">HAK61 · Wien</p>
    </div>
  );
}

export default async function ChangePinPage() {
  // Requires auth; bounces to home if there is nothing to change (no loop).
  await requirePinChange();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      {/* Işık yıkaması — giriş ekranıyla birebir aynı (DESIGN.md §1). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(60rem 30rem at 50% -10%, var(--accent-claret-soft), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{
          background:
            "radial-gradient(40rem 24rem at 85% 110%, var(--accent-coral-soft), transparent 70%)",
        }}
      />
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="relative z-10 w-full max-w-[400px]">
        <ChangePinShell />
      </div>
    </main>
  );
}
