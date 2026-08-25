#!/usr/bin/env node
/**
 * VARDİYA DÜZELTME — KANIT (migration 087).
 *
 * Yığın: Docker Postgres 16 + PostgREST + proxy (docs/VARDIYA-DUZELTME.md §Prova).
 * Gerçek sunucu eylemleri, gerçek kapılar, gerçek AZG raporu.
 *
 * Kullanım:
 *   set -a; . <qa env>; set +a
 *   npm run verify:vardiya-duzelt
 */
import { supabaseAdmin } from "@/lib/supabase";
import { editEntryAction, adminCloseShiftAction, getShiftEditsAction } from "@/app/actions/shift";
import { buildAZGReport } from "@/lib/azg-report";
import { buildCostReport } from "@/lib/reports";
import { mevzuatPanosu } from "@/lib/mevzuat-db";
import { workedMs } from "@/lib/format";

const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const SOFOR = "b0000000-0000-0000-0000-00000000000b";
/**
 * ⚠️ UUID SÜRÜM BİTİ ÖNEMLİ. İlk tohumda id'ler `e1000000-0000-0000-...`
 * biçimindeydi: Postgres kabul ediyor ama `z.string().uuid()` REDDEDİYOR
 * (sürüm/variant nibble'ları geçersiz). Betik "Invalid UUID" ile düşüyordu ve
 * bu bir ÜRÜN kusuru değil TOHUM kusuruydu — gerçek id'ler `gen_random_uuid()`
 * ile üretiliyor ve her zaman v4.
 */
const YANLIS = "e1000000-0000-4000-8000-0000000000e1";
const ACIK = "e2000000-0000-4000-8000-0000000000e2";
/** Düzeltilse de ihlal KALAN kayıt (30 sa → 13 sa) — işaret onun üstünde görünmeli. */
const KALAN_IHLAL = "e3000000-0000-4000-8000-0000000000e3";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);
const sa = (ms) => (ms / 3_600_000).toFixed(2);

async function kimlik(workerId, ad, isAdmin) {
  const { sealData } = await import("iron-session");
  process.env.QA_SESSION_COOKIE = await sealData(
    { worker_id: workerId, name: ad, phone: "+430000000101", is_admin: isAdmin },
    { password: process.env.SESSION_PASSWORD, ttl: 0 }
  );
}

/** Bir vardiyanın TÜRETİLMİŞ sayılarını tek yerden okur. */
async function turetilmis(entryId) {
  const { data: e } = await supabaseAdmin
    .from("time_entries")
    .select("started_at, ended_at, break_minutes, start_km, end_km")
    .eq("id", entryId)
    .single();

  const ay = new Date(e.started_at).toISOString().slice(0, 7);
  const azg = await buildAZGReport(ay);
  const bas = new Date(`${ay}-01T00:00:00Z`);
  const bit = new Date(new Date(bas).setMonth(bas.getMonth() + 1));
  const maliyet = await buildCostReport({ start: bas, end: bit }, { fleetLPer100Km: null, measuredLiters: null });

  return {
    calismaSa: Number(sa(workedMs(e))),
    km: e.end_km !== null && e.start_km !== null ? e.end_km - e.start_km : null,
    azgIhlal: azg.ok ? azg.data.totalViolations : null,
    azgAgir: azg.ok ? azg.data.seriousCount : null,
    azgDuzeltilen: azg.ok ? azg.data.editedCount : null,
    azgIsaretli: azg.ok ? azg.data.violations.filter((v) => v.edited).length : null,
    maliyetSa: Number(maliyet.basis.hours.toFixed(2)),
    maliyetKm: Number(maliyet.basis.km.toFixed(0)),
    maliyetEur: Number(maliyet.totals.totalEur.toFixed(2)),
  };
}

