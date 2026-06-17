"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Image,
} from "@react-pdf/renderer";
import { registerPdfFont, PDF_FONT } from "@/lib/pdf-font";

registerPdfFont();

export type PdfHeaders = {
  worker: string;
  date: string;
  start: string;
  end: string;
  worked: string;
  breakMin: string;
  startKm: string;
  endKm: string;
  km: string;
  cargo: string;
  undelivered: string;
  plate: string;
};

export type PdfRow = {
  worker: string;
  date: string;
  start: string;
  end: string;
  worked: string;
  breakMin: string;
  startKm: string;
  endKm: string;
  km: string;
  cargo: string;
  undelivered: string;
  plate: string;
};

export type PdfOptions = {
  title: string;
  company: string;
  address: string;
  period: string;
  generatedAt: string;
  footer: string;
  headers: PdfHeaders;
  rows: PdfRow[];
  filename: string;
  logoDataUrl?: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 9,
    fontFamily: PDF_FONT,
    color: "#0f172a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#FF6B00",
    paddingBottom: 10,
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "column" },
  brandBox: {
    width: 110,
    height: 30,
    backgroundColor: "#FF6B00",
    borderRadius: 4,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  brandText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  company: { fontSize: 11, fontWeight: "bold", color: "#0f172a" },
  address: { fontSize: 8, color: "#475569", marginTop: 2 },
  title: { fontSize: 14, fontWeight: "bold", color: "#0f172a" },
  meta: { fontSize: 8, color: "#64748b", textAlign: "right", marginTop: 2 },
  table: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
  },
  thead: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  trAlt: { backgroundColor: "#fafbfc" },
  th: {
    padding: 5,
    fontSize: 8,
    fontWeight: "bold",
    color: "#334155",
  },
  td: {
    padding: 5,
    fontSize: 8,
    color: "#1e293b",
  },
  colWorker: { width: "14%" },
  colDate: { width: "8%" },
  colStart: { width: "6%" },
  colEnd: { width: "6%" },
  colWorked: { width: "9%" },
  colBreak: { width: "6%" },
  colStartKm: { width: "9%" },
  colEndKm: { width: "9%" },
  colKm: { width: "7%" },
  colCargo: { width: "7%" },
  colUndelivered: { width: "10%" },
  colPlate: { width: "9%" },
  footer: {
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

function ReportDoc(opts: PdfOptions) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {opts.logoDataUrl ? (
              <Image src={opts.logoDataUrl} style={{ width: 110, height: 30, marginBottom: 6 }} />
            ) : (
              <View style={styles.brandBox}>
                <Text style={styles.brandText}>HAK</Text>
              </View>
            )}
            <Text style={styles.company}>{opts.company}</Text>
            <Text style={styles.address}>{opts.address}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>{opts.title}</Text>
            <Text style={styles.meta}>{opts.period}</Text>
            <Text style={styles.meta}>{opts.generatedAt}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, styles.colWorker]}>{opts.headers.worker}</Text>
            <Text style={[styles.th, styles.colDate]}>{opts.headers.date}</Text>
            <Text style={[styles.th, styles.colStart]}>{opts.headers.start}</Text>
            <Text style={[styles.th, styles.colEnd]}>{opts.headers.end}</Text>
            <Text style={[styles.th, styles.colWorked]}>{opts.headers.worked}</Text>
            <Text style={[styles.th, styles.colBreak]}>{opts.headers.breakMin}</Text>
            <Text style={[styles.th, styles.colStartKm]}>{opts.headers.startKm}</Text>
            <Text style={[styles.th, styles.colEndKm]}>{opts.headers.endKm}</Text>
            <Text style={[styles.th, styles.colKm]}>{opts.headers.km}</Text>
            <Text style={[styles.th, styles.colCargo]}>{opts.headers.cargo}</Text>
            <Text style={[styles.th, styles.colUndelivered]}>{opts.headers.undelivered}</Text>
            <Text style={[styles.th, styles.colPlate]}>{opts.headers.plate}</Text>
          </View>
          {opts.rows.map((r, i) => (
            <View key={i} style={[styles.tr, i % 2 === 1 ? styles.trAlt : {}]} wrap={false}>
              <Text style={[styles.td, styles.colWorker]}>{r.worker}</Text>
              <Text style={[styles.td, styles.colDate]}>{r.date}</Text>
              <Text style={[styles.td, styles.colStart]}>{r.start}</Text>
              <Text style={[styles.td, styles.colEnd]}>{r.end}</Text>
              <Text style={[styles.td, styles.colWorked]}>{r.worked}</Text>
              <Text style={[styles.td, styles.colBreak]}>{r.breakMin}</Text>
              <Text style={[styles.td, styles.colStartKm]}>{r.startKm}</Text>
              <Text style={[styles.td, styles.colEndKm]}>{r.endKm}</Text>
              <Text style={[styles.td, styles.colKm]}>{r.km}</Text>
              <Text style={[styles.td, styles.colCargo]}>{r.cargo}</Text>
              <Text style={[styles.td, styles.colUndelivered]}>{r.undelivered}</Text>
              <Text style={[styles.td, styles.colPlate]}>{r.plate}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>{opts.footer}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function downloadPdf(opts: PdfOptions) {
  const blob = await pdf(<ReportDoc {...opts} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
