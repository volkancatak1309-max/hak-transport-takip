#!/usr/bin/env node
/**
 * ŞOFÖR BELGE TAKİBİ — CANLIDA KANIT (migration 078). YAZAR ve TEMİZLER.
 *
 * NE YAPAR: panonun GERÇEK `getDashboardData()`sını, cron ucunun GERÇEK
 * `GET`ini ve push modülünün GERÇEK yolunu çalıştırır. Sorgu yolu taklit
 * EDİLMEZ; ölçülen şey ekranın çalıştırdığı kodun kendisidir.
 *
 * ── ⚠️ BU BETİK CANLI VERİTABANINA YAZAR ──────────────────────────────────
 * Emniyetler:
 *   • yazılan HER satır `zzz_kanit_` ön ekli bir belge TÜRÜNE bağlıdır ve
 *     silme bu ön ek üzerinden yapılır — kiracının gerçek türlerine dokunulmaz.
 *   • gerçek şoförlere satır girilir, çünkü kanıt tam olarak "panoda görünüyor
 *     mu" sorusudur ve TEST şoförü panoda görünmez (migration 028 eler).
 *     Satırlar `finally` içinde silinir, tablo sayıları başlangıçla ölçülür.
 *   • PUSH yalnız `--push` ile gerçekten gönderilir ve konusu TEST ŞOFÖRÜDÜR:
 *     gerçek bir şoförün adı hiçbir bildirime girmez.
 *   • Expo'nun `DeviceNotRegistered` cevabı üretimde jetonu SİLER; betik
 *     jetonları önce yedekler, silinmişse GERİ KOYAR ve bunu bildirir.
 *
 * Bayraklar:
 *   --push      Expo'ya gerçekten gönder (varsayılan: yalnız yükü göster)
 *   --birak     temizleme; satırlar panelde gözle görülebilsin diye kalsın
 *   --temizle   yalnız temizlik yap (yarım kalmış koşumdan sonra)
 *
 * Kullanım:  npm run verify:belge-takibi -- --push
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createTranslator } from "next-intl";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna, endOfTodayVienna, formatDate } from "@/lib/format";
import { UNRESTRICTED } from "@/lib/fleet-scope";
import { getDriverScope, dropNonDrivers } from "@/lib/driver-scope";
import { getTestScope } from "@/lib/test-data";
import { getDashboardData } from "@/lib/admin-dashboard";
import {
  listDocumentTypes,
  listExpiringDocuments,
  upsertDocumentType,
  upsertWorkerDocument,
} from "@/lib/documents-db";
import { GET as CRON_GET } from "@/app/api/cron/document-alerts/route";
import trMesaj from "../messages/tr.json";
import deMesaj from "../messages/de.json";
import enMesaj from "../messages/en.json";

const PUSH = process.argv.includes("--push");
const BIRAK = process.argv.includes("--birak");
const YALNIZ_TEMIZLIK = process.argv.includes("--temizle");

/** QA türlerinin kod ön eki — temizlik BUNUN üzerinden yapılır. */
const ON_EK = "zzz_kanit_";
const SIR = "kanit-cron-siri-" + Math.random().toString(36).slice(2, 10);

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
function bilgi(s) {
  console.log(`    ${s}`);
}

/** Cron ucunun beklediği istek — `nextUrl` dahil, gerçek NextRequest. */
function istek(qs) {
  return new NextRequest(`https://kanit.local/api/cron/document-alerts${qs}`);
}

/** UTC gün ekseninde YYYY-MM-DD — `listExpiringDocuments` de UTC gününe bakar. */
function gunSonra(n) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
    .toISOString()
    .slice(0, 10);
}

/** Dikkat listesinin tür kırılımı — "mevcut takip bozuldu mu"nun ölçüsü. */
function kirilim(items) {
  const m = {};
  for (const i of items) m[i.kind] = (m[i.kind] ?? 0) + 1;
  return m;
}

