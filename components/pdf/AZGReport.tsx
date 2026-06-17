"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { registerPdfFont, PDF_FONT } from "@/lib/pdf-font";
import type { AZGData, AZGSeverity } from "@/app/actions/azg-report";

registerPdfFont();

const SEVERITY_DE: Record<AZGSeverity, string> = {
  warning: "Warnung",
  violation: "Verstoß",
  serious_violation: "Schwerer Verstoß",
};

const SEVERITY_COLOR: Record<AZGSeverity, string> = {
  warning: "#d97706",
  violation: "#dc2626",
  serious_violation: "#991b1b",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: PDF_FONT, color: "#0f172a" },
  cover: { padding: 48, fontFamily: PDF_FONT, color: "#0f172a" },
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
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
  },
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

function ReportDoc({ data, title }: { data: AZGData; title: string }) {
  const genStr = new Date(data.generatedAt).toLocaleString("de-AT", {
    timeZone: "Europe/Vienna",
  });
  const warnColor = data.warningCount > 0 ? SEVERITY_COLOR.warning : "#94a3b8";
  const violColor = data.violationCount > 0 ? SEVERITY_COLOR.violation : "#059669";
  const seriousColor = data.seriousCount > 0 ? SEVERITY_COLOR.serious_violation : "#94a3b8";

  return (
    <Document>
      {/* Cover */}
      <Page size="A4" style={styles.cover}>
        <View style={styles.brandBox}>
          <Text style={styles.brandText}>HAK</Text>
        </View>
        <Text style={styles.company}>HAK61 GmbH</Text>
        <Text style={styles.address}>
          Manstraße 21/1/5, 2333 Leopoldsdorf, Österreich
        </Text>
        <Text style={styles.coverTitle}>{title}</Text>
        <Text style={styles.coverMonth}>{data.monthLabel}</Text>
        <Text style={styles.meta}>Erstellt am: {genStr}</Text>

        <View style={styles.statRow}>
          <StatBox num={data.totalShifts} label="Schichten gesamt" />
          <StatBox num={data.totalWorkers} label="Mitarbeiter" />
        </View>
        <View style={styles.statRow}>
          <StatBox num={data.warningCount} label="Warnungen" color={warnColor} />
          <StatBox num={data.violationCount} label="Verstöße" color={violColor} />
          <StatBox num={data.seriousCount} label="Schwere Verstöße" color={seriousColor} />
        </View>
      </Page>

      {/* Summary + suspicious */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Zusammenfassung je Mitarbeiter</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "28%" }]}>Mitarbeiter</Text>
            <Text style={[styles.th, { width: "12%" }]}>Schichten</Text>
            <Text style={[styles.th, { width: "16%" }]}>Stunden gesamt</Text>
            <Text style={[styles.th, { width: "14%" }]}>Warnungen</Text>
            <Text style={[styles.th, { width: "14%" }]}>Verstöße</Text>
            <Text style={[styles.th, { width: "16%" }]}>Schwerste Art</Text>
          </View>
          {data.perWorker.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>
                Keine Daten im gewählten Zeitraum.
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
                  {w.worst === "none" ? "—" : SEVERITY_DE[w.worst]}
                </Text>
              </View>
            ))
          )}
        </View>

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
                <Text style={[styles.th, { width: "18%" }]}>Datum</Text>
                <Text style={[styles.th, { width: "30%" }]}>Mitarbeiter</Text>
                <Text style={[styles.th, { width: "16%" }]}>Beginn</Text>
                <Text style={[styles.th, { width: "16%" }]}>Ende</Text>
                <Text style={[styles.th, { width: "20%" }]}>Dauer</Text>
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
        <Text style={styles.h2}>Detaillierte Verstöße</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "11%" }]}>Datum</Text>
            <Text style={[styles.th, { width: "16%" }]}>Mitarbeiter</Text>
            <Text style={[styles.th, { width: "22%" }]}>Art</Text>
            <Text style={[styles.th, { width: "24%" }]}>Beschreibung</Text>
            <Text style={[styles.th, { width: "19%" }]}>Rechtsgrundlage</Text>
            <Text style={[styles.th, { width: "8%" }]}>Schwere</Text>
          </View>
          {data.violations.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>
                Keine Verstöße festgestellt.
              </Text>
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
                  {SEVERITY_DE[v.severity]}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.legal}>
          <Text>
            Dieser Bericht erfüllt die Anforderungen gemäß § 26 AZG zur
            Aufzeichnungs- und Auskunftspflicht. Aufbewahrungspflicht: 2 Jahre.
          </Text>
          <Text style={styles.signature}>
            Galzura Intelligence — automatisch generierter Compliance-Bericht
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

export async function downloadAZGReport(data: AZGData, title: string) {
  const blob = await pdf(<ReportDoc data={data} title={title} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `HAK_AZG_${data.monthLabel}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
