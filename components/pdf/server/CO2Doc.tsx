import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_SERVER } from "@/lib/pdf-server";
import {
  COMPANY,
  COMPANY_UID_LINE,
  COMPANY_EXTRA_LINE,
  BRAND_MARK,
} from "@/lib/report-de";
import {
  WatermarkServer,
  FingerprintServer,
  fingerprintDocPropsServer,
} from "@/components/pdf/server/Chrome";
import {
  CO2_KATSAYI_SURUM,
  CO2_KAYNAK,
  CO2_TTW,
  CO2_WTT,
  type CO2Esas,
  type CO2ReportData,
} from "@/lib/co2";

/**
 * CO₂ RAPORU (PDF) — SUNUCU İKİZİ.
 *
 * ── PANELİN BELGESİYLE AYNI KÂĞIT ─────────────────────────────────────────
 * `components/pdf/CO2Report.tsx` tarayıcıda üretiyor (Raporlar › CO₂ ekranının
 * üç dil düğmesi). Bu dosya AYNI üç sayfayı, AYNI sütunlarla, AYNI sözlükle
 * sunucuda üretir — mobilin ekranı yok, `pdf().toBlob()` yolu ona kapalı.
 * Emsal `AZGDoc` / `SchichtberichtDoc` / `PerformanceDoc`.
 *
 * ⚠️ FONT `PDF_FONT_SERVER`. İstemci dosyası `registerPdfFont()` ile modül
 * yükleme anında kaydediyor; sunucuda font `registerServerPdfFont()` ile
 * İSTEK anında kaydedilir. Bu ayrım bir kez METNİ ÇIKARILAMAYAN belge üretti
 * (18.08.2026): iki yol aynı font adını paylaşınca render SIRASINA bağlı bir
 * kusur çıkıyor. İki yol ayrı ad kullanır, ayrı kalır.
 *
 * ⚠️ KİMLİK PROP, GLOBAL DEĞİL. Filigran kullanıcısı ve parmak izi zorunlu
 * prop (gerekçe `Chrome.tsx` başlığında): sunucuda modül globali eşzamanlı
 * istekler arasında sızar ve belgeye YANLIŞ İNSANIN adını basar.
 *
 * ⚠️ `new Date()` YOK. Üretim anı hazır dize olarak gelir; belge tek bir ana
 * ait olmalı ve bileşen saf kalmalı.
 *
 * ⚠️ METODOLOJİ SAYFASI ZORUNLU — denetimin okuduğu bölüm orası: esas
 * (TTW/WTW), katsayılar, girdi kaynağı, standart ve KAPSAMA. Biri eksikse
 * belge beyan olarak kullanılamaz.
 */

export type PdfDil = "tr" | "de" | "en";

const LOCALE: Record<PdfDil, string> = { tr: "tr-TR", de: "de-AT", en: "en-GB" };

