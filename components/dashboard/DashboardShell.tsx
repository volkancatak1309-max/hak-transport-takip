"use client";

import Link from "next/link";
import { setWatermarkUser } from "@/lib/pdf-watermark-user";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Archive,
  ArrowLeft,
  LayoutDashboard,
  MapPinned,
  Route,
  Truck,
  Users,
  Fuel,
  Receipt,
  Hexagon,
  Siren,
  Wrench,
  CalendarCheck,
  ClipboardCheck,
  Award,
  Euro,
  Leaf,
  BarChart3,
  FileBarChart,
  CalendarOff,
  LogOut,
  Menu,
  X,
  Globe,
  Search,
  type LucideIcon,
  ShieldCheck,
  MessageSquare,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/ui-v2/CommandPalette";
import { BrandLogo } from "@/components/BrandLogo";
import { UserAvatar } from "@/components/UserAvatar";
import { OfflineBadge } from "@/components/OfflineBadge";
import { HelpProvider } from "@/components/help/HelpProvider";
import { HelpToggle } from "@/components/help/HelpToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { exitShadowAction } from "@/app/actions/shadow";
import { setLocaleAction } from "@/app/actions/preferences";
import { FUEL_ENABLED, EXPENSE_ENABLED, LEAVES_ENABLED } from "@/lib/features";
import { DRIVER_PANEL_ENABLED, ADMIN_DRIVER_PANEL_LINK } from "@/lib/tenant";
import { brandCopyright } from "@/lib/brand";
import { TENANT_TZ } from "@/lib/tz";