async function panoOku() {
  const d = await getDashboardData(
    startOfTodayVienna().toISOString(),
    endOfTodayVienna().toISOString(),
    UNRESTRICTED
  );
  return d.attention;
}

/** `zzz_kanit_` türlerine bağlı HER ŞEYİ siler. */
async function temizle() {
  const { data: tipler } = await supabaseAdmin
    .from("document_types")
    .select("id, code")
    .like("code", `${ON_EK}%`);
  const idler = (tipler ?? []).map((t) => t.id);
  if (idler.length === 0) return { tip: 0, belge: 0 };
  const { count: belgeSayi } = await supabaseAdmin
    .from("worker_documents")
    .select("id", { count: "exact", head: true })
    .in("type_id", idler);
  // Önce belgeler: tür FK'si `on delete restrict`.
  await supabaseAdmin.from("worker_documents").delete().in("type_id", idler);
  await supabaseAdmin.from("document_types").delete().in("id", idler);
  return { tip: idler.length, belge: belgeSayi ?? 0 };
}

if (YALNIZ_TEMIZLIK) {
  const t = await temizle();
  console.log(`temizlendi: ${t.tip} tür, ${t.belge} belge`);
  process.exit(0);
}

console.log(`\n╔══ ŞOFÖR BELGE TAKİBİ · CANLIDA KANIT (078) ════════════════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ push    ${PUSH ? "GERÇEK GÖNDERİM" : "yük gösterilir, gönderilmez (--push yok)"}`);
console.log(`╚════════════════════════════════════════════════════════════════════\n`);

let baslangicTip = 0;
let baslangicBelge = 0;

