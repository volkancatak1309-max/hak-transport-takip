# Kiracı şema hizalama — 043 → 078

> Ölçüm ve prova: **24.08.2026**. Dosyalar: `db/install/sendigo-hizalama-078.sql`,
> `db/install/galzura-demo-hizalama-078.sql`, `db/install/ENVANTER.sql`.
> Üreteç: `scripts/gen-align-sql.mjs` · muhafız: `npm run lint:install-sql`.

Kurulum dosyası 24.08.2026'ya kadar **043'te bayattı**. Sendigo ve galzura-demo
o dosyayla açıldığı için mesajlaşma, belge takibi, maliyet motoru, yakıt fiyatı,
sefer sistemi ve bölge ziyaretleri o kurulumlarda **şema düzeyinde hiç yoktu**.
Bu belge onları bugünkü şemaya çeken işi anlatır.

---

## 1 · Ölçüm

### Sendigo — ÖLÇÜLDÜ (canlı, PostgREST + service key)

| Ne | Değer |
|---|---|
| Şema seviyesi | **043 + 044 + 050 + 052** (ölçülerek belirlendi, varsayım değil) |
| Tablo | 26 (hedef 47) |
| Kolon | 308 |
| Canlı veri | 9 personel · 5 araç · 26 vardiya · **0 bölge** · 207.388 telemetri satırı |
| `vehicles.fleet` | 5 satırın hepsi `mavi` → 059'un FK'si sorunsuz |
| `workers.managed_fleet` | 9 satırın hepsi NULL → FK sorunsuz |
| `telegram_chat_id` dolu | 0 satır |

**Eksik: 22 tablo · 13 kolon · 5 RPC.** Tam liste hizalama dosyasının başlığında.

> Sendigo'nun 044/050/052'yi almış olması ölçümle çıktı: `report_fuel_stats_vehicle`
> ve `shift_odometer_spans` RPC'leri canlıda VAR, `workers.token_version` kolonu VAR.
> Yani "043'te kaldı" cümlesi Sendigo için tam doğru değildi.

### galzura-demo — 🔴 ÖLÇÜLMEDİ

Service key Claude'da **yok** (Vercel'de Sensitive, kopyalanamıyor) ve repoda da
yok. `.env.sendigo` depoda duruyor, galzura'nınki hiç commit edilmemiş.

**Bu yüzden galzura-demo için hiçbir sayı verilmedi.** Beklenen liste Sendigo'dan
ÇIKARIM'dır. Kesinleştirmek için önce `db/install/ENVANTER.sql` çalıştırılmalı
(salt okuma, ~10 sn) — çıktısı hangi tablo/kolon/RPC'nin eksik olduğunu satır
satır söyler. Hizalama dosyası her hâlükârda idempotenttir: var olana dokunmaz.

---

## 2 · Migration'lar ve risk sınıfı

Sınıflar: 🟢 **saf ekleme** (mevcut satıra dokunmaz) · 🟡 **geri dolgu** (yalnız
YENİ kolonu doldurur) · 🟠 **kısıt** (mevcut veriyi reddedebilir — ön denetimle
yakalanır) · 🔴 **düşürme**.

