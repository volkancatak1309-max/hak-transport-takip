import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_SERVER } from "@/lib/pdf-server";
import {
  COMPANY,
  COMPANY_UID_LINE,
  COMPANY_EXTRA_LINE,
  BRAND_MARK,
} from "@/lib/report-de";
import type { AZGData, AZGSeverity } from "@/lib/azg-report";
import {
  WatermarkServer,
  FingerprintServer,
  fingerprintDocPropsServer,
} from "@/components/pdf/server/Chrome";

/**
 * § 26 AZG İHLAL RAPORU (PDF) — SUNUCU İKİZİ.
 *
 * ⚠️ RESMÎ EVRAK. Avusturya Arbeitsinspektorat'ına ibraz edilir. Buradaki her
 * Almanca dize, her § referansı ve her sütun genişliği
 * `components/pdf/AZGReport.tsx` ile BİREBİR AYNIDIR ve öyle kalmalıdır: aynı
 * ay için panelden ve mobilden alınan iki belge farklı görünemez, farklı madde
 * yazamaz. Metin katmanı karşılaştırmalı olarak doğrulanıyor
 * (scripts/verify-rapor-pdf-tur3.mjs) — göz kararı DEĞİL.
 *
 * ── NEDEN İKİZ, NEDEN ORTAK DOSYA DEĞİL ───────────────────────────────────
 * Panelin dosyası `"use client"`. Bir sunucu modülü ondan bileşen fonksiyonunu
 * DEĞİL, istemci referansını alır — react-pdf onu render edemez. Ortaklaştırmak
 * panelin canlı yolunu değiştirmeyi gerektirirdi. Gerekçe ve bedel
 * `components/pdf/server/Chrome.tsx` başlığında; ikizler panel de sunucu yoluna
 * geçtiği turda silinir.
 *
 * ── KİMLİK PROP, GLOBAL DEĞİL ─────────────────────────────────────────────
 * Filigran kullanıcısı ve parmak izi zorunlu prop — sunucuda modül globali
 * eşzamanlı istekler arasında sızar (ölçüm Chrome.tsx başlığında).
 */

const SEVERITY_DE: Record<AZGSeverity, string> = {
  warning: "Warnung",
  violation: "Verstoß",
  serious_violation: "Schwerer Verstoß",
};

const SEVERITY_TR: Record<AZGSeverity, string> = {
  warning: "Uyarı",
  violation: "İhlal",
  serious_violation: "Ağır ihlal",
};

const SEVERITY_EN: Record<AZGSeverity, string> = {
  warning: "Warning",
  violation: "Violation",
  serious_violation: "Serious violation",
};

/** Dil -> siddet etiketi. Bilinmeyen/bos dilde Almanca (eski hal). */
function severityEtiket(dil?: string | null): Record<AZGSeverity, string> {
  if (dil === "tr") return SEVERITY_TR;
  if (dil === "en") return SEVERITY_EN;
  return SEVERITY_DE;
}

const SEVERITY_COLOR: Record<AZGSeverity, string> = {
  warning: "#d97706",
  violation: "#dc2626",
  serious_violation: "#991b1b",
};

// Panelin AZGReport.tsx'iyle BİREBİR aynı stil değerleri.
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: PDF_FONT_SERVER, color: "#0f172a" },
  cover: { padding: 48, fontFamily: PDF_FONT_SERVER, color: "#0f172a" },
  brandBox: {
    width: 130,
    height: 36,
    backgroundColor: "#FF6B00",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  brandText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  company: { fontSize: 12, fontWeight: "bold" },
  address: { fontSize: 9, color: "#475569", marginTop: 2, marginBottom: 28 },
  coverTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 8 },
  coverMonth: { fontSize: 14, color: "#FF6B00", fontWeight: "bold", marginBottom: 24 },
  meta: { fontSize: 9, color: "#64748b", marginBottom: 4 },
  statRow: { marginTop: 16, flexDirection: "row", gap: 12 },
  stat: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6, padding: 12 },
  statNum: { fontSize: 20, fontWeight: "bold" },
  statLabel: { fontSize: 8, color: "#64748b", marginTop: 2 },
  h2: { fontSize: 13, fontWeight: "bold", marginBottom: 10, color: "#0f172a" },
  h2sub: { fontSize: 13, fontWeight: "bold", marginTop: 24, marginBottom: 10, color: "#0f172a" },
  table: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  thead: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  th: { padding: 5, fontSize: 8, fontWeight: "bold", color: "#334155" },
  td: { padding: 5, fontSize: 8, color: "#1e293b" },
  noteBox: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
    fontSize: 8,
    color: "#92400e",
    lineHeight: 1.4,
  },
  legal: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
    fontSize: 8,
    color: "#475569",
    lineHeight: 1.4,
  },
  signature: { marginTop: 10, fontSize: 8, color: "#94a3b8" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
  },
});

