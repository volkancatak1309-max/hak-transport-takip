#!/usr/bin/env node
/**
 * SÜRÜCÜ PERFORMANSI UÇLARI — CANLIDA KANIT.
 *
 * NE YAPAR: dört ucun GERÇEK işleyicilerini çağırır. Sorgu yolu taklit
 * EDİLMEZ; kapı dahil uçtan uca çalışır, token deponun kendi `issueTokens`'ıyla
 * mühürlenir.
 *
 * ── ⚠️ CANLI VERİTABANI: NEYE DOKUNUR ────────────────────────────────────
 * Okuma bölümleri (driver-scores, performans) HİÇBİR ŞEY yazmaz.
 * Yazma bölümleri (pin, pasif) YALNIZCA `is_test = true` işaretli test
 * hesabında çalışır (migration 028) — hiçbir gerçek kişiye dokunulmaz.
 * Emniyetler:
 *   • koşum başında test hesabının `pin_hash`, `must_change_pin`, `is_active`,
 *     `terminated_at`, `token_version` değerleri alınır;
 *   • `finally` içinde HEPSİ geri yazılır ve geri yazmanın TUTTUĞU ölçülür
 *     ("geri aldım" demek yetmez);
 *   • test hesabı yoksa yazma bölümleri ÖLÇÜLMEDİ sayılır, uydurulmaz.
 * Gerçek kişilere giden tek istekler REDDEDİLMESİ BEKLENEN isteklerdir
 * (yetkisiz token, geçersiz girdi, var olmayan kimlik) ve hiçbiri yazmaya
 * ulaşmaz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-sofor-performans.mjs
 */
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { buildPerformanceReport } from "@/lib/reports";
import { computeAnalyticsRange } from "@/lib/analytics";
import { GET as SCORES_GET } from "@/app/api/mobile/driver-scores/route";
import { GET as PERF_GET } from "@/app/api/mobile/workers/[id]/performans/route";
import { POST as PIN_POST } from "@/app/api/mobile/workers/[id]/pin/route";
import { POST as PASIF_POST } from "@/app/api/mobile/workers/[id]/pasif/route";

const YOK_UUID = "00000000-0000-4000-8000-000000000000";
/** Zayıf değil, sıralı değil, tekrar değil — şemadan geçmesi beklenen değer. */
const GECICI_PIN = "418302";

let dusen = 0;
let olculmeyen = 0;

function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function olculmedi(baslik, sebep) {
  console.log(`  ○ ${baslik}  —  ÖLÇÜLMEDİ (${sebep})`);
  olculmeyen++;
}
function bilgi(satir) {
  console.log(`     ${satir}`);
}

const istek = (url, init = {}, token) => {
  const h = { ...(init.headers ?? {}) };
  if (token) h.authorization = `Bearer ${token}`;
  if (init.body !== undefined) h["content-type"] = "application/json";
  return new Request(url, { ...init, headers: h });
};
const govde = (o) => (typeof o === "string" ? o : JSON.stringify(o));

