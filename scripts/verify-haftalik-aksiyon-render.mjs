#!/usr/bin/env node
/**
 * HAFTALIK AKSİYON — RENDER KANITI (migration 084).
 *
 * Kardeş betik (`verify-haftalik-aksiyon.mjs`) motoru ve sunucu eylemlerini
 * ölçüyor. Bu betik EKRANI ölçüyor: üretim derlemesi (`next start`), gerçek
 * iron-session çerezi, gerçek HTML.
 *
 * İki soru:
 *   1. Panel kalemleri, kanıt şeridini ve tarama sayaçlarını GERÇEKTEN basıyor mu?
 *   2. Her kalemin HEDEF EKRANI çalışıyor mu — dosya var mı değil, 200 dönüyor mu?
 *
 * ⚠️ `NEXT_PUBLIC_*` derleme anında gömülür: QA yığınına bakan bir `next start`
 * için QA env'iyle YENİDEN DERLEMEK şart (ölçüldü 25.08.2026).
 *
 * Kullanım (docs/HAFTALIK-AKSIYON.md §Prova):
 *   set -a; . <qa env>; set +a
 *   npm run build && npx next start -p 3300 &
 *   node scripts/verify-haftalik-aksiyon-render.mjs
 */
import { sealData } from "iron-session";

const TABAN = "http://127.0.0.1:3300";
const YONETICI = "a0000000-0000-0000-0000-00000000000a";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};

const cerez = await sealData(
  { worker_id: YONETICI, name: "QA Yonetici", phone: "+430000000101", is_admin: true },
  { password: process.env.SESSION_PASSWORD, ttl: 0 }
);

async function sayfa(yol) {
  const r = await fetch(TABAN + yol, {
    headers: { cookie: `hak_session=${cerez}` },
    redirect: "manual",
  });
  const html = await r.text();
  /**
   * 🔴 GÖRÜNEN METİN, GÖMÜLÜ SÖZLÜK DEĞİL.
   *
   * Next sayfanın içine RSC yükünü `<script>self.__next_f.push(...)` olarak
   * gömüyor ve o yükte TÜM i18n sözlüğü var. `html.includes("Tarama")` gibi
   * bir iddia ekran boş olsa bile geçer — bu betikte İKİ KEZ öyle geçti.
   * Script blokları atılıyor; iddialar yalnız render edilmiş markup'a bakıyor.
   */
  const gorunen = html.replace(/<script[\s\S]*?<\/script>/g, "");
  return { status: r.status, html, gorunen, yon: r.headers.get("location") };
}

const rest = async (yol) => {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${yol}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  return r.json();
};

// ── Panelin GERÇEKTEN göstereceği kalemleri veriden oku (beklenti sabitlenmiyor).
const turlar = await rest("haftalik_aksiyon_turlari?select=id,hafta_basi,bildirim_alici,bildirim_jeton&order=hafta_basi.desc&limit=1");
const tur = turlar[0];
const kalemler = await rest(
  `haftalik_aksiyonlar?select=baslik,kural,hedef_yol,kanit,durum&tur_id=eq.${tur.id}&order=oncelik.desc`
);
console.log(`  (veri) hafta ${tur.hafta_basi} · ${kalemler.length} kalem`);

