# Yeni Müşteri Kurulumu — sıfırdan canlıya

**Mimari:** tek repo · müşteri başına ayrı Supabase projesi · müşteri başına ayrı
Vercel projesi. Marka ve kurulum farkları **env'den** gelir; kod dallanmaz.

**Hedef süre:** ilk kurulumda ~3 saat, ikinciden sonra **~1 saat** (donanım ve
flespi cihaz kaydı hariç — o kalemler sahaya bağlı).

> **Değişmezlik kuralı.** Bu dokümandaki hiçbir env, mevcut bir müşterinin
> projesine eklenmez. Env tanımlı değilken uygulama HAK61'in bugünkü davranışını
> birebir üretir; `npm run verify` bunu her seferinde denetler
> (`scripts/check-tenant-defaults.mjs`).

---

## 0. Önce toplanacak bilgiler

Kuruluma başlamadan elde olması gerekenler — hiçbiri tahminle doldurulmaz:

| Bilgi | Nerede kullanılır | Neden tahmin edilemez |
|---|---|---|
| Ticari unvan, adres | PDF anteti (`COMPANY_*`) | resmî belge, muhasebe/denetimde ibraz edilir |
| UID (ATU…) ya da FN numarası | PDF anteti | yanlışı hukuki iddiadır |
| Logo (saydam PNG, yüksek çözünürlük) | tüm marka yüzeyleri | türevleri bundan üretilir |
| Araç listesi: plaka, marka/model, tank kapasitesi | araç kayıtları | — |
| Teltonika cihazları: IMEI + flespi device id | telemetri eşlemesi | eşleşmezse veri hiç gelmez |
| Şoför listesi: ad, telefon (+43…) | personel + AZG raporu | telefon giriş anahtarıdır |
| Depo adresi/koordinatı | geofence | vardiya tetiği buna bağlı |
| Araçlar 2,5 t altında ve sınır geçmiyor mu? | AZG-only modeli | değilse VO 561/2006 + takograf gerekir |

---

## 1. Supabase projesi

1. Yeni proje aç (bölge: **eu-central-1**).
2. **Settings → API**'den `Project URL` ve `service_role` anahtarını al.
3. SQL Editor'da **tek parça kurulum dosyasını** çalıştır:

```
db/install/<musteri>-full.sql      ← hepsini yapıştır → Run
```

Dosyayı `node scripts/gen-install-sql.mjs <musteri>` üretir; içinde
**001 → 078** arası migration'lar doğru sırayla ve tek transaction içinde
durur. Migration'ları tek tek çalıştırmak GEREKMEZ ve önerilmez: sıra
elle takip edilemeyecek kadar uzadı ve iki yerde köprü gerekiyor (aşağıda).

> **HEPSİ YA DA HİÇBİRİ.** Dosyanın tamamı tek `begin/commit` içindedir;
> bir ifade hata verirse hiçbir şey uygulanmaz — yarım şema oluşmaz.
> Başındaki boşluk denetimi, dolu bir veritabanına çalıştırılmasını da
> engeller (`DURDURULDU: bu veritabanı BOŞ DEĞİL`).

> **013 ve 014 iki kez var.** Numaralar tarihsel olarak çakışmış; kurulum
> dosyası sırayı zaten içeriyor.

