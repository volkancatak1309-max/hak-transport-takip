#!/usr/bin/env node
/**
 * ZİYARET YAZMA YOLU — GERÇEK VERİTABANINDA KANIT (FAZ C).
 *
 * `verify-bolge-ziyaret.mjs` motorun KARARINI kanıtlıyor (saf hesap + gerçek
 * telemetriyle tekrar oynatma) ama tek satır bile YAZMIYOR. Oysa bu turda
 * bulunan iki hata tam olarak YAZMA katmanındaydı ve ikisi de ancak gerçek
 * şemaya çarpınca görülür:
 *
 *   • `upsert(onConflict:"vehicle_id,zone_id")` → `uq_zone_visit_open` KISMİ
 *     bir indeks (`where ended_at is null`); PostgREST WHERE ekleyemediği için
 *     Postgres onu arbiter seçemez → 42P10.
 *   • Kısmi kolonlu güncelleme partisi → PostgREST partide aynı kolon kümesini
 *     bekler, eksik kolon null'a düşer → `last_seen_at` (NOT NULL) ihlali.
 *
 * Bu betik o üç ifadeyi (insert · TAM satır upsert · toplu delete) canlı şemaya
 * karşı koşar.
 *
 * ── ⚠️ NEDEN MÜŞTERİ PANELİNE HİÇBİR ŞEY SIZMAZ ───────────────────────────
 * Yeni bölge AÇILMIYOR. Test satırı MEVCUT bir bölgeye (depo) ve mevcut bir
 * araca bağlanıyor; `zone_visits` yalnız `purpose='customer'` bölgeler için
 * okunuyor ve HAK61'de öyle bir bölge yok — yani satır hiçbir ekranda
 * görünmez. Yine de betik sonunda kendi satırını SİLER ve silindiğini
 * doğrular. Geride hiçbir şey kalmaz; bölge/araç kayıtlarına dokunulmaz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-ziyaret-yazma.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";

let hata = 0;
const ok = (ad, kosul, detay = "") => {
  if (kosul) console.log(`  ✓ ${ad}`);
  else {
    console.log(`  ✗ ${ad}${detay ? ` — ${detay}` : ""}`);
    hata++;
  }
};

// ── Bağlam: mevcut bir araç + mevcut bir bölge (hiçbiri değiştirilmiyor).
const { data: arac } = await supabaseAdmin.from("vehicles").select("id, plate").limit(1).maybeSingle();
const { data: bolge } = await supabaseAdmin
  .from("geofences")
  .select("id, name, purpose")
  .limit(1)
  .maybeSingle();
if (!arac || !bolge) {
  console.error("✗ araç ya da bölge bulunamadı — test kurulamadı");
  process.exit(1);
}
console.log(`\nbağlam: araç ${arac.plate} · bölge "${bolge.name}" (purpose=${bolge.purpose})`);
console.log("(bölge purpose'u DEĞİŞTİRİLMİYOR — satır hiçbir ekranda okunmuyor)\n");

const T = Date.now();
const an = (dk) => new Date(T - dk * 60000).toISOString();
const olusturulan = [];

try {
  // ── 1) AÇILIŞ: düz insert (upsert DEĞİL — kısmi indeks arbiter olamıyor).
  {
    const satir = {
      vehicle_id: arac.id,
      zone_id: bolge.id,
      worker_id: null,
      started_at: an(30),
      last_seen_at: an(20),
      ended_at: null,
      end_reason: null,
    };
    const { data, error } = await supabaseAdmin.from("zone_visits").insert(satir).select("id");
    ok("1 açık ziyaret yazıldı (düz insert)", !error && data?.length === 1, error?.message);
    if (data?.[0]?.id) olusturulan.push(data[0].id);
  }

  // ── 2) KISMİ İNDEKS GERÇEKTEN KORUYOR MU: aynı araç+bölgeye ikinci AÇIK satır.
  {
    const { error } = await supabaseAdmin.from("zone_visits").insert({
      vehicle_id: arac.id,
      zone_id: bolge.id,
      worker_id: null,
      started_at: an(10),
      last_seen_at: an(9),
      ended_at: null,
      end_reason: null,
    });
    ok(
      "2 ikinci AÇIK ziyaret 23505 ile reddedildi (uq_zone_visit_open çalışıyor)",
      error?.code === "23505",
      error ? `${error.code}: ${error.message}` : "hata BEKLENİYORDU, gelmedi"
    );
  }

  // ── 3) ESKİ KODUN DÜŞTÜĞÜ YER: onConflict="vehicle_id,zone_id" upsert.
  {
    const { error } = await supabaseAdmin
      .from("zone_visits")
      .upsert(
        [
          {
            vehicle_id: arac.id,
            zone_id: bolge.id,
            worker_id: null,
            started_at: an(10),
            last_seen_at: an(9),
            ended_at: null,
            end_reason: null,
          },
        ],
        { onConflict: "vehicle_id,zone_id", ignoreDuplicates: true }
      );
    ok(
      "3 eski yol (onConflict=vehicle_id,zone_id) GERÇEKTEN çalışmıyor — 42P10",
      error?.code === "42P10",
      error ? `${error.code}: ${error.message}` : "hata beklenirken istek GEÇTİ"
    );
  }

  // ── 4) ESKİ KODUN İKİNCİ DÜŞTÜĞÜ YER: karışık kolonlu güncelleme partisi.
  {
    const { error } = await supabaseAdmin.from("zone_visits").upsert(
      [
        { id: olusturulan[0], ended_at: an(5), end_reason: "exit" },
        { id: olusturulan[0], last_seen_at: an(6) },
      ],
      { onConflict: "id" }
    );
    ok(
      "4 eski yol (kısmi + karışık kolonlu parti) GERÇEKTEN çalışmıyor",
      !!error,
      error ? `${error.code}: ${error.message}` : "hata beklenirken istek GEÇTİ"
    );
    if (error) console.log(`     → ${error.code}: ${error.message.slice(0, 110)}`);
  }

  // ── 5) YENİ YOL: TAM satır upsert (id arbiter) — kapanış.
  {
    const { error } = await supabaseAdmin.from("zone_visits").upsert(
      [
        {
          id: olusturulan[0],
          vehicle_id: arac.id,
          zone_id: bolge.id,
          worker_id: null,
          started_at: an(30),
          last_seen_at: an(6),
          ended_at: an(6),
          end_reason: "exit",
        },
      ],
      { onConflict: "id" }
    );
    ok("5 YENİ yol: TAM satır upsert ile kapanış yazıldı", !error, error?.message);

    const { data } = await supabaseAdmin
      .from("zone_visits")
      .select("started_at, ended_at, last_seen_at, end_reason")
      .eq("id", olusturulan[0])
      .maybeSingle();
    ok(
      "5 kapanış DB'de doğru duruyor (ended_at dolu, last_seen NOT NULL korundu)",
      !!data?.ended_at && !!data?.last_seen_at && data?.end_reason === "exit",
      JSON.stringify(data)
    );
    const sure = data ? Date.parse(data.ended_at) - Date.parse(data.started_at) : 0;
    ok(
      "5 süre = ended_at - started_at (24 dk), 'şu an' kullanılmadı",
      Math.abs(sure - 24 * 60000) < 2000,
      `${Math.round(sure / 60000)} dk`
    );
  }

  // ── 6) KAPANDIKTAN SONRA aynı araç+bölgeye YENİ açık ziyaret açılabilmeli.
  {
    const { data, error } = await supabaseAdmin
      .from("zone_visits")
      .insert({
        vehicle_id: arac.id,
        zone_id: bolge.id,
        worker_id: null,
        started_at: an(4),
        last_seen_at: an(3),
        ended_at: null,
        end_reason: null,
      })
      .select("id");
    ok(
      "6 kapanmış ziyaretten sonra yeni ziyaret açılabiliyor (kısmi indeks doğru dar)",
      !error && data?.length === 1,
      error?.message
    );
    if (data?.[0]?.id) olusturulan.push(data[0].id);
  }

  // ── 7) SIRA MUHAFIZI: ended_at < started_at yazılamaz.
  {
    const { error } = await supabaseAdmin
      .from("zone_visits")
      .update({ ended_at: an(60) })
      .eq("id", olusturulan[0]);
    ok(
      "7 geriye akan ziyaret DB tarafından reddediliyor (zone_visits_sira)",
      !!error,
      error ? `${error.code}` : "kısıt devreye girmedi"
    );
  }

  // ── 8) TOPLU SİLME (kısa ziyaret temizliği).
  {
    const { error } = await supabaseAdmin.from("zone_visits").delete().in("id", olusturulan);
    ok("8 toplu delete .in(id) çalışıyor", !error, error?.message);
    const { data } = await supabaseAdmin.from("zone_visits").select("id").in("id", olusturulan);
    ok("8 test satırlarının HİÇBİRİ kalmadı", (data ?? []).length === 0, JSON.stringify(data));
    if ((data ?? []).length === 0) olusturulan.length = 0;
  }
} finally {
  // Emniyet: yukarıda bir yerde patlarsak bile geride satır bırakma.
  if (olusturulan.length > 0) {
    await supabaseAdmin.from("zone_visits").delete().in("id", olusturulan);
    console.log(`  ↺ temizlik: ${olusturulan.length} artık satır silindi`);
  }
}

console.log(hata === 0 ? "\n✅ YAZMA YOLU KANITLANDI\n" : `\n❌ ${hata} KONTROL DÜŞTÜ\n`);
process.exit(hata === 0 ? 0 : 1);
