import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_SERVER } from "@/lib/pdf-server";
import {
  COMPANY,
  COMPANY_UID_LINE,
  COMPANY_EXTRA_LINE,
} from "@/lib/report-de";
import {
  WatermarkServer,
  FingerprintServer,
  fingerprintDocPropsServer,
} from "@/components/pdf/server/Chrome";

/**
 * TEK ŞOFÖRÜN PERFORMANS RAPORU (PDF) — sunucuda üretilir.
 *
 * ── PANELİN RAPORUNDAN FARKI: KAPSAM, İÇERİK DEĞİL ────────────────────────
 * `components/pdf/PerformanceReport.tsx` FİLONUN TAMAMINI tek tabloda basar
 * (Raporlar › Performans sayfasının çıktısı). Bu belge AYNI alanları basar ama
 * TEK KİŞİ için — çünkü ucu `/api/mobile/workers/[id]/rapor.pdf`, yani zaten
 * bir kişinin dosyası. Aynı sütunlar, aynı Almanca, aynı künye, aynı skor
 * kuralı; yalnız satır sayısı bir.
 *
 * Sayılar YENİDEN HESAPLANMAZ: hepsi `buildPerformanceReport`ın o şoför için
 * ürettiği `PerformanceRow`dan gelir — mobil Sürücüler ekranı, panelin
 * Performans raporu ve bu belge aynı satırdan beslenir. Kâğıt ile ekran
 * çelişemez.
 *
 * ── DİL SABİT ALMANCA ─────────────────────────────────────────────────────
 * Panelin bütün PDF'lerindeki kural (lib/report-de.ts): belge yönetime ve
 * dışarıya sunulur, dili arayüz tercihine bağlı olamaz.
 *
 * ── BİLEŞEN APTALDIR ──────────────────────────────────────────────────────
 * Biçimleme YOK: her değer hazır DİZE olarak gelir (saat, km, tarih, skor
 * notu). Sebep panelinkiyle aynı: `PerformanceClient` de PDF'e biçimlenmiş
 * dizeler veriyor. Burada ikinci bir biçimleme yolu açmak, aynı sayının iki
 * yüzeyde farklı yazılmasına giden en kısa yoldur.
 *
 * ── KİMLİK PROP, GLOBAL DEĞİL ─────────────────────────────────────────────
 * Filigran kullanıcısı ve parmak izi zorunlu prop (bkz. Chrome.tsx başlığı) —
 * sunucuda modül globali eşzamanlı istekler arasında sızar.
 */

export type PerformanceDocSatir = {
  /** Filo genelindeki sıra (1 tabanlı); satır yoksa null. */
  sira: number | null;
  skor: string;
  vardiya: string;
  calisma: string;
  km: string;
  teslim: string;
  teslimEdilemeyen: string;
  ihlal: string;
  sertFren: string;
  aniHizlanma: string;
  asiriHiz: string;
};

export type PerformanceDocProps = {
  /** Belge dili — verilmezse Almanca (eski davranış). */
  dil?: string | null;
  adSoyad: string;
  /** "01.08.2026 – 18.08.2026" — hazır dize. */
  donem: string;
  /** de-AT biçiminde üretim anı — hazır dize. */
  uretimAni: string;
  /** false → skor satırı HİÇ basılmaz (kalibrasyon bekliyor). */
  showScore: boolean;
  /** null → dönemde ne vardiya ne olay var. */
  satir: PerformanceDocSatir | null;
  filo: {
    soforSayisi: string;
    ortalamaSkor: string;
    skorlanan: string;
    yetersizVeri: string;
  };
  /**
   * Skor neden hesaplanamadı — hazır Almanca cümle; skor varsa null.
   * "—" tek başına yöneticiye hiçbir iş vermiyordu (bkz. lib/metric-thresholds.ts
   * başlığı: sebebi yazılmayan boşluk "panel bozuk" dedirtir).
   */
  skorNotu: string | null;
  /** Filigran için: belgeyi İSTEYEN kişi. */
  kullanici: string | null;
  /** Görünmez parmak izi (047); katman kapalıysa null. */
  isaret: string | null;
};

