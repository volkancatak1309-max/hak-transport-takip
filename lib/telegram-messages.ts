import "server-only";
import { BRAND } from "@/lib/brand";

// Notification bodies (HTML parse_mode). Each is rendered in the recipient's
// language; legal terms (AZG § 9, VO 561/2006) stay as-is.
//
// Mesaj başlığındaki marka adı lib/brand.ts'ten gelir (31.07.2026): bu dosyada
// 20 yerde düz metin yazılıydı ve ikinci müşteride hepsi tek tek aranacaktı.

type Loc = "tr" | "de";
const L = (locale: string | null | undefined): Loc => (locale === "de" ? "de" : "tr");

// Escape values that go inside HTML (driver names, plates).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Uzun süredir açık vardiya uyarısı → yöneticiler.
 *
 * ŞU AN ÇAĞRILMIYOR (ölü kod, 22.07.2026). Metni yine de düzeltildi: içindeki
 * "AZG § 9: maksimum 10 saat" ifadesi YANLIŞTI — § 9 Abs. 1'e göre günlük
 * tavan 12 saat, gece çalışması yapılan günde § 14 Abs. 2'ye göre 10 saattir.
 * Yanlış hukuki iddianın kod tabanında durmasına gerek yok. Yeniden
 * kullanılacaksa eşik lib/azg-rules.ts'ten okunmalı.
 */
export function nineHourMessage(
  locale: string | null,
  p: { name: string; plate: string; hours: string }
): string {
  const name = esc(p.name);
  const plate = esc(p.plate);
  if (L(locale) === "de") {
    return (
      `🚨 ${BRAND.name}\n\n` +
      `<b>${name}</b> (${plate}) <b>${p.hours}</b> Stunden aktiv.\n\n` +
      "AZG § 9 Abs. 1: höchstens 12 Stunden täglich (bei Nachtarbeit 10).\n" +
      "Bitte mit dem Fahrer Kontakt aufnehmen."
    );
  }
  return (
    `🚨 ${BRAND.name}\n\n` +
    `<b>${name}</b> (${plate}) <b>${p.hours}</b> saattir aktif.\n\n` +
    "AZG § 9 Abs. 1: günlük en fazla 12 saat (gece çalışmasında 10).\n" +
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
      `🟢 ${BRAND.name}\n\n` +
      `<b>${name}</b> (${plate}) hat die Schicht begonnen.\n` +
      `🕐 Uhrzeit: <b>${p.time}</b>`
    );
  }
  return (
    `🟢 ${BRAND.name}\n\n` +
    `<b>${name}</b> (${plate}) vardiyayı başlattı.\n` +
    `🕐 Saat: <b>${p.time}</b>`
  );
}

/** Auto shift-start (ignition) alert → admins. */
export function autoShiftStartedAdminMessage(
  locale: string | null,
  p: { name: string; plate: string; time: string }
): string {
  const name = esc(p.name);
  const plate = esc(p.plate);
  if (L(locale) === "de") {
    return (
      `🟢 ${BRAND.name}\n\n` +
      `Zündung an: Schicht von <b>${name}</b> (${plate}) wurde automatisch gestartet.\n` +
      `🕐 Uhrzeit: <b>${p.time}</b>\n` +
      "Bestätigung des Fahrers steht noch aus."
    );
  }
  return (
    `🟢 ${BRAND.name}\n\n` +
    `Kontak açıldı: <b>${name}</b> (${plate}) vardiyası otomatik başlatıldı.\n` +
    `🕐 Saat: <b>${p.time}</b>\n` +
    "Şoför onayı bekleniyor."
  );
}

/** Auto shift-start → driver: please confirm in the panel. */
export function autoShiftStartedDriverMessage(
  locale: string | null,
  p: { plate: string; time: string }
): string {
  const plate = esc(p.plate);
  if (L(locale) === "de") {
    return (
      "🟢 <b>Schicht gestartet</b>\n\n" +
      `Zündung an (${plate}) — deine Schicht läuft seit <b>${p.time}</b>.\n` +
      `Bitte im Panel mit einem Tipp bestätigen.\n<i>${BRAND.name}</i>`
    );
  }
  return (
    "🟢 <b>Vardiyan başladı</b>\n\n" +
    `Kontak açıldı (${plate}) — vardiyan <b>${p.time}</b> itibarıyla başladı.\n` +
    `Lütfen panelden tek dokunuşla onayla.\n<i>${BRAND.name}</i>`
  );
}

