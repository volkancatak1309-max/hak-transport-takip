#!/usr/bin/env node
/**
 * ÇOK DURAKLI SEFER — RENDER KANITI (migration 082).
 *
 * `verify-sefer-duraklari.mjs` sunucu EYLEMLERİNİ ölçüyor; bu betik SAYFANIN
 * KENDİSİNİ ölçüyor: üretim derlemesi (`next start`), gerçek iron-session
 * çerezi, gerçek HTML. Soru tek: `/admin/seferler` ve `/panel/seferler`
 * sunucuda render edilirken durak sayacını ve ÇÖZÜLMÜŞ hedef adını gerçekten
 * basıyor mu.
 *
 * ⚠️ DURAK SATIRLARI BU HTML'DE YOK — BEKLENEN. Liste istek üzerine
 * (istemcide, `getSeferDuraklari`/`getSoforDuraklari` ile) yükleniyor; o katman
 * kardeş betikte kanıtlanıyor. Burada ölçülen SUNUCUDA türetilen iki değer.
 *
 * ⚠️ `NEXT_PUBLIC_*` DERLEME ANINDA GÖMÜLÜR: QA yığınına bakan bir `next start`
 * için QA env'iyle YENİDEN DERLEMEK şart. Üretim derlemesiyle koşulursa
 * "Invalid API key" alınır (ölçüldü, 25.08.2026) — çünkü sunucu QA anahtarıyla
 * ÜRETİM adresine gider.
 *
 * Kullanım (docs/COK-DURAKLI-SEFER.md §Prova):
 *   set -a; . <qa env>; set +a
 *   npm run build && npx next start -p 3300 &
 *   node scripts/verify-sefer-duraklari-render.mjs
 */
import { sealData } from "iron-session";

const TABAN = "http://127.0.0.1:3300";
const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const SOFOR = "b0000000-0000-0000-0000-00000000000b";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};

async function muhur(workerId, ad, isAdmin) {
  return sealData(
    { worker_id: workerId, name: ad, phone: "+430000000000", is_admin: isAdmin },
    { password: process.env.SESSION_PASSWORD, ttl: 0 }
  );
}

async function sayfa(yol, cerez) {
  const r = await fetch(TABAN + yol, {
    headers: { cookie: `hak_session=${cerez}` },
    redirect: "manual",
  });
  return { status: r.status, html: await r.text(), yonlendirme: r.headers.get("location") };
}

const bugun = new Date().toISOString().slice(0, 10);
const ay = bugun.slice(0, 7);

/**
 * BEKLENEN HEDEF ADINI SABİTLEMİYORUZ — VERİTABANINDAN TÜRETİYORUZ.
 *
 * İlk turda ad sabit yazılmıştı ve doğrulama betiği sıralamayı değiştirdiği
 * için iddia düştü; sayfa DOĞRUYU basıyordu. Sabit beklenti, ölçümü verinin
 * o anki hâline değil betiğin hafızasına bağlar.
 */
const rest = async (yol) => {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${yol}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  return r.json();
};
const duraklar = await rest(
  "sefer_duraklari?select=sira,ad,durum,sefer_id&sefer_id=eq.e2000000-0000-0000-0000-0000000000e2&order=sira"
);
const acik = duraklar.filter((d) => d.durum === "bekliyor" || d.durum === "varildi");
const beklenenHedef = (acik[0] ?? duraklar[duraklar.length - 1]).ad;
const biten = duraklar.filter((d) => d.durum === "tamamlandi" || d.durum === "atlandi").length;
console.log(`  (veri) ${duraklar.length} durak · biten ${biten} · sıradaki "${beklenenHedef}"`);

console.log("\n═══ RENDER · /admin/seferler ═══");
const a = await sayfa(`/admin/seferler?tarih=${bugun}`, await muhur(YONETICI, "QA Yonetici", true));
iddia("sayfa 200 döndü (giriş sayfasına atmadı)", a.status === 200, `${a.status} ${a.yonlendirme ?? ""}`);
iddia(
  "çok duraklı seferin sayacı HTML'de",
  a.html.includes(`${biten}/${duraklar.length} durak`),
  (a.html.match(/\d+\/\d+ durak/g) ?? []).join(" ")
);
iddia(
  "çözülmüş hedef adı HTML'de (sıradaki durak)",
  a.html.includes(beklenenHedef),
  a.html.includes(beklenenHedef) ? beklenenHedef : "yok"
);
iddia(
  "eski tek hedefli seferin hedefi de HTML'de (zone_id yolu)",
  a.html.includes("Metzgerei Huber"),
  a.html.includes("Metzgerei Huber") ? "Metzgerei Huber" : "yok"
);

console.log("\n═══ RENDER · /panel/seferler (şoför) ═══");
const p = await sayfa(`/panel/seferler?ay=${ay}`, await muhur(SOFOR, "QA Sofor", false));
iddia("sayfa 200 döndü", p.status === 200, `${p.status} ${p.yonlendirme ?? ""}`);
iddia(
  "şoförün hedefi = SIRADAKİ durak (sunucuda çözülmüş)",
  p.html.includes(beklenenHedef),
  p.html.includes(beklenenHedef) ? beklenenHedef : "yok"
);
iddia(
  "şoför BAŞKASININ seferini görmüyor (yöneticinin seferi listede yok)",
  !p.html.includes("QA Yonetici"),
  p.html.includes("QA Yonetici") ? "sızdı!" : "temiz"
);

console.log(`\n${dusen === 0 ? "✓ RENDER KANITI GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
process.exit(dusen === 0 ? 0 : 1);