function StatBox({ num, label, color }: { num: number; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statNum, color ? { color } : {}]}>{num}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}


/**
 * AZG BELGE ŞABLONU ETİKETLERİ (21.08.2026).
 *
 * ⚠️ ESKİDEN SABİT ALMANCAYDI. `buildAZGReport` t()'den geçen alanları
 * çeviriyordu ama ŞABLON çevirmiyordu; sonuç KARMA bir belgeydi — Volkan'ın
 * mobil tarafta teşhis ettiği kusurun ikinci yarısı. Artık dil seçilebiliyor.
 *
 * ⚠️ ÇEVRİLMEYEN: künye (COMPANY) ve "§ 26 AZG" madde kimliği. Kimlik sabit,
 * açıklama dile uyar — lib/azg-rules.ts AZG_REF_TR ile aynı kural.
 */
const AZG_DOC_DE = {
  createdAt: "Erstellt am",
  shiftsTotal: "Schichten gesamt",
  workers: "Mitarbeiter",
  hoursTotal: "Stunden gesamt",
  warnings: "Warnungen",
  violations: "Verstöße",
  serious: "Schwere Verstöße",
  perWorker: "Zusammenfassung je Mitarbeiter",
  worker: "Mitarbeiter",
  shifts: "Schichten",
  worstKind: "Schwerste Art",
  noData: "{L.noData}",
  detailed: "Detaillierte Verstöße",
  noViolations: "{L.noViolations}",
  date: "Datum",
  /** İhlal tablosunun TÜR sütunu — "Schwerste Art" ile karışmasın: o özet
   *  sayfasındaki EN AĞIR tür, bu ise satırın kendi türü. */
  kind: "Art",
  start: "Beginn",
  end: "Ende",
  duration: "Dauer",
  severity: "Schwere",
  description: "Beschreibung",
  legalBasis: "Rechtsgrundlage",
  suspicious: "Verdächtige Aufzeichnungen",
} as const;

const AZG_DOC_TR = {
  createdAt: "Oluşturulma",
  shiftsTotal: "Toplam vardiya",
  workers: "Personel",
  hoursTotal: "Toplam saat",
  warnings: "Uyarılar",
  violations: "İhlaller",
  serious: "Ağır ihlaller",
  perWorker: "Personel bazında özet",
  worker: "Personel",
  shifts: "Vardiya",
  worstKind: "En ağır tür",
  noData: "Seçili dönemde veri yok.",
  detailed: "İhlal ayrıntıları",
  noViolations: "İhlal tespit edilmedi.",
  date: "Tarih",
  kind: "Tür",
  start: "Başlangıç",
  end: "Bitiş",
  duration: "Süre",
  severity: "Ağırlık",
  description: "Açıklama",
  legalBasis: "Yasal dayanak",
  suspicious: "Şüpheli kayıtlar",
} as const;

const AZG_DOC_EN = {
  createdAt: "Created",
  shiftsTotal: "Shifts in total",
  workers: "Employees",
  hoursTotal: "Hours in total",
  warnings: "Warnings",
  violations: "Violations",
  serious: "Serious violations",
  perWorker: "Summary per employee",
  worker: "Employee",
  shifts: "Shifts",
  worstKind: "Most serious type",
  noData: "No data in the selected period.",
  detailed: "Violations in detail",
  noViolations: "No violations found.",
  date: "Date",
  kind: "Type",
  start: "Start",
  end: "End",
  duration: "Duration",
  severity: "Severity",
  description: "Description",
  legalBasis: "Legal basis",
  suspicious: "Suspicious records",
} as const;

type AzgDocEtiket = {
  [K in keyof typeof AZG_DOC_DE]: string;
};
/** Derleme anı kontrolü: ikizlerde eksik/fazla anahtar varsa burada patlar. */
const AZG_DOC_TR_KONTROL: AzgDocEtiket = AZG_DOC_TR;
const AZG_DOC_EN_KONTROL: AzgDocEtiket = AZG_DOC_EN;
void AZG_DOC_TR_KONTROL;
void AZG_DOC_EN_KONTROL;

function azgDocEtiket(dil?: string | null): AzgDocEtiket {
  if (dil === "tr") return AZG_DOC_TR;
  if (dil === "en") return AZG_DOC_EN;
  return AZG_DOC_DE;
}