export type HeaderUser = {
  id: string;
  name: string;
  phone: string;
  isAdmin: boolean;
  /**
   * Patron kademesi (migration 045). YALNIZ /admin/guvenlik menü ögesini
   * gösterir; sayfanın kendisi requireOwner() ile ayrıca korunur — menüyü
   * gizlemek kozmetiktir, yetkiyi kapı verir.
   */
  isOwner?: boolean;
  /**
   * GÖLGE MODU (dalga 3) — patron bu kişinin gözünden bakıyorsa ONUN ADI.
   *
   * Ad oturumda taşınıyor (session.shadow_name), her sayfada ayrı bir sorguyla
   * çözülmüyor: şerit 20 yüzeyde birden görünüyor ve her biri için bir okuma
   * eklemek, salt görsel bir uyarı için ölçülebilir bir maliyet olurdu.
   */
  shadowOf?: string | null;
  /**
   * Filo sefi ise yonettigi filo (migration 029); degilse null/undefined.
   * isAdmin ile BIRLIKTE kullanilmaz: sef isAdmin=false'tur.
   */
  managedFleet?: string | null;
  /**
   * Hesabın YÖNETİCİ YETKİSİ var mı? `isAdmin`den ayrıdır: `isAdmin` "yönetici
   * KABUĞUNU çiz" demektir (menü, komut paleti). Yönetici şoför panelindeyken
   * diğer şoförlerle AYNI ekranı görmeli, yani orada `isAdmin=false` geçilir —
   * ama üst çubuktaki "Filo Yönetimi" dönüş bağlantısı yine de çıkmalıdır.
   * Bu bayrak tam olarak o farkı taşır. Filo şefinde kullanılmaz (o `isChief`).
   */
  adminAccount?: boolean;
};

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Live Vienna clock for the topbar. Mounts client-side to avoid hydration drift. */
function Clock() {
  const locale = useLocale();
  const [time, setTime] = useState<string>("");
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString(locale === "de" ? "de-AT" : "tr-TR", {
        timeZone: TENANT_TZ,
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
  // PDF filigranı istemcide üretiliyor ve React ağacının dışından çağrılıyor;
  // adı burada bir kez yazıyoruz (bkz. lib/pdf-watermark-user.ts).
  setWatermarkUser(user?.name ?? null);
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [localePending, startLocale] = useTransition();
  const logoutRef = useRef<HTMLFormElement>(null);

  // UC MOD: patron (tam menu) / filo sefi (2 buton + panele donus) /
  // sofor (panel menusu). Sefin menusu KISITLI DEGIL, KAPSAMLI: gormedigi
  // sayfalar zaten requireAdmin() ile sunucu tarafinda kapali.
  const isChief = !user.isAdmin && !!user.managedFleet;
  const onAdminSide = pathname.startsWith("/admin");
  /**
   * YÖNETİCİ ↔ ŞOFÖR PANELİ GEÇİŞİ (03.08.2026). Filo şefinin migration
   * 029'dan beri kullandığı geçişin AYNISI; yalnız kime görüneceği genişliyor.
   * Üç koşul birden: kiracı ayarı açık + şoför paneli açık + hesap yönetici.
   * HAK61 varsayılanı kapalı → orada üst çubuk aynen bugünkü gibi kalır.
   */
  const isAdminAccount = user.isAdmin || !!user.adminAccount;
  const showAdminPanelToggle =
    ADMIN_DRIVER_PANEL_LINK && DRIVER_PANEL_ENABLED && isAdminAccount;
  const navItems: NavItem[] = isChief
    ? [
        { href: "/admin", label: t("admin"), icon: LayoutDashboard },
        // Şef de görür ama KAPSAMLI: kendi filosu dışındaki kalem sunucudan
        // hiç çıkmıyor (app/actions/haftalik-aksiyon.ts).
        { href: "/admin/haftalik", label: t("weekly"), icon: ClipboardCheck },
        { href: "/admin/karlilik", label: t("profitability"), icon: Euro },
        { href: "/admin/mevzuat", label: t("compliance"), icon: ShieldCheck },
        { href: "/admin/odul", label: t("recognition"), icon: Award },
        { href: "/admin/co2", label: t("co2"), icon: Leaf },
        { href: "/admin/harita", label: t("map"), icon: MapPinned },
        // İş emirleri şefe AÇIK (081): aracı servise o gönderiyor. Kapsam
        // eylem katmanında ARAÇ ekseninde uygulanıyor, menü onu daraltmıyor.
        { href: "/admin/is-emirleri", label: t("workOrders"), icon: Wrench },
        // İzinler: şef kendi filosunun izin TALEBİNİ açar (onay patronda).
        // /admin ve /admin/harita'dan sonra şefe açılan ÜÇÜNCÜ sayfa —
        // bilinçli; yazma sunucuda scope.isFleetWorker ile korunuyor.
        ...(LEAVES_ENABLED
          ? [{ href: "/admin/izinler", label: t("leaves"), icon: CalendarOff }]
          : []),
        // Şoför paneli kapalı müşteride (Sendigo) /panel yok — şefi var olmayan
        // bir sayfaya gönderen bir bağlantı bırakılmaz.
        ...(DRIVER_PANEL_ENABLED
          ? [{ href: "/panel", label: t("backToPanel"), icon: ArrowLeft }]
          : []),
      ]
    : user.isAdmin
    ? [
        { href: "/admin", label: t("admin"), icon: LayoutDashboard },
        // HAFTALIK AKSİYON (084) — /admin'in hemen ardında, bilinçli.
        // /admin GÜNÜN panosu ("bugün ne var"), bu HAFTANIN yorumu
        // ("bu hafta ne yap"). İkisi aynı aile, farklı zaman ölçeği.
        { href: "/admin/haftalik", label: t("weekly"), icon: ClipboardCheck },
        { href: "/admin/karlilik", label: t("profitability"), icon: Euro },
        { href: "/admin/mevzuat", label: t("compliance"), icon: ShieldCheck },
        { href: "/admin/odul", label: t("recognition"), icon: Award },
        { href: "/admin/co2", label: t("co2"), icon: Leaf },
        { href: "/admin/harita", label: t("map"), icon: MapPinned },
        { href: "/admin/araclar", label: t("vehicles"), icon: Truck },
        // İŞ EMİRLERİ + BAKIM (081): Araçlar'ın hemen ardında, bilinçli.
        // İkisi de ARAÇ ekseninde ve aracın "sorunlu mu / servise ne zaman"
        // sorusunu yanıtlıyor; Alarmlar sürüş davranışı ekseni, ayrı aile.
        { href: "/admin/is-emirleri", label: t("workOrders"), icon: Wrench },
        { href: "/admin/bakim", label: t("maintenance"), icon: CalendarCheck },
        { href: "/admin/alarmlar", label: t("alarms"), icon: Siren },
        { href: "/admin/analiz", label: t("analytics"), icon: BarChart3 },
        { href: "/admin/raporlar", label: t("reports"), icon: FileBarChart },
        { href: "/admin/bolgeler", label: t("zones"), icon: Hexagon },
        { href: "/admin/seferler", label: t("assignments"), icon: Route },
        { href: "/admin/mesajlar", label: t("messages"), icon: MessageSquare },
        ...(FUEL_ENABLED ? [{ href: "/admin/yakit", label: t("fuel"), icon: Fuel }] : []),
        ...(EXPENSE_ENABLED
          ? [{ href: "/admin/masraflar", label: t("expenses"), icon: Receipt }]
          : []),
        { href: "/admin/workers", label: t("workers"), icon: Users },
        ...(LEAVES_ENABLED
          ? [{ href: "/admin/izinler", label: t("leaves"), icon: CalendarOff }]
          : []),
        // AYARLAR (23.08.2026) — kiracının kendi maliyet oranlarını girdiği yer.
        // Bayrak YOK ve olmayacak: ayar ekranı bir modül değil, ürünün kendi
        // kurulum yüzeyi. Şefe gösterilmez (yönetici listesinde, şef listesinde
        // değil) — oranlar FİLONUN TAMAMININ €/km'sini oynatır, şefin kapsamı
        // ise tek filo (bkz. app/actions/cost-rates.ts).
        { href: "/admin/ayarlar", label: t("settings"), icon: SlidersHorizontal },
        // SAKLAMA POLİTİKASI (090) — Ayarlar'ın hemen ardında ama AYRI kalem.
        // Bir AYAR değil bir BEYAN: dışarıya (müşteriye, iş müfettişliğine)
        // gösterilecek sayı ve gerekçesi burada. Ayarlar içindeki bir satır
        // olsaydı, denetimde "politikanız nerede yazılı" sorusunun cevabı bir
        // alt sekme olurdu. Şefe KAPALI — süre tüm filonun beyanını değiştirir.
        { href: "/admin/saklama", label: t("retention"), icon: Archive },
        ...(user.isOwner
          ? [{ href: "/admin/guvenlik", label: t("security"), icon: ShieldCheck }]
          : []),
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

  /**
   * Nav bağlantıları — HER ZAMAN koyu ray üstünde çizilir (açık temada da).
   * Bu yüzden renkler tema token'larından (foreground/surface-2) değil, NAV
   * token'larından gelir; aksi halde açık temada koyu ray üstüne koyu metin düşerdi.
   * Aktif durum: mercan metin + mercan %12 zemin + sol mercan çizgi
   * (DESIGN.md §5). Eski `nav-active` bordo→mavi gradyanı kilit gereği kalktı.
   */
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
                ? "bg-accent-coral-soft text-accent-coral"
                : "text-nav-muted hover:bg-white/[0.06] hover:text-nav-foreground"
            )}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent-coral" />
            )}
            <Icon className="size-[18px] shrink-0" />
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
    {/* GÖLGE ŞERİDİ — sayfanın en üstünde ve KALICI (dalga 3).
        Gölge modunda olduğunu unutan bir patron, gördüğü eksik listeyi gerçek
        sanar ("kadroda neden ben yokum?") ve yanlış karar verir. Bu yüzden bir
        kez gösterilip kaybolan bildirim DEĞİL, sürekli duran bir şerit.
        Çıkış her sayfadan tek tıkla erişilebilir: gölgeden çıkamamak paneli
        yarı kullanılamaz bırakırdı. */}
    {user.shadowOf && (
      <form
        action={exitShadowAction}
        className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-status-critical-fill px-4 py-2 text-sm text-white"
      >
        <span>
          <strong>GÖLGE MODU</strong> — {user.shadowOf} olarak görüntülüyorsun ·
          salt okuma
        </span>
        <button type="submit" className="underline underline-offset-2">
          Çık
        </button>
      </form>
    )}
    <div className="flex min-h-screen bg-background text-foreground">
      {/* YÜZEN NAV RAYI (DESIGN.md §5 — birincil referans Runey'in imza öğesi).
          Kenara yapışık değil: her yanından 12px içeride, 20px köşeli, koyu yüzey.
          AÇIK TEMADA DA KOYU kalır — imza budur, tema ile değişmez.
          Yükseklik = ekran - 24px (üst+alt boşluk), sticky. */}
      <aside
        className={cn(
          "sticky top-3 my-3 ml-3 hidden h-[calc(100vh-1.5rem)] w-[248px] shrink-0 flex-col",
          "rounded-[20px] bg-nav-surface text-nav-foreground lg:flex"
        )}
      >
        <div className="flex h-16 items-center px-5">
          <Link href={user.isAdmin || isChief ? "/admin" : "/panel"} className="flex items-center">
            <BrandLogo height={38} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks />
        </div>
        {/* Ayraç ray içinde: tema kenarlığı değil, beyazın düşük opaklığı. */}
        <div className="border-t border-white/[0.08] p-3">
          <div className="flex items-center gap-3 rounded-[10px] px-2 py-2">
            <UserAvatar name={user.name} size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium leading-tight">{user.name}</span>
              <span className="nums truncate text-xs leading-tight text-nav-muted">
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
          {/* Mobil çekmece — masaüstü rayının aynı dili: koyu yüzey, aynı nav
              token'ları. Sağ köşeleri yuvarlak (sol kenara yaslı çekmece). */}
          <div
            className={cn(
              "absolute left-0 top-0 flex h-full w-[260px] flex-col page-enter",
              "rounded-r-[20px] bg-nav-surface text-nav-foreground"
            )}
          >
            <div className="flex h-16 items-center justify-between px-5">
              <BrandLogo height={38} />
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-nav-muted hover:bg-white/[0.06] hover:text-nav-foreground"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-white/[0.08] p-3">
              <div className="flex items-center gap-3 px-2 py-2">
                <UserAvatar name={user.name} size="sm" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium leading-tight">{user.name}</span>
                  <span className="nums truncate text-xs leading-tight text-nav-muted">
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
            {/* FILO SEFI GECISI (migration 029). Sef gunun buyuk kismini
                sofor panelinde gecirir; yonetim gorunumu ikincil is.
                Panelde "Filo Yonetimi", yonetim tarafinda "Panelime don".
                Bordo aksan, yeni renk yok. */}
            {(isChief || showAdminPanelToggle) && (
              <Link
                href={onAdminSide ? "/panel" : "/admin"}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-accent-claret/40 px-2.5 py-1.5 text-xs font-medium text-accent-claret-text transition-colors hover:bg-accent-claret/10"
              >
                {onAdminSide ? (
                  isChief ? (
                    <ArrowLeft className="size-4" aria-hidden />
                  ) : (
                    /* Yonetici icin bu bir DONUS degil, GIDIS: sefin
                       "panelime don" oku yerine surus ikonu. */
                    <Truck className="size-4" aria-hidden />
                  )
                ) : (
                  <LayoutDashboard className="size-4" aria-hidden />
                )}
                <span className="hidden sm:inline">
                  {onAdminSide
                    ? isChief
                      ? t("backToPanel")
                      : t("driverPanel")
                    : t("fleetAdmin")}
                </span>
              </Link>
            )}
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
            {/* TEMA DÜĞMESİ (26.07.2026): bileşen 21.07'den beri vardı ama YALNIZ
                giriş ve PIN sayfalarında render ediliyordu — panelin tamamı
                (yönetici + şoför) kabuğu buradan aldığı için tema değiştirilemiyordu.
                Koyu tema zorunluyken (forcedTheme) fark edilmemişti; açık tema
                varsayılan olunca eksiklik görünür hale geldi. */}
            <ThemeToggle />
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
            <span>{brandCopyright(new Date().getFullYear())}</span>
            <span className="nums">v2.0.0</span>
          </div>
        </footer>
      </div>

      <form ref={logoutRef} action={logoutAction} className="hidden" />
    </div>
    </HelpProvider>
  );
}
