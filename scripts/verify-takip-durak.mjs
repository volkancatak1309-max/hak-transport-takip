#!/usr/bin/env node
/**
 * TAKİP LİNKİ DURAĞA BAĞLI — KANIT (migration 083).
 *
 * ⚠️ ÜRETİME DEĞİL, YEREL YIĞINA KOŞAR (Docker: Postgres + PostgREST + proxy).
 * Sefer/durak/link YAZAR; üretimde sahte müşteri linki üretmek istemiyoruz.
 * Kurulum adımları docs/COK-DURAKLI-SEFER.md §Prova.
 *
 * ── NE SINANIYOR ──────────────────────────────────────────────────────────
 * Panelin ve girişsiz sayfanın ÇALIŞTIRDIĞI yolun ta kendisi: sunucu eylemleri
 * gerçek kapılarından (`requireFleetView`/`requireWorker`) gerçek iron-session
 * mührüyle, girişsiz okuma `readTakipByToken` ve GERÇEK HTTP ucu üzerinden.
 *
 * ── SIZINTI DENETİMİ ÖLÇÜMLE ──────────────────────────────────────────────
 * "Diğer durakların adresi görünmüyor" bir iddia değil, bir ÖLÇÜM: girişsiz
 * gövdenin TAM JSON metni yasaklı dizgilerle taranıyor. Bir alan yanlışlıkla
 * eklenirse betik kırılır.
 *
 * Kullanım:
 *   ENV_FILE=<qa env> node --import ./scripts/ts-server.mjs scripts/verify-takip-durak.mjs
 */
import { sealData } from "iron-session";
import { sessionOptions } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { takipLinkiUret, takipLinkleriGetir } from "@/app/actions/seferler";
import { durakSil, durakIlerlet, durakEkle, getSeferDuraklari } from "@/app/actions/duraklar";
import { readTakipByToken } from "@/lib/takip-db";
import { issueTokens } from "@/lib/mobile-auth";
import { GET as TAKIP_GET } from "@/app/api/takip/[token]/route";
import {
  POST as LINK_POST,
  GET as LINK_GET,
} from "@/app/api/mobile/sefer/[id]/takip-linki/route";
import { TAKIP_SIRA_ESIGI } from "@/lib/tenant";

const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const SOFOR = "b0000000-0000-0000-0000-00000000000b";
const SEFER = "e2000000-0000-0000-0000-0000000000e2"; // 3 duraklı
const SEFER_DURAKSIZ = "e1000000-0000-0000-0000-0000000000e1"; // 079 tarzı
const S1 = "f1000000-0000-0000-0000-0000000000f1"; // Metzgerei Huber (başka müşteri)
const S2 = "f2000000-0000-0000-0000-0000000000f2"; // Baecker Fuchs (BİZİM müşteri)
const S3 = "f3000000-0000-0000-0000-0000000000f3"; // Konditorei Wolf (başka müşteri)

/** Müşterinin durağının (S2 → Baecker Fuchs bölgesi) gerçek geometrisi. */
const BENIM = { lat: 47.501, lng: 9.747, yaricapM: 200 };
/** 1. durağın geometrisi — gövdede GÖRÜNMEMELİ. */
const BASKASI = { lat: 47.4125, lng: 9.7417 };

let dusen = 0;
function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function baslik(s) {
  console.log(`\n═══ ${s} ═══`);
}

async function kimlik(workerId, ad, isAdmin) {
  process.env.QA_SESSION_COOKIE = await sealData(
    { worker_id: workerId, name: ad, phone: "+430000000000", is_admin: isAdmin },
    { password: sessionOptions.password, ttl: 0 }
  );
}

/** URL'den token'ı söker. */
const tokenAl = (url) => url.split("/takip/")[1];

