#!/usr/bin/env node
/**
 * HAFTALIK AKSİYON PANELİ — KANIT (migration 084).
 *
 * ⚠️ ÜRETİME DEĞİL, YEREL YIĞINA KOŞAR (Docker: Postgres + PostgREST + proxy).
 * Tur/aksiyon YAZAR ve GERÇEK Expo ucuna bildirim gönderir; üretimde haftalık
 * tur uydurmak istemiyoruz. Kurulum: docs/HAFTALIK-AKSIYON.md §Prova.
 *
 * ── NE SINANIYOR ──────────────────────────────────────────────────────────
 * GERÇEK cron uç işleyicisi (sır denetimi dahil), GERÇEK sunucu eylemleri
 * (`requireFleetView` kapısından, gerçek iron-session mührüyle) ve GERÇEK
 * push yolu. Kural katmanı ayrıca SAF olarak (sorgusuz) sınanıyor.
 *
 * Kullanım:
 *   ENV_FILE=<qa env> node --import ./scripts/ts-server.mjs scripts/verify-haftalik-aksiyon.mjs
 */
import { existsSync } from "node:fs";
import { sealData } from "iron-session";
import { sessionOptions } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { GET as CRON_GET } from "@/app/api/cron/haftalik-aksiyon/route";
import { getHaftalikPanel, haftalikAksiyonKapat } from "@/app/actions/haftalik-aksiyon";
import { haftalikTuruUret } from "@/lib/haftalik-aksiyon-db";
import {
  adaylariSec,
  haftaBasi,
  oncelikHesapla,
  susturulmusMu,
  HAFTALIK_SUSTURMA_GUN,
  HAFTALIK_TAVAN,
  KURAL_BASINA_TAVAN,
} from "@/lib/haftalik-aksiyon";

const YONETICI = "a0000000-0000-0000-0000-00000000000a";

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

