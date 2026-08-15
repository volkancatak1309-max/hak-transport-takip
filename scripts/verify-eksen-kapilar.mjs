#!/usr/bin/env node
/**
 * EKSEN DÜZELTMESİ · KAPI DENETİMİ — ARIZA ENJEKSİYONU. YAZMAZ, DB'YE GİTMEZ.
 *
 * `shiftWindowsForScoring` km ile AYNI üç durumu ayırmak zorunda; ayırmazsa
 * 052'siz bir kurulumda (Sendigo/Galzura — rpc yok) TÜM olaylar sahipsiz kalır
 * ve her şoför "veri yok"a düşer. Bu betik o üç durumu ve pencere eşleme
 * kurallarını UYDURMA sonuç yerine ÜRETİM fonksiyonlarına sorarak doğrular.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-eksen-kapilar.mjs
 */
import { shiftWindowsForScoring, workerDrivingAt, computeSafetyScores } from "@/lib/analytics";

let gecti = 0;
let kaldi = 0;
const iddia = (ad, kosul) => {
  if (kosul) {
    gecti++;
    console.log(`  ✓ ${ad}`);
  } else {
    kaldi++;
    console.log(`  ✗ ${ad}`);
  }
};

console.log(`\n══ EKSEN KAPILARI · ARIZA ENJEKSİYONU ══`);

// ── 1. ÜÇ DURUM ────────────────────────────────────────────────────────────
console.log(`\n── 1. shiftWindowsForScoring üç durumu (km ile AYNI ayrım) ──`);
{
  const yok = shiftWindowsForScoring({ km: null, coverage: null, windows: null, unavailable: "missing_function" });
  iddia("missing_function → undefined (eski ATAMA yoluna düşer)", yok === undefined);

  const zamanAsimi = shiftWindowsForScoring({ km: null, coverage: null, windows: null, unavailable: "timeout" });
  iddia("timeout → BOŞ harita (km de boş; hiçbir skor üretilmez)", zamanAsimi instanceof Map && zamanAsimi.size === 0);

  const hata = shiftWindowsForScoring({ km: null, coverage: null, windows: null, unavailable: "error" });
  iddia("error → BOŞ harita", hata instanceof Map && hata.size === 0);

  const ok = shiftWindowsForScoring({
    km: new Map(), coverage: new Map(), unavailable: null,
    windows: [
      { workerId: "w1", vehicleId: "v1", startMs: 200, endMs: 300 },
      { workerId: "w2", vehicleId: "v1", startMs: 100, endMs: 150 },
      { workerId: "w3", vehicleId: "v2", startMs: 100, endMs: 150 },
    ],
  });
  iddia("başarılı → araç eksenli harita (2 araç)", ok instanceof Map && ok.size === 2);
  iddia("pencereler başlangıca göre SIRALI", ok.get("v1")[0].startMs === 100 && ok.get("v1")[1].startMs === 200);
}

// ── 2. PENCERE EŞLEME ──────────────────────────────────────────────────────
console.log(`\n── 2. workerDrivingAt eşleme kuralları ──`);
{
  const t = (ms) => new Date(ms).toISOString();
  const w = shiftWindowsForScoring({
    km: new Map(), coverage: new Map(), unavailable: null,
    windows: [
      { workerId: "erken", vehicleId: "v1", startMs: 1000, endMs: 2000 },
      { workerId: "gec", vehicleId: "v1", startMs: 1500, endMs: 2500 },
    ],
  });
  iddia("pencere içi → o vardiyanın şoförü", workerDrivingAt(w, "v1", t(1200)) === "erken");
  iddia("başlangıç ANI dahil", workerDrivingAt(w, "v1", t(1000)) === "erken");
  iddia("bitiş ANI dahil", workerDrivingAt(w, "v1", t(2500)) === "gec");
  iddia("pencere ÖNCESİ → null (uydurma atıf YOK)", workerDrivingAt(w, "v1", t(999)) === null);
  iddia("pencere SONRASI → null", workerDrivingAt(w, "v1", t(2501)) === null);
  iddia("ÇAKIŞMADA en geç başlayan kazanır", workerDrivingAt(w, "v1", t(1800)) === "gec");
  iddia("hiç vardiyası olmayan araç → null", workerDrivingAt(w, "yok", t(1200)) === null);
  iddia("bozuk zaman damgası → null (çökme yok)", workerDrivingAt(w, "v1", "abc") === null);
}

// ── 3. GERİYE DÖNÜK UYUM ───────────────────────────────────────────────────
console.log(`\n── 3. computeSafetyScores: 9. argüman YOKSA eski ATAMA davranışı ──`);
{
  const vehiclesById = new Map([["v1", { id: "v1", plate: "TEST-1", assigned_worker_id: "w1" }]]);
  const workersById = new Map([["w1", { id: "w1", name: "Ata Nan" }]]);
  const events = [
    { id: "e1", vehicle_id: "v1", event_type: "harsh_braking", occurred_at: "2026-08-01T10:00:00.000Z", plate: "TEST-1" },
  ];
  const distanceByVehicle = new Map([["v1", 1000]]);
  const shiftKm = new Map([["w1", 1000]]);

  const eski = computeSafetyScores(events, [], vehiclesById, workersById, distanceByVehicle, 0, undefined, shiftKm);
  iddia("pencere YOK → olay atanmış şoföre yazıldı", eski[0].totalEvents === 1);

  // Pencere VAR ama olay hiçbirine düşmüyor → sahipsiz.
  const disarida = shiftWindowsForScoring({
    km: new Map(), coverage: new Map(), unavailable: null,
    windows: [{ workerId: "w1", vehicleId: "v1", startMs: Date.parse("2026-08-02T00:00:00Z"), endMs: Date.parse("2026-08-02T12:00:00Z") }],
  });
  const yeni = computeSafetyScores(events, [], vehiclesById, workersById, distanceByVehicle, 0, undefined, shiftKm, disarida);
  iddia("pencere VAR, olay dışarıda → hiç kimseye yazılmadı", yeni[0].totalEvents === 0 && yeni[0].penalty === 0);
  iddia("skor yine üretiliyor (km eşiği geçiyor)", yeni[0].score === 100);

  // Olay BAŞKA şoförün penceresinde → atanmış şoför almaz.
  const baskasinin = shiftWindowsForScoring({
    km: new Map(), coverage: new Map(), unavailable: null,
    windows: [{ workerId: "w2", vehicleId: "v1", startMs: Date.parse("2026-08-01T08:00:00Z"), endMs: Date.parse("2026-08-01T18:00:00Z") }],
  });
  const devir = computeSafetyScores(events, [], vehiclesById, workersById, distanceByVehicle, 0, undefined, shiftKm, baskasinin);
  iddia("olay BAŞKASININ vardiyasında → atanmış şoför cezalanmaz", devir[0].totalEvents === 0);
}

console.log(`\n══ ${gecti} geçti · ${kaldi} kaldı ══\n`);
process.exit(kaldi === 0 ? 0 : 1);
