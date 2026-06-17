import { useTranslations } from "next-intl";

const APP_VERSION = "2.0.0";

export function Footer() {
  const t = useTranslations("footer");
  return (
    <footer className="border-t border-border/60 bg-background mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          © {new Date().getFullYear()} HAK61 GmbH — {t("poweredBy")}
        </div>
        <div className="nums">{t("version", { v: APP_VERSION })}</div>
      </div>
    </footer>
  );
}