/** GERÇEK girişsiz HTTP ucu. */
async function ucCagir(token, ip) {
  const res = await TAKIP_GET(
    new Request(`http://x/api/takip/${token}`, { headers: { "x-forwarded-for": ip } }),
    { params: Promise.resolve({ token }) }
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function mobilCagir(fn, yol, opsiyon, params) {
  const res = await fn(
    new Request(`http://x${yol}`, {
      method: opsiyon.method ?? "GET",
      headers: {
        authorization: `Bearer ${opsiyon.jeton}`,
        ...(opsiyon.body ? { "content-type": "application/json" } : {}),
      },
      ...(opsiyon.body ? { body: JSON.stringify(opsiyon.body) } : {}),
    }),
    { params: Promise.resolve(params) }
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · PANELDEN DURAK BAZLI LİNK ÜRETİMİ");
  await kimlik(YONETICI, "QA Yonetici", true);

  const l2 = await takipLinkiUret(SEFER, null, S2);
  iddia("2. durak için link üretildi", l2.ok, l2.ok ? l2.link.url.slice(-12) : l2.hata);
  iddia("link DURAĞA bağlı (durakId dolu)", l2.ok && l2.link.durakId === S2, l2.ok ? String(l2.link.durakId).slice(0, 8) : "-");

  const l1 = await takipLinkiUret(SEFER, null, S1);
  iddia("1. durak için de ayrı link üretilebiliyor", l1.ok && l1.link.durakId === S1, l1.ok ? "ok" : l1.hata);

  const lSefer = await takipLinkiUret(SEFER, null);
  iddia("SEFER bazlı link hâlâ üretilebiliyor (durakId yok)", lSefer.ok && lSefer.link.durakId === null, lSefer.ok ? "durakId=null" : lSefer.hata);

  // Hedefsiz durak: yalnız adı olan bir durak eklenip link denenir.
  const eklendi = await durakEkle(SEFER, { ad: "Hedefsiz durak", adres: "Adres var koordinat yok" });
  const liste = await getSeferDuraklari(SEFER);
  const hedefsiz = liste.duraklar.find((d) => d.ad === "Hedefsiz durak");
  const lHedefsiz = await takipLinkiUret(SEFER, null, hedefsiz.id);
  iddia("HEDEFSİZ durağa link REDDEDİLDİ", !lHedefsiz.ok && lHedefsiz.hata === "durak_hedefsiz", lHedefsiz.ok ? "kabul edildi!" : lHedefsiz.hata);
  await durakSil(hedefsiz.id);
  iddia("hedefsiz durak temizlendi", eklendi.ok, "ok");

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · MÜŞTERİ KENDİ DURAĞININ ETA'SINI GÖRÜYOR");

  const t2 = tokenAl(l2.link.url);
  const tSefer = tokenAl(lSefer.link.url);

  const g2 = await readTakipByToken(t2);
  const gSefer = await readTakipByToken(tSefer);
  iddia("durak linki okunuyor", g2.ok, g2.ok ? "ok" : g2.sebep);
  iddia("sefer linki okunuyor", gSefer.ok, gSefer.ok ? "ok" : gSefer.sebep);

  const h2 = g2.ok ? g2.gorunum.hedef : null;
  const hS = gSefer.ok ? gSefer.gorunum.hedef : null;
  iddia(
    "hedef MÜŞTERİNİN durağı (2. durak — Baecker Fuchs)",
    h2 && Math.abs(h2.lat - BENIM.lat) < 1e-6 && Math.abs(h2.lng - BENIM.lng) < 1e-6,
    `${h2?.lat}, ${h2?.lng}`
  );
  iddia(
    "🔴 ESKİ DAVRANIŞ FARKI ÖLÇÜLDÜ: sefer bazlı link SIRADAKİ durağı gösteriyor",
    hS && Math.abs(hS.lat - BASKASI.lat) < 1e-6,
    `sefer linki → ${hS?.lat}, ${hS?.lng} (1. durak) · durak linki → ${h2?.lat}, ${h2?.lng}`
  );
  iddia("iki link FARKLI hedef gösteriyor (083'ün varlık sebebi)", h2 && hS && h2.lat !== hS.lat, "farklı");

  iddia("durak linki `durakBagli` bayrağını taşıyor", g2.ok && g2.gorunum.durakBagli === true, String(g2.ok && g2.gorunum.durakBagli));
  iddia("sefer linkinde `durakBagli` FALSE", gSefer.ok && gSefer.gorunum.durakBagli === false, String(gSefer.ok && gSefer.gorunum.durakBagli));

  // ── ETA: zincir ARA DURAĞIN SERVİS SÜRESİNİ içeriyor mu
  const eta2 = g2.ok ? g2.gorunum.eta : null;
  const etaS = gSefer.ok ? gSefer.gorunum.eta : null;
  iddia(
    "durak ETA'sı sefer ETA'sından BÜYÜK (araya 1. durak + 20 dk servis giriyor)",
    eta2 && etaS && eta2.dakika > etaS.dakika,
    `durak ${eta2?.dakika} dk · sefer ${etaS?.dakika} dk`
  );
  iddia(
    "durak ETA'sı en az 20 dk servis süresi taşıyor",
    eta2 && etaS && eta2.dakika - etaS.dakika >= 20,
    `fark ${eta2 && etaS ? eta2.dakika - etaS.dakika : "-"} dk`
  );
  iddia("durak ETA'sının üst sınırı 240 (tek hedefte 90)", eta2?.ustSinirDk === 240 && etaS?.ustSinirDk === 90, `${eta2?.ustSinirDk} / ${etaS?.ustSinirDk}`);

  // ── Zaman penceresi: müşterinin KENDİ kısıtı
  iddia(
    "müşterinin KENDİ zaman penceresi gövdede",
    g2.ok && g2.gorunum.pencere?.bas?.startsWith("08:00") && g2.gorunum.pencere?.bit?.startsWith("12:00"),
    `${g2.ok ? g2.gorunum.pencere?.bas : "-"} – ${g2.ok ? g2.gorunum.pencere?.bit : "-"}`
  );
  iddia("sefer bazlı linkte pencere YOK", gSefer.ok && gSefer.gorunum.pencere === null, String(gSefer.ok && gSefer.gorunum.pencere));

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · SIRA BİLGİSİ — 'ÖNÜNÜZDE N DURAK VAR'");

  iddia("2. durağın müşterisi: önünde 1 durak", g2.ok && g2.gorunum.onunuzdeDurak === 1, String(g2.ok ? g2.gorunum.onunuzdeDurak : "-"));

  const t1 = tokenAl(l1.link.url);
  const g1 = await readTakipByToken(t1);
  iddia("1. durağın müşterisi: önünde 0 durak (sıradaki o)", g1.ok && g1.gorunum.onunuzdeDurak === 0, String(g1.ok ? g1.gorunum.onunuzdeDurak : "-"));
  iddia("SEFER bazlı linkte sıra bilgisi YOK (null)", gSefer.ok && gSefer.gorunum.onunuzdeDurak === null, String(gSefer.ok ? gSefer.gorunum.onunuzdeDurak : "-"));

  // ── EŞİK: TAKIP_SIRA_ESIGI üstünde sayı GÖSTERİLMEZ
  const dolgu = [];
  for (let i = 0; i < TAKIP_SIRA_ESIGI + 1; i++) {
    dolgu.push({
      sefer_id: SEFER,
      sira: 100 + i,
      ad: `Dolgu ${i}`,
      latitude: 47.4 + i * 0.001,
      longitude: 9.7,
      yaricap_m: 150,
    });
  }
  /**
   * ⚠️ Doğrudan SQL: dolgu durakları müşterinin durağından ÖNCE olmalı, bu
   * yüzden 2. durak geçici olarak en sona alınıyor.
   *
   * ⚠️ TEMİZLİK KİMLİKLE, SIRA ARALIĞIYLA DEĞİL. İlk yazımda dolgular
   * `sira >= 100` ile siliniyordu — ama müşterinin durağı da o an 999'daydı ve
   * BİRLİKTE SİLİNDİ. Sonraki bütün iddialar yanlış sebeple düştü/geçti. Test
   * verisini konuma göre silmek, ölçtüğün şeyi silmenin en kolay yoludur.
   */
  const { data: dolguYazilan } = await supabaseAdmin
    .from("sefer_duraklari")
    .insert(dolgu)
    .select("id");
  const dolguIdler = (dolguYazilan ?? []).map((d) => d.id);
  await supabaseAdmin.from("sefer_duraklari").update({ sira: 999 }).eq("id", S2);
  const gEsik = await readTakipByToken(t2);
  iddia(
    `eşiğin (${TAKIP_SIRA_ESIGI}) ÜSTÜNDE sıra sayısı GİZLENİYOR`,
    gEsik.ok && gEsik.gorunum.onunuzdeDurak === null,
    `önünde ${TAKIP_SIRA_ESIGI + 2} durak var → gövdede ${gEsik.ok ? String(gEsik.gorunum.onunuzdeDurak) : "-"}`
  );
  iddia("eşik üstünde ETA yine de veriliyor", gEsik.ok && gEsik.gorunum.eta !== null, `${gEsik.ok ? gEsik.gorunum.eta?.dakika : "-"} dk`);
  // Geri al — YALNIZ dolguların kimlikleri.
  await supabaseAdmin.from("sefer_duraklari").delete().in("id", dolguIdler);
  await supabaseAdmin.from("sefer_duraklari").update({ sira: 2 }).eq("id", S2);
  const geriAlindi = await getSeferDuraklari(SEFER);
  iddia(
    "dolgu temizlendi, üç durak yerinde",
    geriAlindi.duraklar.length === 3 && geriAlindi.duraklar.some((d) => d.id === S2),
    `${geriAlindi.duraklar.length} durak`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · SIZINTI TESTİ — ÖLÇÜMLE");

  const govde = JSON.stringify((await readTakipByToken(t2)).gorunum ?? {});
  const uc = await ucCagir(t2, "9.9.9.9");
  const ucGovde = JSON.stringify(uc.json ?? {});

  /** Gövdede ASLA geçmemesi gerekenler. */
  const YASAK = [
    ["diğer durağın adı (1)", "Metzgerei"],
    ["diğer durağın adı (3)", "Konditorei"],
    ["diğer durağın ADRESİ", "Kirchgasse"],
    ["diğer durağın notu", "arka kapidan"],
    ["şoför adı", "Hans Mustermann"],
    ["plaka", "W-12345X"],
    ["kendi durağının ADI", "Baecker Fuchs"],
    ["1. durağın enlemi", String(BASKASI.lat)],
    ["3. durağın enlemi", "47.503"],
    ["sefer kimliği", SEFER],
    ["durak kimliği", S2],
    ["şoför kimliği", SOFOR],
  ];
  for (const [ad, dizgi] of YASAK) {
    const varMi = govde.includes(dizgi) || ucGovde.includes(dizgi);
    iddia(`gövdede YOK: ${ad}`, !varMi, varMi ? `SIZDI → ${dizgi}` : "temiz");
  }
  iddia("gövdede SIRA NUMARASI da TOPLAM DURAK da yok", !/"sira"|"toplam"/.test(govde + ucGovde), "temiz");
  iddia("HTTP ucu 200 döndü", uc.status === 200, String(uc.status));
  iddia("ama KENDİ hedefi VAR (gövde boş değil)", govde.includes("47.501"), "47.501 var");
  iddia("gövdenin alan listesi bilinen kümede", Object.keys(uc.json ?? {}).sort().join(",") === "durakBagli,durum,eta,etaKaba,hedef,konum,linkBitisISO,ok,onunuzdeDurak,pencere,soforAdi", Object.keys(uc.json ?? {}).sort().join(","));

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · DURAK KAPANINCA LİNK ÖLÜYOR (dördüncü ölüm yolu)");

  await kimlik(SOFOR, "Hans Mustermann", false);
  const bitir = await durakIlerlet(S2, "tamamlandi");
  iddia("şoför 2. durağı tamamladı", bitir.ok, bitir.ok ? "ok" : bitir.hata);

  const gOlu = await readTakipByToken(t2);
  iddia("durak linki ÖLDÜ", !gOlu.ok && gOlu.sebep === "durak_kapandi", gOlu.ok ? "hâlâ açık!" : gOlu.sebep);
  const ucOlu = await ucCagir(t2, "9.9.9.8");
  iddia("HTTP ucu 410 döndü (ölü link)", ucOlu.status === 410 && ucOlu.json?.sebep === "durak_kapandi", `${ucOlu.status} ${ucOlu.json?.sebep}`);

  // Atlanan durak da linki öldürür.
  const atla = await durakIlerlet(S1, "atlandi", "dükkân kapalıydı");
  const gAtlandi = await readTakipByToken(t1);
  iddia("ATLANAN durağın linki de öldü", atla.ok && !gAtlandi.ok && gAtlandi.sebep === "durak_kapandi", gAtlandi.ok ? "hâlâ açık!" : gAtlandi.sebep);

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · SEFER BAZLI LİNK BOZULMADI");

  await kimlik(YONETICI, "QA Yonetici", true);
  const gSefer2 = await readTakipByToken(tSefer);
  iddia("çok duraklı seferin SEFER bazlı linki HÂLÂ AÇIK", gSefer2.ok, gSefer2.ok ? "ok" : gSefer2.sebep);
  iddia(
    "hedefi sıradaki AÇIK durağa kaydı (1 ve 2 kapandı → 3. durak)",
    gSefer2.ok && Math.abs((gSefer2.gorunum.hedef?.lat ?? 0) - 47.503) < 1e-6,
    `${gSefer2.ok ? gSefer2.gorunum.hedef?.lat : "-"}`
  );

  // DURAKSIZ sefer — 079'un tam davranışı.
  const lEski = await takipLinkiUret(SEFER_DURAKSIZ, null);
  const gEski = await readTakipByToken(tokenAl(lEski.link.url));
  iddia("duraksız seferde link üretildi ve okunuyor", lEski.ok && gEski.ok, lEski.ok ? "ok" : lEski.hata);
  iddia(
    "duraksız seferin hedefi ESKİ `zone_id` (079 yolu)",
    gEski.ok && Math.abs((gEski.gorunum.hedef?.lat ?? 0) - BASKASI.lat) < 1e-6,
    `${gEski.ok ? gEski.gorunum.hedef?.lat : "-"}`
  );
  iddia("duraksız seferde ETA tek hedefli fonksiyondan (üst sınır 90)", gEski.ok && gEski.gorunum.eta?.ustSinirDk === 90, `${gEski.ok ? gEski.gorunum.eta?.ustSinirDk : "-"}`);
  iddia("duraksız seferde durakBagli=false, sıra ve pencere null", gEski.ok && gEski.gorunum.durakBagli === false && gEski.gorunum.onunuzdeDurak === null && gEski.gorunum.pencere === null, "ok");

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · DURAK SİLİNİRSE LİNKİ İPTAL EDİLİYOR");

  const l3 = await takipLinkiUret(SEFER, null, S3);
  iddia("3. durağa link üretildi", l3.ok, l3.ok ? "ok" : l3.hata);
  const t3 = tokenAl(l3.link.url);
  iddia("link canlı", (await readTakipByToken(t3)).ok, "ok");

  const sil = await durakSil(S3);
  const gSilindi = await readTakipByToken(t3);
  iddia(
    "durak silindi → link İPTAL EDİLDİ (müşteri 'gönderen kapattı' görür)",
    sil.ok && !gSilindi.ok && gSilindi.sebep === "iptal_edildi",
    gSilindi.ok ? "hâlâ açık!" : gSilindi.sebep
  );
  const kalanlar = await takipLinkleriGetir(SEFER);
  iddia("link KAYDI silinmedi, yalnız iptal edildi", kalanlar.linkler.some((l) => l.id === l3.link.id), `${kalanlar.linkler.length} link kayıtta`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · MOBİL UÇ");

  const jeton = (await issueTokens(YONETICI, true, 0)).accessToken;
  const mDurak = await mobilCagir(
    LINK_POST,
    `/api/mobile/sefer/${SEFER}/takip-linki`,
    { jeton, method: "POST", body: { durakId: S2 } },
    { id: SEFER }
  );
  iddia("POST durakId → kapanmış durak 409", mDurak.status === 409 && mDurak.json?.sebep === "durak_kapali", `${mDurak.status} ${mDurak.json?.sebep}`);

  // Açık bir durak gerek: yeni durak ekleyip mobilden link üretiyoruz.
  const yeni = await durakEkle(SEFER, { ad: "Mobil hedef", zoneId: "d2000000-0000-0000-0000-0000000000d2" });
  iddia("mobil sınama için açık durak eklendi", yeni.ok, yeni.ok ? "ok" : yeni.hata);
  const liste2 = await getSeferDuraklari(SEFER);
  const mobilDurak = liste2.duraklar.find((d) => d.ad === "Mobil hedef");
  const mOk = await mobilCagir(
    LINK_POST,
    `/api/mobile/sefer/${SEFER}/takip-linki`,
    { jeton, method: "POST", body: { durakId: mobilDurak.id } },
    { id: SEFER }
  );
  iddia("POST durakId → 201 ve gövdede durakId", mOk.status === 201 && mOk.json?.link?.durakId === mobilDurak.id, `${mOk.status} · ${String(mOk.json?.link?.durakId).slice(0, 8)}`);

  const mKotu = await mobilCagir(
    LINK_POST,
    `/api/mobile/sefer/${SEFER}/takip-linki`,
    { jeton, method: "POST", body: { durakId: "kotu-uuid" } },
    { id: SEFER }
  );
  iddia("POST bozuk durakId → 400", mKotu.status === 400, `${mKotu.status} ${mKotu.json?.sebep}`);

  const mList = await mobilCagir(LINK_GET, `/api/mobile/sefer/${SEFER}/takip-linki`, { jeton }, { id: SEFER });
  iddia("GET listesi durakId taşıyor", mList.status === 200 && mList.json?.linkler?.some((l) => l.durakId === mobilDurak.id), `${mList.status} · ${mList.json?.linkler?.length} link`);

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
