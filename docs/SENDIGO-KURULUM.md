# Sendigo kurulumu — 1. AŞAMA (müşteri verisi olmadan)

**Kapsam:** cihaz IMEI'leri, şoför telefonları, depo konumu ve araç künyeleri
GELMEDEN yapılabilecek her şey. Sonunda ayakta, markalı, giriş yapılabilir bir
sistem olur; içinde araç/şoför olmaz. Bunlar geldiğinde §6'daki liste işletilir.

**HAK61'e dokunulmaz.** Ayrı Supabase projesi, ayrı Vercel projesi, aynı repo.
HAK61 Vercel projesine tek bir env eklenmez.

> **Süre tahmini:** ~45 dk (SQL 1 dk, Vercel projesi + env 20 dk, deploy 5 dk,
> yönetici + doğrulama 15 dk).

---

## 1. Adım sırası — hangi ekran, hangi buton

Sıra bağlayıcıdır: her adım bir öncekinin çıktısını kullanır.

### 1.1 Supabase projesi

| # | Nerede | Ne yap |
|---|---|---|
| 1 | supabase.com → **New project** | Ad: `sendigo` · Region: **Central EU (eu-central-1)** · DB parolası üret ve parola yöneticisine kaydet |
| 2 | Proje açılmasını bekle (~2 dk) | — |
| 3 | **SQL Editor** → New query | `db/install/sendigo-full.sql` dosyasının **tamamını** yapıştır → **Run** |
| 4 | Aynı ekranda doğrula | Aşağıdaki iki sorguyu çalıştır |
| 5 | **Settings → API** | `Project URL` ve **`service_role`** anahtarını kopyala (⚠️ `anon` değil) |

Doğrulama sorguları (adım 4):

```sql
select count(*) as tablo from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';
-- beklenen: 24

select plate, is_test, status from public.vehicles;
-- beklenen: TEST-001 | true | active   (1 satır)
```

> **TEST-001 nedir?** Migration 028 her kuruluma kalıcı bir test şoförü + test
> aracı yazar. Yönetici listelerinde **görünmez** (`is_test`), gerçek donanımı
> yoktur, tek satır telemetri üretmez. Silme — muhafız betikleri onu bekliyor.

### 1.2 Vercel projesi

| # | Nerede | Ne yap |
|---|---|---|
| 6 | vercel.com → **Add New… → Project** | **Import** → `volkancatak1309-max/hak-transport-takip` (HAK61 ile **aynı repo**) |
| 7 | Configure Project | Project Name: `sendigo` · Framework: **Next.js** (otomatik gelir, dokunma) · Root Directory: `./` |
| 8 | **Environment Variables** | §3'teki tabloyu gir. Her satırda **Production + Preview + Development** üçünü de işaretle |
| 9 | **Deploy** | İlk build ~3-4 dk |
| 10 | Settings → **Domains** | Şimdilik `sendigo-*.vercel.app` yeter. Gerçek alan adı bağlanınca `NEXT_PUBLIC_APP_URL`'i güncelle ve **Redeploy** et |
| 11 | Settings → **Git** | Production Branch = `main` (varsayılan). Bundan sonra `main`'e her push **iki müşteriyi birden** deploy eder |

> ⚠️ **`NEXT_PUBLIC_*` env'leri build ANINDA koda gömülür.** Sonradan
> değiştirirsen Vercel'de **Redeploy** şart — yalnız kaydetmek yetmez.
> `COMPANY_*` sunucu env'idir, o da redeploy ister.

### 1.3 İlk yönetici → §4.

---

## 2. Tek parça kurulum SQL'i

**Dosya:** `db/install/sendigo-full.sql` (2.399 satır)
**Üreteci:** `node scripts/gen-install-sql.mjs` — dosya **elle düzenlenmez**;
yeni bir migration eklenince üreteçteki sıraya yazılır ve betik yeniden
çalıştırılır. Yapılan her sapma üreteçte açıkça kodludur ve çalıştırınca raporlanır.

001 → 040 arası **42 migration'ın tamamı**, `docs/YENI-MUSTERI-KURULUM.md`
§1'deki sırayla (013 ve 014'ün çift numaraları dahil). **Seed dosyaları
yoktur** (`db/seed/*` demo araç/rota verisidir).

**Emniyetler**

- **Hepsi ya da hiçbiri.** Dosyanın tamamı tek transaction. Bir ifade patlarsa
  hiçbir şey uygulanmaz; yarım şema oluşmaz, düzeltip baştan çalıştırabilirsin.
