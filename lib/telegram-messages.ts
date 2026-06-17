import "server-only";

// Notification bodies (HTML parse_mode). Each is rendered in the recipient's
// language; legal terms (AZG § 9, VO 561/2006) stay as-is.

type Loc = "tr" | "de";
const L = (locale: string | null | undefined): Loc => (locale === "de" ? "de" : "tr");

// Escape values that go inside HTML (driver names, plates).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 9-hour active-shift alert → admins. */
export function nineHourMessage(
  locale: string | null,
  p: { name: string; plate: string; hours: string }
): string {
  const name = esc(p.name);
  const plate = esc(p.plate);
  if (L(locale) === "de") {
    return (
      "🚨 HAK Transport\n\n" +
      `<b>${name}</b> (${plate}) <b>${p.hours}</b> Stunden aktiv.\n\n` +
      "AZG § 9: maximal 10 Stunden täglich.\n" +
      "Bitte mit dem Fahrer Kontakt aufnehmen."
    );
  }
  return (
    "🚨 HAK Transport\n\n" +
    `<b>${name}</b> (${plate}) <b>${p.hours}</b> saattir aktif.\n\n` +
    "AZG § 9: maksimum 10 saat günlük.\n" +
    "Lütfen şoförle iletişime geçin."
  );
}

/** Shift-started alert → admins. */
export function shiftStartedMessage(
  locale: string | null,
  p: { name: string; plate: string; time: string }
): string {
  const name = esc(p.name);
  const plate = esc(p.plate);
  if (L(locale) === "de") {
    return (
      "🟢 HAK Transport\n\n" +
      `<b>${name}</b> (${plate}) hat die Schicht begonnen.\n` +
      `🕐 Uhrzeit: <b>${p.time}</b>`
    );
  }
  return (
    "🟢 HAK Transport\n\n" +
    `<b>${name}</b> (${plate}) vardiyayı başlattı.\n` +
    `🕐 Saat: <b>${p.time}</b>`
  );
}

/** End-of-shift summary → driver. */
export function shiftSummaryMessage(
  locale: string | null,
  p: { hours: string; km: string; cargo: string; breakMin: string }
): string {
  if (L(locale) === "de") {
    return (
      "✅ <b>Schicht abgeschlossen</b>\n\n" +
      `⏱ Arbeit: <b>${p.hours}</b>\n` +
      `🚚 Kilometer: <b>${p.km}</b> km\n` +
      `📦 Fracht: <b>${p.cargo}</b>\n` +
      `☕ Pause: <b>${p.breakMin}</b> Min\n\n` +
      "Gute Arbeit 👋\n<i>HAK Transport</i>"
    );
  }
  return (
    "✅ <b>Vardiya Tamamlandı</b>\n\n" +
    `⏱ Çalışma: <b>${p.hours}</b>\n` +
    `🚚 Kilometre: <b>${p.km}</b> km\n` +
    `📦 Kargo: <b>${p.cargo}</b>\n` +
    `☕ Mola: <b>${p.breakMin}</b> dk\n\n` +
    "İyi çalışmalar 👋\n<i>HAK Transport</i>"
  );
}

/** Lenkzeit 4.5h warning → driver. */
export function lenkzeitMessage(locale: string | null): string {
  if (L(locale) === "de") {
    return (
      "⚠️ <b>Lenkzeit-Warnung</b>\n\n" +
      "4,5 Stunden Fahrt absolviert. <b>45 Min Pause</b> erforderlich.\n\n" +
      "VO (EG) 561/2006\n<i>HAK Transport</i>"
    );
  }
  return (
    "⚠️ <b>Lenkzeit Uyarısı</b>\n\n" +
    "4.5 saat sürüş tamamlandı. <b>45 dk mola</b> yapma zamanı.\n\n" +
    "EU 561/2006\n<i>HAK Transport</i>"
  );
}
