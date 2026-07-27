import { HelpTip } from "@/components/help/HelpTip";
import { cn } from "@/lib/utils";

/**
 * Sayfa gövdesi başlığı (DESIGN-SYSTEM §7). h1 DashboardShell topbar'ındadır —
 * burada h2 kullanılır; çift h1 sorunu böyle kapanır. Sağda TEK birincil
 * aksiyon slotu (İlke 4: ekran başına bir birincil eylem).
 *
 * `help` (27.07.2026): başlığın yanında (i). Sayfanın NE İŞE YARADIĞINI
 * söyleyen tek yer burasıdır — açıklama satırı kısa kalmak zorunda, balon
 * uzun anlatabilir.
 */
export function PageHeader({
  title,
  description,
  help,
  action,
  className,
}: {
  title: string;
  description?: string;
  /** "help" i18n uzayındaki anahtar; verilirse başlığın yanında (i) çıkar. */
  help?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
          {title}
          {help && <HelpTip tkey={help} />}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
