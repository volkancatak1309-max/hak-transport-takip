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
 * GÖRSEL EKSEN — RENK DEĞİL, DESEN + TON (27.07.2026 kararı).
 *
 * Eski sürümde her türün kendi hex rengi vardı (10 renk). İki kuralı birden
 * çiğniyordu: DESIGN.md §2.5 "5+ renkli kategorik palet yasak" ve §2.3 —
 * yıllık izin `#2563EB` ile MAVİ FİLO kimliğine, ücretsiz izin `#DC2626` ile
 * KRİTİK durum rengine biniyordu. Filo renkleri araç kimliği taşır; izin
 * türü bir zaman aralığıdır, ikisi aynı palete giremez.
 *
 * Yeni eksen iki katmanlı:
 *   • TON     — accent (mercan ailesi) / neutral (gri). İzin ÜCRETLİ çekirdek
 *               mi yoksa diğer/ücretsiz mi, tek bakışta.
 *   • DESEN   — solid / hatch / dots / dashed. Kategoriyi taşır.
 * Kesin türü ise hücredeki `short` kodu + tooltip + lejant söyler (WCAG 1.4.1).
 * Yani renk hiçbir zaman tek taşıyıcı değil — üç kanal var.
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

/** Hücre tonu — token'a bağlanır, hex yazılmaz (DESIGN.md §8/1). */
export type LeaveTone = "accent" | "neutral";
/** Hücre deseni — kategori taşıyıcısı. */
export type LeavePattern = "solid" | "hatch" | "dots" | "dashed";

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
  /** Ton — mercan ailesi mi nötr mü (DESIGN.md §2.2). Hex YOK: token'dan gelir. */
  tone: LeaveTone;
  /** Desen — kategoriyi taşır; renk tek taşıyıcı olmasın diye. */
  pattern: LeavePattern;
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
  { key: "jahresurlaub",       de: "Urlaub",              tr: "Yıllık izin",         short: "U",  tone: "accent",  pattern: "solid",  paid: true,  legal: "UrlG §2/§4/§6",           azgCategory: "Urlaub",               common: true },
  { key: "krankenstand",       de: "Krankenstand",        tr: "Raporlu / hasta",     short: "K",  tone: "accent",  pattern: "hatch",  paid: true,  legal: "§8 AngG · EFZG",          azgCategory: "Krankenstand",         common: true },
  { key: "pflegefreistellung", de: "Pflegefreistellung",  tr: "Hasta yakını bakımı", short: "P",  tone: "accent",  pattern: "dots",   paid: true,  legal: "UrlG §16",                azgCategory: "Pflegefreistellung",   common: true },
  { key: "unbezahlt",          de: "Unbezahlter Urlaub",  tr: "Ücretsiz izin",       short: "UB", tone: "neutral", pattern: "dashed", paid: false, legal: "Vereinbarung",            azgCategory: "Sonstige Abwesenheit", common: true },
  { key: "hochzeit",           de: "Eheschließung",       tr: "Düğün / evlilik",     short: "H",  tone: "neutral", pattern: "solid",  paid: true,  legal: "§8/3 AngG · KV",          azgCategory: "Sonstige Abwesenheit", common: true },
  { key: "sonderurlaub",       de: "Dienstverhinderung",  tr: "Mazeret izni",        short: "D",  tone: "neutral", pattern: "solid",  paid: true,  legal: "§8/3 AngG · §1154b ABGB", azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "todesfall",          de: "Todesfall",           tr: "Cenaze",              short: "T",  tone: "neutral", pattern: "hatch",  paid: true,  legal: "§8/3 AngG · KV",          azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "umzug",              de: "Wohnungswechsel",     tr: "Taşınma",             short: "UM", tone: "neutral", pattern: "dots",   paid: true,  legal: "§8/3 AngG · KV",          azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "geburt",             de: "Geburt",              tr: "Eşin doğumu",         short: "G",  tone: "neutral", pattern: "solid",  paid: true,  legal: "§8/3 AngG · KV",          azgCategory: "Sonstige Abwesenheit", common: false },
  { key: "karenz",             de: "Karenz / Familienzeit", tr: "Doğum/ebeveyn izni", short: "Ka", tone: "neutral", pattern: "dashed", paid: false, legal: "MSchG/VKG · FamZeitbG",  azgCategory: "Sonstige Abwesenheit", common: false, longTerm: true },
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
      tone: "neutral",
      pattern: "solid",
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
