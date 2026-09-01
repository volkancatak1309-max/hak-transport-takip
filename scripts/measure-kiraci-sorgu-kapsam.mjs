#!/usr/bin/env node
/**
 * KİRACI SORGU UCU — MARUZİYET VE BİÇİM ÖLÇÜMÜ (SALT OKUMA).
 *
 * `/api/mobile/kiraci-sorgu` tasarlanırken üç soru VARSAYILMADI, ölçüldü.
 * Sonuçlar docs/KIRACI-SORGU-UCU.md § 2, § 3 ve § 7'de kayıtlı.
 *
 *   S1 · MARUZİYET — uç kaç numaraya "evet" diyecek? Kimliksiz bir uçta bu
 *        sayı, "elindeki numaranın hangi firmada çalıştığını doğrulayabileceğin
 *        kişi sayısı"dır ve güvenlik kararının girdisidir.
 *
 *   S2 · BİÇİM — `phoneVariants` gerçekten gerekli mi? Migration 075 (trunk
 *        sıfırı temizliği) her kiracıda koşmadı; koşmadığı yerde varyant listesi
 *        tek dayanaktır. Ayrıca `canonicalPhone` DEVİRGEN Mİ (idempotent) —
 *        değilse hangi veri sınıfında bozuluyor?
 *
 *   S3 · ÇAKIŞMA — aynı numara birden fazla kiracıda var mı? Yayılma modelinde
 *        iki "evet", yönlendirme servisinin çözmesi gereken bir durumdur ve
 *        sözleşmede yeri olmalıdır.
 *
 * ⚠️ HAM NUMARA NE EKRANA NE REPOYA GİRER. Kiracılar arası karşılaştırma
 * sha256 ÖZETİYLE yapılır; teşhis çıktısı rakamları maskeler.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-alias.mjs \
 *     scripts/measure-kiraci-sorgu-kapsam.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalPhone, phoneVariants } from "../lib/phone.ts";

const ozet = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

function envOku(dosya) {
  return Object.fromEntries(
    readFileSync(dosya, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
}

/**
 * Ölçülen kiracılar. `panelAcik`, o kurulumun NEXT_PUBLIC_DRIVER_PANEL_ENABLED
 * değeridir — uç bu bayrağa göre şoförleri eler, dolayısıyla maruziyet sayısı
 * ona bağlıdır. galzura-demo listede YOK: service_role anahtarı verilmiyor.
 */
const KIRACILAR = [
  { ad: "HAK61", dosya: ".env.local", panelAcik: true },
  { ad: "Sendigo", dosya: ".env.sendigo", panelAcik: false },
];

const kume = {};