| # | Migration | Ne yapar | Risk |
|---|---|---|---|
| 044 | mobile_token_version | +1 kolon | 🟢 |
| 045 | owner_security | +2 tablo, +3 kolon, +7 indeks | 🟢 |
| 046 | access_gates | +5 tablo, +3 kolon, +9 indeks | 🟢 ¹ |
| 047 | pdf_fingerprints | +1 tablo, +3 indeks | 🟢 |
| 048 | gate_exempt | +1 kolon, +1 indeks | 🟢 |
| 049 | fuel_report_index | +2 indeks (`device_telemetry`) | 🟢 ² |
| 050 | report_perf | 2 RPC (create or replace) | 🟢 |
| 051 | drop_odometer_spans | `vehicle_odometer_spans` FONKSİYONUNU düşürür | 🟠 ³ |
| 052 | shift_distance_and_refill_merge | 2 RPC | 🟢 |
| 053 | covering_indexes | +2 indeks (`device_telemetry`) | 🟢 ² |
| 054 | demo_telemetry_retention | +1 fonksiyon — **yalnız galzura-demo** | 🟢 ⁴ |
| 055 | vehicle_device_model | +1 kolon | 🟢 |
| 056 | vehicle_fault_reports | +1 tablo | 🟢 |
| 057 | fault_report_closed | +2 kolon (056'nın tablosuna) | 🟢 |
| 058 | action_snoozes | +1 tablo | 🟢 |
| 059 | fleets | +1 tablo, 2 satır tohum, CHECK→**FK** | 🟠 ⁵ |
| 060 | last_recorded_at_batch | +1 RPC | 🟢 |
| 061 | idle_episode_cursors_batch | +1 RPC | 🟢 |
| 062 | autoshift_telemetry_batch | +1 RPC | 🟢 |
| 063 | geofence_category | +1 kolon + geri dolgu + CHECK | 🟡 ⁶ |
| 064 | customer_zone_visits | +1 tablo, +3 kolon, purpose CHECK'i yeniden | 🟠 ⁷ |
| 065 | latest_telemetry_batch | +1 RPC | 🟢 |
| 066 | seferler | +1 tablo | 🟢 |
| 067 | first_ignition_batch | +1 RPC | 🟢 |
| 068 | zone_visit_zone_closed | zone_visits'e CHECK | 🟢 ⁸ |
| 069 | geofence_category_repair | 063'ün eksiklerini tamamlar + geri dolgu | 🟡 ⁶ |
| 070 | sefer_koprular | +2 kolon | 🟢 |
| 071 | messaging | +3 tablo | 🟢 |
| 072 | worker_fleet | +1 kolon + geri dolgu + CHECK | 🟡 ⁹ |
| 073 | messaging_groups | +1 tablo, +5 kolon, 1 tetikleyici | 🟢 |
| 074 | push_tokens | +1 tablo | 🟢 |
| 076 | tenant_cost_rates | +1 tablo | 🟢 |
| 077 | fuel_price_reference | +1 tablo | 🟢 |
| 078 | worker_documents | +2 tablo | 🟢 |

¹ Özgün 046, HAK61'in **gizli soru bcrypt hash'ini** de yazıyor. Üreteç o satırı
çıkarıyor: başka kiracıya taşımak, HAK61'in cevabını bilen birine oranın ölü adam
anahtarını açma yetkisi verirdi. Satırsız davranış güvenli — `verifySecret()`
fail-closed.

² `device_telemetry` büyük (Sendigo 207 bin satır, demo daha fazla). İndeks
kurulumu sürer; dosyada `statement_timeout = 15min`, `lock_timeout = 20s`.
Kilit alınamazsa dosya kendini düşürür ve **hiçbir şey uygulanmaz**.

³ Tek DROP. **Veri değil, kod**: `vehicle_odometer_spans` fonksiyonu. Yerine
052'nin `shift_odometer_spans`'ı geliyor ve uygulama onu çağırıyor.

⁴ Fonksiyonun **kurulması** hiçbir şey silmez; silme işini cron çağırdığında
yapar. Gerçek müşteride (Sendigo) fonksiyon **hiç kurulmaz** — bkz.
`docs/CRON-KAYITLARI.md`.

⁵ `vehicles.fleet` ve `workers.managed_fleet` CHECK'ten FK'ye geçiyor; izinli
küme artık `fleets` tablosunun satırları (`bordo`, `mavi`). Tanımsız bir kod
varsa FK eklenemez. **Ön denetim bunu okunur bir cümleyle yakalar.** Sendigo'da
ölçüldü: risk yok.

⁶ Geri dolgu YALNIZ varsayılanda (`custom`) kalmış satırlara dokunur ve yalnız
YENİ `category` kolonunu yazar. Elle değiştirilmiş kategori ezilmez. Sendigo'da
bölge tablosu boş → hiçbir satıra dokunulmaz.

⁷ `geofences_purpose_check` düşürülüp yeniden kuruluyor (`rule/depot/customer`).
İzinli olmayan bir değer varsa kısıt eklenemez → **ön denetim yakalar**.

⁸ Kısıt, aynı koşumda 064'ün yarattığı BOŞ tabloya ekleniyor → reddedecek satır yok.

⁹ `workers.fleet` yeni kolon; araç atamasından, yoksa son vardiyadan türetiliyor.
Provada doğrulandı: iki şoför `mavi` aldı, yönetici ve test hesabı NULL kaldı.

### Sıra bağımlılıkları

- Dosya numara sırasını izler; **köprü kolonları en başta** verilir.
- **`geofences.archived_at` 063'ten ÖNCE olmak zorunda:** 063 o kolona kısmi
  indeks kuruyor ama kolonu 069 ekliyor (altı dosya sonra). Boş PostgreSQL 16'da
  ölçüldü: köprüsüz kurulum 063'te `column archived_at does not exist` ile durur.
- 057 → 056'ya, 068 → 064'e, 070 → 066'ya, 073 → 071'e bağlı; numara sırası
  bunların hepsini zaten doğru veriyor.
- 059 (fleets tablosu) 072'den (workers.fleet CHECK) önce gelmeli — öyle.

---

## 3 · Hizalama dosyalarının provası (Docker + PostgreSQL 16.15)

| Prova | Sonuç |
|---|---|
| Sendigo'nun canlı şeması Docker'da yeniden kuruldu | **26 tablo · 308 kolon — canlıyla BİREBİR**, sıfır fark |
| Hizalama uygulandı | çıkış 0, tek ERROR yok |
| Sonuç ↔ sıfırdan 078 kurulumu | **0 eksik tablo · 0 eksik kolon · 0 eksik fonksiyon** |
| Fark olarak kalan | yalnız Telegram kalıntısı (bilerek dokunulmadı) |
| Tohum veriyle veri kaybı sınaması | 5 tablonun satır sayısı ve **md5 özeti birebir aynı** |
| Geri dolgu doğru mu | `workers.fleet` iki şoförde `mavi`, yöneticide NULL; `geofences.category` = `depot` |
| İkinci kez çalıştırma | çıkış 0, şema değişmedi (**idempotent**) |
| galzura dosyası, DÜZ 043 tabanında | çıkış 0 → 48 tablo, hedefe göre 0 eksik, artı `purge_old_telemetry` |
| galzura dosyası ikinci koşum | çıkış 0 |

---

## 4 · Çalıştırma

1. **(galzura-demo için zorunlu, Sendigo'da isteğe bağlı)** `ENVANTER.sql` →
   çıktıyı sakla. Salt okuma.
2. Sakin bir saat seç. `lock_timeout` 20 sn: canlı yazma kilidi tutarsa dosya
   kendini düşürür, hiçbir şey uygulanmaz, tekrar çalıştırmak güvenlidir.
3. Supabase → SQL Editor → ilgili `*-hizalama-078.sql` → Run.
4. Ön denetimler geçmezse dosya **okunur bir cümleyle** durur ve hiçbir şey
   uygulanmaz. Cümlede ne yapılacağı yazar.
5. Sonrasında `ENVANTER.sql`'i tekrar çalıştır: `hizalama gerekli mi` satırı
   **HAYIR** demeli.

### Hizalamadan sonra da gereken adımlar

Şema açılır, **davranış** için ayrıca:

| Özellik | Ek gereksinim |
|---|---|
| Mesajlaşma · belge takibi · sefer · bölge ziyareti | ek adım YOK, tablolar gelince açılır |
| Yakıt fiyatı otomatiği (077) | `/api/cron/fuel-price-sync` cron kaydı — `docs/CRON-KAYITLARI.md` |
| Belge uyarısı bildirimi (078) | `/api/cron/document-alerts` cron kaydı, **günde tam 1** |
| Güvenlik katmanı (045/046/047) | env: `SECURITY_LAYER_ENABLED`, `ACCESS_GATES_ENABLED` — ikisi de varsayılan **false**; tablolar gelse bile katman kapalı kalır |
| Demo telemetri temizliği (054) | yalnız galzura-demo + `/api/cron/demo-retention` kaydı |

---

## 5 · Bilerek YAPILMAYAN iki şey

**Telegram kalıntısı düşürülmedi.** `telegram_link_codes` tablosu ve
`workers.telegram_*` dört kolonu duruyor (canlı HAK61'de düşürülmüş). Uygulama
onları hiç okumuyor; ama `telegram_username` kişisel veridir. Silmek geri
alınamaz bir işlem olduğu için ayrı bir karar: hazır komut hizalama dosyasının
sonunda, yorum içinde. Sendigo'da ölçüldü — dolu satır **0**, yani kayıp yok.

**Telefon normalizasyonu (075) uygulanmadı.** Şema değil VERİ değişikliği ve
`workers.phone` UNIQUE olduğu için çakışma üretebilir. Kod her iki biçimi de
tanıyor (`lib/phone.ts` phoneVariants), giriş bozulmuyor. İstenirse
`db/migrations/075_phone_trunk_zero.sql` AYRI çalıştırılır; içindeki DO bloğu
çakışma varsa kendini durdurur.
