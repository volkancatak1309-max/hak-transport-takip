"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { registerPdfFont, PDF_FONT } from "@/lib/pdf-font";
import {
  COMPANY,
  COMPANY_UID_LINE,
  COMPANY_EXTRA_LINE,
  FILE_PREFIX_LOWER,
} from "@/lib/report-de";

registerPdfFont();

/**
 * Yakıt raporu (PDF) — Schichtbericht / Fahrerleistungsbericht ile AYNI kurallar:
 * sabit ALMANCA ve aynı firma künyesi (ad + adres + UID). Yönetime sunulur, dili
 * arayüz tercihine bağlı olamaz (bkz. lib/report-de.ts).
 *
 * Ekrandaki değerler olduğu gibi basılır (yeniden hesap yok) — kâğıt ile ekran
 * çelişmesin. Litre değerleri yalnız tank hacmi girilmiş araçlarda vardır;
 * girilmemişte yüzde basılır, UYDURMA litre yoktur.
 */
export type FuelPdfRow = {
  plate: string;
  driver: string;
  tank: string;
  avg: string;
  consumed: string;
  l100: string;
  refills: string;
  leak: string;
};

const DE = {
  title: "Kraftstoffbericht",
  period: "Zeitraum",
  generatedAt: "Erstellt am",
  summary: (total: number, fleet: string) =>
    `Gesamtverbrauch: ${total} L · Flotte Ø: ${fleet} L/100km`,
  footer:
    "Verbrauch aus Füllstand (%) × Tankvolumen geschätzt · Diebstahl-Warnung: Füllstand fiel ohne Fahrzeugbewegung",
  headers: {
    plate: "Kennzeichen",
    driver: "Fahrer",
    tank: "Tank",
    avg: "Ø Füllung",
    consumed: "Verbrauch",
    l100: "L/100km",
    refills: "Betankungen",
    leak: "Diebstahl-Warnung",
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
    marginBottom: 8,
  },
  company: { fontSize: 11, fontWeight: "bold" },
  address: { fontSize: 8, color: "#475569", marginTop: 2 },
  title: { fontSize: 14, fontWeight: "bold" },
  meta: { fontSize: 8, color: "#64748b", textAlign: "right", marginTop: 2 },
  summary: { fontSize: 9, color: "#334155", marginBottom: 10 },
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
  leak: { color: "#b91c1c", fontWeight: "bold" },
  colPlate: { width: "13%" },
  colDriver: { width: "19%" },
  colTank: { width: "10%", textAlign: "right" },
  colAvg: { width: "11%", textAlign: "right" },
  colConsumed: { width: "13%", textAlign: "right" },
  colL100: { width: "11%", textAlign: "right" },
  colRefills: { width: "13%", textAlign: "right" },
  colLeak: { width: "10%", textAlign: "right" },
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

function Doc({
  period,
  totalLiters,
  fleetL100,
  rows,
}: {
  period: string;
  totalLiters: number;
  fleetL100: string;
  rows: FuelPdfRow[];
}) {
  const gen = new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.company}>{COMPANY.name}</Text>
            <Text style={styles.address}>{COMPANY.address}</Text>
            <Text style={styles.address}>{COMPANY_UID_LINE}</Text>
            {COMPANY_EXTRA_LINE ? (
              <Text style={styles.address}>{COMPANY_EXTRA_LINE}</Text>
            ) : null}
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

        <Text style={styles.summary}>{DE.summary(totalLiters, fleetL100)}</Text>

        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, styles.colPlate]}>{DE.headers.plate}</Text>
            <Text style={[styles.th, styles.colDriver]}>{DE.headers.driver}</Text>
            <Text style={[styles.th, styles.colTank]}>{DE.headers.tank}</Text>
            <Text style={[styles.th, styles.colAvg]}>{DE.headers.avg}</Text>
            <Text style={[styles.th, styles.colConsumed]}>{DE.headers.consumed}</Text>
            <Text style={[styles.th, styles.colL100]}>{DE.headers.l100}</Text>
            <Text style={[styles.th, styles.colRefills]}>{DE.headers.refills}</Text>
            <Text style={[styles.th, styles.colLeak]}>{DE.headers.leak}</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={[styles.tr, i % 2 === 1 ? styles.trAlt : {}]} wrap={false}>
              <Text style={[styles.td, styles.colPlate]}>{r.plate}</Text>
              <Text style={[styles.td, styles.colDriver]}>{r.driver}</Text>
              <Text style={[styles.td, styles.colTank]}>{r.tank}</Text>
              <Text style={[styles.td, styles.colAvg]}>{r.avg}</Text>
              <Text style={[styles.td, styles.colConsumed]}>{r.consumed}</Text>
              <Text style={[styles.td, styles.colL100]}>{r.l100}</Text>
              <Text style={[styles.td, styles.colRefills]}>{r.refills}</Text>
              <Text
                style={[styles.td, styles.colLeak, r.leak !== "—" ? styles.leak : {}]}
              >
                {r.leak}
              </Text>
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

export async function downloadFuelPdf(opts: {
  period: string;
  totalLiters: number;
  fleetL100: string;
  rows: FuelPdfRow[];
}) {
  let url: string | null = null;
  try {
    const blob = await pdf(
      <Doc
        period={opts.period}
        totalLiters={opts.totalLiters}
        fleetL100={opts.fleetL100}
        rows={opts.rows}
      />
    ).toBlob();
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${FILE_PREFIX_LOWER}-kraftstoff-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