const S: Record<PdfDil, Record<string, string>> = {
  tr: {
    olusturuldu: "Oluşturulma",
    tuketim: "Yakıt tüketimi",
    toplam: "Toplam CO₂",
    mesafe: "Toplam mesafe",
    ortalama: "Ortalama",
    aracBasi: "Araç başına CO₂",
    plaka: "Plaka",
    litre: "Litre",
    km: "km",
    l100: "L/100km",
    kgKol: "CO₂ kg",
    gkm: "g/km",
    veriYok: "Seçilen dönemde veri yok.",
    metodBaslik: "Metodoloji ve kaynaklar",
    esasTTW: "Esas: TTW (tank-to-wheel) — doğrudan yanma, Scope 1. Egzozdan çıkan CO₂.",
    esasWTW: "Esas: WTW (well-to-wheel) — yukarı akış (WTT) + doğrudan yanma (TTW).",
    girdi: "Girdi: araç telemetrisinden ölçülen yakıt tüketimi (yakıt fişi DEĞİL).",
    olculemeyen:
      "Tüketimi ölçülemeyen araç bu rapora GİRMEZ ve 0 kg sayılmaz; kapsama aşağıda yazılıdır.",
    kapsama: "Kapsama",
    kapsamaMetin: "araçtan ölçülen",
    olculemeyenler: "Ölçülemeyen araçlar",
    surum: "Katsayı kümesi sürümü",
    uyari:
      "Bu rapor iç kullanım ve müşteri beyanı içindir. Akredite bir doğrulama için yetkili kuruluşa başvurulması önerilir.",
    imza: "Galzura Intelligence — otomatik üretilmiş CO₂ raporu",
  },
  de: {
    olusturuldu: "Erstellt am",
    tuketim: "Kraftstoffverbrauch",
    toplam: "CO₂ gesamt",
    mesafe: "Gesamtstrecke",
    ortalama: "Durchschnitt",
    aracBasi: "CO₂ je Fahrzeug",
    plaka: "Kennzeichen",
    litre: "Liter",
    km: "km",
    l100: "L/100km",
    kgKol: "CO₂ kg",
    gkm: "g/km",
    veriYok: "Keine Daten im gewählten Zeitraum.",
    metodBaslik: "Methodik und Quellen",
    esasTTW:
      "Grundlage: TTW (tank-to-wheel) — direkte Verbrennung, Scope 1. CO₂ aus dem Auspuff.",
    esasWTW: "Grundlage: WTW (well-to-wheel) — Vorkette (WTT) plus direkte Verbrennung (TTW).",
    girdi:
      "Eingangsdaten: aus der Fahrzeugtelemetrie gemessener Kraftstoffverbrauch (KEINE Tankbelege).",
    olculemeyen:
      "Fahrzeuge ohne messbaren Verbrauch fließen NICHT ein und werden nicht als 0 kg gewertet; die Abdeckung ist unten angegeben.",
    kapsama: "Abdeckung",
    kapsamaMetin: "Fahrzeuge gemessen",
    olculemeyenler: "Nicht messbare Fahrzeuge",
    surum: "Version des Faktorensatzes",
    uyari:
      "Dieser Bericht dient der internen Verwendung und der Kundeninformation. Für eine zertifizierte Prüfung wird eine akkreditierte Stelle empfohlen.",
    imza: "Galzura Intelligence — automatisch generierter CO₂-Bericht",
  },
  en: {
    olusturuldu: "Generated",
    tuketim: "Fuel consumption",
    toplam: "Total CO₂",
    mesafe: "Total distance",
    ortalama: "Average",
    aracBasi: "CO₂ per vehicle",
    plaka: "Plate",
    litre: "Litres",
    km: "km",
    l100: "L/100km",
    kgKol: "CO₂ kg",
    gkm: "g/km",
    veriYok: "No data in the selected period.",
    metodBaslik: "Methodology and sources",
    esasTTW: "Basis: TTW (tank-to-wheel) — direct combustion, Scope 1. CO₂ leaving the tailpipe.",
    esasWTW: "Basis: WTW (well-to-wheel) — upstream (WTT) plus direct combustion (TTW).",
    girdi: "Input: fuel consumption measured from vehicle telemetry (NOT fuel receipts).",
    olculemeyen:
      "Vehicles whose consumption cannot be measured are EXCLUDED and are not counted as 0 kg; coverage is stated below.",
    kapsama: "Coverage",
    kapsamaMetin: "vehicles measured",
    olculemeyenler: "Vehicles not measurable",
    surum: "Factor set version",
    uyari:
      "This report is for internal use and customer disclosure. For a certified audit an accredited body is recommended.",
    imza: "Galzura Intelligence — automatically generated CO₂ report",
  },
};

/** Panelin biçimleyicisiyle BİREBİR aynı — virgüllü ondalık, sabit basamak. */
const f = (n: number, d = 2) => n.toFixed(d).replace(".", ",");

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
  statRow: { marginTop: 20, flexDirection: "row", gap: 12 },
  stat: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6, padding: 12 },
  statNum: { fontSize: 18, fontWeight: "bold" },
  statLabel: { fontSize: 8, color: "#64748b", marginTop: 2 },
  h2: { fontSize: 13, fontWeight: "bold", marginBottom: 10 },
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
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
    fontSize: 8,
    color: "#475569",
    lineHeight: 1.5,
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

export type CO2Kapsama = {
  esas: CO2Esas;
  olculenArac: number;
  toplamArac: number;
  olculemeyenPlakalar: string[];
};

function katsayiSatiri(esas: CO2Esas): string {
  const d = esas === "WTW" ? CO2_TTW.diesel + CO2_WTT.diesel : CO2_TTW.diesel;
  const b = esas === "WTW" ? CO2_TTW.benzin + CO2_WTT.benzin : CO2_TTW.benzin;
  const l = esas === "WTW" ? CO2_TTW.lpg + CO2_WTT.lpg : CO2_TTW.lpg;
  return `CO₂ = L × ${f(d)} kg/L (Diesel) · ${f(b)} (Benzin) · ${f(l)} (LPG)`;
}

