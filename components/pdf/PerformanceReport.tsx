"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { registerPdfFont, PDF_FONT } from "@/lib/pdf-font";
import { COMPANY, COMPANY_UID_LINE } from "@/lib/report-de";

registerPdfFont();

/**
 * Sürücü performans raporu (PDF) — Schichtbericht ile AYNI kurallar: sabit
 * ALMANCA ve aynı firma künyesi (ad + adres + UID). Bu belge de yönetime /
 * dışarıya sunulur, dili arayüz tercihine bağlı olamaz (bkz. lib/report-de.ts).
 *
 * Güvenlik skoru burada YENİDEN hesaplanmaz; ekranda gösterilen değerler
 * (computeSafetyScores çıktısı) olduğu gibi basılır — kâğıt ile ekran
 * çelişemesin.
 */
export type PerformancePdfRow = {
  name: string;
  score: string;
  shifts: string;
  worked: string;
  km: string;
  delivered: string;
  events: string;
  braking: string;
  accel: string;
  speeding: string;
};

const DE = {
  title: "Fahrerleistungsbericht",
  period: "Zeitraum",
  generatedAt: "Erstellt am",
  footer: "Sicherheitsscore: 100 = keine Ereignisse, km-normalisiert",
  headers: {
    name: "Mitarbeiter",
    score: "Score",
    shifts: "Schichten",
    worked: "Arbeitszeit",
    km: "km",
    delivered: "Zugestellt",
    events: "Ereignisse",
    braking: "Bremsen",
    accel: "Beschl.",
    speeding: "Tempo",
  },
} as const;

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: PDF_FONT, color: "#0f172a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#FF6B00",
    paddingBottom: 10,
    marginBottom: 14,
  },
  company: { fontSize: 11, fontWeight: "bold" },
  address: { fontSize: 8, color: "#475569", marginTop: 2 },
  title: { fontSize: 14, fontWeight: "bold" },
  meta: { fontSize: 8, color: "#64748b", textAlign: "right", marginTop: 2 },
  table: { width: "100%", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  thead: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  trAlt: { backgroundColor: "#fafbfc" },
  th: { padding: 5, fontSize: 8, fontWeight: "bold", color: "#334155" },
  td: { padding: 5, fontSize: 8, color: "#1e293b" },
  colName: { width: "22%" },
  colNum: { width: "9.75%", textAlign: "right" },
  footer_: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
  },
});

function Doc({ period, rows }: { period: string; rows: PerformancePdfRow[] }) {
  const gen = new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  const numCols: (keyof PerformancePdfRow)[] = [
    "score",
    "shifts",
    "worked",
    "km",
    "delivered",
    "events",
    "braking",
    "accel",
  ];
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.company}>{COMPANY.name}</Text>
            <Text style={styles.address}>{COMPANY.address}</Text>
            <Text style={styles.address}>{COMPANY_UID_LINE}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>{DE.title}</Text>
            <Text style={styles.meta}>
              {DE.period}: {period}
            </Text>
            <Text style={styles.meta}>
              {DE.generatedAt}: {gen}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, styles.colName]}>{DE.headers.name}</Text>
            {numCols.map((k) => (
              <Text key={k} style={[styles.th, styles.colNum]}>
                {DE.headers[k]}
              </Text>
            ))}
            <Text style={[styles.th, styles.colNum]}>{DE.headers.speeding}</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={[styles.tr, i % 2 === 1 ? styles.trAlt : {}]} wrap={false}>
              <Text style={[styles.td, styles.colName]}>{r.name}</Text>
              {numCols.map((k) => (
                <Text key={k} style={[styles.td, styles.colNum]}>
                  {r[k]}
                </Text>
              ))}
              <Text style={[styles.td, styles.colNum]}>{r.speeding}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer_} fixed>
          <Text>{DE.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function downloadPerformancePdf(opts: {
  period: string;
  rows: PerformancePdfRow[];
}) {
  let url: string | null = null;
  try {
    const blob = await pdf(<Doc period={opts.period} rows={opts.rows} />).toBlob();
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-fahrerleistung-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