function formVerisi(alanlar) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(alanlar)) if (v !== null && v !== undefined) fd.set(k, String(v));
  return fd;
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · ŞOFÖR DÜZELTEMEZ");

  await kimlik(SOFOR, "QA Sofor", false);
  let redd = null;
  try {
    await editEntryAction(
      formVerisi({ id: YANLIS, started_at: "2026-08-10T20:30", start_km: 100000, reason: "deneme" })
    );
  } catch (e) {
    redd = String(e.message ?? e);
  }
  iddia(
    "🔑 ŞOFÖR vardiya düzeltemiyor (requireAdmin kapısı)",
    Boolean(redd),
    redd ? redd.slice(0, 60) : "GEÇTİ — kapı açık!"
  );

  let reddKapat = null;
  try {
    await adminCloseShiftAction(ACIK, "deneme sebebi");
  } catch (e) {
    reddKapat = String(e.message ?? e);
  }
  iddia("🔑 ŞOFÖR kapanmamış vardiyayı kapatamıyor", Boolean(reddKapat), reddKapat ? reddKapat.slice(0, 60) : "GEÇTİ!");

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · SEBEP ZORUNLU");

  await kimlik(YONETICI, "QA Yonetici", true);

  const sebepsiz = await editEntryAction(
    formVerisi({
      id: YANLIS,
      started_at: "2026-08-10T20:30",
      ended_at: "2026-08-11T05:30",
      start_km: 100000,
      end_km: 100090,
      break_minutes: 0,
    })
  );
  iddia("🔑 SEBEPSİZ düzeltme REDDEDİLDİ", !sebepsiz.ok, sebepsiz.ok ? "kabul etti!" : sebepsiz.error);

  const kisaSebep = await editEntryAction(
    formVerisi({ id: YANLIS, started_at: "2026-08-10T20:30", start_km: 100000, reason: "ok" })
  );
  iddia("  2 karakterlik sebep de REDDEDİLDİ", !kisaSebep.ok, kisaSebep.ok ? "kabul etti!" : kisaSebep.error);

  const kapatSebepsiz = await adminCloseShiftAction(ACIK, "");
  iddia("🔑 SEBEPSİZ kapatma REDDEDİLDİ", !kapatSebepsiz.ok && kapatSebepsiz.error === "errReasonShort", kapatSebepsiz.ok ? "kapattı!" : kapatSebepsiz.error);

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · DÜZELTME ÖNCESİ — TÜRETİLMİŞ SAYILAR");

  const once = await turetilmis(YANLIS);
  console.log(`  ── ÖNCE: çalışma ${once.calismaSa} sa · km ${once.km} · AZG ihlal ${once.azgIhlal} (ağır ${once.azgAgir})`);
  console.log(`           maliyet paydası ${once.maliyetSa} sa · ${once.maliyetKm} km · ${once.maliyetEur} €`);
  iddia("yanlış kayıt 23+ saat görünüyor", once.calismaSa > 23, `${once.calismaSa} sa`);
  iddia("AZG bu kaydı AĞIR İHLAL sayıyor (12 sa tavanı)", once.azgAgir >= 1, `${once.azgAgir} ağır ihlal`);
  iddia("henüz düzeltme işareti YOK", once.azgDuzeltilen === 0 && once.azgIsaretli === 0, `${once.azgDuzeltilen} düzeltilmiş · ${once.azgIsaretli} işaretli satır`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · YÖNETİCİ DÜZELTTİ — İZ KALDI");

  const SEBEP = "Şoför kapatmayı unuttu; gerçek bitiş 05:30 (araç depoda).";
  const duzelt = await editEntryAction(
    formVerisi({
      id: YANLIS,
      started_at: "2026-08-10T20:30",
      ended_at: "2026-08-11T05:30",
      start_km: 100000,
      end_km: 100090,
      break_minutes: 30,
      reason: SEBEP,
    })
  );
  iddia("düzeltme kabul edildi", duzelt.ok, duzelt.ok ? "ok" : duzelt.error);

  const iz = await getShiftEditsAction(YANLIS);
  const alanlar = iz.map((r) => r.field);
  console.log(`  ── İZ: ${iz.length} satır · alanlar: ${alanlar.join(", ")}`);
  iddia("değişen HER alan için bir iz satırı", iz.length >= 3, `${iz.length} satır`);

  const bitisIzi = iz.find((r) => r.field === "ended_at");
  iddia(
    "🔑 ESKİ → YENİ değer kayıtta",
    Boolean(bitisIzi?.old_value && bitisIzi?.new_value && bitisIzi.old_value !== bitisIzi.new_value),
    `${bitisIzi?.old_value?.slice(0, 16)} → ${bitisIzi?.new_value?.slice(0, 16)}`
  );
  iddia("🔑 SEBEP kayıtta", bitisIzi?.reason === SEBEP, `"${(bitisIzi?.reason ?? "").slice(0, 45)}…"`);
  iddia("KİM kayıtta", bitisIzi?.changed_by === YONETICI, bitisIzi?.changed_by_name ?? bitisIzi?.changed_by);
  iddia("NE ZAMAN kayıtta", Boolean(bitisIzi?.changed_at), bitisIzi?.changed_at?.slice(0, 19));
  iddia("kaynak 'duzeltme'", bitisIzi?.kaynak === "duzeltme", String(bitisIzi?.kaynak));
  const gruplar = new Set(iz.map((r) => r.edit_group).filter(Boolean));
  iddia(
    "🔑 TEK DÜZELTME = TEK GRUP (sebep alan başına kopyalanmıyor)",
    gruplar.size === 1,
    `${gruplar.size} grup · ${iz.length} alan satırı`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · TÜRETİLMİŞ SAYILAR YENİDEN HESAPLANDI");

  const sonra = await turetilmis(YANLIS);
  console.log(`  ── SONRA: çalışma ${sonra.calismaSa} sa · km ${sonra.km} · AZG ihlal ${sonra.azgIhlal} (ağır ${sonra.azgAgir})`);
  console.log(`            maliyet paydası ${sonra.maliyetSa} sa · ${sonra.maliyetKm} km · ${sonra.maliyetEur} €`);

  iddia(
    "🔑 ÇALIŞMA SAATİ değişti (23,4 → 8,5 sa; 9 saat eksi 30 dk mola)",
    sonra.calismaSa < 9 && sonra.calismaSa > 8,
    `${once.calismaSa} → ${sonra.calismaSa} sa`
  );
  iddia("🔑 KM değişti", sonra.km !== once.km && sonra.km === 90, `${once.km} → ${sonra.km} km`);
  iddia(
    "🔑 AĞIR İHLAL KALKTI (12 sa tavanı artık aşılmıyor)",
    sonra.azgAgir < once.azgAgir,
    `${once.azgAgir} → ${sonra.azgAgir} ağır ihlal`
  );
  iddia(
    "🔑 MALİYET paydası değişti (saat ve km)",
    sonra.maliyetSa !== once.maliyetSa && sonra.maliyetKm !== once.maliyetKm,
    `${once.maliyetSa} sa/${once.maliyetKm} km → ${sonra.maliyetSa} sa/${sonra.maliyetKm} km`
  );
  iddia(
    "  maliyet toplamı da değişti",
    sonra.maliyetEur !== once.maliyetEur,
    `${once.maliyetEur} € → ${sonra.maliyetEur} €`
  );

  /**
   * ÖNBELLEK YOK — bu yüzden yeniden hesap "tetiklenmiyor", KENDİLİĞİNDEN
   * oluyor. Ölçüldü (canlı): surucu_skorlari / vardiya_ozet / gunluk_ozet
   * gibi türetilmiş tablo YOK; her sayı istek anında time_entries'ten
   * hesaplanıyor. Yukarıdaki dört sayı bunun kanıtı.
   */

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · AZG RAPORUNDA DÜZELTME İŞARETİ");

  iddia("düzeltilen kayıt sayısı raporda", sonra.azgDuzeltilen >= 1, `${sonra.azgDuzeltilen} kayıt`);

  /**
   * ⚠️ İLK TURDA BU BÖLÜM BOŞ GEÇTİ: tek kaydı düzeltince rapor tamamen
   * temizlendi (0 bulgu) ve "0 işaretli / 0 toplam" iddiayı geçirdi. İşaretin
   * çalıştığını görmek için düzeltildikten SONRA DA ihlal kalan bir satır
   * gerekiyor — 30 saatlik kayıt 13 saate çekiliyor, 12 sa tavanını hâlâ aşıyor.
   */
  const ay = "2026-08";
  const oncekiRapor = await buildAZGReport(ay);
  const oncekiIsaret = oncekiRapor.ok ? oncekiRapor.data.violations.filter((v) => v.edited).length : -1;

  const kalan = await editEntryAction(
    formVerisi({
      id: KALAN_IHLAL,
      started_at: "2026-08-15T05:00",
      ended_at: "2026-08-15T18:00",
      start_km: 300000,
      end_km: 300200,
      break_minutes: 45,
      reason: "Bitiş saati yanlış girilmiş; gerçek bitiş 18:00.",
    })
  );
  iddia("30 saatlik kayıt 13 saate düzeltildi", kalan.ok, kalan.ok ? "ok" : kalan.error);

  const rapor = await buildAZGReport(ay);
  const hepsi = rapor.ok ? rapor.data.violations : [];
  const isaretli = hepsi.filter((v) => v.edited);
  const isaretsiz = hepsi.filter((v) => !v.edited);
  for (const v of isaretli.slice(0, 4)) console.log(`     ★ ${v.date} · ${v.worker} · ${v.type}`);
  for (const v of isaretsiz.slice(0, 2)) console.log(`       ${v.date} · ${v.worker} · ${v.type}`);

  iddia(
    "🔑 DÜZELTİLDİĞİ HÂLDE İHLAL KALAN SATIR İŞARETLİ",
    isaretli.length >= 1,
    `${isaretli.length} işaretli / ${hepsi.length} bulgu (önce ${oncekiIsaret})`
  );
  iddia(
    "🔑 İŞARET KÖRÜ KÖRÜNE BASILMIYOR — düzeltilmemiş bulgu işaretsiz",
    isaretsiz.length >= 1,
    `${isaretsiz.length} işaretsiz`
  );
  iddia(
    "  işaretli satır düzeltilen ŞOFÖRE ait",
    isaretli.some((v) => v.worker === "QA Sofor Uc"),
    isaretli.map((v) => v.worker).join(" · ") || "—"
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · KAPANMAMIŞ VARDİYA KAPATILDI");

  const panoOnce = await mevzuatPanosu();
  iddia(
    "mevzuat panosu kaydı 'kapanmamış' sayıyor",
    panoOnce.bayatVardiya === 1,
    `${panoOnce.bayatVardiya} kapanmamış · ${panoOnce.satirlar.length} açık`
  );

  const KAPAT_SEBEP = "Şoför kapatmayı unuttu; son telemetriye göre kapatıldı.";
  const kapat = await adminCloseShiftAction(ACIK, KAPAT_SEBEP);
  iddia("kapatma kabul edildi", kapat.ok, kapat.ok ? "ok" : kapat.error);

  const { data: kapali } = await supabaseAdmin
    .from("time_entries")
    .select("ended_at, end_km, end_reason")
    .eq("id", ACIK)
    .single();
  iddia("vardiya kapandı", Boolean(kapali.ended_at), `${kapali.ended_at?.slice(0, 16)} · ${kapali.end_reason}`);

  const kapatIz = await getShiftEditsAction(ACIK);
  const bitisKapat = kapatIz.find((r) => r.field === "ended_at");
  console.log(`  ── KAPATMA İZİ: ${kapatIz.length} satır · alanlar: ${kapatIz.map((r) => r.field).join(", ")}`);
  iddia(
    "🔑 KAPATMA İZ BIRAKTI (önceden HİÇ iz bırakmıyordu)",
    Boolean(bitisKapat),
    bitisKapat ? `${bitisKapat.old_value ?? "null"} → ${bitisKapat.new_value?.slice(0, 16)}` : "iz yok!"
  );
  /**
   * KAPATMADA `end_km` İZİ YOK VE BU DOĞRU: tohumdaki odometre okuması 28
   * saatlik, `resolveEndKm` bayat okumayı REDDEDİYOR (ODO_MAX_AGE_MS = 6 sa).
   * Ölçülemeyen km null kalıyor, değişmediği için iz satırı da yazılmıyor.
   * "0 km" yazmak uydurma olurdu.
   */
  iddia(
    "  ölçülemeyen end_km için iz YAZILMADI (0 uydurulmadı)",
    kapali.end_km === null && !kapatIz.some((r) => r.field === "end_km"),
    `end_km=${kapali.end_km}`
  );
  iddia("  sebebi kayıtta", bitisKapat?.reason === KAPAT_SEBEP, `"${(bitisKapat?.reason ?? "").slice(0, 40)}…"`);
  iddia("  kaynak 'kapatma'", bitisKapat?.kaynak === "kapatma", String(bitisKapat?.kaynak));

  const panoSonra = await mevzuatPanosu();
  iddia(
    "🔑 MEVZUAT PANOSU da tazelendi (kapanmamış kayıt kalmadı)",
    panoSonra.bayatVardiya === 0,
    `${panoOnce.bayatVardiya} → ${panoSonra.bayatVardiya}`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · İZ SESSİZCE ÜZERİNE YAZILMIYOR");

  const izOnce = (await getShiftEditsAction(YANLIS)).length;
  await editEntryAction(
    formVerisi({
      id: YANLIS,
      started_at: "2026-08-10T20:30",
      ended_at: "2026-08-11T05:00",
      start_km: 100000,
      end_km: 100090,
      break_minutes: 30,
      reason: "İkinci düzeltme — bitiş 05:00 olacakmış.",
    })
  );
  const izSonra = await getShiftEditsAction(YANLIS);
  iddia(
    "🔑 İKİNCİ DÜZELTME İZ SATIRINI EZMEDİ, EKLEDİ",
    izSonra.length > izOnce,
    `${izOnce} → ${izSonra.length} satır`
  );
  const ilkSebep = izSonra.filter((r) => r.reason === SEBEP).length;
  iddia(
    "  ilk düzeltmenin sebebi HÂLÂ kayıtta",
    ilkSebep >= 1,
    `${ilkSebep} satır ilk sebebi taşıyor`
  );
  const gruplar2 = new Set(izSonra.map((r) => r.edit_group).filter(Boolean));
  iddia("  iki ayrı düzeltme = iki ayrı grup", gruplar2.size === 2, `${gruplar2.size} grup`);

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