- **Boşluk denetimi.** İlk blok veritabanının boş olduğunu doğrular; doluysa
  kendini durdurur — yanlış projeye çalıştırılamaz.

**Kaynak migration'lara göre 4 bilinçli sapma** (dosyanın başında da yazılı):

| # | Sapma | Neden |
|---|---|---|
| 1 | `vehicles.tank_capacity_l` **eklendi** | Bu kolonu **hiçbir migration yaratmıyor** — canlı HAK61'e elle eklenmiş, repoya hiç girmemiş. Yokluğunda 028 `column does not exist` ile patlar ve 028-040 hiç çalışmaz. Ayrıca `lib/reports.ts:630` onu select ediyor |
| 2 | 008 ve 030'daki iç `begin;`/`commit;` kaldırıldı | Dosyanın tamamı zaten tek transaction; içerideki `commit` dış transaction'ı erken kapatır ve kalan ifadeler korumasız kalırdı |
| 3 | 030 uyarlandı | Özgün dosya HAK61'e özgü bir **veri onarımıdır** (iki çalışanın numarasındaki görünmez Unicode). Boş DB'de onarılacak satır yok. Kalıcı şema parçası (telefon biçimi kısıtı) korundu; teşhis SELECT'leri ve **gerçek HAK61 telefon parçaları içeren** `DELETE FROM login_attempts` çıkarıldı |
| 4 | 006/007'deki `create table/index/trigger` idempotent yapıldı | Boş veritabanında sonuç birebir aynı; yalnız ikinci çalıştırma hata vermek yerine no-op olur |

**Doğrulama — tahmin değil, icra edildi.** Dosya gerçek bir Postgres 16
motorunda (PGlite) boş veritabanına çalıştırıldı:

```
✓ Hatasız çalıştı (162 ms)
✓ 24 tablo · 6 fonksiyon · 81 indeks · 4 trigger
✓ vehicles.tank_capacity_l var (numeric)
✓ TEST-001 aracı + test şoförü yazıldı
✓ workers_phone_temiz kısıtı çalışıyor (boşluklu numara reddedildi)
✓ 4 rapor RPC'si çağrılabiliyor
✓ Boşluk denetimi dolu veritabanında durdurdu
✓ Bağımsız ikinci kapta tekrar hatasız, aynı 24 tablo
```

Ayrıca **şema kapsam denetimi**: 243 kaynak dosyada uygulamanın Supabase'den
select ettiği **169 tablo.kolon çiftinin tamamı** bu şemada var; `lib/types.ts`
satır tipleri de tam (Worker 26, TimeEntry 27, Vehicle 16 alan). Yani
`tank_capacity_l` dışında **başka eksik kolon yok**.

---

## 3. Env tablosu — Vercel → Settings → Environment Variables

Üç durum var:

- 🟢 **DOLU** — değeri aşağıda, olduğu gibi kopyala
- 🔑 **ÜRET** — sırrı şimdi üret (müşteri verisi gerekmez), komut aşağıda
- 🕓 **SONRA** — müşteri verisi/kararı bekliyor, 1. aşamada **girme**

### 3.1 Altyapı

| Değişken | Durum | Değer |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 🟢 | Supabase → Settings → API → **Project URL** (adım 5) |
| `SUPABASE_SERVICE_ROLE_KEY` | 🟢 | Supabase → Settings → API → **service_role** (adım 5) ⚠️ `anon` değil |
| `SESSION_PASSWORD` | 🔑 | 32+ rastgele karakter — komut §3.5 |
| `NEXT_PUBLIC_APP_URL` | 🟢 | İlk deploy'un verdiği `https://sendigo-….vercel.app`. Alan adı bağlanınca güncelle + redeploy |
| `CRON_SECRET` | 🔑 | Rastgele — komut §3.5 |
| `FLESPI_SYNC_SECRET` | 🔑 | Rastgele — komut §3.5 |
| `FLESPI_TOKEN` | 🕓 | flespi'de Sendigo cihaz grubu açılınca (§6) |
| `TELEGRAM_BOT_TOKEN` | 🕓 | @BotFather'dan **ayrı bot** (§6) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | 🕓 | Botun kullanıcı adı (§6) |
| `TELEGRAM_WEBHOOK_SECRET` | 🕓 | Bot kurulunca üret (§6) |

### 3.2 Marka

| Değişken | Durum | Değer |
|---|---|---|
| `NEXT_PUBLIC_TENANT` | 🟢 | `sendigo` |