const DE = {
  title: "Fahrerleistungsbericht",
  employee: "Mitarbeiter",
  period: "Zeitraum",
  generatedAt: "Erstellt am",
  rank: "Rang",
  ofDrivers: "von",
  noData: "Keine Daten im gewählten Zeitraum.",
  sectionMetrics: "Kennzahlen",
  sectionFleet: "Flottenkontext",
  fleetAvg: "Flottendurchschnitt",
  fleetScored: "Bewertete Fahrer",
  fleetInsufficient: "Unzureichende Daten",
  fleetTotal: "Fahrer gesamt",
  footer: "Sicherheitsscore: 100 = keine Ereignisse, km-normalisiert",
  footerNoScore:
    "Sicherheitsscore wird derzeit kalibriert — Spalte vorübergehend ausgeblendet",
  rows: {
    score: "Sicherheitsscore",
    shifts: "Schichten",
    worked: "Arbeitszeit",
    km: "km",
    delivered: "Zugestellt",
    undelivered: "Nicht zugestellt",
    events: "Ereignisse gesamt",
    braking: "Bremsen",
    accel: "Beschl.",
    speeding: "Tempo",
  },
} as const;

/**
 * TÜRKÇE İKİZ (21.08.2026). Rapor dili artık kullanıcıya soruluyor
 * (`?dil=`), panelden türetilmiyor — Volkan kararı.
 *
 * ⚠️ ANAHTARLAR `DE` ile BİREBİR aynı olmak zorunda: belge gövdesi tek bir
 * etiket kümesi üzerinden çiziliyor, eksik anahtar sessizce `undefined`
 * basardı. `EtiketKumesi` tipi bunu derleme anında zorluyor.
 */
const TR = {
  title: "Sürücü Performans Raporu",
  employee: "Personel",
  period: "Dönem",
  generatedAt: "Oluşturulma",
  rank: "Sıra",
  ofDrivers: "/",
  noData: "Seçili dönemde veri yok.",
  sectionMetrics: "Ölçümler",
  sectionFleet: "Filo bağlamı",
  fleetAvg: "Filo ortalaması",
  fleetScored: "Skorlanan şoför",
  fleetInsufficient: "Yetersiz veri",
  fleetTotal: "Toplam şoför",
  footer: "Güvenlik skoru: 100 = hiç olay yok, km'ye göre normalize",
  footerNoScore:
    "Güvenlik skoru şu anda kalibre ediliyor — sütun geçici olarak gizlendi",
  rows: {
    score: "Güvenlik skoru",
    shifts: "Vardiya",
    worked: "Çalışma",
    km: "km",
    delivered: "Teslim",
    undelivered: "Teslim edilemeyen",
    events: "Toplam olay",
    braking: "Sert fren",
    accel: "Ani hız.",
    speeding: "Aşırı hız",
  },
} as const;

/**
 * `DE`nin ANAHTAR KÜMESİ, değerleri serbest metin. `typeof DE` kullanmak
 * `as const` yüzünden değerleri de sabitler ve Türkçe metni reddederdi;
 * amaç değeri değil ANAHTARI zorlamak.
 */
type EtiketKumesi = {
  [K in keyof typeof DE]: (typeof DE)[K] extends Record<string, unknown>
    ? { [R in keyof (typeof DE)[K]]: string }
    : string;
};
/** Derleme anı kontrolü: TR'de eksik/fazla anahtar varsa burada patlar. */
const TR_KONTROL: EtiketKumesi = TR;
void TR_KONTROL;

/** Dil → etiket kümesi. Bilinmeyen/boş dilde Almanca (eski hâl). */
function etiketler(dil?: string | null): EtiketKumesi {
  return dil === "tr" ? TR : DE;
}