export type AZGDocProps = {
  data: AZGData;
  /** Belge dili — verilmezse Almanca (eski davranış). */
  dil?: string | null;
  /**
   * `data.generatedAt`in de-AT biçimli hâli — ROUTE'ta üretilir.
   * Panel bunu bileşen içinde `toLocaleString` ile kuruyor; burada prop çünkü
   * bileşen içinde saf olmayan çağrı React derleyici kuralına takılıyor ve
   * belgenin TEK bir üretim anı taşıması gerekiyor.
   */
  uretimAni: string;
  /** Filigran: belgeyi İSTEYEN kişi. */
  kullanici: string | null;
  /** Görünmez parmak izi (047); katman kapalıysa null. */
  isaret: string | null;
};

export function AZGDoc({ data, uretimAni, kullanici, isaret, dil }: AZGDocProps) {
  const L = azgDocEtiket(dil);
  const SEV = severityEtiket(dil);
  const title = data.reportTitle;
  const warnColor = data.warningCount > 0 ? SEVERITY_COLOR.warning : "#94a3b8";
  const violColor = data.violationCount > 0 ? SEVERITY_COLOR.violation : "#059669";
  const seriousColor = data.seriousCount > 0 ? SEVERITY_COLOR.serious_violation : "#94a3b8";

  return (
    <Document {...fingerprintDocPropsServer(isaret)}>
      {/* Cover */}
      <Page size="A4" style={styles.cover}>
        <WatermarkServer kullanici={kullanici} damga={uretimAni} />
        <FingerprintServer isaret={isaret} />
        <View style={styles.brandBox}>
          <Text style={styles.brandText}>{BRAND_MARK}</Text>
        </View>
        <Text style={styles.company}>{COMPANY.name}</Text>
        <Text style={styles.address}>{COMPANY.address}</Text>
        <Text style={styles.address}>{COMPANY_UID_LINE}</Text>
        {COMPANY_EXTRA_LINE ? <Text style={styles.address}>{COMPANY_EXTRA_LINE}</Text> : null}
        <Text style={styles.coverTitle}>{title}</Text>
        <Text style={styles.coverMonth}>{data.monthLabel}</Text>
        <Text style={styles.meta}>{L.createdAt}: {uretimAni}</Text>

        <View style={styles.statRow}>
          <StatBox num={data.totalShifts} label={L.shiftsTotal} />
          <StatBox num={data.totalWorkers} label={L.workers} />
        </View>
        <View style={styles.statRow}>
          <StatBox num={data.warningCount} label={L.warnings} color={warnColor} />
          <StatBox num={data.violationCount} label={L.violations} color={violColor} />
          <StatBox num={data.seriousCount} label={L.serious} color={seriousColor} />
        </View>
      </Page>

      {/* Summary + suspicious */}
      <Page size="A4" style={styles.page}>
        <WatermarkServer kullanici={kullanici} damga={uretimAni} />
        <FingerprintServer isaret={isaret} />
        <Text style={styles.h2}>{L.perWorker}</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "28%" }]}>{L.worker}</Text>
            <Text style={[styles.th, { width: "12%" }]}>{L.shifts}</Text>
            <Text style={[styles.th, { width: "16%" }]}>Stunden gesamt</Text>
            <Text style={[styles.th, { width: "14%" }]}>{L.warnings}</Text>
            <Text style={[styles.th, { width: "14%" }]}>{L.violations}</Text>
            <Text style={[styles.th, { width: "16%" }]}>{L.worstKind}</Text>
          </View>
          {data.perWorker.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>
                {L.noData}
              </Text>
            </View>
          ) : (
            data.perWorker.map((w, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.td, { width: "28%" }]}>{w.name}</Text>
                <Text style={[styles.td, { width: "12%" }]}>{w.shifts}</Text>
                <Text style={[styles.td, { width: "16%" }]}>{w.totalHours}</Text>
                <Text style={[styles.td, { width: "14%" }]}>{w.warnings}</Text>
                <Text style={[styles.td, { width: "14%" }]}>{w.violations}</Text>
                <Text
                  style={[
                    styles.td,
                    { width: "16%" },
                    w.worst !== "none" ? { color: SEVERITY_COLOR[w.worst] } : {},
                  ]}
                >
                  {w.worst === "none" ? "—" : SEV[w.worst]}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ELLE DÜZELTİLEN KAYIT DİPNOTU — panelinkiyle birebir aynı metin.
            Bu raporu besleyen üç alan (Beginn/Ende/Pause) yönetici tarafından
            değiştirilebiliyor; denetim karşısında beyan edilmesi gerekir. */}
        {data.editedCount > 0 && (
          <View style={styles.noteBox}>
            <Text>
              {dil === "tr"
                ? `Bu dönemde ${data.editedCount} kayıt elle düzeltildi. Değişiklikler sistemde iz olarak tutuluyor (alan, eski değer, yeni değer, düzelten, zaman).`
                : dil === "en"
                  ? `${data.editedCount} record(s) were corrected manually in this period. The changes are logged in the system (field, old value, new value, editor, time).`
                  : `In diesem Zeitraum wurden ${data.editedCount} Aufzeichnung(en) manuell korrigiert. Die Änderungen sind im System protokolliert (Feld, alter Wert, neuer Wert, Bearbeiter, Zeitpunkt).`}
            </Text>
          </View>
        )}

        {data.suspicious.length > 0 && (
          <>
            <Text style={styles.h2sub}>Verdächtige Aufzeichnungen</Text>
            <View style={styles.noteBox}>
              <Text>
                {data.suspicious.length} Aufzeichnung(en) unter 5 Minuten erkannt —
                möglicherweise Test- oder Fehleingaben. Diese sind aus der Statistik
                ausgenommen. Bitte vor der Prüfung überprüfen.
              </Text>
            </View>
            <View style={styles.table}>
              <View style={styles.thead} fixed>
                <Text style={[styles.th, { width: "18%" }]}>{L.date}</Text>
                <Text style={[styles.th, { width: "30%" }]}>{L.worker}</Text>
                <Text style={[styles.th, { width: "16%" }]}>{L.start}</Text>
                <Text style={[styles.th, { width: "16%" }]}>{L.end}</Text>
                <Text style={[styles.th, { width: "20%" }]}>{L.duration}</Text>
              </View>
              {data.suspicious.map((s, i) => (
                <View key={i} style={styles.tr} wrap={false}>
                  <Text style={[styles.td, { width: "18%" }]}>{s.date}</Text>
                  <Text style={[styles.td, { width: "30%" }]}>{s.worker}</Text>
                  <Text style={[styles.td, { width: "16%" }]}>{s.start}</Text>
                  <Text style={[styles.td, { width: "16%" }]}>{s.end}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{s.duration}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>{title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* Detail */}
      <Page size="A4" style={styles.page}>
        <WatermarkServer kullanici={kullanici} damga={uretimAni} />
        <FingerprintServer isaret={isaret} />
        <Text style={styles.h2}>{L.detailed}</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "11%" }]}>{L.date}</Text>
            <Text style={[styles.th, { width: "16%" }]}>{L.worker}</Text>
            <Text style={[styles.th, { width: "22%" }]}>{L.kind}</Text>
            <Text style={[styles.th, { width: "24%" }]}>{L.description}</Text>
            <Text style={[styles.th, { width: "19%" }]}>{L.legalBasis}</Text>
            <Text style={[styles.th, { width: "8%" }]}>{L.severity}</Text>
          </View>
          {data.violations.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>{L.noViolations}</Text>
            </View>
          ) : (
            data.violations.map((v, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.td, { width: "11%" }]}>{v.date}</Text>
                <Text style={[styles.td, { width: "16%" }]}>{v.worker}</Text>
                <Text style={[styles.td, { width: "22%" }]}>{v.type}</Text>
                <Text style={[styles.td, { width: "24%" }]}>{v.description}</Text>
                <Text style={[styles.td, { width: "19%" }]}>{v.legalRef}</Text>
                <Text style={[styles.td, { width: "8%", color: SEVERITY_COLOR[v.severity] }]}>
                  {SEV[v.severity]}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.legal}>
          <Text>
            {dil === "tr"
              ? "Bu rapor § 26 AZG kayıt ve bilgi verme yükümlülüğünün gereklerini karşılar. Saklama süresi: 2 yıl."
              : dil === "en"
                ? "This report meets the recording and disclosure requirements of § 26 AZG. Retention period: 2 years."
                : "Dieser Bericht erfüllt die Anforderungen gemäß § 26 AZG zur Aufzeichnungs- und Auskunftspflicht. Aufbewahrungspflicht: 2 Jahre."}
          </Text>
          <Text style={styles.signature}>
            {dil === "tr"
              ? "Galzura Intelligence — otomatik üretilmiş uyum raporu"
              : dil === "en"
                ? "Galzura Intelligence — automatically generated compliance report"
                : "Galzura Intelligence — automatisch generierter Compliance-Bericht"}
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
