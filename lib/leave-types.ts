/**
 * İZİN TÜRLERİ — TEK KAYNAK (Modül 1).
 *
 * Renk, DB CHECK listesi, UI seçici, kısa hücre kodu ve Almanca AZG etiketi
 * hepsi buradan türer (FLEET_STYLE / AZG_REF deseni gibi ikinci kaynak yok).
 *
 * Taksonomi Avusturya resmi kaynaklarından doğrulandı (usp.gv.at, wko.at,
 * arbeiterkammer.at). Gün sayıları KODA GÖMÜLMEZ: Dienstverhinderung günleri
 * nakliye Kollektivvertrag'ında belirlenir; takvim yalnız İŞARETLER.
 *
 * Renkler kullanıcı eşlemesi (yıllık=mavi, raporlu=yeşil, hasta bakım=turuncu,
 * ücretsiz=kırmızı, düğün=mor) + erişilebilir ek tonlar. Anlam renge TEK BAŞINA
 * yüklenmez: hücrede `short` kodu + tooltip + lejant birlikte kullanılır
 * (WCAG 1.4.1).
 */

export type LeaveTypeKey =
  | "jahresurlaub"
  | "krankenstand"
  | "pflegefreistellung"
  | "unbezahlt"
  | "hochzeit"
  | "sonderurlaub"
  | "todesfall"
  | "umzug"
  | "geburt"
  | "karenz";

/** Onay akışı durumu (migration 031). pending = şef talebi (silik). */
export type LeaveStatus = "pending" | "approved" | "rejected";

/** Faz-2 AZG "Abwesenheiten" bölümü için kova. */
export type AzgAbsenceCategory =
  | "Urlaub"
  | "Krankenstand"
  | "Pflegefreistellung"
  | "Sonstige Abwesenheit";

export type LeaveTypeDef = {
  key: LeaveTypeKey;
  /** Almanca resmî ad — AZG/PDF için (sabit Almanca kuralı). */
  de: string;
  /** Türkçe UI etiketi. */
  tr: string;
  /** Izgara hücresi kısa kodu (renk tek taşıyıcı olmasın diye). */
  short: string;
  /** Hücre zemin rengi (hex). Metin beyaz — tonlar yeterince koyu. */
  color: string;
  /** Ücretli mi (UI rozeti + Faz-2 rapor notu). */
  paid: boolean;
  /** Yasal dayanak kısa etiketi. */
  legal: string;
  /** Faz-2 AZG kovası. */
  azgCategory: AzgAbsenceCategory;
  /** Faz-1 seçicide "Yaygın" grubunda mı (kullanıcının 5 çekirdeği). */
  common: boolean;
  /** Uzun süreli (Karenz/Familienzeit) — gün ızgarasında taralı, ayrı ele alınır. */
  longTerm?: boolean;
};

export const LEAVE_TYPES: LeaveTypeDef[] = [
  { key: "jahresurlaub",       de: "Urlaub",              tr: "Yıllık izin",        short: "U",  color: "#2563EB", paid: true,  legal: "UrlG §2/§4/§6",       azgCategory: "Urlaub",               common: true },
  { key: "krankenstand",       de: "Krankenstand",        tr: "Raporlu / hasta",    short: "K",  color: "#16A34A", paid: true,  legal: "§8 AngG · EFZG",      azgCategory: "Krankenstand",         common: true },
  { key: "pflegefreistellung", de: "Pflegefreistellung",  tr: "Hasta yakını bakımı",short: "P",  color: "#EA580C", paid: true,  legal: "UrlG §16",            azgCategory: "Pflegefreistellung",   common: true },
  { key: "unbezahlt",          de: "Unbezahlter Urlaub",  tr: "Ücretsiz izin",      short: "UB", color: "#DC2626", paid: false, legal: "Vereinbarung",        azgCategory: "Sonstige Abwesenheit", common: true },
  { key: "hochzeit",           de: "Eheschließung",       tr: "Düğün / evlilik",    short: "H",  color: "#7C3AED", paid: true,  legal: "§8/3 AngG · KV",      azgCategory: "Sonstige Abwesenheit", common: true },
  { key: "sonderurlaub",       de: "Dienstverhinderung",  tr: "Mazeret izni",       short: "D",  color: "#0891B2", paid: true,  legal: "§8/3 AngG · §1154b ABGB", azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "todesfall",          de: "Todesfall",           tr: "Cenaze",             short: "T",  color: "#64748B", paid: true,  legal: "§8/3 AngG · KV",      azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "umzug",              de: "Wohnungswechsel",     tr: "Taşınma",            short: "UM", color: "#B45309", paid: true,  legal: "§8/3 AngG · KV",      azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "geburt",             de: "Geburt",              tr: "Eşin doğumu",        short: "G",  color: "#DB2777", paid: true,  legal: "§8/3 AngG · KV",      azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "karenz",             de: "Karenz / Familienzeit", tr: "Doğum/ebeveyn izni", short: "Ka", color: "#4338CA", paid: false, legal: "MSchG/VKG · FamZeitbG", azgCategory: "Sonstige Abwesenheit", common: false, longTerm: true },
];

export const LEAVE_TYPE_KEYS: LeaveTypeKey[] = LEAVE_TYPES.map((t) => t.key);

const BY_KEY = new Map<string, LeaveTypeDef>(LEAVE_TYPES.map((t) => [t.key, t]));

/** Bilinmeyen anahtar için güvenli fallback (bozuk veri UI'ı çökertmesin). */
export function leaveTypeDef(key: string): LeaveTypeDef {
  return (
    BY_KEY.get(key) ?? {
      key: "sonderurlaub",
      de: key,
      tr: key,
      short: "?",
      color: "#64748B",
      paid: false,
      legal: "",
      azgCategory: "Sonstige Abwesenheit",
      common: false,
    }
  );
}

export function isLeaveTypeKey(v: unknown): v is LeaveTypeKey {
  return typeof v === "string" && BY_KEY.has(v);
}