/** One-tap driver problem report → admins. */
export function driverReportMessage(
  locale: string | null,
  p: { name: string; plate: string; type: string }
): string {
  const name = esc(p.name);
  const plate = esc(p.plate);
  const typesTr: Record<string, string> = {
    vehicle_fault: "Araç Arızası",
    address_issue: "Adres Sorunu",
    damaged_package: "Hasarlı Paket",
    other: "Diğer",
  };
  const typesDe: Record<string, string> = {
    vehicle_fault: "Fahrzeugdefekt",
    address_issue: "Adressproblem",
    damaged_package: "Beschädigtes Paket",
    other: "Sonstiges",
  };
  if (L(locale) === "de") {
    const label = typesDe[p.type] ?? p.type;
    return (
      `⚠️ ${BRAND.name} — <b>Fahrermeldung</b>\n\n` +
      `<b>${name}</b> (${plate}) meldet: <b>${esc(label)}</b>\n` +
      "Details im Admin-Panel."
    );
  }
  const label = typesTr[p.type] ?? p.type;
  return (
    `⚠️ ${BRAND.name} — <b>Şoför Bildirimi</b>\n\n` +
    `<b>${name}</b> (${plate}) bildirdi: <b>${esc(label)}</b>\n` +
    "Detaylar yönetici panelinde."
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
      `Gute Arbeit 👋\n<i>${BRAND.name}</i>`
    );
  }
  return (
    "✅ <b>Vardiya Tamamlandı</b>\n\n" +
    `⏱ Çalışma: <b>${p.hours}</b>\n` +
    `🚚 Kilometre: <b>${p.km}</b> km\n` +
    `📦 Kargo: <b>${p.cargo}</b>\n` +
    `☕ Mola: <b>${p.breakMin}</b> dk\n\n` +
    `İyi çalışmalar 👋\n<i>${BRAND.name}</i>`
  );
}

/**
 * "Is your shift still active?" prompt → driver, for a shift that has been open
 * unusually long. Paired with inline [Yes]/[No] buttons (see stillActiveLabels).
 */
export function stillActiveMessage(
  locale: string | null,
  p: { hours: string }
): string {
  if (L(locale) === "de") {
    return (
      `⏳ <b>${BRAND.name}</b>\n\n` +
      `Deine Schicht ist seit <b>${p.hours}</b> Stunden offen.\n` +
      "Ist deine Schicht noch aktiv?"
    );
  }
  return (
    `⏳ <b>${BRAND.name}</b>\n\n` +
    `Vardiyan <b>${p.hours}</b> saattir açık.\n` +
    "Vardiyan hâlâ devam ediyor mu?"
  );
}

/** Inline button labels for the "still active?" prompt. */
export function stillActiveLabels(locale: string | null): { yes: string; no: string } {
  return L(locale) === "de"
    ? { yes: "✅ Ja, läuft", no: "🔴 Nein, beendet" }
    : { yes: "✅ Evet, devam", no: "🔴 Hayır, bitti" };
}

/** Driver tapped "Yes, still going" → acknowledge, we'll re-ask in 1 hour. */
export function stillActiveConfirmedMessage(locale: string | null): string {
  if (L(locale) === "de") {
    return "👍 Danke! Schicht läuft weiter. Ich frage in 1 Stunde erneut.";
  }
  return "👍 Teşekkürler! Vardiya devam ediyor. 1 saat sonra tekrar soracağım.";
}

/** Driver tapped "No, finished" → the shift was closed for them. */
export function shiftClosedByWatchdogMessage(locale: string | null): string {
  if (L(locale) === "de") {
    return (
      "✅ <b>Schicht beendet</b>\n\n" +
      `Deine offene Schicht wurde geschlossen. Bitte Kilometer/Fracht bei Bedarf im Panel nachtragen.\n<i>${BRAND.name}</i>`
    );
  }
  return (
    "✅ <b>Vardiya kapatıldı</b>\n\n" +
    `Açık kalan vardiyan kapatıldı. Gerekirse km/kargo bilgisini panelden tamamlayabilirsin.\n<i>${BRAND.name}</i>`
  );
}

/** Long-open shift whose driver isn't reachable on Telegram → admins. */
export function longShiftUnreachableMessage(
  locale: string | null,
  p: { name: string; plate: string; hours: string }
): string {
  const name = esc(p.name);
  const plate = esc(p.plate);
  if (L(locale) === "de") {
    return (
      `⚠️ ${BRAND.name}\n\n` +
      `<b>${name}</b> (${plate}) hat eine seit <b>${p.hours}</b> Std offene Schicht ` +
      "und ist nicht per Telegram erreichbar.\n" +
      "Bitte prüfen / Schicht im Panel schließen."
    );
  }
  return (
    `⚠️ ${BRAND.name}\n\n` +
    `<b>${name}</b> (${plate}) <b>${p.hours}</b> saattir açık bir vardiyaya sahip ` +
    "ve Telegram'dan ulaşılamıyor.\n" +
    "Lütfen kontrol edin / vardiyayı panelden kapatın."
  );
}

/** Lenkzeit 4.5h warning → driver. */
export function lenkzeitMessage(locale: string | null): string {
  if (L(locale) === "de") {
    return (
      "⚠️ <b>Lenkzeit-Warnung</b>\n\n" +
      "4,5 Stunden Fahrt absolviert. <b>45 Min Pause</b> erforderlich.\n\n" +
      `VO (EG) 561/2006\n<i>${BRAND.name}</i>`
    );
  }
  return (
    "⚠️ <b>Lenkzeit Uyarısı</b>\n\n" +
    "4.5 saat sürüş tamamlandı. <b>45 dk mola</b> yapma zamanı.\n\n" +
    `EU 561/2006\n<i>${BRAND.name}</i>`
  );
}