console.log("\n═══ PANEL EKRANI ═══");
const p = await sayfa("/admin/haftalik");
iddia("sayfa 200 döndü", p.status === 200, `${p.status} ${p.yon ?? ""}`);
iddia(
  "kalem başlıkları HTML'de",
  kalemler.every((k) => p.gorunen.includes(k.baslik)),
  `${kalemler.filter((k) => p.gorunen.includes(k.baslik)).length}/${kalemler.length}`
);
iddia(
  "KANIT ŞERİDİ basılıyor (ölçülen · eşik)",
  kalemler.some((k) => p.gorunen.includes(`${k.kanit.olculen} ölçüldü`)),
  (p.gorunen.match(/[\d.-]+ ölçüldü · eşik [\d.-]+ ?[^<\s]*/) ?? ["yok"])[0]
);
iddia("hafta başlığı görünüyor", /hafta[sı]?\b/i.test(p.gorunen), "var");
iddia("tarama bölümü sayfada", p.gorunen.includes("Tarama"), "var");
/**
 * BİLDİRİM AKIBETİ — ÜÇ DURUM, HEPSİ RENDER'DAN OKUNUYOR.
 *
 * ⚠️ İKİ TUZAK BURADA YAKALANDI:
 *   1. İlk desen (`/yöneticiye/`) sayfaya gömülü ÇEVİRİ SÖZLÜĞÜNDE eşleşti ve
 *      iddia gerçek çıktıyı hiç ölçmeden geçti. Artık yalnız SAYIYLA eşleşiyor.
 *   2. Gerçek kusur: bildirim DENENMEMİŞ tur (cron dışı üretim) panelde
 *      "kayıtlı cihaz yok" yazıyordu. 084'te sütunlar NULL'lanabilir yapıldı;
 *      panelin üçüncü kolu burada ölçülüyor.
 */
const BILDIRIM = {
  gitti: /(\d+) yöneticiye · (\d+) cihaza/,
  gitmedi: /(\d+) yönetici — kayıtlı cihaz yok/,
  denenmedi: /Bildirim denenmedi[^<]*/,
};
const okunanBildirim = (html) => {
  for (const [ad, desen] of Object.entries(BILDIRIM)) {
    const m = html.match(desen);
    if (m) return { ad, metin: m[0] };
  }
  return { ad: "yok", metin: "hiçbir bildirim satırı basılmadı" };
};
const bs = okunanBildirim(p.gorunen);
iddia(
  `bildirim akıbeti RENDER'DAN okunuyor — '${bs.ad}' kolu`,
  bs.ad !== "yok" && bs.ad === (tur.bildirim_alici === null ? "denenmedi" : tur.bildirim_jeton > 0 ? "gitti" : "gitmedi"),
  `${bs.metin}  (db: alici=${tur.bildirim_alici} jeton=${tur.bildirim_jeton})`
);

iddia(
  "'Yaptım' ve 'İlgisiz' düğmeleri açık kalemlerde",
  kalemler.some((k) => k.durum === "acik") ? p.gorunen.includes("Yaptım") && p.gorunen.includes("İlgisiz") : true,
  p.gorunen.includes("Yaptım") ? "var" : "açık kalem yok"
);

console.log("\n═══ HEDEF EKRANLARI — 200 mü ═══");
const yollar = [...new Set(kalemler.map((k) => k.hedef_yol).filter(Boolean))];
for (const yol of yollar) {
  const h = await sayfa(yol);
  iddia(`${yol}`, h.status === 200, `${h.status}${h.yon ? " → " + h.yon : ""}`);
}

console.log("\n═══ GEÇMİŞ HAFTA ═══");
const eski = await rest("haftalik_aksiyon_turlari?select=hafta_basi,bildirim_alici,bildirim_jeton&order=hafta_basi.asc&limit=1");
const g = await sayfa(`/admin/haftalik?hafta=${eski[0].hafta_basi}`);
iddia("geçmiş hafta 200", g.status === 200, `${g.status} · ${eski[0].hafta_basi}`);
iddia("kapatılanlar bölümü var", g.gorunen.includes("Kapatılanlar"), "var");
/**
 * GEÇMİŞ HAFTA = bildirimin GERÇEKTEN gönderildiği tur (cron yolu). Böylece
 * bildirim satırının İKİ kolu da tek koşumda render'dan ölçülmüş oluyor.
 */
const gb = okunanBildirim(g.gorunen);
iddia(
  `geçmiş turda bildirim '${gb.ad}' kolu — gönderim yolu koştuğu için`,
  gb.ad === (eski[0].bildirim_alici === null ? "denenmedi" : eski[0].bildirim_jeton > 0 ? "gitti" : "gitmedi"),
  `${gb.metin}  (db: alici=${eski[0].bildirim_alici} jeton=${eski[0].bildirim_jeton})`
);

console.log(`\n${dusen === 0 ? "✓ RENDER KANITI GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
process.exit(dusen === 0 ? 0 : 1);
