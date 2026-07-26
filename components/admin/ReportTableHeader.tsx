import { HelpTip } from "@/components/help/HelpTip";

/**
 * Rapor tablosunun üst satırı — sol mikro etiket + yardım, sağ eylem yuvası.
 *
 * Etiket kasıtlı olarak KÜÇÜK: Resend'de tablo başlığı sayfanın rakamlarıyla
 * yarışmaz, yalnız altındaki bloğu adlandırır. Dört rapor sayfasının dördü de
 * aynı satırı elle kuruyordu ve hizası/boyutu birbirini tutmuyordu.
 */
export function ReportTableHeader({
  label,
  tkey,
  actions,
}: {
  label: string;
  /** HelpTip anahtarı (ör. "rep_speed_table"). */
  tkey: string;
  /** Dışa aktarım düğmeleri. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">
          {label}
        </span>
        <HelpTip tkey={tkey} />
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
