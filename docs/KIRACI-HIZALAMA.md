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

### galzura-demo — TABLO LİSTESİ ÖLÇÜLDÜ (Volkan, 24.08.2026)

Service key hâlâ Claude'da yok; ölçümü Volkan Supabase panelinden yaptı ve
**canlı tablo listesini** verdi. Kolon ve RPC listesi **verilmedi**.

| Ne | Değer |
|---|---|
| Tablo | **35** (hedef 47) |
| Taban | **043 + 045 + 046 + 047 + 064** — Docker'da yeniden kurularak doğrulandı: **35/35, sıfır fark** |
| Eksik tablo | **13** |
| Kolon / RPC | 🔴 **ÖLÇÜLMEDİ** — sayı verilmedi, tahmin edilmedi |

**Eksik 13 tablo:** `action_snoozes` (058) · `conversations` + `messages` +
`message_receipts` (071) · `conversation_members` (073) · `document_types` +
`worker_documents` (078) · `fleets` (059) · `fuel_price_reference` (077) ·
`push_tokens` (074) · `seferler` (066) · `tenant_cost_rates` (076) ·
`vehicle_fault_reports` (056).

> ⚠️ **Sendigo'dan FARKLI bir taban.** Güvenlik katmanı (045/046/047) demo'da
> UYGULANMIŞ ve `zone_visits` (064) VAR; buna karşılık `action_snoozes` ve
> `fleets` YOK. Sendigo'da ise 044/050/052 var, güvenlik katmanı yok.
> "İki kiracı aynı yerde" varsayımı yanlış olurdu — bu yüzden iki ayrı dosya.

> 🔴 **046 elle uygulandığı için `kill_switch_secret`te HAK61'in gizli soru
> hash'i duruyor olabilir.** Özgün migration o satırı yazar; hizalama dosyası
> yazmaz ve mevcut satıra dokunmaz, ama koşum başında satır sayısını NOTICE
> olarak basar. Provada birebir bu durum kuruldu ve satırın **değişmediği**
> md5 ile doğrulandı. Kendi hash'inizle değiştirme komutu dosyanın sonunda.

> Kolon/RPC ölçülmediği için "kaç kolon eklenecek" sayısı verilmedi. Dosya bu
> belirsizliği taşıyabiliyor: her adım `if not exists`. Hizalamadan sonra
> `db/install/ENVANTER.sql` çalıştırılırsa kesin tablo çıkar.

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

### galzura-demo, ÖLÇÜLEN taban üzerinde (24.08.2026 akşamı)

| Prova | Sonuç |
|---|---|
| Taban Docker'da yeniden kuruldu (043 + 045 + 046 + 047 + 064) | **35 tablo — canlı listeyle BİREBİR**, sıfır fark |
| Tohum veri (4 personel · 3 araç · 1 vardiya · 2 bölge · **1 bölge ziyareti** · 800 telemetri · 1 oturum · 1 kill_switch_secret satırı) | yazıldı |
| Hizalama uygulandı | çıkış 0; `NOTICE: ⚠️ kill_switch_secret'te 1 satır var…` beklendiği gibi bastı |
| Mevcut veri | satır sayıları **ve md5 özetleri birebir aynı** — `kill_switch_secret` hash'i dahil |
| Sonuç ↔ sıfırdan 078 | **0 eksik tablo · 0 eksik kolon · 0 eksik fonksiyon** (48 tablo · 503 kolon · 37 fonksiyon) |
| Fazla kalanlar | yalnız `telegram_link_codes` ve demo'ya ait `purge_old_telemetry` |
| Geri dolgu | `workers.fleet`: araç atanmış şoför `mavi`, diğerleri NULL · `geofences.category`: `depot`→depot, `customer`→customer |
| İkinci koşum | çıkış 0, 48 tablo / 503 kolon değişmedi (**idempotent**) |
| Hizalama sonrası ENVANTER | "**HAYIR — bu kurulum 078 hizasında**", 0 eksik tablo/kolon/RPC |

### Ön denetimin NEGATİF sınaması

`vehicles.fleet = 'yesil'` yazılıp hizalama çalıştırıldı →
`ERROR: DURDURULDU (059): vehicles.fleet'te tanımsız filo kodu var: yesil…`
çıkışı **3**, tablo sayısı **35 → 35** (hiçbir şey uygulanmadı). Satır `mavi`
yapılıp tekrar çalıştırıldığında çıkış **0**, 48 tablo.

> İlk denemede bozuk satır **yazılamadı**: 023'ün ve 064'ün CHECK kısıtları
> girişi zaten reddetti, yani sınama boşa döndü ve ön denetim hiç tetiklenmedi.
> Kısıtı düşürüp tekrar denendi. **Buradan çıkan gerçek:** 023/064 uygulanmış
> her veritabanında 059/064 riski fiilen teoriktir — kötü değer zaten
> yazılamıyor. Ön denetimler yine de duruyor, çünkü kısıtın hiç kurulmadığı ya
> da elle düşürüldüğü bir kurulum bunu garanti etmez.

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