**Tek satır yeter.** İsim, unvan, şehir, sayfa başlığı, logo, ikonlar, splash ve
logo oranı `lib/brand.ts`'teki SENDIGO künyesinden gelir; görseller
`public/brands/sendigo/` altında **hazır ve commit'li** (7 dosya, hepsi geçerli
PNG). `NEXT_PUBLIC_BRAND_*` satırlarının hiçbirine ihtiyaç yok — ancak bir
metni ezmek gerekirse env her zaman künyeyi ezer.

### 3.3 Resmî belge anteti (PDF) — sunucu env'i, `NEXT_PUBLIC_` **değil**

| Değişken | Durum | Değer |
|---|---|---|
| `COMPANY_NAME` | 🟢 | `Sendigo GmbH` |
| `COMPANY_ADDRESS` | 🟢 | `Bildgasse 10, 6850 Dornbirn, Österreich` |
| `COMPANY_REG_LINE` | 🟢 | `FN 681377a (Landesgericht Feldkirch)` |
| `COMPANY_EXTRA_LINE` | 🟢 | `Geschäftsführer: Gökhan Kalkanlı` |
| `PDF_BRAND_MARK` | 🟢 | `SEN` |

> UID (ATU…) geldiğinde **yalnız** `COMPANY_REG_LINE` değişir:
> `UID-Nr.: ATU…` → kaydet → **Redeploy**.

### 3.4 Kurulum modu ve vardiya otomatı

| Değişken | Durum | Değer | Ne yapar |
|---|---|---|---|
| `NEXT_PUBLIC_DEFAULT_LOCALE` | 🟢 | `de` | Panel varsayılan dili Almanca |
| `NEXT_PUBLIC_DRIVER_PANEL_ENABLED` | 🟢 | `false` | Şoför paneli kapalı; şoför girişi reddedilir, takip araç ekseninde |
| `NEXT_PUBLIC_PACKAGES_ENABLED` | 🟢 | `false` | Paket sayacı kolonları/formları/PDF sütunları görünmez (veri modeli durur) |
| `NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED` | 🟢 | `false` | 2,5 t altı sınır geçmeyen filoda VO 561/2006 uygulanmaz |
| `NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED` | 🟢 | `false` | Skor kalibrasyonu HAK61 filosuna ait; kendi medyanı ölçülene kadar kapalı |
| `NEXT_PUBLIC_FLEET_MAVI_LABEL` | 🟢 | `Flotte` | Tek filo; DB kod adı `mavi` kalır, etiket sadeleşir |
| `SHIFT_START_TRIGGER` | 🟢 | `first_ignition` | Gün, aracın **ilk çalıştırılmasıyla** başlar |
| `SHIFT_AUTO_END` | 🟢 | `depot_idle` | Araç **depoda** + kontak kapalı + eşik → vardiya kapanır |
| `SHIFT_AUTO_END_IDLE_MIN` | 🟢 | `20` | Eşik: 20 dakika |
| `FLEET_EPOCH` | 🟢 | `2026-08-01T00:00:00.000Z` | "Tüm zamanlar" aralığının tabanı |

**Girilmeyecekler** (varsayılanları zaten doğru): `NEXT_PUBLIC_FUEL_ENABLED`,
`NEXT_PUBLIC_EXPENSE_ENABLED`, `NEXT_PUBLIC_MAINTENANCE_ENABLED` (üçü de
`false`), `NEXT_PUBLIC_LEAVES_ENABLED` (`true`, migration 031 kuruldu),
`SHIFT_AUTO_END_MIDNIGHT_FALLBACK` (`true`), `NEXT_PUBLIC_FLEET_BORDO_LABEL`.

> 🔒 **Fail-closed kilit.** `DRIVER_PANEL_ENABLED=false` iken `SHIFT_AUTO_END`
> **`off` olamaz** — vardiyayı kapatacak kimse kalmaz. Uygulama açılışta hata
> fırlatır (`lib/tenant.ts assertTenantConfig`). Yukarıdaki set bu kilidi geçer.

**Bu env seti ölçüldü:** modüller yalnız bu değişkenlerle yüklendi ve üretilen
28 ayarın 28'i de amaçlananla birebir çıktı (marka, künye, bayraklar, vardiya
otomatı, `assertTenantConfig` = OK).

### 3.5 Sırları üretme komutu

Her biri için ayrı ayrı çalıştır (aynı değeri paylaşma):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Sırlar bu dosyaya **yazılmaz** — repo'ya sızmamalı. Vercel'e doğrudan gir,
> bir kopyasını parola yöneticisinde sakla.

---

## 4. İlk yönetici

Panelden personel eklemek `requireAdmin()` istiyor; boş veritabanında yönetici
yok. Bu düğümü betik çözer.

