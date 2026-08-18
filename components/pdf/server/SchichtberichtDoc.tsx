import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { PDF_FONT_SERVER } from "@/lib/pdf-server";
import { BRAND_MARK } from "@/lib/report-de";
import { PACKAGES_ENABLED } from "@/lib/tenant";
import {
  WatermarkServer,
  FingerprintServer,
  fingerprintDocPropsServer,
} from "@/components/pdf/server/Chrome";

/**
 * SCHICHTBERICHT (vardiya/AZG çalışma süresi kaydı) — SUNUCU İKİZİ.
 *
 * ⚠️ RESMÎ EVRAK. AZG kapsamında ibraz edilir. Sütun payları, Almanca
 * başlıklar ve künye `components/pdf/ShiftReport.tsx` ile BİREBİR AYNIDIR.
 * Aynı dönem için panelden ve mobilden alınan iki belge farklı görünemez;
 * metin katmanı karşılaştırmalı doğrulanıyor (scripts/verify-rapor-pdf-tur3.mjs).
 *
 * ── SAYAÇ KOLONU YOK (panelin kuralı, 21.07.2026) ─────────────────────────
 * Start-KM/End-KM basılmıyor: şoför sayaç girmiyor, kilometre cihazdan geliyor
 * ve mutlak sayaç değeri her araçta doğru değil (23 araçta gerçek odometre,
 * 6'sında GPS mesafesi). Resmî belgeye aracın panelindeki sayaçla uyuşmayacak
 * bir rakam basmaktansa tek doğru olan "gefahrene Kilometer" bırakıldı.
 *
 * ── KİMLİK PROP, GLOBAL DEĞİL ─────────────────────────────────────────────
 * Gerekçe components/pdf/server/Chrome.tsx başlığında.
 */

export type SchichtHeaders = {
  worker: string;
  date: string;
  start: string;
  end: string;
  worked: string;
  breakMin: string;
  km: string;
  loaded: string;
  cargo: string;
  undelivered: string;
  plate: string;
};

export type SchichtRow = SchichtHeaders;

export type SchichtberichtDocProps = {
  title: string;
  company: string;
  address: string;
  /** "UID-Nr.: ATU…" — Avusturya resmî belgesinde künyenin üçüncü satırı. */
  uid: string;
  period: string;
  generatedAt: string;
  footer: string;
  headers: SchichtHeaders;
  rows: SchichtRow[];
  /** Filigran: belgeyi İSTEYEN kişi. */
  kullanici: string | null;
  /** Filigran damgası — belgenin TEK üretim anı (de-AT). */
  damga: string;
  /** Görünmez parmak izi (047); katman kapalıysa null. */
  isaret: string | null;
};

// Panelin ShiftReport.tsx'iyle BİREBİR aynı stil değerleri.
const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: PDF_FONT_SERVER, color: "#0f172a" },
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

/**
 * KOLON PAYLARI — yüzde DEĞİL, PAY (panelin kuralının birebir kopyası).
 * Paket kolonları kiracı ayarına bağlı; kapalıyken boşalan pay kalan kolonlara
 * ORANSAL dağıtılır, yoksa tablo sayfanın %72'sinde sıkışır.
 */
const COL_W = {
  worker: 14,
  date: 9,
  start: 7,
  end: 7,
  worked: 10,
  break: 7,
  km: 9,
  loaded: 9,
  cargo: 9,
  undelivered: 10,
  plate: 9,
} as const;

const PACKAGE_COLS = ["loaded", "cargo", "undelivered"] as const;

function colWidths(withPackages: boolean): Record<keyof typeof COL_W, Style> {
  const keys = Object.keys(COL_W) as (keyof typeof COL_W)[];
  const active = withPackages
    ? keys
    : keys.filter((k) => !(PACKAGE_COLS as readonly string[]).includes(k));
  const total = active.reduce((n, k) => n + COL_W[k], 0);
  const out = {} as Record<keyof typeof COL_W, Style>;
  for (const k of keys) {
    out[k] = active.includes(k)
      ? { width: `${((COL_W[k] / total) * 100).toFixed(3)}%` }
      : { width: 0 };
  }
  return out;
}

export function SchichtberichtDoc(opts: SchichtberichtDocProps) {
  const w = colWidths(PACKAGES_ENABLED);
  return (
    <Document {...fingerprintDocPropsServer(opts.isaret)}>
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <WatermarkServer kullanici={opts.kullanici} damga={opts.damga} />
        <FingerprintServer isaret={opts.isaret} />
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            <View style={styles.brandBox}>
              <Text style={styles.brandText}>{BRAND_MARK}</Text>
            </View>
            <Text style={styles.company}>{opts.company}</Text>
            <Text style={styles.address}>{opts.address}</Text>
            <Text style={styles.address}>{opts.uid}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>{opts.title}</Text>
            <Text style={styles.meta}>{opts.period}</Text>
            <Text style={styles.meta}>{opts.generatedAt}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, w.worker]}>{opts.headers.worker}</Text>
            <Text style={[styles.th, w.date]}>{opts.headers.date}</Text>
            <Text style={[styles.th, w.start]}>{opts.headers.start}</Text>
            <Text style={[styles.th, w.end]}>{opts.headers.end}</Text>
            <Text style={[styles.th, w.worked]}>{opts.headers.worked}</Text>
            <Text style={[styles.th, w.break]}>{opts.headers.breakMin}</Text>
            <Text style={[styles.th, w.km]}>{opts.headers.km}</Text>
            {PACKAGES_ENABLED && (
              <>
                <Text style={[styles.th, w.loaded]}>{opts.headers.loaded}</Text>
                <Text style={[styles.th, w.cargo]}>{opts.headers.cargo}</Text>
                <Text style={[styles.th, w.undelivered]}>{opts.headers.undelivered}</Text>
              </>
            )}
            <Text style={[styles.th, w.plate]}>{opts.headers.plate}</Text>
          </View>
          {opts.rows.map((r, i) => (
            <View key={i} style={[styles.tr, i % 2 === 1 ? styles.trAlt : {}]} wrap={false}>
              <Text style={[styles.td, w.worker]}>{r.worker}</Text>
              <Text style={[styles.td, w.date]}>{r.date}</Text>
              <Text style={[styles.td, w.start]}>{r.start}</Text>
              <Text style={[styles.td, w.end]}>{r.end}</Text>
              <Text style={[styles.td, w.worked]}>{r.worked}</Text>
              <Text style={[styles.td, w.break]}>{r.breakMin}</Text>
              <Text style={[styles.td, w.km]}>{r.km}</Text>
              {PACKAGES_ENABLED && (
                <>
                  <Text style={[styles.td, w.loaded]}>{r.loaded}</Text>
                  <Text style={[styles.td, w.cargo]}>{r.cargo}</Text>
                  <Text style={[styles.td, w.undelivered]}>{r.undelivered}</Text>
                </>
              )}
              <Text style={[styles.td, w.plate]}>{r.plate}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>{opts.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