async function skorlar(qs, token) {
  const res = await SCORES_GET(
    istek(`http://x/api/mobile/driver-scores${qs ?? ""}`, {}, token)
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function performans(id, qs, token) {
  const res = await PERF_GET(
    istek(`http://x/api/mobile/workers/x/performans${qs ?? ""}`, {}, token),
    { params: Promise.resolve({ id }) }
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function pinAta(id, g, token) {
  const init = { method: "POST" };
  if (g !== undefined) init.body = govde(g);
  const res = await PIN_POST(istek("http://x/api/mobile/workers/x/pin", init, token), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function pasifYap(id, g, token) {
  const init = { method: "POST" };
  if (g !== undefined) init.body = govde(g);
  const res = await PASIF_POST(istek("http://x/api/mobile/workers/x/pasif", init, token), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Test hesabının koşum başındaki hâli — geri alma bundan yapılır. */
let testBas = null;
let testId = null;

console.log(`\n╔══ SÜRÜCÜ PERFORMANSI UÇLARI · CANLIDA KANIT ══════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

try {
  // ── Hazırlık ─────────────────────────────────────────────────────────────
  const { data: patron } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", true)
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (!patron) {
    console.error("✗ aktif yönetici hesabı bulunamadı, çıkıyorum.");
    process.exit(1);
  }
  const { data: sofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", false)
    .eq("is_active", true)
    .is("managed_fleet", null)
    .order("name")
    .limit(1)
    .maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version, managed_fleet")
    .not("managed_fleet", "is", null)
    .eq("is_admin", false)
    .eq("is_active", true)
    .order("name")
    .limit(1);
  const sef = (sefler ?? [])[0] ?? null;
  const { data: testHesap } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_test, is_active, terminated_at, must_change_pin, pin_hash, token_version")
    .eq("is_test", true)
    .limit(1)
    .maybeSingle();

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0))
    .accessToken;
  const soforToken = sofor
    ? (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken
    : null;
  const sefToken = sef
    ? (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken
    : null;

  if (testHesap) {
    testId = testHesap.id;
    testBas = {
      is_active: testHesap.is_active,
      terminated_at: testHesap.terminated_at ?? null,
      must_change_pin: testHesap.must_change_pin,
      pin_hash: testHesap.pin_hash,
      token_version: testHesap.token_version ?? 0,
    };
  }

  console.log(`║ patron  ${patron.name.slice(0, 3)}***`);
  console.log(`║ şoför   ${sofor ? `${sofor.name.slice(0, 3)}***` : "YOK"}`);
  console.log(`║ şef     ${sef ? `${sef.name.slice(0, 3)}*** (${sef.managed_fleet})` : "YOK"}`);
  console.log(`║ test    ${testHesap ? `${testHesap.name.slice(0, 3)}*** (aktif=${testHesap.is_active})` : "YOK"}`);

  // ══ 1. KAPI ══════════════════════════════════════════════════════════════
  console.log(`\n── 1. KAPI (dört uç) ──`);
  const hedefId = sofor?.id ?? YOK_UUID;
  const kapilar = [
    ["GET  /driver-scores", (t) => skorlar("", t)],
    ["GET  /workers/[id]/performans", (t) => performans(hedefId, "", t)],
    ["POST /workers/[id]/pin", (t) => pinAta(hedefId, { pin: "000000" }, t)],
    ["POST /workers/[id]/pasif", (t) => pasifYap(hedefId, {}, t)],
  ];
  for (const [ad, cagir] of kapilar) {
    const t0 = await cagir(null);
    iddia(`${ad} · token yok → 401`, t0.status === 401, `${t0.status} ${t0.json?.error}`);
    const t1 = await cagir("kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, t1.status === 401, `${t1.status} ${t1.json?.error}`);
    if (soforToken) {
      const t2 = await cagir(soforToken);
      iddia(
        `${ad} · ŞOFÖR → 403 admin_required`,
        t2.status === 403 && t2.json?.error === "admin_required",
        `${t2.status} ${t2.json?.error}`
      );
    } else olculmedi(`${ad} · şoför → 403`, "aktif şoför hesabı yok");
    if (sefToken) {
      const t3 = await cagir(sefToken);
      iddia(
        `${ad} · FİLO ŞEFİ → 403 admin_required`,
        t3.status === 403 && t3.json?.error === "admin_required",
        `${t3.status} ${t3.json?.error}`
      );
    } else olculmedi(`${ad} · filo şefi → 403`, "filo şefi hesabı yok");
  }
  bilgi("NOT: yukarıdaki reddedilen istekler yazmaya ULAŞMADI (kapı ilk satırda).");

  // ══ 2. GİRDİ REDLERİ ═════════════════════════════════════════════════════
  console.log(`\n── 2. GİRDİ REDLERİ (hiçbiri yazmıyor) ──`);
  {
    const a = await skorlar("?donem=aylik", patronToken);
    iddia(
      "donem=aylik → 400 invalid_donem + geçerli küme",
      a.status === 400 &&
        a.json?.error === "invalid_donem" &&
        Array.isArray(a.json?.gecerli) &&
        a.json.gecerli.join(",") === "gun,hafta,ay",
      `${a.status} ${a.json?.error} gecerli=${JSON.stringify(a.json?.gecerli)}`
    );
    const b = await skorlar("?tarih=12.08.2026", patronToken);
    iddia(
      "tarih=12.08.2026 → 400 invalid_tarih",
      b.status === 400 && b.json?.error === "invalid_tarih",
      `${b.status} ${b.json?.error}`
    );
    // Biçimi doğru, takvimde YOK. Denetim olmasaydı sessizce 3 Mart'a kayardı.
    const c = await skorlar("?tarih=2026-02-31", patronToken);
    iddia(
      "tarih=2026-02-31 (takvimde yok) → 400 invalid_tarih",
      c.status === 400 && c.json?.error === "invalid_tarih",
      `${c.status} ${c.json?.error}`
    );
    const d = await skorlar("?tarih=2026-13-01", patronToken);
    iddia(
      "tarih=2026-13-01 (13. ay) → 400 invalid_tarih",
      d.status === 400 && d.json?.error === "invalid_tarih",
      `${d.status} ${d.json?.error}`
    );
  }
  {
    const a = await pinAta(YOK_UUID, undefined, patronToken);
    iddia("pin · gövde yok → 400 invalid_json", a.status === 400 && a.json?.error === "invalid_json", `${a.status} ${a.json?.error}`);
    const b = await pinAta(YOK_UUID, {}, patronToken);
    iddia("pin · alan yok → 400 missing_fields", b.status === 400 && b.json?.error === "missing_fields", `${b.status} ${b.json?.error}`);
    const c = await pinAta(YOK_UUID, { pin: 418302 }, patronToken);
    iddia("pin · sayı → 400 invalid/metin_degil", c.status === 400 && c.json?.error === "invalid" && c.json?.sebep === "metin_degil", `${c.status} ${c.json?.error}/${c.json?.sebep}`);
    const d = await pinAta(YOK_UUID, { pin: "12345" }, patronToken);
    iddia("pin · 5 hane → 400 invalid_pin/errPin", d.status === 400 && d.json?.error === "invalid_pin" && d.json?.sebep === "errPin", `${d.status} ${d.json?.error}/${d.json?.sebep}`);
    const e = await pinAta(YOK_UUID, { pin: "111111" }, patronToken);
    iddia("pin · 111111 zayıf → 400 invalid_pin/errPinWeak", e.status === 400 && e.json?.error === "invalid_pin" && e.json?.sebep === "errPinWeak", `${e.status} ${e.json?.error}/${e.json?.sebep}`);
    const f = await pinAta(YOK_UUID, { pin: "654321" }, patronToken);
    iddia("pin · 654321 zayıf → 400 invalid_pin/errPinWeak", f.status === 400 && f.json?.error === "invalid_pin" && f.json?.sebep === "errPinWeak", `${f.status} ${f.json?.error}/${f.json?.sebep}`);
    // 123456 saha standardı: ŞEMA KABUL EDER. Var olmayan kimliğe gönderiyoruz
    // → 404'e düşer, yani şemanın geçtiği yazmaya ulaşmadan kanıtlanır.
    const g = await pinAta(YOK_UUID, { pin: "123456" }, patronToken);
    iddia("pin · 123456 şemadan GEÇER, kimlik yok → 404", g.status === 404 && g.json?.error === "not_found", `${g.status} ${g.json?.error}`);
    const h = await pinAta(YOK_UUID, { pin: GECICI_PIN, mustChange: "evet" }, patronToken);
    iddia("pin · mustChange metin → 400 invalid/boolean_degil", h.status === 400 && h.json?.error === "invalid" && h.json?.sebep === "boolean_degil", `${h.status} ${h.json?.error}/${h.json?.sebep}`);
  }
  {
    const a = await pasifYap(YOK_UUID, {}, patronToken);
    iddia("pasif · alan yok → 400 missing_fields", a.status === 400 && a.json?.error === "missing_fields", `${a.status} ${a.json?.error}`);
    const b = await pasifYap(YOK_UUID, { pasif: "evet" }, patronToken);
    iddia("pasif · metin → 400 invalid/boolean_degil", b.status === 400 && b.json?.error === "invalid" && b.json?.sebep === "boolean_degil", `${b.status} ${b.json?.error}/${b.json?.sebep}`);
    const c = await pasifYap(YOK_UUID, { pasif: true }, patronToken);
    iddia("pasif · kimlik yok → 404 not_found", c.status === 404 && c.json?.error === "not_found", `${c.status} ${c.json?.error}`);
  }

  // ══ 3. DRIVER-SCORES — GERÇEK SAYILAR ════════════════════════════════════
  console.log(`\n── 3. GET /driver-scores · canlı sayılar ──`);
  const donemler = {};
  for (const d of ["gun", "hafta", "ay"]) {
    const r = await skorlar(`?donem=${d}&limit=200`, patronToken);
    if (r.status !== 200) {
      iddia(`donem=${d} → 200`, false, `${r.status} ${r.json?.error}`);
      continue;
    }
    donemler[d] = r.json;
    const j = r.json;
    bilgi(
      `donem=${d.padEnd(5)} · şoför ${String(j.skor.soforSayisi).padStart(2)}` +
        ` · skorlanan ${String(j.skor.skorlanan).padStart(2)}` +
        ` · yetersiz veri ${String(j.skor.yetersizVeri).padStart(2)}` +
        ` · vardiya ${String(j.toplam.vardiya).padStart(3)}` +
        ` · km ${Math.round(j.toplam.km).toLocaleString("tr-TR").padStart(7)}` +
        ` · ort.skor ${j.skor.ortalama ?? "—"}`
    );
    iddia(
      `donem=${d} · satır sayısı = skor.soforSayisi = sayfa.total`,
      j.satirlar.length === j.skor.soforSayisi && j.sayfa.total === j.skor.soforSayisi,
      `${j.satirlar.length}/${j.skor.soforSayisi}/${j.sayfa.total}`
    );
    iddia(
      `donem=${d} · sıra 1..n kesintisiz`,
      j.satirlar.every((s, i) => s.sira === i + 1),
      `ilk=${j.satirlar[0]?.sira} son=${j.satirlar.at(-1)?.sira}`
    );
    iddia(
      `donem=${d} · yetersizVeri ⇔ guvenlikSkoru===null`,
      j.satirlar.every((s) => s.yetersizVeri === (s.guvenlikSkoru === null)),
      `${j.satirlar.filter((s) => s.yetersizVeri).length} satır işaretli`
    );
    iddia(
      `donem=${d} · skorsuz satırda skor UYDURULMAMIŞ`,
      j.satirlar.filter((s) => s.yetersizVeri).every((s) => s.guvenlikSkoru === null),
      `0'a çakılan yok`
    );
  }
  if (donemler.gun && donemler.hafta && donemler.ay) {
    iddia(
      "dönem değişince sayılar DEĞİŞİYOR (gun < hafta ≤ ay, vardiya)",
      donemler.gun.toplam.vardiya < donemler.hafta.toplam.vardiya &&
        donemler.hafta.toplam.vardiya <= donemler.ay.toplam.vardiya,
      `${donemler.gun.toplam.vardiya} / ${donemler.hafta.toplam.vardiya} / ${donemler.ay.toplam.vardiya}`
    );
    iddia(
      "pencere uzunlukları 1 / 7 / 30 gün",
      donemler.gun.donem.gun === 1 &&
        donemler.hafta.donem.gun === 7 &&
        donemler.ay.donem.gun === 30,
      `${donemler.gun.donem.gun}/${donemler.hafta.donem.gun}/${donemler.ay.donem.gun}`
    );
  }

  // Demirli pencere = kayan pencere (tarih = bugün)
  {
    const bugun = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
    const kayan = donemler.hafta;
    const demirli = (await skorlar(`?donem=hafta&tarih=${bugun}&limit=200`, patronToken)).json;
    iddia(
      `tarih=${bugun} demirli pencere ≡ kayan pencere (aynı aralık)`,
      demirli?.donem?.baslangic === kayan?.donem?.baslangic &&
        demirli?.donem?.bitis === kayan?.donem?.bitis,
      `${demirli?.donem?.baslangic} → ${demirli?.donem?.bitis}`
    );
    iddia(
      "demirli/kayan aynı şoför sayısı",
      demirli?.skor?.soforSayisi === kayan?.skor?.soforSayisi,
      `${demirli?.skor?.soforSayisi} = ${kayan?.skor?.soforSayisi}`
    );
    iddia("demirli pencere `demirli:true` diyor", demirli?.donem?.demirli === true, String(demirli?.donem?.demirli));
    iddia("kayan pencere `demirli:false` diyor", kayan?.donem?.demirli === false, String(kayan?.donem?.demirli));
  }

  // Önceki dönem sıralaması
  {
    const j = donemler.hafta;
    const oncekili = j.satirlar.filter((s) => s.oncekiSira !== null);
    const oncekisiz = j.satirlar.filter((s) => s.oncekiSira === null);
    iddia(
      "önceki dönem bloğu var (baslangic/bitis/satirSayisi)",
      j.oncekiDonem !== null &&
        typeof j.oncekiDonem.satirSayisi === "number",
      j.oncekiDonem
        ? `${j.oncekiDonem.baslangic.slice(0, 10)} → ${j.oncekiDonem.bitis.slice(0, 10)} · ${j.oncekiDonem.satirSayisi} satır`
        : "null"
    );
    bilgi(
      `önceki sırası OLAN ${oncekili.length} şoför · OLMAYAN ${oncekisiz.length}` +
        ` (önceki dönemde rapora hiç girmemiş)`
    );
    iddia(
      "siraDegisimi = oncekiSira − sira (uydurulmuş 0 yok)",
      j.satirlar.every((s) =>
        s.oncekiSira === null
          ? s.siraDegisimi === null
          : s.siraDegisimi === s.oncekiSira - s.sira
      ),
      `${oncekisiz.length} satırda null (0 değil)`
    );
    const hareketli = oncekili.filter((s) => s.siraDegisimi !== 0);
    bilgi(
      `sırası DEĞİŞEN ${hareketli.length} şoför` +
        (hareketli.length
          ? ` · en büyük hareket ${Math.max(...hareketli.map((s) => Math.abs(s.siraDegisimi)))} basamak`
          : "")
    );
  }

  // Sayfalama
  {
    const j = await skorlar("?donem=hafta&limit=5", patronToken);
    const tam = donemler.hafta;
    iddia(
      "limit=5 · dilim 5 satır, total TAM sayı, sıra global",
      j.json.satirlar.length === Math.min(5, tam.skor.soforSayisi) &&
        j.json.sayfa.total === tam.skor.soforSayisi &&
        j.json.satirlar[0]?.sira === 1,
      `${j.json.satirlar.length} satır / total ${j.json.sayfa.total} / hasMore ${j.json.sayfa.hasMore}`
    );
    const o = await skorlar("?donem=hafta&limit=5&offset=5", patronToken);
    iddia(
      "offset=5 · sıra 6'dan başlıyor (dilim sıralamayı bozmuyor)",
      tam.skor.soforSayisi <= 5 || o.json.satirlar[0]?.sira === 6,
      `ilk sıra ${o.json.satirlar[0]?.sira}`
    );
  }

  // ══ 4. PANEL PARİTESİ ════════════════════════════════════════════════════
  console.log(`\n── 4. PANEL PARİTESİ (lib/reports.ts doğrudan çağrıldı) ──`);
  const panel = await buildPerformanceReport(computeAnalyticsRange("hafta"));
  const uc = donemler.hafta;
  iddia(
    "satır sayısı birebir",
    panel.rows.length === uc.satirlar.length,
    `panel ${panel.rows.length} = uç ${uc.satirlar.length}`
  );
  {
    let sapan = 0;
    let msSapma = 0;
    for (let i = 0; i < Math.min(panel.rows.length, uc.satirlar.length); i++) {
      const p = panel.rows[i];
      const m = uc.satirlar[i];
      msSapma = Math.max(msSapma, Math.abs(p.workedMs - m.calismaMs));
      const esit =
        p.workerId === m.workerId &&
        p.name === m.adSoyad &&
        p.shifts === m.vardiya &&
        p.km === m.km &&
        p.delivered === m.teslim &&
        p.undelivered === m.teslimEdilemeyen &&
        p.safetyScore === m.guvenlikSkoru &&
        p.events === m.ihlal.toplam &&
        p.harshBraking === m.ihlal.sertFren &&
        p.harshAcceleration === m.ihlal.aniHizlanma &&
        p.overspeeding === m.ihlal.asiriHiz;
      if (!esit) sapan++;
    }
    iddia(
      "her satırın 11 alanı birebir (workerId/ad/vardiya/km/teslim/skor/4 ihlal)",
      sapan === 0,
      `${sapan} sapan satır`
    );
    // workedMs AÇIK vardiyada Date.now() okur — iki çağrı arası kayar. Sapmayı
    // gizlemiyoruz, ÖLÇÜYORUZ: dakikalar mertebesindeyse hesap ayrışmış demektir.
    iddia(
      "calismaMs sapması yalnız açık vardiyanın saat farkı (< 60 sn)",
      msSapma < 60_000,
      `en büyük sapma ${msSapma} ms`
    );
  }
  iddia(
    "toplamlar birebir (vardiya / km)",
    panel.totalShifts === uc.toplam.vardiya &&
      Math.abs(panel.totalKm - uc.toplam.km) < 0.001,
    `${panel.totalShifts}=${uc.toplam.vardiya} · ${panel.totalKm.toFixed(1)}=${uc.toplam.km.toFixed(1)}`
  );
  iddia(
    "ortalama skor / skorlanan birebir",
    panel.avgScore === uc.skor.ortalama && panel.scoredCount === uc.skor.skorlanan,
    `ort ${panel.avgScore} · skorlanan ${panel.scoredCount}`
  );
  bilgi(`skor kalibrasyon bayrağı (SAFETY_SCORE_CALIBRATED) = ${uc.skor.kalibre}`);

  // ══ 5. TEK ŞOFÖR UCU ═════════════════════════════════════════════════════
  console.log(`\n── 5. GET /workers/[id]/performans ──`);
  {
    // İhlali EN ÇOK olan şoför — kırılımın gerçekten dolu olduğu satır.
    const enCok = [...panel.rows].sort((a, b) => b.events - a.events)[0] ?? null;
    if (!enCok) {
      olculmedi("tek şoför paritesi", "haftalık raporda satır yok");
    } else {
      const r = await performans(enCok.workerId, "?donem=hafta", patronToken);
      const j = r.json;
      iddia(`şoför ucu → 200 durum=var`, r.status === 200 && j?.durum === "var", `${r.status} ${j?.durum}`);
      bilgi(
        `${enCok.name.slice(0, 3)}*** · sıra ${j?.satir?.sira}/${j?.filo?.soforSayisi}` +
          ` · skor ${j?.satir?.guvenlikSkoru ?? "yetersiz veri"}` +
          ` · vardiya ${j?.satir?.vardiya} · km ${j?.satir?.km === null ? "—" : Math.round(j.satir.km)}`
      );
      bilgi(
        `ihlal kırılımı → toplam ${j?.satir?.ihlal?.toplam} =` +
          ` fren ${j?.satir?.ihlal?.sertFren} + hızlanma ${j?.satir?.ihlal?.aniHizlanma} +` +
          ` hız ${j?.satir?.ihlal?.asiriHiz}`
      );
      iddia(
        "İHLAL KIRILIMI panel raporuyla BİREBİR (4 alan)",
        j?.satir?.ihlal?.toplam === enCok.events &&
          j?.satir?.ihlal?.sertFren === enCok.harshBraking &&
          j?.satir?.ihlal?.aniHizlanma === enCok.harshAcceleration &&
          j?.satir?.ihlal?.asiriHiz === enCok.overspeeding,
        `panel ${enCok.events}/${enCok.harshBraking}/${enCok.harshAcceleration}/${enCok.overspeeding}`
      );
      const listeSatir = uc.satirlar.find((s) => s.workerId === enCok.workerId);
      iddia(
        "liste ucu ile tek-şoför ucu AYNI satırı veriyor (sıra + skor + km)",
        listeSatir &&
          listeSatir.sira === j?.satir?.sira &&
          listeSatir.guvenlikSkoru === j?.satir?.guvenlikSkoru &&
          listeSatir.km === j?.satir?.km,
        `sıra ${listeSatir?.sira}=${j?.satir?.sira}`
      );
      iddia(
        "filo.soforSayisi = liste satır sayısı (sıranın paydası)",
        j?.filo?.soforSayisi === uc.satirlar.length,
        `${j?.filo?.soforSayisi} = ${uc.satirlar.length}`
      );
    }

    const y = await performans(patron.id, "?donem=hafta", patronToken);
    iddia(
      "YÖNETİCİ kimliği → durum=sofor_degil (veri_yok DEĞİL)",
      y.status === 200 && y.json?.durum === "sofor_degil" && y.json?.satir === null,
      `${y.status} ${y.json?.durum}`
    );
    const n = await performans(YOK_UUID, "?donem=hafta", patronToken);
    iddia("var olmayan kimlik → 404 not_found", n.status === 404 && n.json?.error === "not_found", `${n.status} ${n.json?.error}`);
    const g = await performans(hedefId, "?donem=aylik", patronToken);
    iddia("geçersiz dönem → 400 invalid_donem", g.status === 400 && g.json?.error === "invalid_donem", `${g.status} ${g.json?.error}`);
  }

  // ══ 6. YAZMA UÇLARI — YALNIZ TEST HESABINDA ══════════════════════════════
  console.log(`\n── 6. YAZMA UÇLARI (yalnız is_test hesabı, sonra geri alınır) ──`);
  bilgi(
    "NOT: bu koşumda `panelTazelendi=false` BEKLENİR. revalidatePath istek" +
      " bağlamı ister; düz Node'da bağlam yok. Üretim sunucusunda (next start)" +
      " ölçüldü → true (12.08.2026)."
  );
  if (!testHesap) {
    olculmedi("pin / pasif mutlu yol", "is_test hesabı yok (migration 028)");
  } else {
    // ── pasif ──────────────────────────────────────────────────────────────
    const tvBas = (
      await supabaseAdmin.from("workers").select("token_version").eq("id", testId).maybeSingle()
    ).data?.token_version ?? 0;

    const p1 = await pasifYap(testId, { pasif: true }, patronToken);
    iddia("pasif=true → 200 degisti:true", p1.status === 200 && p1.json?.degisti === true, `${p1.status} degisti=${p1.json?.degisti} tokenIptal=${p1.json?.tokenIptal} panelTazelendi=${p1.json?.panelTazelendi}`);
    const s1 = (
      await supabaseAdmin.from("workers").select("is_active, terminated_at, token_version").eq("id", testId).maybeSingle()
    ).data;
    iddia("DB'de is_active=false", s1?.is_active === false, `is_active=${s1?.is_active}`);
    iddia(
      "⚠️ terminated_at DEĞİŞMEDİ (pasif ≠ işten çıkış)",
      (s1?.terminated_at ?? null) === testBas.terminated_at,
      `önce ${testBas.terminated_at ?? "null"} → sonra ${s1?.terminated_at ?? "null"}`
    );
    iddia("token_version arttı (mobil anahtar düştü)", (s1?.token_version ?? 0) > tvBas, `${tvBas} → ${s1?.token_version}`);

    const p2 = await pasifYap(testId, { pasif: true }, patronToken);
    const s2 = (
      await supabaseAdmin.from("workers").select("token_version").eq("id", testId).maybeSingle()
    ).data;
    iddia("aynı istek 2. kez → degisti:false (idempotent)", p2.status === 200 && p2.json?.degisti === false, `${p2.status} degisti=${p2.json?.degisti}`);
    iddia(
      "no-op'ta token_version ARTMADI (boşuna oturum düşürülmedi)",
      (s2?.token_version ?? 0) === (s1?.token_version ?? 0),
      `${s1?.token_version} = ${s2?.token_version}`
    );

    const p3 = await pasifYap(testId, { pasif: false }, patronToken);
    const s3 = (
      await supabaseAdmin.from("workers").select("is_active, terminated_at").eq("id", testId).maybeSingle()
    ).data;
    iddia("pasif=false → 200 degisti:true, is_active=true", p3.status === 200 && p3.json?.degisti === true && s3?.is_active === true, `${p3.status} is_active=${s3?.is_active}`);
    iddia(
      "geri açmada terminated_at TEMİZLENDİ (hayalet durum önlendi)",
      (s3?.terminated_at ?? null) === null,
      `terminated_at=${s3?.terminated_at ?? "null"}`
    );

    // ── pin ────────────────────────────────────────────────────────────────
    const k1 = await pinAta(testId, { pin: GECICI_PIN, mustChange: false }, patronToken);
    iddia("pin ata → 200", k1.status === 200 && k1.json?.ok === true, `${k1.status} tokenIptal=${k1.json?.tokenIptal} panelTazelendi=${k1.json?.panelTazelendi}`);
    iddia(
      "yanıt PIN'i GERİ DÖNDÜRMÜYOR",
      !JSON.stringify(k1.json ?? {}).includes(GECICI_PIN),
      JSON.stringify(k1.json)
    );
    const h1 = (
      await supabaseAdmin.from("workers").select("pin_hash, must_change_pin").eq("id", testId).maybeSingle()
    ).data;
    iddia("pin_hash DEĞİŞTİ", h1?.pin_hash !== testBas.pin_hash, `${String(testBas.pin_hash).slice(0, 12)}… → ${String(h1?.pin_hash).slice(0, 12)}…`);
    iddia("yeni PIN hash'le DOĞRULANIYOR (bcrypt.compare)", await bcrypt.compare(GECICI_PIN, h1?.pin_hash ?? ""), "compare=true");
    iddia("must_change_pin gövdeden geldi (false)", h1?.must_change_pin === false, `must_change_pin=${h1?.must_change_pin}`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEYEN HATA:", e?.message ?? e);
  if (e?.stack) console.error(e.stack.split("\n").slice(1, 5).join("\n"));
  dusen++;
} finally {
  // ── GERİ ALMA — ölçülerek ────────────────────────────────────────────────
  if (testId && testBas) {
    console.log(`\n── GERİ ALMA (test hesabı) ──`);
    const { error } = await supabaseAdmin
      .from("workers")
      .update({
        is_active: testBas.is_active,
        terminated_at: testBas.terminated_at,
        must_change_pin: testBas.must_change_pin,
        pin_hash: testBas.pin_hash,
      })
      .eq("id", testId);
    const son = (
      await supabaseAdmin
        .from("workers")
        .select("is_active, terminated_at, must_change_pin, pin_hash")
        .eq("id", testId)
        .maybeSingle()
    ).data;
    const tuttu =
      !error &&
      son?.is_active === testBas.is_active &&
      (son?.terminated_at ?? null) === testBas.terminated_at &&
      son?.must_change_pin === testBas.must_change_pin &&
      son?.pin_hash === testBas.pin_hash;
    iddia(
      "test hesabı koşum ÖNCESİ hâline döndü (4 alan)",
      tuttu,
      `is_active=${son?.is_active} must_change_pin=${son?.must_change_pin} pin_hash ${son?.pin_hash === testBas.pin_hash ? "aynı" : "FARKLI"}`
    );
    bilgi("NOT: token_version geri ALINMAZ (iptal sayacı geri sayılamaz) — zararsız.");
  }

  console.log(`\n╚══ SONUÇ: ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`}` +
    `${olculmeyen ? ` · ${olculmeyen} ölçülemedi` : ""} ═══\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