export function CO2Doc({
  data,
  title,
  dil,
  kapsama,
  uretimAni,
  kullanici,
  isaret,
}: {
  data: CO2ReportData;
  title: string;
  dil: PdfDil;
  kapsama: CO2Kapsama;
  /** Önceden biçimlenmiş üretim anı — bileşen içinde tarih üretilmez. */
  uretimAni: string;
  /** Belgeyi İSTEYEN kişi (raporun konusu olan şoförler değil). */
  kullanici: string | null;
  /** 047 parmak izi; katman kapalıysa null ve belge işaretsiz üretilir. */
  isaret: string | null;
}) {
  const L = LOCALE[dil];
  const w = S[dil];

  return (
    <Document {...fingerprintDocPropsServer(isaret)}>
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
        <Text style={styles.meta}>
          {w.olusturuldu}: {uretimAni}
        </Text>
        {/* ESAS KAPAKTA: belgeyi eline alan ilk saniyede hangi cetvel olduğunu görmeli. */}
        <Text style={styles.meta}>{kapsama.esas === "WTW" ? w.esasWTW : w.esasTTW}</Text>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{f(data.totalLiters)} L</Text>
            <Text style={styles.statLabel}>{w.tuketim}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: "#dc2626" }]}>{f(data.totalCo2)} kg</Text>
            <Text style={styles.statLabel}>{w.toplam}</Text>
          </View>
        </View>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{data.totalKm.toLocaleString(L)} km</Text>
            <Text style={styles.statLabel}>{w.mesafe}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>
              {data.avgGPerKm != null ? `${f(data.avgGPerKm, 0)} g/km` : "—"}
            </Text>
            <Text style={styles.statLabel}>{w.ortalama}</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <WatermarkServer kullanici={kullanici} damga={uretimAni} />
        <FingerprintServer isaret={isaret} />
        <Text style={styles.h2}>{w.aracBasi}</Text>
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, { width: "22%" }]}>{w.plaka}</Text>
            <Text style={[styles.th, { width: "16%" }]}>{w.litre}</Text>
            <Text style={[styles.th, { width: "18%" }]}>{w.km}</Text>
            <Text style={[styles.th, { width: "16%" }]}>{w.l100}</Text>
            <Text style={[styles.th, { width: "16%" }]}>{w.kgKol}</Text>
            <Text style={[styles.th, { width: "12%" }]}>{w.gkm}</Text>
          </View>
          {data.vehicles.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.td, { width: "100%" }]}>{w.veriYok}</Text>
            </View>
          ) : (
            data.vehicles.map((v, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.td, { width: "22%" }]}>{v.plate}</Text>
                <Text style={[styles.td, { width: "16%" }]}>{f(v.liters)}</Text>
                <Text style={[styles.td, { width: "18%" }]}>{v.km.toLocaleString(L)}</Text>
                <Text style={[styles.td, { width: "16%" }]}>
                  {v.lPer100 != null ? f(v.lPer100) : "—"}
                </Text>
                <Text style={[styles.td, { width: "16%" }]}>{f(v.co2Kg)}</Text>
                <Text style={[styles.td, { width: "12%" }]}>
                  {v.gPerKm != null ? f(v.gPerKm, 0) : "—"}
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

      <Page size="A4" style={styles.page}>
        <WatermarkServer kullanici={kullanici} damga={uretimAni} />
        <FingerprintServer isaret={isaret} />
        <Text style={styles.h2}>{w.metodBaslik}</Text>
        <View style={styles.legal}>
          {/*
            DENETİMİN OKUDUĞU BÖLÜM: esas · katsayılar · girdi kaynağı ·
            standart · KAPSAMA. Biri eksikse belge beyan olarak kullanılamaz.
          */}
          <Text>{kapsama.esas === "WTW" ? w.esasWTW : w.esasTTW}</Text>
          <Text style={{ marginTop: 6 }}>{katsayiSatiri(kapsama.esas)}</Text>
          <Text style={{ marginTop: 6 }}>{w.girdi}</Text>
          <Text style={{ marginTop: 6 }}>{CO2_KAYNAK.ttw}</Text>
          {kapsama.esas === "WTW" ? <Text style={{ marginTop: 6 }}>{CO2_KAYNAK.wtt}</Text> : null}
          <Text style={{ marginTop: 6 }}>{CO2_KAYNAK.standart}</Text>
          <Text style={{ marginTop: 6 }}>{`${w.surum}: ${CO2_KATSAYI_SURUM}`}</Text>

          <Text style={{ marginTop: 10 }}>{w.olculemeyen}</Text>
          <Text style={{ marginTop: 6 }}>
            {`${w.kapsama}: ${kapsama.olculenArac}/${kapsama.toplamArac} ${w.kapsamaMetin}`}
          </Text>
          {kapsama.olculemeyenPlakalar.length > 0 ? (
            <Text style={{ marginTop: 6 }}>
              {`${w.olculemeyenler}: ${kapsama.olculemeyenPlakalar.join(" · ")}`}
            </Text>
          ) : null}

          <Text style={{ marginTop: 10 }}>{w.uyari}</Text>
          <Text style={styles.signature}>{w.imza}</Text>
        </View>
        <View style={styles.footer} fixed>
          <Text>{title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