> **İKİ KÖPRÜ KOLONU** kurulum dosyasında var, migration'larda yok:
> `vehicles.tank_capacity_l` (hiçbir migration yaratmıyor, canlı HAK61'e elle
> eklenmiş — yokluğunda 028 kırılır) ve `geofences.archived_at` (063
> kullanıyor, 069 yaratıyor — yokluğunda kurulum 063'te durur). İkisi de boş
> bir PostgreSQL 16 üzerinde ölçüldü (24.08.2026).

> **ÜÇ MIGRATION BİLEREK DIŞARIDA:** `013_telegram_chat_unique` ve `005`in
> telegram kısmı (katman 20.08.2026'da söküldü), `054` (yalnız galzura-demo'ya
> ait telemetri silme fonksiyonu — gerçek müşteride var olmaması bir güvenlik
> katmanı) ve `075` (sıfır DDL, saf veri onarımı). Gerekçeler
> `scripts/gen-install-sql.mjs` → `HARIC` sözlüğünde; muhafız
> (`npm run lint:install-sql`) gerekçesiz atlamaya izin vermez.

> **ESKİ KURULUMLAR (Sendigo · Galzura) 043'TE KALDI.** Kurulum dosyası
> 24.08.2026'ya kadar 043'te bitiyordu; o tarihte 35 migration'ın listeden
> düştüğü fark edildi. Somut sonucu: `report_fuel_stats_vehicle` migration
> **052** ile geliyor, yani o iki kurulumda **yok** — mobil vardiya detayının
> yakıt bloğu orada `bloklar.yakit: "rpc_yok"` döner ("bu kurulumda yakıt
> hesabı yok", "bu vardiyada yakıt harcanmadı" DEĞİL). Aynı şekilde
> `vehicles.device_model` (**055**) yok → araç uçlarında `cihaz.ad` null.
> **YENİ kurulumlar bu eksiklerden etkilenmez;** mevcut iki kurulumu
> hizalamak ayrı bir karardır (migration'lar oralarda elle çalıştırılır).

> **028** boş veritabanında test şoförünü **kendisi yaratır** (31.07.2026'da
> düzeltildi — önceden sabit bir UUID'ye bağlıydı ve yabancı anahtar hatasıyla
> zinciri 028'de kırıyordu).

Tamamlandığında kontrol (24.08.2026'da boş PostgreSQL 16 üzerinde ölçüldü):

```sql
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';
-- 47 tablo bekleniyor
select count(*) from pg_indexes where schemaname = 'public';
-- 156 indeks
select * from public.vehicles where is_test;   -- 1 satır (TEST-001)
```

---

## 2. İlk yönetici

Panelden personel eklemek `requireAdmin()` istiyor; boş veritabanında yönetici
yok. Bu düğümü betik çözer (elle bcrypt üretmek gerekmez):

```bash
cp .env.example .env.local     # NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY doldur
npm run bootstrap:admin -- --name "Ad Soyad" --phone "+43660..." --pin 123456
```

Betik `must_change_pin=true` yazar: yönetici ilk girişte PIN'i değiştirmek
zorunda kalır. Veritabanında zaten yönetici varsa **çalışmaz** — bu bir "yönetici
ekleme" aracı değil, yalnız boş kurulumun kapısı.

---

## 3. Marka görselleri

```bash
mkdir -p public/brands/<tenant>
cp <logo> public/brands/<tenant>/logo-source.png     # ← kaynak adı ÖNEMLİ
npm run brand:assets -- <tenant>
```

Üretilenler: `logo.png · splash.png · icon-192 · icon-512 · apple-touch-icon ·
favicon-32x32 · favicon.ico`. Betik logonun **oranını** ve splash boyutunu basar
— ikisini `lib/brand.ts`'e ya da env'e yaz.

> Kaynak dosya adı `logo-source.png` olmalı. `logo.png` adıyla konursa betik
> okurken aynı dosyanın üstüne yazar ve Windows'ta kaynağı bozar (31.07.2026'da
> yaşandı; betik artık ayrı ad bekliyor ama kural yine de budur).

Sonra `lib/brand.ts`'teki `REGISTRY`'ye bir satır ekle (metinler + varlık
yolları). Alternatif: kayıt defterine dokunmadan sadece env doldur — bilinmeyen
tenant kodu için varlıklar zaten `public/brands/<tenant>/` altında aranır.

---

## 4. Vercel projesi

1. Vercel → Add New → Project → aynı repo (`hak-transport-takip`).
2. Framework **Next.js** (otomatik algılanır), production branch `main`.
3. Environment Variables — aşağıdaki tablo.
4. Deploy, sonra domain bağla.

### Zorunlu env

| Değişken | Açıklama |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase proje URL'i |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT — **yalnız sunucu** |
| `SESSION_PASSWORD` | 32+ rastgele karakter (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `FLESPI_TOKEN` | flespi REST token'ı |
| `FLESPI_SYNC_SECRET` | `/api/flespi/sync` ve `/api/flespi/ingest` koruması |
| `CRON_SECRET` | `/api/cron/*` uçlarının koruması (yakıt fiyatı · belge uyarısı · demo temizliği) — bkz. [`CRON-KAYITLARI.md`](CRON-KAYITLARI.md) |
| `KIRACI_SORGU_SECRET` | `/api/mobile/kiraci-sorgu` koruması — **mobil giriş yönlendirmesi buna bağlı.** Tanımsız bırakılırsa uç 503 döner ve bu kiracının personeli mobilden hiçbir yere yönlenemez. Ayrı bir değer üretin (`CRON_SECRET` kopyalanmaz) ve **aynı değeri galzura.com yönlendirme servisine de girin.** Bilinçli olarak kimliksiz istiyorsanız değer `acik`. Bkz. [`KIRACI-SORGU-UCU.md`](KIRACI-SORGU-UCU.md) |

### Marka + kurulum modu env

Tam liste ve varsayılanlar `.env.example`'ın alt bloğunda. **Boş bırakılan her
ayar HAK61 varsayılanına düşer** — yeni müşteride bilinçli olarak doldurulur.

### ⚠️ Avusturya dışındaki müşteri: saat dilimi

`NEXT_PUBLIC_TENANT_TZ` panelin **ve mobil uygulamanın** tek kaynağıdır — tüm
saatler, gün anahtarları ve "bugün / bu hafta / bu ay" pencereleri buradan
çözülür. Mobil uç aynı değeri `/api/mobile/auth/login` ve `/api/mobile/me`
yanıtlarında `tenant.saatDilimi` olarak alır; mobil tarafta ikinci bir sabit
TANIMLANMAZ.

| Müşteri ülkesi | Değer |
|---|---|
| Avusturya (HAK61 · Sendigo · galzura-demo) | boş bırak → `Europe/Vienna` |
| Türkiye | `Europe/Istanbul` |

Geçersiz bir IANA adı sunucu açılışında hata verir (`assertTenantConfig`) —
sessizce varsayılana düşmez.

**Avusturya dışında ayrıca install SQL'i:** `db/install/<tenant>-full.sql`
içindeki iki `at time zone 'Europe/Vienna'` yazımı (ifade indeksi
`idx_time_entries_started_date` + `report_coolant_daily` RPC'si) da o dilime
çevrilmelidir. Bugün ikisi de fiilen ölüdür — hiçbir canlı sorgu o ifadeyle
filtrelemiyor, o RPC repoda çağrılmıyor — ama yeni bir sorgu onlara dayanırsa
gün sınırı panelden ayrışır.

---

## 5. flespi

1. Cihazları flespi'de kaydet, müşteriye **ayrı bir grup** aç.
2. Tercihen müşteriye özel, o gruba ACL'i daraltılmış **ikinci bir token** üret:
   tek token iki filoyu birden açar.
3. Veri yolu iki seçenekten biri:
   - **REST pull (önerilen):** dış zamanlayıcı `/api/flespi/sync?secret=…`
     adresini 30–60 sn'de bir çağırır. Motor yalnız *kendi* veritabanındaki
     `flespi_device_id` dolu araçları çeker → müşteriler arası sızıntı yapısal
     olarak imkânsız.
   - **HTTP Stream push:** stream **yalnız o müşterinin cihaz grubuna** filtreli
     olmalı. Filtresiz stream diğer müşterinin uygulamasına da mesaj gönderir;
     veri bozulmaz (eşleşmeyen IMEI atılır) ama gürültü olur.
4. Cron kayıtları (cron-job.org / GitHub Actions) —
   **ayrıntı: [`CRON-KAYITLARI.md`](CRON-KAYITLARI.md)**:
   - `GET /api/flespi/sync?secret=<FLESPI_SYNC_SECRET>` — her 30–60 sn
   - `GET /api/cron/fuel-price-sync?secret=<CRON_SECRET>` — günde 1, 06:00 (migration 077)
   - `GET /api/cron/document-alerts?secret=<CRON_SECRET>` — günde **tam 1**, 06:00 (migration 078)

   > `shift-watchdog` **artık yok** (Telegram sökümü, 20.08.2026) — kaydını kurma.
   > `document-alerts` günde birden fazla çağrılırsa **aynı bildirimi tekrarlar**:
   > dönüm noktası gün sayısından türetiliyor, durum kolonu yok.

---

## 7. İlk veri (panelden)

Sıra önemli — her adım bir öncekine dayanıyor:

1. **Şoförler** (`/admin/workers`): ad, telefon, PIN.
   > **Şoför paneli kapalı kurulumda da şoför kayıtları ZORUNLUDUR.**
   > `time_entries.worker_id` NOT NULL'dır: vardiya bir şoföre yazılmak
   > zorundadır ve AZG raporu şoför ekseninde üretilir. 4 araç = 4 şoför kaydı,
   > panele hiç girmeseler bile.
2. **Araçlar** (`/admin/araclar`): plaka, filo, `flespi_device_id`, `imei`,
   tank kapasitesi, **atanmış şoför**.
   > Atanmamış araç otomatik vardiya AÇAMAZ — motor `assigned_worker_id` üstünden
   > çalışır.
3. **Depo** (`/admin/bolgeler`): yeni bölge, amaç **depot**, yarıçapı çiz
   (200–500 m tipik).

---

## 8. Kabul testi

| # | Ne | Nasıl doğrulanır |
|---|---|---|
| 1 | Telemetri akıyor | `select count(*) from device_telemetry where recorded_at > now() - interval '1 hour';` > 0 |
| 2 | Araç haritada | `/admin/harita` — 4 araç görünüyor |
| 3 | Vardiya açılıyor | ayarlanan tetikleyiciye göre; `select * from time_entries where started_at::date = current_date;` |
| 4 | Vardiya kapanıyor | `depot_idle` kurulumda: araç depoya dönüp eşiği geçince `ended_at` doluyor |
| 5 | PDF anteti doğru | `/admin` → rapor indir → firma adı/adres/sicil satırı **gözle** kontrol |
| 6 | Marka | sekme başlığı, favicon, giriş ekranı logosu, footer |
| 7 | Kapalı modüller | kapalı bayrakların menüde/formda izi yok |
| 8 | Mobil giriş yönlendirmesi | `curl -s -X POST https://<domain>/api/mobile/kiraci-sorgu -H "authorization: Bearer $KIRACI_SORGU_SECRET" -H 'content-type: application/json' -d '{"telefon":"<kayıtlı bir yönetici numarası>"}'` → **200**. `503` = env girilmemiş, `401` = sır yönlendirme servisindekiyle aynı değil. Gövdede `"var":true` bekleniyor |

---

## 9. Müşteri profilleri — hazır env setleri

### HAK61 (mevcut, referans)

Çok-müşteri env'lerinin **hiçbiri tanımlı değil.** Varsayılanlar zaten HAK61.

### Sendigo GmbH — ilaç lojistiği, 4 araç, Dornbirn

```bash
NEXT_PUBLIC_TENANT=sendigo
NEXT_PUBLIC_DEFAULT_LOCALE=de

# Resmî antet (UID henüz yok → FN kullanılıyor; geldiğinde bu satır değişir)
# ⚠️ NEXT_PUBLIC_ ÖNEKİ ZORUNLU: PDF'ler tarayıcıda üretilir, öneksiz env
# istemciye ulaşmaz ve künye HAK61 varsayılanına düşer (31.07.2026 düzeltmesi).
NEXT_PUBLIC_COMPANY_NAME=Sendigo GmbH
NEXT_PUBLIC_COMPANY_ADDRESS=Bildgasse 10, 6850 Dornbirn, Österreich
NEXT_PUBLIC_COMPANY_REG_LINE=FN 681377a (Landesgericht Feldkirch)
NEXT_PUBLIC_COMPANY_EXTRA_LINE=Geschäftsführer: Gökhan Kalkanlı
NEXT_PUBLIC_PDF_BRAND_MARK=SEN

# Araç odaklı kurulum: şoför paneli yok, paket sayacı yok
NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false
NEXT_PUBLIC_PACKAGES_ENABLED=false
NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED=false

# Vardiya tam otomatik
SHIFT_START_TRIGGER=first_ignition
SHIFT_AUTO_END=depot_idle
SHIFT_AUTO_END_IDLE_MIN=20

# Skor kalibrasyonu HAK61 filosuna ait — kendi medyanı ölçülene kadar kapalı
NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED=false

# Tek filo: renk kod adı DB'de 'mavi' kalır, etiket sadeleşir ve ikinci
# filonun çipi/seçeneği arayüzden kalkar
NEXT_PUBLIC_FLEET_MAVI_LABEL=Flotte
NEXT_PUBLIC_FLEETS=mavi

FLEET_EPOCH=2026-08-01T00:00:00.000Z
```

**Sendigo'nun vardiya mantığı, tek cümlede:** gün, aracın sabah ilk
çalıştırılmasıyla başlar; gün içinde eczane teslimatlarında kontak defalarca
kapanır ama araç depo dışında olduğu için vardiya kapanmaz; araç akşam depoya
dönüp 20 dakika hareketsiz kalınca vardiya kapanır; depoya hiç dönmezse gece
yarısı emniyetiyle **son hareket anına** yazılarak kapanır.

---

## 10. Sık karşılaşılanlar

**Migration 028 hata veriyor.** 31.07.2026 öncesi sürümdesiniz — dosyayı
`main`'den güncelleyin.

**Panele giriş "geçersiz" diyor, telefon/PIN doğru.** Şoför paneli kapalıysa
şoför girişi bilinçli olarak reddedilir (hesap sayımını engellemek için hata
mesajı ayırt edilmez). Yönetici hesabıyla deneyin.

**Uygulama açılışta hata fırlatıyor: "DRIVER_PANEL_ENABLED=false iken
SHIFT_AUTO_END='off' olamaz".** Doğru davranış: kapatacak kimse olmadan vardiya
gece boyu açık kalırdı. `SHIFT_AUTO_END=depot_idle` yapın.

**Vardiya hiç açılmıyor.** Sırayla: araca şoför atanmış mı → araç `status=active`
mi → `auto_start_enabled` false mu → tetikleyici `depot_entry` ise depo bölgesi
tanımlı mı → telemetri geliyor mu.

**Vardiya hiç kapanmıyor.** `SHIFT_AUTO_END=depot_idle` mi → araç son fix'inde
depo yarıçapı içinde mi (yarıçap dar olabilir) → eşik çok mu uzun.

**PDF anteti hâlâ eski firma.** `COMPANY_*` **sunucu** env'leridir, `NEXT_PUBLIC_`
öneki almazlar; Vercel'de tanımlandıktan sonra **yeniden deploy** gerekir.