// Panelin PerformanceReport.tsx'iyle aynı renk/ölçü dili — iki belge aynı yüz.
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
  company: { fontSize: 11, fontWeight: "bold" },
  address: { fontSize: 8, color: "#475569", marginTop: 2 },
  title: { fontSize: 14, fontWeight: "bold" },
  meta: { fontSize: 8, color: "#64748b", textAlign: "right", marginTop: 2 },

  kimlik: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    backgroundColor: "#f8fafc",
    padding: 10,
    marginBottom: 14,
  },
  ad: { fontSize: 15, fontWeight: "bold" },
  sira: { fontSize: 9, color: "#475569", marginTop: 3 },

  h2: { fontSize: 10, fontWeight: "bold", color: "#334155", marginBottom: 5 },
  table: { width: "100%", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  trAlt: { backgroundColor: "#fafbfc" },
  trSon: { borderBottomWidth: 0 },
  etiket: { padding: 6, fontSize: 9, color: "#334155", width: "60%" },
  deger: { padding: 6, fontSize: 9, color: "#0f172a", width: "40%", textAlign: "right" },

  bosluk: { marginTop: 14 },
  not: {
    marginTop: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    borderRadius: 4,
    fontSize: 8,
    color: "#78350f",
  },
  bosVeri: {
    marginTop: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    fontSize: 9,
    color: "#64748b",
  },
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

function Satir({
  etiket,
  deger,
  alt,
  son,
}: {
  etiket: string;
  deger: string;
  alt: boolean;
  son?: boolean;
}) {
  return (
    <View style={[styles.tr, alt ? styles.trAlt : {}, son ? styles.trSon : {}]} wrap={false}>
      <Text style={styles.etiket}>{etiket}</Text>
      <Text style={styles.deger}>{deger}</Text>
    </View>
  );
}

export function PerformanceDoc(p: PerformanceDocProps) {
  const L = etiketler(p.dil);
  const kalemler: { etiket: string; deger: string }[] = [];
  if (p.satir) {
    // Skor kalibre edilmemişse kâğıda HİÇ girmez — panelin kuralının aynısı
    // (22.07.2026): basılmış yanlış bir sayı ekrandakinden uzun yaşar.
    if (p.showScore) kalemler.push({ etiket: L.rows.score, deger: p.satir.skor });
    kalemler.push(
      { etiket: L.rows.shifts, deger: p.satir.vardiya },
      { etiket: L.rows.worked, deger: p.satir.calisma },
      { etiket: L.rows.km, deger: p.satir.km },
      { etiket: L.rows.delivered, deger: p.satir.teslim },
      { etiket: L.rows.undelivered, deger: p.satir.teslimEdilemeyen },
      { etiket: L.rows.events, deger: p.satir.ihlal },
      { etiket: L.rows.braking, deger: p.satir.sertFren },
      { etiket: L.rows.accel, deger: p.satir.aniHizlanma },
      { etiket: L.rows.speeding, deger: p.satir.asiriHiz }
    );
  }

  const filoKalemleri = [
    { etiket: L.fleetAvg, deger: p.filo.ortalamaSkor },
    { etiket: L.fleetScored, deger: p.filo.skorlanan },
    { etiket: L.fleetInsufficient, deger: p.filo.yetersizVeri },
    { etiket: L.fleetTotal, deger: p.filo.soforSayisi },
  ];

  return (
    <Document title={`${L.title} — ${p.adSoyad}`} {...fingerprintDocPropsServer(p.isaret)}>
      <Page size="A4" style={styles.page} wrap>
        <WatermarkServer kullanici={p.kullanici} damga={p.uretimAni} />
        <FingerprintServer isaret={p.isaret} />

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
            <Text style={styles.title}>{L.title}</Text>
            <Text style={styles.meta}>
              {L.period}: {p.donem}
            </Text>
            <Text style={styles.meta}>
              {L.generatedAt}: {p.uretimAni}
            </Text>
          </View>
        </View>

        <View style={styles.kimlik}>
          <Text style={styles.ad}>{p.adSoyad}</Text>
          <Text style={styles.sira}>
            {L.employee}
            {p.satir?.sira !== null && p.satir !== null
              ? ` · ${L.rank} ${p.satir.sira} ${L.ofDrivers} ${p.filo.soforSayisi}`
              : ""}
          </Text>
        </View>

        {p.satir === null ? (
          <Text style={styles.bosVeri}>{L.noData}</Text>
        ) : (
          <>
            <Text style={styles.h2}>{L.sectionMetrics}</Text>
            <View style={styles.table}>
              {kalemler.map((k, i) => (
                <Satir
                  key={k.etiket}
                  etiket={k.etiket}
                  deger={k.deger}
                  alt={i % 2 === 1}
                  son={i === kalemler.length - 1}
                />
              ))}
            </View>
            {p.skorNotu ? <Text style={styles.not}>{p.skorNotu}</Text> : null}
          </>
        )}

        <View style={styles.bosluk}>
          <Text style={styles.h2}>{L.sectionFleet}</Text>
          <View style={styles.table}>
            {filoKalemleri.map((k, i) => (
              <Satir
                key={k.etiket}
                etiket={k.etiket}
                deger={k.deger}
                alt={i % 2 === 1}
                son={i === filoKalemleri.length - 1}
              />
            ))}
          </View>
        </View>

        <View style={styles.footer_} fixed>
          <Text>{p.showScore ? L.footer : L.footerNoScore}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