Betik `.env.local`'i okur. HAK61'inki üstüne yazılmamalı — PowerShell'de:

```powershell
# 1) HAK61 ortamını yedekle
Copy-Item .env.local .env.local.hak61-yedek

# 2) .env.local içindeki ŞU İKİ satırı Sendigo'nunkiyle değiştir:
#    NEXT_PUBLIC_SUPABASE_URL=https://<sendigo-ref>.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY=<sendigo service_role>

# 3) İlk yöneticiyi aç (Volkan kendi bilgileriyle)
npm run bootstrap:admin -- --name "Volkan Çatak" --phone "+43…" --pin 123456

# 4) HAK61 ortamını geri al
Move-Item -Force .env.local.hak61-yedek .env.local
```

> Alternatif (dosyaya hiç dokunmadan), tek komutluk ortam:
> ```powershell
> $env:NEXT_PUBLIC_SUPABASE_URL="https://<sendigo-ref>.supabase.co"
> $env:SUPABASE_SERVICE_ROLE_KEY="<sendigo service_role>"
> npm run bootstrap:admin -- --name "Volkan Çatak" --phone "+43…" --pin 123456
> ```
> Betik süreç ortamını `.env.local`'in ÜSTÜNDE tutar, yani yerel dosya
> okunmaz.

**Betiğin davranışı:**

- PIN **tam 6 hane** olmalı (uygulamanın `loginPinSchema` kuralı).
- `must_change_pin=true` yazar → Volkan ilk girişte `/pin` ekranına düşer ve
  PIN'i kendisi belirler. Kurulumcunun bildiği geçici PIN kalıcı olamaz.
- Telefon uygulamayla **aynı** kuralla normalize edilir (`+430660…` → `+43660…`).
  Giriş ekranı hangi biçimi kabul ediyorsa DB'ye o yazılır.
- Veritabanında **zaten yönetici varsa çalışmaz** (`--force` ile aşılır). Bu bir
  "yönetici ekleme" aracı değil, yalnız boş kurulumun kapısı.

**Gökhan Kalkanlı** bundan sonra **panelden** eklenir:
`/admin/workers` → Yeni Personel → ad, telefon, geçici PIN → yönetici işaretle.
(Şoför paneli kapalı olduğu için normal personelin giriş hakkı yoktur; yönetici
yetkisi verilmezse panele giremez.)

---

## 5. 1. aşama kabul kontrolü

Bunlar **şimdi** doğrulanabilir:

| # | Ne | Nasıl |
|---|---|---|
| 1 | Sayfa açılıyor | `https://sendigo-….vercel.app` → giriş ekranı |
| 2 | Marka doğru | Sekme başlığı **Sendigo — Fuhrpark** · giriş ekranında **Sendigo logosu** · alt satır **SENDIGO · Dornbirn** |
| 3 | Dil Almanca | Çerezi olmayan ilk ziyarette arayüz DE |
| 4 | Manifest | `/manifest.json` → `"short_name": "Sendigo"`, ikonlar `/brands/sendigo/…` |
| 5 | Yönetici girişi | Telefon + geçici PIN → **PIN değiştirme ekranı** → yeni PIN → `/admin` |
| 6 | Pano boş ama sağlam | Günün Panosu 0 satır, filo 0 araç, hata yok |
| 7 | Kapalı modüller yok | Menüde Yakıt/Masraf/Bakım yok; vardiya formlarında paket alanı yok |
| 8 | PDF anteti | `/admin/raporlar` → herhangi bir PDF → **Sendigo GmbH · Bildgasse 10 · FN 681377a · Geschäftsführer: Gökhan Kalkanlı** |

Bunlar **şimdi doğrulanamaz** (veri yok, beklenen): araç haritası, telemetri,
vardiya açılması/kapanması, Telegram.

---

## 6. Sonraya kalanlar — müşteri verisi geldiğinde

Sıra bağlayıcıdır.

### 6.1 Şoför kayıtları — `/admin/workers` ⚠️ ÖNCE BU

**Şoför paneli kapalı olsa da şoför kayıtları ZORUNLUDUR.**
`time_entries.worker_id` NOT NULL'dır: vardiya bir şoföre yazılmak zorundadır ve
AZG raporu şoför ekseninde üretilir. 4 araç = 4 şoför kaydı, hiçbiri panele
girmese bile.

Gereken: ad, telefon (`+43…`), geçici PIN.

### 6.2 Araç kayıtları — `/admin/araclar`

Gereken: plaka · marka/model · yıl · **flespi_device_id** · **IMEI** · tank
kapasitesi (litre) · **atanmış şoför**.

