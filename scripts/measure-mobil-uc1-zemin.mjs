#!/usr/bin/env node
/**
 * MOBİL UÇ TUR 1 — ZEMİN ÖLÇÜMÜ (SALT OKUMA).
 *
 * Yeni uçlar (`/me/pin`, `/shifts/start`, `/shifts/start-for`,
 * `PATCH /shifts/[id]`) hangi tablo ve kolonlara dokunuyorsa, o zeminin HER
 * KİRACIDA var olup olmadığını ölçer. Tahmin yok: PostgREST'in OpenAPI
 * tanımı (`GET /rest/v1/`) şemanın kendisini döndürüyor, tablo ve kolon
 * listesi oradan okunuyor.
 *
 * ⚠️ HİÇBİR SATIR YAZILMAZ. Yalnız şema tanımı ve `head:true` sayımları.
 *
 * Kullanım:
 *   node scripts/measure-mobil-uc1-zemin.mjs .env.local     # HAK61
 *   node scripts/measure-mobil-uc1-zemin.mjs .env.sendigo   # Sendigo
 */
import { readFileSync, existsSync } from "node:fs";

const envPath = process.argv[2] ?? ".env.local";
if (!existsSync(envPath)) {
  console.error(`env dosyası yok: ${envPath}`);
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok");
  process.exit(1);
}

/** Yeni uçların dokunduğu zemin — tablo → beklenen kolonlar. */
const GEREKLI = {
  workers: [
    "id",
    "phone",
    "pin_hash",
    "is_admin",
    "is_active",
    "must_change_pin",
    "counts_as_driver",
    // 044 — token iptali. YOKSA: diğer cihazlar PIN değişince DÜŞMEZ.
    "token_version",
  ],
  // 042 — giriş kilidi. YOKSA: PIN kapısında sayaç ÇALIŞMAZ.
  login_attempts: ["identifier", "attempts", "last_attempt_at", "locked_until"],
  time_entries: [
    "id",
    "worker_id",
    "vehicle_id",
    "plate",
    "started_at",
    "ended_at",
    "start_km",
    "end_km",
    "break_minutes",
    "auto_started",
    "auto_ended",
    "confirmation_status",
    "confirmed_at",
    "end_reason",
    "summary_notified_at",
    "summary_confirmed_at",
    "summary_confirmed_by",
    "undelivered_count",
    "start_package_count",
    "cargo_count",
    "notes",
    "updated_at",
    "updated_by",
    // 037 — manuel başlatma izi. Yoksa kod kolonsuz yola düşüyor.
    "started_by",
    "start_source",
    // 038 — konum/saat bayrakları. Yoksa best-effort atlanıyor.
    "location_unverified",
    "start_time_estimated",
  ],
  vehicles: ["id", "plate", "status", "is_test", "assigned_worker_id"],
  // 087 — düzeltme izi + sebep. Yoksa iz yazılamaz (sessiz düşüş).
  shift_edit_log: [
    "time_entry_id",
    "changed_at",
    "changed_by",
    "field",
    "old_value",
    "new_value",
    "reason",
    "edit_group",
    "kaynak",
  ],
  device_telemetry: ["vehicle_id", "recorded_at", "odometer_km"],
};

const res = await fetch(`${URL_}/rest/v1/`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error(`OpenAPI okunamadı: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.json();
const defs = spec.definitions ?? {};

console.log(`\n=== ${envPath} · ${URL_.replace(/https?:\/\//, "").split(".")[0]} ===\n`);

let eksikToplam = 0;
for (const [tablo, kolonlar] of Object.entries(GEREKLI)) {
  const d = defs[tablo];
  if (!d) {
    console.log(`  ✗ TABLO YOK: ${tablo}`);
    eksikToplam += kolonlar.length;
    continue;
  }
  const mevcut = new Set(Object.keys(d.properties ?? {}));
  const eksik = kolonlar.filter((c) => !mevcut.has(c));
  if (eksik.length === 0) {
    console.log(`  ✓ ${tablo} — ${kolonlar.length} kolonun hepsi var`);
  } else {
    console.log(`  ✗ ${tablo} — EKSİK: ${eksik.join(", ")}`);
    eksikToplam += eksik.length;
  }
}

// Kilit tablosunda satır var mı — "tablo var ama hiç kullanılmamış" ile
// "gerçekten işliyor" farkını gösterir.
const say = await fetch(`${URL_}/rest/v1/login_attempts?select=identifier&limit=1`, {
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    Prefer: "count=exact",
    Range: "0-0",
  },
});
const cr = say.headers.get("content-range");
console.log(`\n  login_attempts satır sayısı: ${cr ?? "okunamadı"} (HTTP ${say.status})`);

console.log(`\n  TOPLAM EKSİK: ${eksikToplam}\n`);
