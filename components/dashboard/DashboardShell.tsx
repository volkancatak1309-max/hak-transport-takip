"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  LayoutDashboard,
  MapPinned,
  Route,
  Truck,
  Users,
  Send,
  Fuel,
  Receipt,
  Hexagon,
  Siren,
  LogOut,
  Menu,
  X,
  Globe,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/ui-v2/CommandPalette";
import { BrandLogo } from "@/components/BrandLogo";
import { UserAvatar } from "@/components/UserAvatar";
import { OfflineBadge } from "@/components/OfflineBadge";
import { HelpProvider } from "@/components/help/HelpProvider";
import { HelpToggle } from "@/components/help/HelpToggle";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { setLocaleAction } from "@/app/actions/preferences";
import { FUEL_ENABLED, EXPENSE_ENABLED } from "@/lib/features";

export type HeaderUser = {
  id: string;
  name: string;
  phone: string;
  isAdmin: boolean;
};

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Live Vienna clock for the topbar. Mounts client-side to avoid hydration drift. */
function Clock() {
  const locale = useLocale();
  const [time, setTime] = useState<string>("");
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString(locale === "de" ? "de-AT" : "tr-TR", {
        timeZone: "Europe/Vienna",
        hour: "2-digit",
        minute: "2-digit",
      });
    setTime(fmt());
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, [locale]);
  if (!time) return null;
  return (
    <span className="nums hidden text-sm tabular-nums text-muted-foreground sm:inline">
      {time}
    </span>
  );
}

export function DashboardShell({
  user,
  title,
  children,
}: {
  user: HeaderUser;
  title?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [localePending, startLocale] = useTransition();
  const logoutRef = useRef<HTMLFormElement>(null);

  const navItems: NavItem[] = user.isAdmin
    ? [
        { href: "/admin", label: t("admin"), icon: LayoutDashboard },
        { href: "/admin/harita", label: t("map"), icon: MapPinned },
        { href: "/admin/araclar", label: t("vehicles"), icon: Truck },
        { href: "/admin/alarmlar", label: t("alarms"), icon: Siren },
        { href: "/admin/bolgeler", label: t("zones"), icon: Hexagon },
        { href: "/admin/seferler", label: t("assignments"), icon: Route },
        ...(FUEL_ENABLED ? [{ href: "/admin/yakit", label: t("fuel"), icon: Fuel }] : []),
        ...(EXPENSE_ENABLED
          ? [{ href: "/admin/masraflar", label: t("expenses"), icon: Receipt }]
          : []),
        { href: "/admin/workers", label: t("workers"), icon: Users },
        { href: "/admin/telegram", label: t("telegram"), icon: Send },
      ]
    : [
        { href: "/panel", label: t("panel"), icon: LayoutDashboard },
        ...(FUEL_ENABLED ? [{ href: "/panel/yakit", label: t("fuel"), icon: Fuel }] : []),
        ...(EXPENSE_ENABLED
          ? [{ href: "/panel/masraflar", label: t("expenses"), icon: Receipt }]
          : []),
      ];

  function isActive(href: string) {
    // Kök rotalar (/admin, /panel) YALNIZ tam eşleşmede aktif — aksi halde her
    // alt sayfada ("/admin/harita" …) startsWith("/admin/") true olur ve hem
    // "Yönetici" hem aktif sayfa aynı anda seçili görünür (FAZ 0 çift-nav hatası).
    if (href === "/admin" || href === "/panel") return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Title defaults to the deepest-matching nav item's label (longest href wins,
  // so /admin/harita beats /admin). An explicit `title` prop always overrides.
  const activeLabel = [...navItems]
    .filter((i) => isActive(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label;
  const pageTitle = title ?? activeLabel ?? "";

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-0.5 px-3">
      {navItems.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium",
              "transition-colors duration-150",
              active
                ? "nav-active text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            )}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent-claret" />
            )}
            <Icon className={cn("size-[18px] shrink-0", active && "text-accent-sky")} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  function flipLocale() {
    const next = locale === "tr" ? "de" : "tr";
    startLocale(async () => {
      await setLocaleAction(next);
    });
  }

  return (
    <HelpProvider>
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="glass sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href={user.isAdmin ? "/admin" : "/panel"} className="flex items-center">
            <BrandLogo height={38} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks />
        </div>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-[10px] px-2 py-2">
            <UserAvatar name={user.name} size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium leading-tight">{user.name}</span>
              <span className="nums truncate text-xs leading-tight text-text-tertiary">
                {user.phone}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="close"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="glass absolute left-0 top-0 flex h-full w-[260px] flex-col page-enter">
            <div className="flex h-16 items-center justify-between px-5">
              <BrandLogo height={38} />
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-border p-3">
              <div className="flex items-center gap-3 px-2 py-2">
                <UserAvatar name={user.name} size="sm" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium leading-tight">{user.name}</span>
                  <span className="nums truncate text-xs leading-tight text-text-tertiary">
                    {user.phone}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-40 flex h-16 items-center gap-3 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {pageTitle}
          </h1>
          <div className="ml-auto flex items-center gap-1.5">
            {user.isAdmin && (
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label={tc("search")}
                className="hidden items-center gap-2 rounded-[10px] border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:flex"
              >
                <Search className="size-4" />
                <span className="hidden md:inline">{tc("search")}</span>
                <kbd className="nums hidden rounded bg-surface-2 px-1.5 py-0.5 text-[10px] md:inline">
                  ⌘K
                </kbd>
              </button>
            )}
            {/* Mobil arama. Yukarıdaki çerçeveli tetikleyici `sm:flex` ile dar
                ekranda kalkıyor ve paletin TEK diğer girişi ⌘K kısayolu —
                dokunmatikte klavye olmadığı için komut paleti mobilde hiç
                açılamıyordu. Aynı state'i açan ikon buton, YALNIZ sm altında;
                masaüstünde render edilmez. */}
            {user.isAdmin && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="sm:hidden"
                aria-label={tc("search")}
                onClick={() => setPaletteOpen(true)}
              >
                <Search className="size-[18px]" />
              </Button>
            )}
            <Clock />
            <OfflineBadge />
            <HelpToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tc("language")}
              onClick={flipLocale}
              disabled={localePending}
            >
              <Globe className="size-[18px]" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tc("logout")}
              onClick={() => logoutRef.current?.requestSubmit()}
              className="text-muted-foreground hover:text-destructive"
            >
              <LogOut className="size-[18px]" />
            </Button>
          </div>
        </header>

        <main className="flex-1 page-enter">{children}</main>

        {user.isAdmin && (
          <CommandPalette
            pages={navItems.map((i) => ({ label: i.label, href: i.href, icon: i.icon }))}
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
          />
        )}

        <footer className="border-t border-border px-4 py-3 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-1 text-xs text-text-tertiary sm:flex-row">
            <span>© {new Date().getFullYear()} HAK61 GmbH</span>
            <span className="nums">v2.0.0</span>
          </div>
        </footer>
      </div>

      <form ref={logoutRef} action={logoutAction} className="hidden" />
    </div>
    </HelpProvider>
  );
}
