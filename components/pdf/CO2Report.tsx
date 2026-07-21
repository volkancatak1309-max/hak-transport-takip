"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { registerPdfFont, PDF_FONT } from "@/lib/pdf-font";
import { COMPANY, COMPANY_UID_LINE } from "@/lib/report-de";
import type { CO2ReportData } from "@/lib/co2";

registerPdfFont();

const f = (n: number, d = 2) => n.toFixed(d).replace(".", ",");

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
  statRow: { marginTop: 20, flexDirection: "row", gap: 12 },
  stat: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6, padding: 12 },
  statNum: { fontSize: 18, fontWeight: "bold" },
  statLabel: { fontSize: 8, color: "#64748b", marginTop: 2 },
  h2: { fontSize: 13, fontWeight: "bold", marginBottom: 10 },
  table: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  thead: { flexDirection: "row", backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  th: { padding: 5, fontSize: 8, fontWeight: "bold", color: "#334155" },
  td: { padding: 5, fontSize: 8, color: "#1e293b" },
  legal: { marginTop: 24, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 12, fontSize: 8, color: "#475569", lineHeight: 1.5 },
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

function Doc({ data, title }: { data: CO2ReportData; title: string }) {
  const gen = new Date(data.generatedAt).toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  return (
    <Document>
      <Page size="A4" style={styles.cover}>
        <View style={styles.brandBox}>
          <Text style={styles.brandText}>HAK</Text>
        </View>
        <Text style={styles.company}>{COMPANY.name}</Text>
        <Text style={styles.address}>{COMPANY.address}</Text>
        <Text style={styles.address}>{COMPANY_UID_LINE}</Text>
        <Text style={styles.coverTitle}>{title}</Text>
        <Text style={styles.coverMonth}>{data.monthLabel}</Text>
        <Text style={styles.meta}>Erstellt am: {gen}</Text>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{f(data.totalLiters)} L</Text>
            <Text style={styles.statLabel}>Kraftstoffverbrauch</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: "#dc2626" }]}>{f(data.totalCo2)} kg</Text>
            <Text style={styles.statLabel}>CO₂ gesamt</Text>
          </View>
        </View>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{data.totalKm.toLocaleString("de-AT")} km</Text>
            <Text style={styles.statLabel}>Gesamtstrecke</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{data.avgGPerKm != null ? `${f(data.avgGPerKm, 0)} g/km` : "—"}</Text>
            <Text style={styles.statLabel}>Durchschnitt</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>CO₂ je Fahrzeug</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "22%" }]}>Kennzeichen</Text>
            <Text style={[styles.th, { width: "16%" }]}>Liter</Text>
            <Text style={[styles.th, { width: "18%" }]}>km</Text>
            <Text style={[styles.th, { width: "16%" }]}>L/100km</Text>
            <Text style={[styles.th, { width: "16%" }]}>CO₂ kg</Text>
            <Text style={[styles.th, { width: "12%" }]}>g/km</Text>
          </View>
          {data.vehicles.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>Keine Daten im gewählten Monat.</Text>
            </View>
          ) : (
            data.vehicles.map((v, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.td, { width: "22%" }]}>{v.plate}</Text>
                <Text style={[styles.td, { width: "16%" }]}>{f(v.liters)}</Text>
                <Text style={[styles.td, { width: "18%" }]}>{v.km.toLocaleString("de-AT")}</Text>
                <Text style={[styles.td, { width: "16%" }]}>{v.lPer100 != null ? f(v.lPer100) : "—"}</Text>
                <Text style={[styles.td, { width: "16%" }]}>{f(v.co2Kg)}</Text>
                <Text style={[styles.td, { width: "12%" }]}>{v.gPerKm != null ? f(v.gPerKm, 0) : "—"}</Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.footer} fixed>
          <Text>{title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Zusammenfassung & EU-Rahmen</Text>
        <View style={styles.legal}>
          <Text>
            Berechnung: CO₂ = Liter × Emissionsfaktor (Diesel 2,64 kg/L, Benzin
            2,31 kg/L, LPG 1,51 kg/L). Grundlage sind die genehmigten
            Tankrechnungen des gewählten Monats.
          </Text>
          <Text style={{ marginTop: 10 }}>
            Dieser Bericht orientiert sich am Rahmen des EU Green Deal
            (Europäischer Grüner Deal) zur Reduktion von Treibhausgasemissionen
            im Verkehrssektor.
          </Text>
          <Text style={{ marginTop: 10 }}>
            Hinweis: Dieser Bericht dient der internen Verwendung. Für eine
            zertifizierte Prüfung wird die Beauftragung einer akkreditierten
            Stelle empfohlen.
          </Text>
          <Text style={styles.signature}>
            Galzura Intelligence — automatisch generierter CO₂-Bericht
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

export async function downloadCO2Report(data: CO2ReportData, title: string) {
  let url: string | null = null;
  try {
    const blob = await pdf(<Doc data={data} title={title} />).toBlob();
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `HAK_CO2_${data.monthLabel}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Always release the object URL, even if generation/click threw. The error
    // (if any) propagates so the caller can surface it to the user.
    if (url) URL.revokeObjectURL(url);
  }
}
