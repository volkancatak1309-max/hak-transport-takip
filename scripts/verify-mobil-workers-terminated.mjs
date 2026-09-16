#!/usr/bin/env node
/**
 * GET /api/mobile/workers — `?aktif` kümesinin SAYIMI. **SALT OKUMA.**
 *
 * Uç yalnız SELECT yapar; bu betik de yazma çağrısı içermez. Bu yüzden HAK61
 * dâhil her kiracıda güvenle koşar (Volkan kuralı: HAK61 salt okuma).
 *
 * Kullanım:
 *   ENV_FILE=.env.local           node … scripts/verify-mobil-workers-terminated.mjs
 *   ENV_FILE=.env.galzura-demo    node … scripts/verify-mobil-workers-terminated.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI =
  url.includes("gopptkmetpfsxmgcijbb")
    ? "HAK61"
    : url.includes("ftbazsyiolkeqivwzmlh")
      ? "Sendigo"
      : url.includes("omgnkvoulndbglmxlvzc")
        ? "galzura-demo"
        : "BİLİNMEYEN";

const { GET } = await import("@/app/api/mobile/workers/route.ts");

const { data: adm } = await supabaseAdmin
  .from("workers")
  .select("id, name, token_version")
  .eq("is_admin", true)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();
if (!adm) {
  console.error("✗ yönetici bulunamadı");
  process.exit(1);
}
const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;

const say = async (aktif) => {
  const u = new URL("https://x.invalid/api/mobile/workers");
  u.searchParams.set("limit", "200");
  if (aktif !== null) u.searchParams.set("aktif", aktif);
  const res = await GET(
    new Request(u.toString(), { headers: { authorization: `Bearer ${token}` } })
  );
  const j = await res.json();
  const satirlar = j.personel ?? [];
  return {
    kod: res.status,
    toplam: j.page?.total ?? null,
    donen: satirlar.length,
    ayrilan: satirlar.filter((r) => r.ayrilisTarihi != null).length,
    pasif: satirlar.filter((r) => r.aktif === false).length,
  };
};

// Ham zemin — uçtan bağımsız sayım (kıyas için).
const { data: ws } = await supabaseAdmin
  .from("workers")
  .select("id, is_active, terminated_at, is_test");
const all = ws ?? [];

console.log(`\n══ ${KIRACI} · GET /api/mobile/workers sayımı ══`);
console.log(`ham workers            : ${all.length}`);
console.log(`  is_active=true       : ${all.filter((w) => w.is_active).length}`);
console.log(`  terminated_at dolu   : ${all.filter((w) => w.terminated_at).length}`);
console.log(`  ayrılan VE aktif     : ${all.filter((w) => w.terminated_at && w.is_active).length}  ← kuralın ayırdığı küme`);
console.log("");

console.log("  küme                     HTTP  toplam  dönen  ayrılan  pasif");
for (const [etiket, aktif] of [
  ["varsayılan (param yok)", null],
  ["?aktif=1", "1"],
  ["?aktif=0", "0"],
  ["?aktif=all", "all"],
  ["?aktif=eski", "eski"],
]) {
  const r = await say(aktif);
  console.log(
    `  ${etiket.padEnd(22)}  ${String(r.kod).padStart(4)}  ${String(r.toplam).padStart(6)}  ${String(r.donen).padStart(5)}  ${String(r.ayrilan).padStart(7)}  ${String(r.pasif).padStart(5)}`
  );
}