try {
  // ══ 0) ÖN KOŞUL ═══════════════════════════════════════════════════════
  console.log(`── 0) ÖN KOŞUL: migration 078 canlıda mı ──`);
  const tipSayim = await supabaseAdmin
    .from("document_types")
    .select("*", { count: "exact", head: true });
  const belgeSayim = await supabaseAdmin
    .from("worker_documents")
    .select("*", { count: "exact", head: true });
  iddia("document_types okunabiliyor", !tipSayim.error, `${tipSayim.count ?? "?"} satır`);
  iddia("worker_documents okunabiliyor", !belgeSayim.error, `${belgeSayim.count ?? "?"} satır`);
  if (tipSayim.error || belgeSayim.error) throw new Error("078 uygulanmamış — kanıt üretilemez");
  baslangicTip = tipSayim.count ?? 0;
  baslangicBelge = belgeSayim.count ?? 0;

  // Hedef şoförler: panonun kullandığı kapsamın AYNISI (test + yönetici elenir).
  const testScope = await getTestScope();
  const driverScope = await getDriverScope();
  const { data: hamW } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const soforler = dropNonDrivers(
    (hamW ?? []).filter((w) => !testScope.isTestWorker(w.id)),
    (w) => w.id,
    driverScope
  );
  iddia("kapsamda en az 2 şoför var", soforler.length >= 2, `${soforler.length} şoför`);
  const [S1, S2] = soforler;
  const testSofor = (hamW ?? []).find((w) => testScope.isTestWorker(w.id));
  iddia("test şoförü bulundu", !!testSofor, testSofor?.name);
  if (!S1 || !S2 || !testSofor) throw new Error("hedef kadro eksik");
  bilgi(`hedef 1: ${S1.name}   ·   hedef 2: ${S2.name}   ·   push konusu: ${testSofor.name}`);

  // ══ 1) ÖNCE — panonun bugünkü hâli ════════════════════════════════════
  console.log(`\n── 1) ÖNCE: Dikkat panosu ──`);
  const once = await panoOku();
  const onceKirilim = kirilim(once);
  console.log(`  toplam ${once.length} kalem  ${JSON.stringify(onceKirilim)}`);
  iddia("ÖNCE belge kalemi YOK", (onceKirilim.document ?? 0) === 0);
  const onceEhliyet = onceKirilim.license ?? 0;

  // ══ 2) TÜRLER — kiracının sözlüğü ═════════════════════════════════════
  console.log(`\n── 2) BELGE TÜRÜ AÇ (kiracı sözlüğü) ──`);
  const rA = await upsertDocumentType(
    {
      code: `${ON_EK}a`,
      label: "KANIT A · 30 gün eşiği",
      warnDays: 30,
      requiresNumber: true,
      active: true,
      sortOrder: 900,
    },
    null
  );
  const rB = await upsertDocumentType(
    {
      code: `${ON_EK}b`,
      label: "KANIT B · 90 gün eşiği",
      warnDays: 90,
      requiresNumber: false,
      active: true,
      sortOrder: 901,
    },
    null
  );
  iddia("A türü açıldı (warn 30)", rA.ok === true, rA.ok ? rA.id : rA.mesaj);
  iddia("B türü açıldı (warn 90)", rB.ok === true, rB.ok ? rB.id : rB.mesaj);
  const { types } = await listDocumentTypes(true);
  const tipA = types.find((t) => t.code === `${ON_EK}a`);
  const tipB = types.find((t) => t.code === `${ON_EK}b`);
  iddia("iki tür de aktif listede", !!tipA && !!tipB, `${tipA?.label} · ${tipB?.label}`);
  if (!tipA || !tipB) throw new Error("tür açılamadı");

  // Aynı kod büyük harfle ikinci kez: tekil kısıt (078 gerekçesi).
  const rCift = await upsertDocumentType(
    {
      code: `${ON_EK.toUpperCase()}A`,
      label: "ÇİFT KAYIT DENEMESİ",
      warnDays: 30,
      requiresNumber: false,
      active: true,
      sortOrder: 902,
    },
    null
  );
  iddia(
    "aynı kod BÜYÜK harfle ikinci kez açılamadı (23505)",
    rCift.ok === false && rCift.sebep === "cakisma",
    rCift.ok ? "AÇILDI — sessiz çift kayıt!" : rCift.sebep
  );

  // ══ 3) PUSH — konusu TEST ŞOFÖRÜ ══════════════════════════════════════
  console.log(`\n── 3) PUSH BİLDİRİMİ (konu: test şoförü) ──`);
  const { data: jetonlar } = await supabaseAdmin.from("push_tokens").select("*");
  const jetonYedek = jetonlar ?? [];
  bilgi(`push_tokens: ${jetonYedek.length} kayıtlı cihaz`);

  // Test şoförüne BUGÜN dolan bir belge → cron dönüm noktası (days = 0).
  const testBelge = await upsertWorkerDocument(
    {
      workerId: testSofor.id,
      typeId: tipA.id,
      expiresAt: gunSonra(0),
      documentNo: "KANIT-0001",
      note: "QA — silinecek",
    },
    null
  );
  iddia("test şoförüne belge yazıldı (bugün doluyor)", testBelge.ok === true, testBelge.ok ? gunSonra(0) : testBelge.mesaj);

  // Expo'ya giden isteği YAKALA — kaynak kod değişmeden, gerçek fetch sarılıyor.
  const gercekFetch = globalThis.fetch;
  const expoCagrilari = [];
  globalThis.fetch = async (url, init) => {
    const adres = typeof url === "string" ? url : (url?.url ?? "");
    if (!adres.includes("exp.host")) return gercekFetch(url, init);
    const yuk = JSON.parse(init?.body ?? "[]");
    if (!PUSH) {
      expoCagrilari.push({ yuk, yanit: null });
      // Üretimdeki cevabın şekli — kod yolu aynen devam etsin diye.
      return new Response(JSON.stringify({ data: yuk.map(() => ({ status: "ok", id: "KURU" })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const yanit = await gercekFetch(url, init);
    const metin = await yanit.text();
    expoCagrilari.push({ yuk, yanit: metin });
    return new Response(metin, { status: yanit.status, headers: yanit.headers });
  };

  process.env.CRON_SECRET = SIR;
  const yetkisiz = await CRON_GET(istek(""));
  iddia("sırsız çağrı 401", yetkisiz.status === 401, String(yetkisiz.status));
  const yanlisSir = await CRON_GET(istek("?secret=yanlis"));
  iddia("yanlış sır 401", yanlisSir.status === 401, String(yanlisSir.status));
  const gercek = await CRON_GET(istek(`?secret=${SIR}`));
  const gercekJson = await gercek.json();
  iddia("doğru sır 200", gercek.status === 200, String(gercek.status));
  iddia(
    "eşikteki belge = 1 (yalnız test şoförünün belgesi)",
    gercekJson.esiktekiBelge === 1,
    JSON.stringify(gercekJson.kalemler)
  );
  iddia("bildirilen = 1 (dönüm noktası: 0 gün)", gercekJson.bildirilen === 1, String(gercekJson.bildirilen));

  globalThis.fetch = gercekFetch;

  if (expoCagrilari.length === 0) {
    if (jetonYedek.length === 0) olculmedi("Expo'ya istek gitti", "kayıtlı push cihazı yok");
    else iddia("Expo'ya istek gitti", false, "hiç çağrı yakalanmadı");
  } else {
    for (const c of expoCagrilari) {
      for (const m of c.yuk) {
        bilgi(`→ ${String(m.to).slice(0, 30)}…`);
        bilgi(`   başlık: ${m.title}`);
        bilgi(`   gövde : ${m.body}`);
        bilgi(`   veri  : ${JSON.stringify(m.data)}  kanal=${m.channelId}  öncelik=${m.priority}`);
      }
      if (c.yanit) bilgi(`← Expo: ${String(c.yanit).slice(0, 300)}`);
    }
    const ilk = expoCagrilari[0];
    const m0 = ilk.yuk[0];
    iddia("bildirim gövdesi TEST ŞOFÖRÜNÜ anıyor", String(m0.body).includes(testSofor.name), m0.body);
    iddia("başlıkta kiracının etiketi var (çevrilmedi)", String(m0.title).includes("KANIT A"), m0.title);
    iddia("veri yükü tur=belge taşıyor", m0.data?.tur === "belge", JSON.stringify(m0.data));
    if (PUSH) {
      const cevap = JSON.parse(ilk.yanit);
      const durumlar = (cevap.data ?? []).map((d) => d.status + (d.details?.error ? `/${d.details.error}` : ""));
      iddia(
        "Expo her jetona cevap verdi",
        (cevap.data ?? []).length === ilk.yuk.length,
        durumlar.join(", ")
      );
      const okSay = (cevap.data ?? []).filter((d) => d.status === "ok").length;
      iddia("en az bir cihaz için status=ok", okSay > 0, `${okSay}/${ilk.yuk.length} jeton`);
    } else {
      olculmedi("Expo yanıtı", "--push verilmedi, istek gönderilmedi");
    }
  }

  // Ölü jeton silindi mi (DeviceNotRegistered) — silindiyse GERİ KOY.
  const { data: jetonSon } = await supabaseAdmin.from("push_tokens").select("token");
  const kalan = new Set((jetonSon ?? []).map((r) => r.token));
  const silinen = jetonYedek.filter((r) => !kalan.has(r.token));
  if (silinen.length) {
    await supabaseAdmin.from("push_tokens").insert(silinen);
    iddia(
      "⚠️ ölü jeton silinmişti — GERİ KONDU",
      true,
      silinen.map((s) => String(s.token).slice(0, 22)).join(", ")
    );
  } else {
    iddia("push_tokens bozulmadı", true, `${jetonYedek.length} cihaz duruyor`);
  }

  // ══ 4) GERÇEK ŞOFÖRLERE BELGE → pano kalemi ═══════════════════════════
  console.log(`\n── 4) BELGE EKLE → Dikkat panosu ──`);
  const yazimlar = [
    ["S1+A ·  7 gün kaldı · eşik 30 → GÖRÜNMELİ", S1, tipA, gunSonra(7)],
    ["S1+B · 45 gün kaldı · eşik 90 → GÖRÜNMELİ", S1, tipB, gunSonra(45)],
    ["S2+A · 45 gün kaldı · eşik 30 → GÖRÜNMEMELİ", S2, tipA, gunSonra(45)],
    ["S2+B ·  7 gün GEÇTİ · dolmuş → GÖRÜNMELİ (kritik)", S2, tipB, gunSonra(-7)],
  ];
  for (const [ad, sofor, tip, tarih] of yazimlar) {
    const r = await upsertWorkerDocument(
      { workerId: sofor.id, typeId: tip.id, expiresAt: tarih, documentNo: null, note: "QA — silinecek" },
      null
    );
    iddia(`yazıldı: ${ad}`, r.ok === true, r.ok ? tarih : r.mesaj);
  }

  const sonra = await panoOku();
  const sonraKirilim = kirilim(sonra);
  console.log(`  toplam ${sonra.length} kalem  ${JSON.stringify(sonraKirilim)}`);
  const belgeKalemleri = sonra.filter((i) => i.kind === "document");
  for (const b of belgeKalemleri) {
    bilgi(`· ${b.worker_name} — ${b.type_label} — ${b.due} (${b.days} gün)`);
  }
  iddia("panoda 3 belge kalemi var", belgeKalemleri.length === 3, `${belgeKalemleri.length} kalem`);
  iddia(
    "45 gün + 30 eşiği GÖRÜNMEDİ (eşik tür başına)",
    !belgeKalemleri.some((b) => b.worker_name === S2.name && b.type_label.includes("KANIT A")),
    "S2+A listede yok"
  );
  iddia(
    "45 gün + 90 eşiği GÖRÜNDÜ (aynı tarih, farklı tür)",
    belgeKalemleri.some((b) => b.worker_name === S1.name && b.type_label.includes("KANIT B") && b.days === 45)
  );
  iddia(
    "test şoförünün belgesi panoda GÖRÜNMEDİ (028 elemesi yeni eksende de çalışıyor)",
    !belgeKalemleri.some((b) => b.worker_name === testSofor.name),
    "test kaydı sızmadı"
  );
  const dolmus = belgeKalemleri.find((b) => b.days < 0);
  iddia("dolmuş belge listede DURUYOR (alt sınır yok)", !!dolmus && dolmus.days === -7, `${dolmus?.days} gün`);
  iddia("dolmuş kalemin türü kiracı etiketi", !!dolmus && dolmus.type_label === tipB.label, dolmus?.type_label);

  // Mevcut takip bozulmadı mı — belge dışındaki HER tür birebir aynı olmalı.
  const farklar = [];
  for (const k of new Set([...Object.keys(onceKirilim), ...Object.keys(sonraKirilim)])) {
    if (k === "document") continue;
    if ((onceKirilim[k] ?? 0) !== (sonraKirilim[k] ?? 0)) {
      farklar.push(`${k}: ${onceKirilim[k] ?? 0}→${sonraKirilim[k] ?? 0}`);
    }
  }
  iddia("belge dışındaki kırılım DEĞİŞMEDİ", farklar.length === 0, farklar.join(", ") || "birebir aynı");
  iddia("ehliyet kalemi sayısı aynı", (sonraKirilim.license ?? 0) === onceEhliyet, `${onceEhliyet} → ${sonraKirilim.license ?? 0}`);
  iddia("toplam kalem = ÖNCE + 3", sonra.length === once.length + 3, `${once.length} → ${sonra.length}`);

  // ŞİDDET SIRASI: dolmuş belge, süresi yaklaşan belgenin ÜSTÜNDE.
  const iDolmus = sonra.findIndex((i) => i.kind === "document" && i.days < 0);
  const iYakin = sonra.findIndex((i) => i.kind === "document" && i.days === 7);
  iddia(
    "dolmuş belge, yaklaşan belgenin ÜSTÜNDE sıralandı",
    iDolmus >= 0 && iYakin >= 0 && iDolmus < iYakin,
    `#${iDolmus} < #${iYakin}`
  );
  const sira = sonra.map((i) => (i.kind === "document" ? `document(${i.days})` : i.kind));
  bilgi(`sıra: ${sira.slice(0, 10).join(" · ")}${sira.length > 10 ? " …" : ""}`);

  // ══ 5) PASİF TÜR uyarı üretmez, GEÇMİŞİ SİLMEZ ════════════════════════
  console.log(`\n── 5) TÜR PASİFLEŞTİRİLİNCE ──`);
  const pasifle = (aktif) =>
    upsertDocumentType(
      {
        id: tipB.id,
        code: tipB.code,
        label: tipB.label,
        warnDays: tipB.warnDays,
        requiresNumber: tipB.requiresNumber,
        active: aktif,
        sortOrder: tipB.sortOrder,
      },
      null
    );
  await pasifle(false);
  const { items: pasifSonrasi } = await listExpiringDocuments(null);
  iddia(
    "B türü pasifken B kalemi ÜRETİLMEDİ",
    !pasifSonrasi.some((i) => i.typeCode === tipB.code),
    `${pasifSonrasi.length} kalem kaldı`
  );
  iddia("A türü etkilenmedi", pasifSonrasi.some((i) => i.typeCode === tipA.code));
  const { data: pasifSatir } = await supabaseAdmin
    .from("worker_documents")
    .select("id")
    .eq("type_id", tipB.id);
  iddia("pasif türün KAYITLARI silinmedi", (pasifSatir ?? []).length === 2, `${(pasifSatir ?? []).length} satır duruyor`);
  await pasifle(true);

  // ══ 6) CRON DÖNÜM NOKTALARI (kuru koşum) ══════════════════════════════
  console.log(`\n── 6) CRON UCU · dönüm noktası hesabı (kuru koşum) ──`);
  const kuru = await CRON_GET(istek(`?secret=${SIR}&kuru=1`));
  const kuruJson = await kuru.json();
  iddia("kuru koşum 200", kuru.status === 200, String(kuru.status));
  iddia(
    "eşikteki belge = 4 (cron kapsam uygulamaz: test dahil)",
    kuruJson.esiktekiBelge === 4,
    String(kuruJson.esiktekiBelge)
  );
  const bildirilenGunler = (kuruJson.kalemler ?? []).map((k) => k.kalanGun).sort((a, b) => a - b);
  iddia("bildirilecek = 3 → günler [−7, 0, 7]", kuruJson.bildirilen === 3, JSON.stringify(bildirilenGunler));
  iddia("45 gün dönüm noktası DEĞİL (sessiz kalır)", !bildirilenGunler.includes(45), JSON.stringify(bildirilenGunler));
  iddia("kuru koşumda hiçbir bildirim gitmedi", kuruJson.kuruYurut === true, `kuruYurut=${kuruJson.kuruYurut}`);

  // ══ 7) EKRAN METNİ — gerçek bileşen kaynağı + gerçek sözlük ═══════════
  console.log(`\n── 7) EKRAN METNİ (AttentionList kaynağı · messages/*.json) ──`);
  const kaynak = readFileSync(new URL("../components/admin/AttentionList.tsx", import.meta.url), "utf8");
  const blok = kaynak.slice(kaynak.indexOf('case "document"'), kaynak.indexOf('case "silent"'));
  iddia("bileşen dolmuş/yaklaşan AYRIMI yapıyor", blok.includes("item.days < 0"), "expired = item.days < 0");
  iddia(
    "iki ayrı i18n anahtarı kullanılıyor",
    blok.includes("dash.attn_doc_expired") && blok.includes('"dash.attn_doc"'),
    "attn_doc / attn_doc_expired"
  );
  iddia("tür etiketi t() İÇİNDEN geçmiyor", blok.includes("doc: item.type_label"), "type_label doğrudan basılıyor");
  const satirlar = kaynak.split("\n");
  const tonSatiri = satirlar.find((s) => s.includes("const tone = r.overdue"));
  const bgSatiri = satirlar.find((s) => s.includes("const bg = r.overdue"));
  iddia("dolmuşta KRİTİK renk token'ı", !!tonSatiri && tonSatiri.includes("status-critical-text"), tonSatiri?.trim());
  iddia("yaklaşanda ALTIN token", !!bgSatiri && bgSatiri.includes("accent-gold"), bgSatiri?.trim());

  for (const [dil, mesajlar] of [
    ["tr", trMesaj],
    ["de", deMesaj],
    ["en", enMesaj],
  ]) {
    const t = createTranslator({ locale: dil, messages: mesajlar, namespace: "admin" });
    const yak = `${t("dash.attn_doc", { name: S1.name, doc: tipA.label, date: formatDate(gunSonra(7), dil) })}  ·  ${t("dash.attn_in_days", { days: 7 })}`;
    const dol = `${t("dash.attn_doc_expired", { name: S2.name, doc: tipB.label, date: formatDate(gunSonra(-7), dil) })}  ·  ${t("dash.attn_overdue_days", { days: 7 })}`;
    bilgi(`${dil}  yaklaşan: ${yak}`);
    bilgi(`${dil}  DOLMUŞ  : ${dol}`);
    iddia(`${dil} · iki metin farklı ve ikisi de anahtarsız değil`, yak !== dol && !yak.includes("attn_doc") && !dol.includes("attn_doc"));
  }
} catch (e) {
  /** `finally` içindeki `process.exit` hatayı yutmasın — düşen iddia sayılır. */
  console.error(`\n  ✗ KOŞUM İSTİSNAYLA KESİLDİ: ${e?.stack ?? e}`);
  dusen++;
} finally {
  console.log(`\n── TEMİZLİK ──`);
  if (BIRAK) {
    console.log(`  ⚠️ --birak verildi: QA satırları CANLIDA DURUYOR (panelde görülebilir).`);
    console.log(`     Silmek için:  npm run verify:belge-takibi -- --temizle`);
  } else {
    const t = await temizle();
    const { count: kalanQa } = await supabaseAdmin
      .from("document_types")
      .select("id", { count: "exact", head: true })
      .like("code", `${ON_EK}%`);
    const { count: sonTip } = await supabaseAdmin
      .from("document_types")
      .select("id", { count: "exact", head: true });
    const { count: sonBelge } = await supabaseAdmin
      .from("worker_documents")
      .select("id", { count: "exact", head: true });
    iddia(`${t.tip} QA türü + ${t.belge} QA belgesi SİLİNDİ`, (kalanQa ?? 0) === 0, `kalan QA türü: ${kalanQa ?? 0}`);
    iddia(
      "tablolar başlangıçtaki satır sayısına döndü",
      (sonTip ?? 0) === baslangicTip && (sonBelge ?? 0) === baslangicBelge,
      `document_types ${baslangicTip}→${sonTip ?? 0} · worker_documents ${baslangicBelge}→${sonBelge ?? 0}`
    );
    const kapanis = await panoOku();
    console.log(`  temizlik sonrası pano: ${kapanis.length} kalem  ${JSON.stringify(kirilim(kapanis))}`);
    iddia("temizlikten sonra belge kalemi YOK", kirilim(kapanis).document === undefined);
  }
  const kuyruk = olculmeyen ? ` · ${olculmeyen} iddia ÖLÇÜLMEDİ` : "";
  console.log(`\n${dusen === 0 ? "✓ TÜM ÖLÇÜLEBİLİR İDDİALAR CANLI VERİDE DOĞRULANDI" : `✗ ${dusen} iddia düştü`}${kuyruk}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