for (const k of KIRACILAR) {
  if (!existsSync(k.dosya)) {
    console.log(`${k.ad}: ${k.dosya} yok, atlandı`);
    continue;
  }
  const env = envOku(k.dosya);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(`${k.ad}: service_role anahtarı yok, atlandı`);
    continue;
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb
    .from("workers")
    .select("phone, is_active, is_admin, is_test, created_at");
  if (error) {
    console.log(`${k.ad}: HATA ${error.message}`);
    continue;
  }

  const tel = (w) => (w.phone ?? "").trim();
  const kayitli = data.filter((w) => tel(w));

  // ── S1 · MARUZİYET ────────────────────────────────────────────────────
  // Ucun kuralı: is_active && (panel açık || is_admin).
  const evet = kayitli.filter((w) => w.is_active && (k.panelAcik || w.is_admin));

  console.log(`\n══ ${k.ad} · şoför paneli ${k.panelAcik ? "AÇIK" : "KAPALI"} ═════════════`);
  console.log(`S1 · personel kaydı                : ${data.length}`);
  console.log(`     numarası olan                 : ${kayitli.length}`);
  console.log(`     aktif                         : ${kayitli.filter((w) => w.is_active).length}`);
  console.log(`     is_test                       : ${kayitli.filter((w) => w.is_test).length}`);
  console.log(`     ► UÇ "EVET" DİYECEK           : ${evet.length}`);

  // ── S2 · BİÇİM ────────────────────────────────────────────────────────
  const kanonikDisi = kayitli.filter((w) => canonicalPhone(tel(w)) !== tel(w));
  const bulunamayan = [];
  for (const w of kayitli) {
    const P = tel(w);
    // Kişi numarasını bu biçimlerden biriyle yazar; hepsi kaydı BULMALI.
    for (const yazim of [P, canonicalPhone(P), ...phoneVariants(P)]) {
      if (!phoneVariants(yazim).includes(P)) bulunamayan.push({ w, yazim });
    }
  }
  console.log(`S2 · kanonik OLMAYAN kayıt         : ${kanonikDisi.length}`);
  console.log(`     phoneVariants'ın ıskaladığı    : ${bulunamayan.length}`);
  for (const { w, yazim } of bulunamayan) {
    // Rakamlar 'N' ile maskeli — sıfırlar korunur, çünkü kusurun kendisi odur.
    console.log(
      `     ⚠ desen ${yazim.replace(/\d/g, (d) => (d === "0" ? "0" : "N"))}` +
        ` · aktif=${w.is_active} yönetici=${w.is_admin} test=${w.is_test}` +
        ` · oluşturulma ${String(w.created_at).slice(0, 10)}`
    );
  }

  kume[k.ad] = kayitli.map((w) => ({
    h: ozet(canonicalPhone(tel(w))),
    aktif: w.is_active,
    admin: w.is_admin,
    test: w.is_test,
  }));
}

// ── S2b · canonicalPhone DEVİRGEN Mİ ─────────────────────────────────────
console.log("\n══ S2b · canonicalPhone devirgenliği (idempotence) ═══════════");
console.log("(uydurma numaralar — canlı veri değil)");
for (const x of [
  "+436601113783",     // zaten kanonik
  "+4306601113783",    // tek trunk sıfırı — 075 öncesi normal veri
  "+43006601113783",   // ÇİFT sıfır — yalnız bozuk/sentetik veride görülür
  "004306601113783",   // 00 uluslararası öneki + trunk
  "+390212345678",     // İtalya: baştaki 0 numaranın PARÇASI
]) {
  const bir = canonicalPhone(x);
  const iki = canonicalPhone(bir);
  console.log(
    `  ${x.padEnd(18)} → ${bir.padEnd(18)} → ${iki.padEnd(18)} ` +
      `${bir === iki ? "devirgen" : "*** DEĞİL — bir sıfır kalıyor ***"}`
  );
}

// ── S3 · ÇAKIŞMA ─────────────────────────────────────────────────────────
const adlar = Object.keys(kume);
console.log("\n══ S3 · aynı numara birden fazla kiracıda ════════════════════");
if (adlar.length < 2) {
  console.log("  (tek kiracı ölçülebildi — çakışma ölçülemedi)");
} else {
  for (let i = 0; i < adlar.length; i++) {
    for (let j = i + 1; j < adlar.length; j++) {
      const a = new Map(kume[adlar[i]].map((x) => [x.h, x]));
      const ortak = kume[adlar[j]].filter((x) => a.has(x.h));
      console.log(`  ${adlar[i]} ∩ ${adlar[j]} : ${ortak.length} numara`);
      for (const o of ortak) {
        const p = a.get(o.h);
        console.log(
          `    özet ${o.h} — ${adlar[i]}[aktif=${p.aktif} yönetici=${p.admin}]` +
            ` · ${adlar[j]}[aktif=${o.aktif} yönetici=${o.admin}]`
        );
      }
    }
  }
  console.log(
    "\n  ► İKİ 'EVET' MÜMKÜN. Yönlendirme servisi ilk 'evet'te DURMAMALI;\n" +
      "    eşleşen kiracıların TAMAMINI toplayıp kullanıcıya seçtirmeli.\n" +
      "    Seçim listesi yalnız kişinin GERÇEKTEN hesabı olan kiracıları içerir —\n" +
      "    müşteri listesi sızıntısı değildir."
  );
}