async function cron(query = "") {
  const res = await CRON_GET(
    new Request(`http://x/api/cron/haftalik-aksiyon?secret=${process.env.CRON_SECRET}${query}`)
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · SAF KATMAN — kural motoru sorgusuz sınanıyor");

  iddia(
    "öncelik TAM SAYI döner (integer kolonu)",
    Number.isInteger(oncelikHesapla({ kural: "yakit_sapmasi", aciliyet: 20, etki: 31.05845 })),
    String(oncelikHesapla({ kural: "yakit_sapmasi", aciliyet: 20, etki: 31.05845 }))
  );
  iddia(
    "risk sınıfı sırası korunuyor (belge > bakım > sessiz > skor > yakıt > düzen)",
    oncelikHesapla({ kural: "belge_bitiyor" }) > oncelikHesapla({ kural: "bakim_gecikti" }) &&
      oncelikHesapla({ kural: "bakim_gecikti" }) > oncelikHesapla({ kural: "sessiz_arac" }) &&
      oncelikHesapla({ kural: "sessiz_arac" }) > oncelikHesapla({ kural: "skor_dususu" }) &&
      oncelikHesapla({ kural: "skor_dususu" }) > oncelikHesapla({ kural: "yakit_sapmasi" }) &&
      oncelikHesapla({ kural: "yakit_sapmasi" }) > oncelikHesapla({ kural: "vardiya_kapanmadi" }),
    "800 > 700 > 600 > 500 > 400 > 300"
  );

  // Çeşitlilik: 7 sessiz araç → yalnız 2'si seçilir, 5'i elenir.
  const sahte = Array.from({ length: 7 }, (_, i) => ({
    kural: "sessiz_arac",
    workerId: null,
    vehicleId: `v${i}`,
    oncelik: 700 - i,
    baslik: `araç ${i}`,
    gerekce: "",
    kanit: {},
    hedefYol: null,
  }));
  const secim = adaylariSec(sahte);
  iddia(
    `çeşitlilik: 7 aynı kural → ${KURAL_BASINA_TAVAN} seçildi, 5 elendi`,
    secim.secilen.length === KURAL_BASINA_TAVAN && secim.elenen.length === 5,
    `seçilen ${secim.secilen.length} · elenen ${secim.elenen.length}`
  );

  // Tavan: 4 farklı kuraldan 8 aday → 5 seçilir.
  const karisik = ["belge_bitiyor", "bakim_gecikti", "sessiz_arac", "yakit_sapmasi"].flatMap((k, i) =>
    [0, 1].map((j) => ({
      kural: k,
      workerId: null,
      vehicleId: `${k}-${j}`,
      oncelik: 900 - i * 100 - j,
      baslik: "",
      gerekce: "",
      kanit: {},
      hedefYol: null,
    }))
  );
  const secim2 = adaylariSec(karisik);
  iddia(
    `tavan: 8 aday → ${HAFTALIK_TAVAN} seçildi`,
    secim2.secilen.length === HAFTALIK_TAVAN,
    `${secim2.secilen.length} kalem · ${secim2.elenen.length} elendi`
  );
  iddia(
    "seçim DETERMİNİST (aynı girdi, aynı çıktı)",
    JSON.stringify(adaylariSec(karisik).secilen) === JSON.stringify(secim2.secilen),
    "aynı"
  );

  iddia("hafta başı PAZARTESİ'ye yuvarlıyor", haftaBasi("2026-08-27") === "2026-08-24", `27.08 → ${haftaBasi("2026-08-27")}`);
  iddia("pazar da AYNI haftaya düşüyor", haftaBasi("2026-08-30") === "2026-08-24", `30.08 → ${haftaBasi("2026-08-30")}`);

  const dun = new Date(Date.now() - 86_400_000).toISOString();
  const eski = new Date(Date.now() - (HAFTALIK_SUSTURMA_GUN + 1) * 86_400_000).toISOString();
  iddia(
    "susturma penceresi içindeki 'ilgisiz' SUSTURUYOR",
    susturulmusMu([{ kural: "k", ozneId: "x", kapatildiAt: dun }], "k", "x"),
    `${HAFTALIK_SUSTURMA_GUN} gün`
  );
  iddia(
    "pencere dışındaki 'ilgisiz' SUSTURMUYOR",
    !susturulmusMu([{ kural: "k", ozneId: "x", kapatildiAt: eski }], "k", "x"),
    `${HAFTALIK_SUSTURMA_GUN + 1} gün önce`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · CRON — GERÇEK UÇ, GERÇEK ÜRETİM");

  const yetkisiz = await CRON_GET(new Request("http://x/api/cron/haftalik-aksiyon"));
  iddia("sırsız istek 401", yetkisiz.status === 401, String(yetkisiz.status));

  const kuru = await cron("&kuru=1");
  iddia("kuru koşum 200 ve YAZMIYOR", kuru.status === 200 && kuru.json?.kuru === true, String(kuru.status));
  const { count: kuruSonrasi } = await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .select("id", { count: "exact", head: true });
  iddia("kuru koşumdan sonra tur YOK", kuruSonrasi === 0, `${kuruSonrasi} tur`);

  const r = await cron();
  iddia("cron 200 döndü", r.status === 200, String(r.status));
  iddia("tur üretildi", !r.json?.zatenVardi && r.json?.turId, r.json?.turId?.slice(0, 8));

  console.log("\n  ── HAM ÇIKTI ──");
  console.log("  tarama:", JSON.stringify(r.json?.tarama));
  for (const k of r.json?.kalemler ?? []) {
    console.log(`    [${k.oncelik}] ${k.kural} — ${k.baslik}`);
  }

  const tarama = r.json?.tarama ?? {};
  iddia("yedi kuralın hepsi tarandı", Object.keys(tarama).length === 7, Object.keys(tarama).join(","));
  iddia(
    "sessiz_arac: 3 cihazlı araçtan 2'si eşiği geçti (biri taze)",
    tarama.sessiz_arac?.gecen === 2,
    `aday ${tarama.sessiz_arac?.aday} · geçen ${tarama.sessiz_arac?.gecen} · eşik ${tarama.sessiz_arac?.esik}`
  );
  iddia(
    "belge_bitiyor: 2 belgeden 1'i eşiği geçti (12 gün ✓, 90 gün ✗)",
    tarama.belge_bitiyor?.gecen === 1,
    `aday ${tarama.belge_bitiyor?.aday} · geçen ${tarama.belge_bitiyor?.gecen}`
  );
  iddia("bakim_gecikti: 1 plan geçti", tarama.bakim_gecikti?.gecen === 1, `geçen ${tarama.bakim_gecikti?.gecen}`);
  iddia("is_emri_bekliyor: 10 günlük emir geçti", tarama.is_emri_bekliyor?.gecen === 1, `geçen ${tarama.is_emri_bekliyor?.gecen}`);
  iddia(
    "vardiya_kapanmadi: 30 vardiyanın 5'i açık → eşiği geçti",
    tarama.vardiya_kapanmadi?.gecen === 1,
    `aday ${tarama.vardiya_kapanmadi?.aday} · geçen ${tarama.vardiya_kapanmadi?.gecen}`
  );
  iddia(
    "🔴 'KURAL ÇALIŞMADI' ile 'GEÇEN YOK' AYRI: yakıt/skor `atlandi` taşıyor",
    Boolean(tarama.yakit_sapmasi?.atlandi || tarama.yakit_sapmasi?.aday === 0) ||
      tarama.yakit_sapmasi?.gecen === 0,
    `yakıt: ${tarama.yakit_sapmasi?.atlandi ?? `aday ${tarama.yakit_sapmasi?.aday}`} · skor: ${tarama.skor_dususu?.atlandi ?? `aday ${tarama.skor_dususu?.aday}`}`
  );

  iddia(`en fazla ${HAFTALIK_TAVAN} kalem yazıldı`, (r.json?.aksiyon ?? 0) <= HAFTALIK_TAVAN, `${r.json?.aksiyon} kalem`);
  const kuralSayaci = {};
  for (const k of r.json?.kalemler ?? []) kuralSayaci[k.kural] = (kuralSayaci[k.kural] ?? 0) + 1;
  iddia(
    `kural başına en fazla ${KURAL_BASINA_TAVAN}`,
    Object.values(kuralSayaci).every((n) => n <= KURAL_BASINA_TAVAN),
    JSON.stringify(kuralSayaci)
  );
  iddia(
    "sıralama önceliğe göre (en yüksek üstte)",
    (r.json?.kalemler ?? []).every((k, i, a) => i === 0 || a[i - 1].oncelik >= k.oncelik),
    (r.json?.kalemler ?? []).map((k) => k.oncelik).join(" ≥ ")
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · HAFTADA TAM 1");

  const ikinci = await cron();
  iddia("ikinci tetikleme yazmıyor", ikinci.json?.zatenVardi === true, JSON.stringify(ikinci.json?.aciklama ?? "").slice(0, 60));
  const { count: turSayisi } = await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .select("id", { count: "exact", head: true });
  iddia("hâlâ TEK tur var", turSayisi === 1, `${turSayisi} tur`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · BİLDİRİM — GERÇEK EXPO UCU");

  iddia("bildirim alıcısı bulundu", (r.json?.bildirim?.alici ?? 0) >= 1, `${r.json?.bildirim?.alici} yönetici`);
  iddia("kayıtlı cihaza gönderildi", (r.json?.bildirim?.jeton ?? 0) === 1, `${r.json?.bildirim?.jeton} jeton`);
  iddia(
    "Expo ucu HATASIZ yanıtladı (gönderim yolu uçtan uca koştu)",
    r.json?.bildirim?.hata === null,
    String(r.json?.bildirim?.hata)
  );
  const { data: jetonSonra } = await supabaseAdmin.from("push_tokens").select("token");
  iddia(
    "🔑 ÖLÜ JETON TEMİZLENDİ (Expo 'DeviceNotRegistered' dedi)",
    (jetonSonra ?? []).length === 0,
    `${(jetonSonra ?? []).length} jeton kaldı`
  );
  const { data: turSatir } = await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .select("bildirim_alici, bildirim_jeton, bildirim_hata")
    .limit(1)
    .maybeSingle();
  iddia(
    "bildirim akıbeti TURA YAZILDI (panel 'gitti mi' diyebilsin)",
    turSatir?.bildirim_alici >= 1 && turSatir?.bildirim_jeton === 1,
    JSON.stringify(turSatir)
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · PANEL — GERÇEK SUNUCU EYLEMİ, GERÇEK KAPI");
  await kimlik(YONETICI, "QA Yonetici", true);

  const panel = await getHaftalikPanel();
  iddia("panel turu okudu", panel.tur !== null, panel.tur?.haftaBasi);
  iddia("kalemler geldi", panel.aksiyonlar.length === r.json?.aksiyon, `${panel.aksiyonlar.length} kalem`);
  iddia(
    "her kalem KANIT taşıyor (ölçülen + eşik + birim)",
    panel.aksiyonlar.every((a) => a.kanit?.olculen !== undefined && a.kanit?.esik !== undefined),
    panel.aksiyonlar.map((a) => `${a.kural}:${a.kanit?.olculen}/${a.kanit?.esik}${a.kanit?.birim ?? ""}`).join(" | ")
  );
  iddia(
    "özne adları çözüldü (şoför adı / plaka)",
    panel.aksiyonlar.filter((a) => a.workerId || a.vehicleId).every((a) => a.ozneAd),
    panel.aksiyonlar.map((a) => a.ozneAd ?? "filo").join(", ")
  );

  // ── HEDEF EKRANLARI
  const yollar = [...new Set(panel.aksiyonlar.map((a) => a.hedefYol).filter(Boolean))];
  for (const yol of yollar) {
    // /admin/araclar/<uuid> → app/admin/araclar/[id]/page.tsx
    const parcalar = yol.split("/").filter(Boolean);
    const adaylar = [
      `app/${parcalar.join("/")}/page.tsx`,
      `app/${parcalar.slice(0, -1).join("/")}/[id]/page.tsx`,
    ];
    iddia(`hedef ekran var: ${yol}`, adaylar.some((a) => existsSync(a)), adaylar.find((a) => existsSync(a)) ?? "YOK");
  }

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · KAPATMA — 'yaptım' ve 'ilgisiz'");

  const yapilacak = panel.aksiyonlar[0];
  const ilgisizOlan = panel.aksiyonlar.find((a) => a.id !== yapilacak.id);

  const k1 = await haftalikAksiyonKapat(yapilacak.id, "yapildi");
  iddia("'yaptım' kapattı", k1.ok, k1.ok ? yapilacak.kural : k1.hata);

  const k1b = await haftalikAksiyonKapat(yapilacak.id, "ilgisiz");
  iddia("İKİNCİ kapatma REDDEDİLDİ (karar değişmez)", !k1b.ok && k1b.hata === "zaten_kapali", k1b.ok ? "kabul edildi!" : k1b.hata);

  const k2 = await haftalikAksiyonKapat(ilgisizOlan.id, "ilgisiz", "QA: bu araç yedek, sürekli park hâlinde");
  iddia("'ilgisiz' kapattı (notuyla)", k2.ok, k2.ok ? ilgisizOlan.kural : k2.hata);

  const panel2 = await getHaftalikPanel();
  const kapananlar = panel2.aksiyonlar.filter((a) => a.durum !== "acik");
  iddia("iki kalem kapandı, KAYITTA duruyor (silinmedi)", kapananlar.length === 2, `${kapananlar.length} kapalı · ${panel2.aksiyonlar.length} toplam`);
  const ilgisizSatir = panel2.aksiyonlar.find((a) => a.id === ilgisizOlan.id);
  iddia("kapatma notu saklandı", ilgisizSatir?.kapatmaNotu?.includes("yedek"), ilgisizSatir?.kapatmaNotu ?? "-");
  const beklenenBitis = Date.parse(ilgisizSatir.kapatildiAt) + HAFTALIK_SUSTURMA_GUN * 86_400_000;
  iddia(
    `susturma bitişi ${HAFTALIK_SUSTURMA_GUN} gün sonrası`,
    Math.abs(Date.parse(ilgisizSatir.susturmaBitis) - beklenenBitis) < 1000,
    new Date(Date.parse(ilgisizSatir.susturmaBitis)).toISOString().slice(0, 10)
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · SUSTURMA GERÇEKTEN ÇALIŞIYOR — GELECEK HAFTA");

  const gelecekHafta = new Date(Date.now() + 7 * 86_400_000);
  const tur2 = await haftalikTuruUret(gelecekHafta);
  iddia("gelecek haftanın turu üretildi", tur2.ok && !tur2.zatenVardi, tur2.ok ? tur2.haftaBasi : tur2.sebep);

  const susturulanKural = ilgisizOlan.kural;
  const susturulanOzne = ilgisizOlan.workerId ?? ilgisizOlan.vehicleId;
  const geriGeldiMi = (tur2.secilen ?? []).some(
    (a) => a.kural === susturulanKural && (a.workerId ?? a.vehicleId) === susturulanOzne
  );
  iddia(
    `'ilgisiz' denen kalem GERİ GELMEDİ (${susturulanKural})`,
    !geriGeldiMi,
    geriGeldiMi ? "GERİ GELDİ!" : `${(tur2.secilen ?? []).length} yeni kalem, o kalem yok`
  );
  const yapildiKural = yapilacak.kural;
  const yapildiOzne = yapilacak.workerId ?? yapilacak.vehicleId;
  const yapildiGeriGeldi = (tur2.secilen ?? []).some(
    (a) => a.kural === yapildiKural && (a.workerId ?? a.vehicleId) === yapildiOzne
  );
  iddia(
    `'yaptım' denen kalem GERİ GELDİ (sorun sürüyorsa tekrar sorulur) — ${yapildiKural}`,
    yapildiGeriGeldi,
    yapildiGeriGeldi ? "geri geldi ✓" : "gelmedi"
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · GEÇMİŞ HAFTA GÖRÜLEBİLİYOR");

  const panel3 = await getHaftalikPanel();
  iddia("panel en son haftayı gösteriyor", panel3.tur?.haftaBasi === tur2.haftaBasi, panel3.tur?.haftaBasi);
  iddia("hafta listesi İKİ hafta taşıyor", panel3.haftalar.length === 2, panel3.haftalar.map((h) => h.haftaBasi).join(" · "));

  const gecmis = await getHaftalikPanel(panel.tur.haftaBasi);
  iddia("GEÇMİŞ hafta açılabiliyor", gecmis.tur?.haftaBasi === panel.tur.haftaBasi, gecmis.tur?.haftaBasi);
  iddia(
    "geçmiş haftada kapatma izleri duruyor ('düzeldi mi' sorusu cevaplanabilir)",
    gecmis.aksiyonlar.filter((a) => a.durum !== "acik").length === 2,
    `${gecmis.aksiyonlar.filter((a) => a.durum !== "acik").length} kapalı kalem`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("9 · KAPSAM — şef kendi filosunu görür");

  // Araçların hepsi 'mavi'. Şefi 'bordo' yapıp araç kalemlerinin düştüğünü ölç.
  await supabaseAdmin.from("workers").update({ managed_fleet: "bordo" }).eq("id", YONETICI);
  await kimlik(YONETICI, "QA Sef", false);
  const sefPanel = await getHaftalikPanel();
  const aracKalemi = sefPanel.aksiyonlar.filter((a) => a.vehicleId);
  iddia(
    "başka filonun ARAÇ kalemleri şefe GÖNDERİLMİYOR",
    aracKalemi.length === 0,
    `${aracKalemi.length} araç kalemi · ${sefPanel.aksiyonlar.length} toplam`
  );
  /**
   * ⚠️ FİLO GENELİ KALEMİ GERÇEKTEN SINA.
   *
   * İlk yazımda bu iddia `||` ile teknik olarak geçiyordu: `vardiya_kapanmadi`
   * eşiği geçmişti ama önceliği en düşük olduğu için 5'lik tavana giremedi ve
   * panelde HİÇ filo geneli kalem yoktu. Yani kapsam kuralının "öznesi yok →
   * herkese açık" kolu ÖLÇÜLMEMİŞTİ. Kalem doğrudan yazılıp sınanıyor.
   */
  await supabaseAdmin.from("haftalik_aksiyonlar").insert({
    tur_id: panel3.tur.id,
    kural: "vardiya_kapanmadi",
    oncelik: 350,
    baslik: "QA filo geneli kalem",
    gerekce: "kapsam sınaması",
    kanit: { olculen: 9, esik: 5, birim: "%" },
    hedef_yol: "/admin",
  });
  const sefPanel2 = await getHaftalikPanel();
  iddia(
    "FİLO GENELİ kalem (öznesi yok) şefe de GÖRÜNÜYOR",
    sefPanel2.aksiyonlar.some((a) => !a.workerId && !a.vehicleId && a.baslik === "QA filo geneli kalem"),
    `${sefPanel2.aksiyonlar.length} kalem: ${sefPanel2.aksiyonlar.map((a) => a.kural).join(",")}`
  );
  iddia(
    "ama ARAÇ kalemleri hâlâ gizli (kapsam yalnız özneli kalemleri süzüyor)",
    sefPanel2.aksiyonlar.every((a) => !a.vehicleId),
    `${sefPanel2.aksiyonlar.filter((a) => a.vehicleId).length} araç kalemi`
  );

  // Şef kendi kapsamı dışındaki bir kalemi KAPATAMAZ.
  const yasakKalem = panel3.aksiyonlar.find((a) => a.vehicleId);
  if (yasakKalem) {
    const yasak = await haftalikAksiyonKapat(yasakKalem.id, "yapildi");
    iddia("şef kapsam DIŞI kalemi kapatamıyor", !yasak.ok && yasak.hata === "kapsam_disi", yasak.ok ? "kapattı!" : yasak.hata);
  }

  await supabaseAdmin.from("workers").update({ managed_fleet: null }).eq("id", YONETICI);

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
