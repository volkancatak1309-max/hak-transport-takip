#!/usr/bin/env node
/**
 * TAKİP LİNKİ DURAĞA BAĞLI — RENDER + SIZINTI KANITI (migration 083).
 *
 * Kardeş betik (`verify-takip-durak.mjs`) sunucu gövdesini ölçüyor; bu betik
 * MÜŞTERİNİN GERÇEKTEN GÖRDÜĞÜ ŞEYİ ölçüyor: üretim derlemesinin (`next start`)
 * ürettiği HTML. Soru tek — diğer durakların adresi, alıcı adı, şoför adı ya da
 * plaka sayfanın KAYNAĞINDA var mı.
 *
 * ⚠️ NEDEN AYRI: gövdeyi denetlemek yetmez. Sunucu bileşeni ilk hâli HTML'e
 * gömüyor (`app/takip/[token]/page.tsx`); bir alan yanlışlıkla prop olarak
 * geçirilirse JSON'da görünmez ama HTML'de görünür. "Gizlemek" ile
 * "göndermemek" arasındaki farkı ancak bu ölçüm gösterir.
 *
 * ⚠️ `NEXT_PUBLIC_*` DERLEME ANINDA GÖMÜLÜR: QA yığınına bakan bir `next start`
 * için QA env'iyle YENİDEN DERLEMEK şart (ölçüldü 25.08.2026 — üretim
 * derlemesiyle "Invalid API key" alınır).
 *
 * Kullanım (docs/COK-DURAKLI-SEFER.md §Prova):
 *   set -a; . <qa env>; set +a
 *   npm run build && npx next start -p 3300 &
 *   node scripts/verify-takip-durak-render.mjs
 */

const TABAN = "http://127.0.0.1:3300";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};

const rest = async (yol, opsiyon = {}) => {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${yol}`, {
    ...opsiyon,
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(opsiyon.headers ?? {}),
    },
  });
  return r.json();
};

// ── Bilinen bir duruma bakmak için linki BURADA üretiyoruz (SQL ile).
const S2 = "f2000000-0000-0000-0000-0000000000f2";
const SEFER = "e2000000-0000-0000-0000-0000000000e2";
const token = "R".repeat(43);

await rest(`sefer_takip_linkleri?token=eq.${token}`, { method: "DELETE" });
const yazilan = await rest("sefer_takip_linkleri", {
  method: "POST",
  body: JSON.stringify({
    sefer_id: SEFER,
    token,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    durak_id: S2,
    durak_bagli: true,
  }),
});
iddia("durak bazlı link yazıldı", Array.isArray(yazilan) && yazilan.length === 1, JSON.stringify(yazilan).slice(0, 90));

const r = await fetch(`${TABAN}/takip/${token}`);
const html = await r.text();
iddia("sayfa 200 döndü", r.status === 200, String(r.status));
iddia("sayfa boş değil", html.length > 2000, `${html.length} bayt`);

console.log("\n═══ SIZINTI — SAYFA KAYNAĞINDA ARANIYOR ═══");
const YASAK = [
  ["diğer durağın adı (1)", "Metzgerei"],
  ["diğer durağın adı (3)", "Konditorei"],
  ["diğer durağın ADRESİ", "Kirchgasse"],
  ["diğer durağın notu", "arka kapidan"],
  ["şoför adı", "Hans Mustermann"],
  ["plaka", "W-12345X"],
  ["kendi durağının ADI", "Baecker Fuchs"],
  ["1. durağın enlemi", "47.4125"],
  ["3. durağın enlemi", "47.503"],
  ["sefer kimliği", SEFER],
  ["durak kimliği", S2],
];
for (const [ad, dizgi] of YASAK) {
  const varMi = html.includes(dizgi);
  iddia(`HTML'de YOK: ${ad}`, !varMi, varMi ? `SIZDI → ${dizgi}` : "temiz");
}

console.log("\n═══ AMA MÜŞTERİNİN KENDİ BİLGİSİ VAR ═══");
iddia("kendi durağının koordinatı HTML'de", html.includes("47.501"), "47.501");
iddia("sıra bilgisi HTML'de ('önünüzde 1 durak')", /1 durak var|1 Stopps vor|1 stops ahead/.test(html), (html.match(/[^<>]*1 durak var[^<>]*/) ?? ["yok"])[0].trim());
iddia("zaman penceresi HTML'de", html.includes("08:00") && html.includes("12:00"), "08:00 – 12:00");

console.log(`\n${dusen === 0 ? "✓ RENDER + SIZINTI KANITI GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
process.exit(dusen === 0 ? 0 : 1);
