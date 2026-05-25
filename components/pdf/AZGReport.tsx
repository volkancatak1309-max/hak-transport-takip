"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { AZGData, AZGSeverity } from "@/app/actions/azg-report";

const SEVERITY_DE: Record<AZGSeverity, string> = {
  warning: "Hinweis",
  violation: "Verstoß",
  serious_violation: "Schwerer Verstoß",
};

const SEVERITY_COLOR: Record<AZGSeverity, string> = {
  warning: "#d97706",
  violation: "#dc2626",
  serious_violation: "#991b1b",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  cover: { padding: 48, fontFamily: "Helvetica", color: "#0f172a" },
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
  statBox: {
    marginTop: 28,
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
  },
  statNum: { fontSize: 22, fontWeight: "bold" },
  statLabel: { fontSize: 8, color: "#64748b", marginTop: 2 },
  h2: { fontSize: 13, fontWeight: "bold", marginBottom: 10, color: "#0f172a" },
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

function ReportDoc({ data, title }: { data: AZGData; title: string }) {
  const genStr = new Date(data.generatedAt).toLocaleString("de-AT", {
    timeZone: "Europe/Vienna",
  });

  return (
    <Document>
      {/* Cover */}
      <Page size="A4" style={styles.cover}>
        <View style={styles.brandBox}>
          <Text style={styles.brandText}>HAK</Text>
        </View>
        <Text style={styles.company}>HAK Transport GmbH</Text>
        <Text style={styles.address}>
          Manstraße 21/1/5, 2333 Leopoldsdorf, Österreich
        </Text>
        <Text style={styles.coverTitle}>{title}</Text>
        <Text style={styles.coverMonth}>{data.monthLabel}</Text>
        <Text style={styles.meta}>Erstellt am: {genStr}</Text>
        <View style={styles.statBox}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{data.totalShifts}</Text>
            <Text style={styles.statLabel}>Schichten</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{data.totalWorkers}</Text>
            <Text style={styles.statLabel}>Mitarbeiter</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: data.totalViolations > 0 ? "#dc2626" : "#059669" }]}>
              {data.totalViolations}
            </Text>
            <Text style={styles.statLabel}>Verstöße</Text>
          </View>
        </View>
      </Page>

      {/* Summary */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Zusammenfassung je Mitarbeiter</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "50%" }]}>Mitarbeiter</Text>
            <Text style={[styles.th, { width: "25%" }]}>Verstöße</Text>
            <Text style={[styles.th, { width: "25%" }]}>Schwerste Art</Text>
          </View>
          {data.perWorker.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>
                Keine Verstöße im gewählten Zeitraum.
              </Text>
            </View>
          ) : (
            data.perWorker.map((w, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.td, { width: "50%" }]}>{w.name}</Text>
                <Text style={[styles.td, { width: "25%" }]}>{w.total}</Text>
                <Text
                  style={[
                    styles.td,
                    { width: "25%" },
                    w.worst !== "none" ? { color: SEVERITY_COLOR[w.worst] } : {},
                  ]}
                >
                  {w.worst === "none" ? "—" : SEVERITY_DE[w.worst]}
                </Text>
              </View>
            ))
          )}
        </View>
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
            <Text style={[styles.th, { width: "12%" }]}>Datum</Text>
            <Text style={[styles.th, { width: "20%" }]}>Mitarbeiter</Text>
            <Text style={[styles.th, { width: "8%" }]}>Ende</Text>
            <Text style={[styles.th, { width: "8%" }]}>Std.</Text>
            <Text style={[styles.th, { width: "22%" }]}>Art</Text>
            <Text style={[styles.th, { width: "30%" }]}>Rechtsgrundlage</Text>
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
                <Text style={[styles.td, { width: "12%" }]}>{v.date}</Text>
                <Text style={[styles.td, { width: "20%" }]}>{v.worker}</Text>
                <Text style={[styles.td, { width: "8%" }]}>{v.end}</Text>
                <Text style={[styles.td, { width: "8%" }]}>{v.workedHours}</Text>
                <Text style={[styles.td, { width: "22%", color: SEVERITY_COLOR[v.severity] }]}>
                  {v.type}
                </Text>
                <Text style={[styles.td, { width: "30%" }]}>{v.legalRef}</Text>
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
