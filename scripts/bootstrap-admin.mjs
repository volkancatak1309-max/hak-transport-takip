#!/usr/bin/env node
/**
 * İLK YÖNETİCİ KURULUMU — yeni müşteri açılışının yumurta-tavuk düğümü.
 *
 * SORUN: personel ekleyen her sunucu eylemi `requireAdmin()` istiyor
 * (app/actions/workers.ts). Sıfırdan kurulan bir veritabanında hiç yönetici
 * yoktur, dolayısıyla panelden ilk yönetici YARATILAMAZ. Bugüne kadarki yol
 * elle bcrypt hash üretip Supabase SQL Editor'da INSERT yazmaktı; her yeni
 * müşteride tekrar edilen, hataya açık bir adım.
 *
 * NE YAPAR: verilen ad/telefon/PIN ile tek bir yönetici satırı yazar.
 *   • PIN bcrypt ile hash'lenir (uygulamanın kullandığı 10 round).
 *   • `must_change_pin = true` — kurulumcunun bildiği geçici PIN kalıcı olamaz;
 *     yönetici ilk girişte /pin ekranına düşer (app/actions/auth.ts:152).
 *   • Telefon uygulamayla AYNI kurala göre normalize edilir (lib/phone.ts):
 *     giriş ekranı hangi biçimi kabul ediyorsa DB'ye o yazılır, yoksa hesap
 *     yaratılır ama giriş yapılamaz.
 *
 * GÜVENLİK: veritabanında zaten bir yönetici varsa ÇALIŞMAZ. Bu betik bir
 * "yönetici ekleme" aracı değildir — o iş panelden yapılır ve orada yetki
 * denetimi vardır. Yalnız BOŞ kurulumu açar. (--force ile bilinçli aşılabilir.)
 *
 * KULLANIM
 *   node scripts/bootstrap-admin.mjs --name "Ad Soyad" --phone "+43660..." --pin 123456
 *   node scripts/bootstrap-admin.mjs            # değerleri sorar
 *
 * Env: .env.local (ya da süreç ortamı) içinden NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY okur.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const ROOT = process.cwd();

// ── env ─────────────────────────────────────────────────────────────────────
// .env.local süreç ortamını EZMEZ: CI/Vercel ortamında gerçek değerler
// zaten süreçtedir ve yerel dosya oraya sızmamalı.
function loadEnv() {
  const out = { ...process.env };
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!(k in out)) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

// ── telefon normalizasyonu — lib/phone.ts canonicalPhone ile BİREBİR ────────
// Kopya olduğu için buraya not: lib/phone.ts değişirse burası da değişmeli.
// (.mjs betiği TypeScript modülünü doğrudan içe aktaramıyor.)
function canonicalPhone(input) {
  let p = String(input)
    .replace(/[‎‏‪-‮⁦-⁩]/g, "") // yön karakterleri
    .replace(/[\s\-().]/g, "")
    .trim();
  if (/^00/.test(p)) p = "+" + p.slice(2); // 0043… → +43…
  if (/^0\d/.test(p)) p = "+43" + p.slice(1); // 0660… → +43660…
  p = p.replace(/^\+430(?=\d)/, "+43"); // +430660… → +43660…
  return p;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "✗ NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (.env.local ya da ortam)."
    );
    process.exit(1);
  }

  let name = arg("name");
  let phone = arg("phone");
  let pin = arg("pin");
  const force = process.argv.includes("--force");

  if (!name || !phone || !pin) {
    if (!stdin.isTTY) {
      console.error(
        "✗ Eksik argüman. Kullanım: --name \"Ad Soyad\" --phone \"+43660...\" --pin 123456"
      );
      process.exit(1);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    name ??= (await rl.question("Ad Soyad: ")).trim();
    phone ??= (await rl.question("Telefon (+43…): ")).trim();
    pin ??= (await rl.question("Geçici PIN (6 hane): ")).trim();
    rl.close();
  }

  if (!name) {
    console.error("✗ Ad boş olamaz.");
    process.exit(1);
  }
  if (!/^\d{6}$/.test(pin)) {
    console.error("✗ PIN tam 6 hane olmalı (uygulamanın loginPinSchema kuralı).");
    process.exit(1);
  }
  const canonical = canonicalPhone(phone);
  if (!/^\+\d{8,15}$/.test(canonical)) {
    console.error(`✗ Telefon geçersiz görünüyor: "${phone}" → "${canonical}"`);
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Zaten yönetici var mı? (Bu betik yalnız BOŞ kurulumu açar.)
  const { data: admins, error: qErr } = await sb
    .from("workers")
    .select("id, name")
    .eq("is_admin", true);
  if (qErr) {
    console.error(`✗ workers sorgusu başarısız: ${qErr.message}`);
    console.error("  Migration 001 çalıştırıldı mı?");
    process.exit(1);
  }
  if (admins.length > 0 && !force) {
    console.error(
      `✗ Bu veritabanında zaten ${admins.length} yönetici var. Yeni yönetici PANELDEN eklenir.\n` +
        "  (Gerçekten gerekiyorsa --force ile çalıştırın.)"
    );
    process.exit(1);
  }

  // Telefon çakışması — uygulama giriş sırasında varyantları da deniyor,
  // burada kanonik biçimi kontrol etmek yeterli (DB'de unique olan o).
  const { data: taken } = await sb
    .from("workers")
    .select("id")
    .eq("phone", canonical)
    .maybeSingle();
  if (taken) {
    console.error(`✗ Bu telefon zaten kayıtlı: ${canonical}`);
    process.exit(1);
  }

  const pin_hash = await bcrypt.hash(pin, 10);
  const { data: created, error } = await sb
    .from("workers")
    .insert({
      name,
      phone: canonical,
      pin_hash,
      is_admin: true,
      is_active: true,
      must_change_pin: true,
    })
    .select("id, name, phone")
    .single();

  if (error) {
    console.error(`✗ Yönetici yazılamadı: ${error.message}`);
    process.exit(1);
  }

  console.log("✓ İlk yönetici oluşturuldu.");
  console.log(`  ad      : ${created.name}`);
  console.log(`  telefon : ${created.phone}`);
  console.log(`  PIN     : ${pin}  (ilk girişte değiştirilmesi ZORUNLU)`);
  console.log("\nGiriş: uygulamanın kök adresi → telefon + PIN.");
}

main().catch((e) => {
  console.error("✗ Beklenmeyen hata:", e?.message ?? e);
  process.exit(1);
});