> ⚠️ **Atanmamış araç otomatik vardiya AÇAMAZ** — motor `assigned_worker_id`
> üstünden çalışır. Filo alanı tek filoda `mavi` kalır (etiketi "Flotte").

### 6.3 Depo bölgesi — `/admin/bolgeler`

Yeni bölge → amaç **depot** → merkez + yarıçap (200-500 m tipik).

> ⚠️ **`SHIFT_AUTO_END=depot_idle` bu bölge olmadan çalışmaz.** Depo çizilene
> kadar vardiyalar `first_ignition` ile **açılır** ama depo şartı hiç
> sağlanmadığı için **gece yarısı emniyetiyle** (son hareket anına yazılarak)
> kapanır. Veri kaybı olmaz, kapanış saatleri kabaca doğru olur — ama gerçek
> davranış için depo şart.

### 6.4 flespi

1. Cihazları flespi'de kaydet, Sendigo'ya **ayrı bir cihaz grubu** aç.
2. O gruba ACL'i daraltılmış **ikinci bir token** üret → `FLESPI_TOKEN`.
   (Tek token iki filoyu birden açar — ayırmak yapısal koruma.)
3. Veri yolu: **REST pull önerilir.** Motor yalnız kendi veritabanındaki
   `flespi_device_id` dolu araçları çeker → müşteriler arası sızıntı yapısal
   olarak imkânsız. HTTP Stream push seçilirse stream **yalnız o gruba**
   filtreli olmalı.

### 6.5 Cron kayıtları (cron-job.org / GitHub Actions)

```
GET https://<domain>/api/flespi/sync?secret=<FLESPI_SYNC_SECRET>     — her 60 sn
GET https://<domain>/api/cron/shift-watchdog?secret=<CRON_SECRET>     — saatlik
```

### 6.6 Telegram — ayrı bot

Bir botun webhook adresi **tektir**; müşteriler bot paylaşamaz.

1. @BotFather → yeni bot → token → `TELEGRAM_BOT_TOKEN`,
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (üret).
2. Env'leri gir → **Redeploy**.
3. Webhook: `https://<domain>/api/telegram/webhook?secret=<TELEGRAM_WEBHOOK_SECRET>`
   (`scripts/telegram-webhook.ps1` bunu teşhisle birlikte yapar).
4. Yöneticiler `/admin/telegram`'dan kod alıp bota `/start <kod>` yazar.

> Bot kurmak aslında müşteri verisi gerektirmiyor — istersen 1. aşamada da
> yapılabilir. Sıralamada burada duruyor çünkü bildirim gidecek kimse yok.

### 6.7 Kabul testi (veri geldikten sonra)

| # | Ne | Nasıl |
|---|---|---|
| 1 | Telemetri akıyor | `select count(*) from device_telemetry where recorded_at > now() - interval '1 hour';` > 0 |
| 2 | Araçlar haritada | `/admin/harita` |
| 3 | Vardiya açılıyor | Sabah ilk kontak → `select * from time_entries where started_at::date = current_date;` |
| 4 | Vardiya kapanıyor | Araç depoya dönüp 20 dk hareketsiz → `ended_at` doluyor |
| 5 | UID geldiğinde | `COMPANY_REG_LINE` güncelle + redeploy |

---

## 7. Bilinen tuzaklar

**"Panele giriş geçersiz diyor, telefon/PIN doğru."**
Şoför paneli kapalı → şoför girişi **bilinçli** reddedilir (hesap sayımını
engellemek için hata mesajı ayırt edilmez). Yönetici hesabıyla dene.

**"Açılışta hata: DRIVER_PANEL_ENABLED=false iken SHIFT_AUTO_END='off' olamaz."**
Doğru davranış. `SHIFT_AUTO_END=depot_idle` gir.

**"Marka hâlâ HAK61 görünüyor."**
`NEXT_PUBLIC_*` build anında gömülür → Vercel'de **Redeploy** et.

**"PDF anteti hâlâ HAK61."**
`COMPANY_*` sunucu env'idir, `NEXT_PUBLIC_` öneki **almaz**. Girildikten sonra
redeploy gerekir.

**"Migration 028 hata verdi."**
`db/install/sendigo-full.sql` yerine tek tek migration çalıştırıyorsun ve
`tank_capacity_l` köprüsü yok. Tek parça dosyayı kullan.

**"main'e push ettim, Sendigo da deploy oldu."**
Beklenen. İki proje aynı repo'nun `main` dalından deploy eder; artık her
değişiklik iki müşteriyi birden etkiler.
