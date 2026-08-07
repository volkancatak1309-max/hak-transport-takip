# HAK61 — Mobil (React Native) keşif raporu

> **Amaç:** mevcut sistemin tam haritasını çıkarmak, mobil API tasarımına temel olmak.
> **Yöntem:** salt-okunur kod incelemesi. 13 ajan, 600 araç çağrısı, 07.08.2026.
> **Kapsam sınırı:** yalnız bu depo okundu. Vercel env'leri, canlı veritabanı ve
> harici zamanlayıcı ayarları **okunmadı** — bunlara dair her satır "BİLİNMİYOR"
> olarak işaretlidir. Hiçbir değer canlıda ölçülmedi.
> **Bu rapor hiçbir kodu değiştirmedi.**

---

## Yönetici özeti — sayılarla

| Ölçüm | Değer |
|---|---|
| Sayfa (`page.tsx`) | **27** — 20 yönetici, 5 şoför paneli, giriş + PIN |
| API route | 5 — 4'ü makineden-makineye (cron/flespi/telegram), 1'i PWA manifesti |
| **Kullanıcıya dönük JSON API ucu** | **0** |
| Server action | **83** (16 dosya, 5.262 satır); 14'ü `FormData`, 69'u tipli argüman |
| Yetki kapısı çağrı yeri | 115 · `middleware.ts` **YOK**, `app/admin/layout.tsx` **YOK** |
| Veritabanı tablosu | **26** · RPC **4** (2'si hiç çağrılmıyor) · **RLS politikası 0** |
| `lib/` iş mantığı | 17.418 satır; içinde `next/` bağı **tek dosyada** (`lib/session.ts`) |
| `revalidatePath` çağrısı | 92 (54 action) · `router.refresh()` 52 |
| `export const revalidate` / `unstable_cache` / `maxDuration` | 0 / 0 / 0 · `force-dynamic` 26 sayfa |
| Kapalı modüller (kod varsayılanı) | Yakıt, Masraf, Bakım — üçü de `false` |

**Hesaplar nerede yapılıyor — tek cümlelik cevap:** neredeyse tamamı **sunucu Node
kodunda (`lib/`)**. Veritabanında yalnız yakıt/soğutma suyu RPC'leri var; tarayıcıda
yalnız canlı sayaçlar, mola ölçümü ve alarm listesi gruplaması.

| Değer | Hesap yeri | Tek kaynak |
|---|---|---|
| Vardiya süresi | Sunucu (canlı sayaç tarayıcıda, aynı fonksiyon) | `lib/format.ts:129` `workedMs` |
| Mola süresi | **Tarayıcı ölçer**, sunucu toplar | `PanelClient.tsx:262` → `shift.ts:778` |
| AZG aşımı | Sunucu | `lib/azg-rules.ts` (tavan 12 sa / gece 10 sa) |
| Güvenlik skoru | Sunucu | `lib/analytics.ts:568` — `100·K/(K+ceza/1000km)`, K=500 |
| Rölanti israfı (€) | Sunucu | `lib/analytics.ts:668` — 0,9 L/sa × 1,65 €/L |
| Yakıt L/100km | **SQL RPC + sunucu** | `report_fuel_stats` + `lib/reports.ts:805-997` |
| Mesafe / km | Sunucu | `lib/analytics.ts:319` (odometre) · `lib/metrics-distance.ts` (GPS) |
| Alarm sayıları ve gruplama | **Tarayıcı** (SQL `count` kullanılmıyor) | `AlarmsClient.tsx:207` + `DataTable.tsx:68` |
| Performans kutuları (7 gün) | Sunucu, **kayan** pencere | `lib/analytics.ts:135` `slidingWindow` |

---

## Mobil için en kritik altı bulgu

1. **Kullanıcı için token yolu yok.** Kimlik `httpOnly` iron-session çerezi
   (`hak_session`, 30 gün, kayan yenileme yok). Kapılar 401 değil `redirect()`
   fırlatıyor — 115 çağrı yerinin API varyantı yazılmalı. Kodda geçen her
   `Authorization` başlığı makineden-makineye **paylaşılan sır**, kullanıcı token'ı değil.
2. **Mobil doğrudan Supabase'e bağlanamaz.** Anon key yok, `create policy` sayısı 0,
   tek istemci `service_role` ve `server-only`. Araya bir BFF şart.
3. **Okuma yüzeyi sıfırdan kurulacak.** 27 sayfanın 14'ü veriyi kendi çekiyor
   (61 satır içi sorgu). Servis katmanı deseni var ama kısmi (`lib/admin-dashboard.ts`,
   `lib/depot.ts`) — icat edilecek bir mimari yok, mevcut desen genişletilecek.
4. **Yazma yolu beklenenden kolay.** 83 action'ın 69'u zaten tipli JSON argüman alıyor
   ve Next bağı **kenarda**: tipik bir action'da yalnız baştaki `requireWorker()` ve
   sondaki `revalidatePath()` Next'e özgü, aradaki iş mantığı `lib/`'e devrediliyor.
   `loginAction` istisna — `headers()` iş mantığının içinde, yeniden yazım şart.
5. **Kiracı seçimi derleme zamanında.** Bayraklar istemci paketine sabit metin olarak
   gömülüyor; `middleware.ts` ve host tabanlı çözümleme yok, her müşteri ayrı Supabase
   projesi. Tek mobil paket birden çok müşteriye hizmet edemez — çalışma zamanı
   yapılandırma ucu yazılmalı.
6. **Hata sözleşmesi mobil için standart değil.** Baskın desen `{ok:false, error:"<kod>"}`
   ama üç çatlak var: bazı yollar ham Supabase mesajını dışa veriyor, bazı kodlar
   `"undelivered_over:5:12"` gibi dizeye gömülü parametre taşıyor, `loginAction`
   başarıda hiç değer döndürmüyor.

---

## Düzeltme notu (rapor içi tutarlılık)

Bölüm 8'in özet tablosunda "RLS politikası 0 (**28** tablo)" yazıyor. Ölçtüm:
`db/install/sendigo-full.sql` içinde `^create table` **26**; "28" rakamı iki yorum
satırındaki "create table" geçişini de sayıyor (satır 35 ve 1986). **Doğru sayı 26.**
Bölüm 4'teki envanter doğrudur. RLS bulgusu (politika sayısı 0) her iki sayımda da aynı.

---

## İçindekiler

| # | Bölüm | Ne bulursun |
|---|---|---|
| 1 | Giriş ve Oturum | telefon+PIN akışı, iron-session, 8 yetki kapısı, giriş kilidi, RLS durumu |
| 2a | Ekran envanteri — Yönetici (çekirdek) | 13 sayfa tablosu, ortak layout yokluğu, ağır sorgular |
| 2b | Ekran envanteri — Yönetici (raporlar) | 7 sayfa, modül bayrakları, PDF üretimi |
| 2c | Ekran envanteri — Şoför paneli + API | panelin tam davranışı, 4 API route, çevrimdışı kuyruk |
| 2d | Server action envanteri | 83 action tam tablo: parametre, kapı, dönüş — **mobil API'nin karşılığı** |
| 3a | Hesaplama — Vardiya / Mola / AZG | süre formülü, mola kademeleri, AZG eşik tablosu, imza kuralı |
| 3b | Hesaplama — Skor / rölanti / yakıt / km / CO₂ | formüller, sabitler, de-glitch kuralı, 1000 satır tavanı |
| 3c | Hesaplama — Alarmlar ve performans | 9 alarm türü, gruplama ekseni, 15 Dikkat kalemi |
| 4 | Veritabanı fonksiyonları ve şema | 4 RPC + 2 trigger, 26 tablo, kritik tablolarda tam kolon listesi |
| 5 | Çok müşterili katman | `lib/tenant.ts`, 32 `NEXT_PUBLIC_` + 20 sunucu env, tenant farkları |
| 6 | Bildirimler (Telegram) | mimari, bağlama akışı, **21 satırlık olay listesi**, zamanlayıcılar |
| 7 | Kapsanmamış alanlar | dosya yükleme, i18n, harita, realtime, PWA, hata formatı, sayfalama |
| 8 | Mobil geçiş zorlukları | 10 somut engel, önem sırasıyla, her biri ölçülmüş kanıtla |

---

## 1) Giriş ve Oturum

### 1. Giriş akışı

**Giriş noktası bir Server Action'dır, API route DEĞİLDİR.**

- `loginAction(_prev: LoginState, formData: FormData): Promise<LoginState>` — `app/actions/auth.ts:120`. Dosyanın başında `"use server"` (`app/actions/auth.ts:1`).
- İstemci tarafı: `app/LoginForm.tsx:72` — `useActionState(loginAction, initial)`, form `action={formAction}` ile bağlanıyor (`app/LoginForm.tsx:100`).
- `app/api` altında giriş yapan HİÇBİR route yok. Mevcut route'lar yalnız: `app/api/cron/shift-watchdog/route.ts`, `app/api/flespi/sync/route.ts`, `app/api/flespi/ingest/route.ts`, `app/api/telegram/webhook/route.ts`.

**Dönüş tipi** (`app/actions/auth.ts:18-30`):
```ts
export type LoginState = {
  error?: "invalid" | "inactive" | "db" | "validation" | "locked";
  retryAfter?: number;    // saniye, yalnız error === "locked"
  lockedUntil?: string;   // ISO, yalnız error === "locked"
};
```
**Kritik:** başarı durumunda hiçbir gövde dönmez — `redirect()` çağrılır (`app/actions/auth.ts:202-203`). Yani `LoginState` YALNIZ hata taşır.

**Adım adım akış** (`app/actions/auth.ts:120-204`):
1. `loginSchema.safeParse({phone, pin})` → başarısızsa `{error:"validation"}` (satır 124-128).
2. `identifier = lockIdentifier(await clientIp(), phone)` (satır 133). `clientIp()` `x-forwarded-for`'un ilk parçasını, yoksa `x-real-ip`, yoksa `"unknown"` (satır 53-58).
3. Kilit kapısı: `login_attempts` tablosundan `locked_until` okunur; gelecekteyse bcrypt'e HİÇ girilmeden `{error:"locked", retryAfter, lockedUntil}` döner (satır 136-150).
4. `workers` sorgusu: `.in("phone", phoneVariants(phone)).limit(2)`, seçilen kolonlar `id, name, phone, pin_hash, plate, is_admin, is_active, must_change_pin` (satır 157-161).
5. Tam olarak BİR bcrypt karşılaştırması: kayıt yoksa sabit `DUMMY_PIN_HASH` ile (satır 46-47, 170-173). Zamanlama üzerinden hesap sayımını (account enumeration) kapatmak için.
6. `authed = !!worker && worker.is_active && pinOk` (satır 174). Bilinmeyen telefon / pasif hesap / yanlış PIN üçü de AYNI `"invalid"` cevabını alır.
7. `DRIVER_PANEL_ENABLED === false` ise `is_admin` olmayan kayıt da aynı `"invalid"` ile reddedilir (satır 185-187).
8. Başarıda `clearFailures(identifier)` → `login_attempts` satırı silinir (satır 116-118, 189).
9. Oturum yazılır ve `session.save()` (satır 191-198).
10. `must_change_pin` ise `/pin`, değilse `worker.is_admin || !DRIVER_PANEL_ENABLED ? "/admin" : "/panel"` (satır 202-203).

**Telefon normalizasyonu** — `lib/phone.ts`, üç fonksiyon:

- `sanitizePhone(raw)` (`lib/phone.ts:22-30`): `NFKC` normalize → `.replace(/[^\d+]/g, "")` (rakam ve `+` DIŞINDA her şeyi atar: Unicode yön işaretleri U+202A/U+202C, sıfır genişlikli boşluk, BOM, NBSP, tire, parantez, harf) → `.replace(/(?!^)\+/g, "")` (baştaki hariç tüm `+` atılır).
- `canonicalPhone(raw)` (`lib/phone.ts:36-42`): sanitize sonrası `^00` → `+`; `^0\d` → `+43` + kalan; `^\+430(?=\d)` → `+43`. **Avusturya (+43) kodda sabit yazılıdır**, env'den gelmez.
- `phoneVariants(raw)` (`lib/phone.ts:48-53`): `[sanitized, canonical, withTrunk]` — `withTrunk` = `canonical.replace(/^\+43(?=\d)/, "+430")`. Tekilleştirilir. DB'de aynı numaranın hem `+43660…` hem `+430660…` yazımı bulunduğu için giriş sorgusu üçünü birden dener.

**Doğrulama şemaları** (`lib/validation.ts`):
- `phoneSchema` (satır 9-15): `trim` + sanitize sonrası uzunluk 6–20 arası, aksi `"errPhone"`.
- `loginPinSchema` (satır 68): `/^\d{4,6}$/` — **girişte 4 haneli eski PIN'ler hâlâ kabul ediliyor** (bilinçli, geçiş dönemi).
- `loginSchema` (satır 70-73): `{phone: phoneSchema, pin: loginPinSchema}`.

**PIN saklama:** `workers.pin_hash` (text, not null — `db/migrations/001_initial.sql:32`). bcryptjs `^3.0.3` (`package.json:25`). **Cost = 10**, üç yerde de aynı: `app/actions/auth.ts:249` (`bcrypt.hash(pin, 10)`), `app/actions/workers.ts:83`, `app/actions/workers.ts:509`, `scripts/bootstrap-admin.mjs:151`.

**Tablo/kolonlar** — `public.workers` (`db/migrations/001_initial.sql:29-38`):
`id uuid pk`, `name text not null`, `phone text not null unique`, `pin_hash text not null`, `plate text`, `is_admin boolean not null default false`, `is_active boolean not null default true`, `created_at timestamptz`. Sonradan eklenenler: `must_change_pin` (019), `managed_fleet` (029), `counts_as_driver` (041).

---

### 2. Oturum saklama

**iron-session `^8.0.4`** (`package.json:30`). Tek kaynak `lib/session.ts:18-28`:

```ts
export const sessionOptions: SessionOptions = {
  password,                                   // process.env.SESSION_PASSWORD
  cookieName: "hak_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,               // 30 gün = 2.592.000 sn
  },
};
```

- **Çerez adı:** `hak_session`
- **Şifreleme sırrı:** `process.env.SESSION_PASSWORD` (`lib/session.ts:13`). En az 32 karakter zorunlu; değilse modül yüklenirken `throw` (`lib/session.ts:14-16`). `.env.example:3`'te tanımlı.
- **ttl:** `sessionOptions` içinde AYRI bir `ttl` alanı **verilmemiştir**; yalnız `cookieOptions.maxAge` var. iron-session'ın maxAge'den ttl türetip türetmediği bu depoda doğrulanamaz — **BILINMIYOR** (kütüphane içi davranış, kodda yazmıyor).
- **httpOnly:** true · **secure:** yalnız production · **sameSite:** "lax" · **path:** "/"

**Session içeriği — tam tip** (`lib/types.ts:399-408`):
```ts
export type SessionData = {
  worker_id?: string;
  name?: string;
  phone?: string;
  is_admin?: boolean;
  plate?: string | null;
  must_change_pin?: boolean;
};
```
Tüm alanlar opsiyonel. **Çerezde OLMAYANLAR (bilinçli):** `managed_fleet` (filo şefliği), `counts_as_driver`, `is_active`. Gerekçe kodda yazılı: çerez 30 gün yaşıyor, yetki kaldırılınca hemen etkili olmalı (`lib/fleet-scope.ts:44-48`, `lib/session.ts:64-65`).

**Oturum yenileme/uzatma:** `session.save()` yalnız İKİ yerde çağrılıyor — `app/actions/auth.ts:198` (giriş) ve `app/actions/auth.ts:257` (PIN değişimi). Her istekte çerezi tazeleyen bir kayan (rolling) yenileme kodda **yoktur**. `session.destroy()` yalnız `logoutAction`'da (`app/actions/auth.ts:206-210`), ardından `/`'a redirect.

---

### 3. Rol ayrımı

| Rol | Kolon | Nereden okunur | Çereze girer mi |
|---|---|---|---|
| Yönetici (patron) | `workers.is_admin` | Girişte DB (`app/actions/auth.ts:159`), sonra çerez (`session.is_admin`) | **Evet** |
| Şoför | Rolün kendi kolonu YOK — `is_admin=false` olan herkes | `lib/driver-scope.ts:116-123` | Hayır |
| Filo şefi | `workers.managed_fleet` (`'bordo'`/`'mavi'`, 029) | **Her istekte DB** — `getManagedFleet()` `lib/fleet-scope.ts:79-93` | **Hayır** |
| Araç kullanan yönetici | `workers.counts_as_driver` (041) | **Her istekte DB** — `lib/driver-scope.ts:123` | **Hayır** |

`counts_as_driver` bir ROL DEĞİL, tek kayda verilen muafiyet işaretidir (`db/migrations/041_counts_as_driver.sql:22-23`): `is_admin`'i ikame etmez, yalnız şoför metriklerinden düşürülmeyi engeller.

**`lib/driver-scope.ts` tam olarak ne yapar:**
- `getDriverScope()` (`lib/driver-scope.ts:112-137`), React `cache()` ile istek başına tek sorgu. `workers` tablosundan `is_admin = true AND counts_as_driver = false` olan id'leri çeker, `getTestScope().workerIds` ile birleştirir → `excludedIds`.
- Döndürdüğü `DriverScope` (`lib/driver-scope.ts:73-95`): `excludedIds`, `isDriver(id)` (null → `true`), `active`.
- Sorgu hata verirse `EMPTY` (`lib/driver-scope.ts:97-101, 125`) — fail-safe, panel boşalmasın diye.
- İki uygulayıcı: `onlyDrivers(query, column, scope)` sorgu düzeyinde `.not(col,"in",…)` (satır 154-161); `dropNonDrivers(rows, pick, scope)` satır düzeyinde filtre (satır 169-176).
- **Bu bir YETKİ kapısı değil, METRİK kapsamıdır.** Kod açıkça yazıyor: giriş/auth, PIN yönetimi, yetki kontrolleri bu filtreden geçmez (`lib/driver-scope.ts:66-70`).

**`lib/fleet-scope.ts` tam olarak ne yapar:**
- `getManagedFleet(workerId)` (satır 79-93): `workers`'tan `managed_fleet, is_active` okur. Hata/kayıt yok → `null`; `is_active !== true` → `null` (şeflik düşer); değer `'bordo'`/`'mavi'` değilse → `null`.
- `getFleetScope(fleet)` (satır 99-165): `fleet` null → `UNRESTRICTED` (satır 69-76). Değilse `vehicles` tablosundan `fleet = X AND is_test IS NOT true` olan `id, assigned_worker_id` çeker. Sorgu hata verirse **FAIL-CLOSED**: boş küme + `isFleetVehicle/isFleetWorker` sabit `false` (satır 113-125) — kısıtsız kapsama DÜŞMEZ.
- Geçici araç genişletmesi (satır 132-152): şefin şoförlerinin BUGÜN kullandığı araçlar (başka filodan olsa bile) `vehicleIds`'e eklenir; `startOfTodayVienna()` sınırıyla.
- Dönen `FleetScope` (satır 55-66): `fleet`, `vehicleIds`, `workerIds`, `restricted`, `isFleetVehicle`, `isFleetWorker`.
- Uygulayıcılar: `onlyFleet()` (satır 181-189) — kısıtlıyken boş listede bile `.in(col, [])` uygular (bilinçli, boş listede filtreyi atlamak tüm filoyu açardı); `dropOtherFleets()` (satır 201-215) — araç VEYA şofördan biri kapsamdaysa satır kalır.

**Yetki NEREDE kontrol ediliyor: `middleware.ts` YOKTUR.**
Kök dizinde ve tüm ağaçta `middleware.ts` / `middleware.js` / `proxy.ts` bulunamadı (`find` sonucu boş). **`app/admin/layout.tsx` de yoktur.** Yetki **her sayfada tek tek** ve **her server action'ın başında** kontrol edilir.

Sayım (doğrulandı, eksiksiz):
- `app/admin` altında 20 `page.tsx` var → 17'si `requireAdmin()`, 3'ü `requireFleetView()` çağırıyor. **Korumasız admin sayfası yok.**
- `app/panel` altında 5 `page.tsx` var → 5'i de `requireWorker()` çağırıyor. **Korumasız panel sayfası yok.**
- `app/admin/loading.tsx:9` ve `app/admin/alarmlar/loading.tsx:8` yalnız `getSession()` çağırır (guard YOK) — bunlar veri içermeyen iskelet ekranlarıdır.

**KAPILAR — toplam 8 farklı kapı:**

| # | Kapı | Tanım | Davranış |
|---|---|---|---|
| 1 | `requireWorker()` | `lib/session.ts:35-40` | `worker_id` yok → `/`; `must_change_pin` → `/pin` |
| 2 | `requireAdmin()` | `lib/session.ts:42-48` | + `!is_admin` → `/panel` |
| 3 | `requireFleetView()` | `lib/session.ts:67-78` | admin → `{fleet:null, isChief:false}`; değilse `getManagedFleet()` DB'den, `null` ise `/panel` |
| 4 | `requireManualStartAuth(targetWorkerId)` | `lib/session.ts:107-138` | Yazma yetkisi. Admin → `UNRESTRICTED`; şef → `scope.isFleetWorker(target)` değilse `{ok:false,"out_of_scope"}` |
| 5 | `requirePinChange()` | `lib/session.ts:146-151` | `/pin` özel kapısı; `must_change_pin` YOKSA `/admin` ya da `/panel`'e atar (döngü kırıcı) |
| 6 | `PanelLayout` tenant kapısı | `app/panel/layout.tsx:27` | `!DRIVER_PANEL_ENABLED` → `/admin`. `/panel` ağacının TEK kapısı |
| 7 | `loginAction` tenant kapısı | `app/actions/auth.ts:185-187` | Panel kapalı + `!is_admin` → giriş reddedilir |
| 8 | API paylaşılan-sır kapıları | `app/api/cron/shift-watchdog/route.ts:37-45`, `app/api/flespi/sync/route.ts:198`, `app/api/flespi/ingest/route.ts:56`, `app/api/telegram/webhook/route.ts:176-180` | `CRON_SECRET` / `FLESPI_SYNC_SECRET` / `TELEGRAM_WEBHOOK_SECRET`, `safeEqual()` ile sabit-zamanlı |

**Ek "ikinci hat" DB tazelemeleri** (çerez bayatlığına karşı):
- `app/actions/shift.ts:118-123` — vardiya başlatmadan önce `workers.is_active` yeniden okunur; `requireWorker()` bunu kapsamaz (yorum satır 114-117).
- `app/actions/shift.ts:379-386` — hedef şoför `is_active, is_admin, counts_as_driver` yeniden okunur.
- `lib/fleet-scope.ts:89` — şeflik `is_active`'e bağlı.

**`requireFleetView()` çağrı noktaları (5 yer):** `app/admin/page.tsx:84`, `app/admin/harita/page.tsx:27`, `app/admin/izinler/page.tsx:42`, `app/actions/leaves.ts:94` (izin talebi oluşturma/düzenleme), `app/actions/leaves.ts:284` (silme; şef yalnız kendi `pending` talebini — satır 290-299).
⚠️ `lib/session.ts:57` yorumu "Bu kapı SADECE iki sayfada kullanılır" diyor; gerçek 3 sayfa + 2 action. Yorum güncel değil.

**Kilit kaldırma yetkisi:** `clearLoginLockAction` — `requireAdmin()` (`app/actions/workers.ts:459`). Şef GİREMEZ (`is_admin=false` → `/panel`).

---

### 4. `must_change_pin` akışı

- **Kolon:** `workers.must_change_pin boolean not null default false` — `db/migrations/019_must_change_pin.sql:16-17`.
- **`true` SET EDİLDİĞİ yerler:**
  - Yeni çalışan oluşturma: `app/actions/workers.ts:102` (`must_change_pin: true`, insert içinde).
  - Yönetici PIN atama: `app/actions/workers.ts:513` — `.update({ pin_hash, must_change_pin: mustChange })`; `mustChange` parametresi `setWorkerPinAction(workerId, pin, mustChange)` imzasından gelir (`app/actions/workers.ts:490-493`) ve yönetici bilinçli olarak kapatabilir.
  - Kurulum betiği: `scripts/bootstrap-admin.mjs:160`.
- **`false` SET EDİLDİĞİ tek yer:** `app/actions/auth.ts:252` — `.update({ pin_hash, must_change_pin: false })`.
- **Kontrol edildiği yerler:** `app/actions/auth.ts:202` (giriş sonrası redirect), `lib/session.ts:38` (`requireWorker`), `lib/session.ts:45` (`requireAdmin`), `lib/session.ts:70` (`requireFleetView`), `lib/session.ts:149` (`requirePinChange`, TERS yönde).
- **Yönlendirme:** `/pin` (`app/pin/page.tsx`). Sayfa `requirePinChange()` çağırır (`app/pin/page.tsx:35`).
- **PIN değiştirme fonksiyonu:** `changePinAction(_prev: ChangePinState, formData: FormData): Promise<ChangePinState>` — `app/actions/auth.ts:220-260`. Dönüş tipi `{ error?: "validation"|"weak"|"mismatch"|"same"|"db" }` (satır 212-214).
  - **Bilerek `requireWorker()` KULLANMAZ** (döngü olurdu) — oturumu kendisi doğrular: `if (!session.worker_id) redirect("/")` (satır 225).
  - `changePinSchema` (`lib/validation.ts:78-86`): `pin: pinSchema` (`/^\d{6}$/` + `!isWeakPin`) + `pin_confirm` eşleşmesi.
  - Eski PIN'le aynı olamaz: `bcrypt.compare(pin, worker.pin_hash)` → `{error:"same"}` (satır 246-247).
  - `bcrypt.hash(pin, 10)` → update → `session.must_change_pin = false; await session.save()` (satır 249-257).
  - Redirect: `worker.is_admin || !DRIVER_PANEL_ENABLED ? "/admin" : "/panel"` (satır 259).
- **Zayıf PIN kuralı** (`lib/validation.ts:24-29`): 6 hane değilse `false`; hepsi aynı rakam (`/^(\d)\1{5}$/`); `"0123456789".includes(pin)` veya `"9876543210".includes(pin)`; sabit liste `{123123, 112233, 121212, 123321, 456456}` (satır 22). `123456` yalnız YÖNETİCİNİN atadığı geçici PIN olarak serbest (`adminSetPinSchema`, `lib/validation.ts:60-63`), şoför kendi kalıcı PIN'i yapamaz.

---

### 5. Giriş kilidi

**Mantık iki dosyada bölünmüş:** eşikler/kimlik biçimi `lib/login-lock.ts`, mekanizma `app/actions/auth.ts`.

**Sabitler** (`lib/login-lock.ts:33-49`):
```ts
export const MAX_FAILURES = 10;
export const ATTEMPT_WINDOW_MS = 30 * 60 * 1000;      // 30 dk
export const LOCK_STEPS_MS = [15_000, 60_000, 5*60_000, 15*60_000, 60*60_000];
```

**Formül** (`lib/login-lock.ts:51-57`):
```ts
export function lockMs(failures: number): number {
  const i = Math.min(Math.max(failures - MAX_FAILURES, 0), LOCK_STEPS_MS.length - 1);
  return LOCK_STEPS_MS[i];
}
```
Yani: 10. hata → 15 sn · 11. → 60 sn · 12. → 5 dk · 13. → 15 dk · 14. ve sonrası → 1 saat.

**Sayaç mantığı** (`registerFailure`, `app/actions/auth.ts:70-100`):
- Mevcut satır okunur; `now - last_attempt_at > ATTEMPT_WINDOW_MS` ise sayaç bayat sayılır ve **0'dan** başlar (satır 80-83).
- `attempts >= MAX_FAILURES` ise `locked_until = now + lockMs(attempts)` (satır 85-88).
- `upsert` ile `onConflict: "identifier"` (satır 90-98).
- Kilidi KURAN deneme de kilit bilgisini döner (`failureState`, satır 103-114) — kullanıcı bir deneme geç öğrenmiyor.

**Kimlik biçimi** (`lib/login-lock.ts:68-70`): `identifier = "<ip>|<canonicalPhone(phone)>"`. IP ile birlikte anahtarlanır ki saldırgan başka ağdan gerçek şoförü kilitleyemesin. Telefon kanonik → aynı numaranın iki yazımı tek sayaçta.

**Tablo** (`db/migrations/012_login_attempts.sql:13-19`):
```sql
create table if not exists public.login_attempts (
  identifier        text primary key,   -- "<ip>|<phone>"
  attempts          int not null default 0,
  locked_until      timestamptz,
  first_attempt_at  timestamptz not null default now(),
  last_attempt_at   timestamptz not null default now()
);
```
İndeks: `login_attempts_last_attempt_idx (last_attempt_at)`.

**Kilidi kim kaldırabilir:** yalnız **patron** (`is_admin`). `clearLoginLockAction(workerId)` → `requireAdmin()` (`app/actions/workers.ts:456-474`). Filo şefi `requireAdmin()` tarafından `/panel`'e atılır (gerekçe `app/actions/workers.ts:447-450`).
- `clearLoginLock(phone)` (`lib/login-lock.ts:145-156`): o telefona ait TÜM satırları siler — `LIKE '%|<kanonik>'` (IP'den bağımsız). `attempts` de sıfırlanır, yalnız `locked_until` değil.
- İz: `logLoginUnlock(workerId, session.worker_id, cleared)` → `login_unlock_log` tablosu (`lib/login-unlock-log.ts:25-39`, `db/migrations/042_login_unlock_log.sql:24-30`). Best-effort: tablo yoksa sessiz geçer, kilit AÇMA işlemi buna bağlı değil.
- Kolonlar: `id uuid`, `unlocked_at timestamptz`, `unlocked_by uuid → workers(id) on delete set null`, `worker_id uuid → workers(id) on delete set null`, `cleared_rows int`. **IP ve telefon YAZILMAZ** (bilinçli, `db/migrations/042_login_unlock_log.sql:10-13`).
- Gösterim tarafı: `getLoginLockState(phone)` (`lib/login-lock.ts:106-135`) → `{locked, lockedUntil, retryAfter, attempts, rows}`; hata → `EMPTY`. Çağrı: `app/admin/workers/[id]/page.tsx:70`, düğme `app/admin/workers/[id]/WorkerDetailClient.tsx:98`.

**İstemci sayacı:** `LockNotice` bileşeni (`app/LoginForm.tsx:30-68`); `key={lockedUntil}` ile sıfırlanır, süre `retryAfter`'dan (göreli saniye) sayılır — telefon saati sapsa bile bozulmaz (`app/LoginForm.tsx:27-28, 142-147`).

---

### 6. Supabase erişimi

**service_role tek istemci, yalnız sunucuda** (`lib/supabase.ts`):
```ts
import "server-only";                                    // satır 1
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;        // satır 4
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;// satır 5
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});                                                       // satır 13-15
```
`import "server-only"` (satır 1) istemci bundle'ına sızmayı derleme zamanında engeller.

**Anon key YOK.** `.env.example` yalnız üç anahtar tanımlar (`.env.example:1-3`): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_PASSWORD`. Tüm depoda (node_modules hariç) `ANON_KEY` geçen tek satır yok.

**İstemciden doğrudan Supabase erişimi YOK.** `createClient` çağıran tüm yerler: `lib/supabase.ts:13` (sunucu, `server-only`) ve dört Node betiği — `scripts/verify-test-hidden.mjs:24`, `scripts/verify-metrics-sane.mjs:71`, `scripts/verify-autoshift-parity.mjs:80`, `scripts/bootstrap-admin.mjs:119`. Hiçbir `"use client"` dosyasında Supabase istemcisi yok.

**RLS — AÇIKÇA SÖYLÜYORUM: RLS TÜM İŞ TABLOLARINDA KAPALIDIR.**

Depo genelinde `create policy` ifadesi **HİÇ YOK** (0 eşleşme). Bulunanların tamamı:

| Dosya:satır | İfade |
|---|---|
| `db/migrations/024_idle_episodes.sql:51` | `alter table public.idle_episodes enable row level security;` |
| `db/migrations/031_worker_leaves.sql:63` | `alter table public.worker_leaves disable row level security;` |
| `db/migrations/031_worker_leaves.sql:64` | `alter table public.leave_edit_log disable row level security;` |
| `db/migrations/033_device_config_epochs.sql:22` | `alter table public.device_config_epochs disable row level security;` |
| `db/migrations/035_depot_lock.sql:25` | `alter table public.depot_exemptions disable row level security;` |
| `db/install/sendigo-full.sql:1262` / `galzura-full.sql:1262` | `idle_episodes enable row level security` |
| `db/install/*-full.sql:1945,1946,2004,2078` | aynı dört `disable` |

Yani `idle_episodes` **TEK** RLS-açık tablodur ve policy'si yoktur — bu bilinçli "varsayılan deny" (`db/migrations/024_idle_episodes.sql:48-50`). Diğer 25 tablo (install SQL'de toplam 26 `create table` var) RLS'siz.

Kod içi gerekçe her yerde aynı: "RLS stays OFF (consistent with the rest of the schema); this table is only ever read/written by the service-role client" — `db/migrations/012_login_attempts.sql:25-26`, `014_device_telemetry.sql:34`, `015_geofences.sql:26`, `019_must_change_pin.sql:12-13`, `021_telemetry_extended.sql:66`.

**Storage:** üç private bucket (`fuel-receipts`, `expense-receipts`, `maintenance-receipts`), 5 MB, yalnız görsel MIME (`db/migrations/007_fuel_expenses.sql:113-119`). Object policy YOK; yorum: "service-role... bypasses RLS, so no object policies are required" (satır 110-112).

---

### 7. Mobil (React Native) için kritik notlar

Yalnız kodda gördüklerime dayanıyor:

**1. Oturum ÇEREZ tabanlıdır, token DEĞİL.**
Kimlik `hak_session` adlı iron-session mühürlü çerezidir (`lib/session.ts:20`). JWT/Bearer/refresh-token üreten hiçbir kod yok. `httpOnly: true` (`lib/session.ts:22`) → RN'de JS'ten okunamaz; native bir cookie jar (fetch'in kendi jar'ı ya da bir cookie kütüphanesi) şart. Çerez `path: "/"` ve `sameSite: "lax"`.

**2. Giriş için çağrılabilir bir HTTP uç noktası YOKTUR.**
`loginAction` bir Next.js Server Action'dır (`app/actions/auth.ts:1, 120`) ve yalnız `app/LoginForm.tsx:72`'deki `useActionState` üzerinden tüketiliyor. `app/api` altında giriş/oturum route'u yok (dizin listesi: `cron/shift-watchdog`, `flespi/ingest`, `flespi/sync`, `telegram/webhook`). Server Action'ın tel üzerindeki çağrı biçimi (istek başlığı/action-id formatı) bu depoda tanımlı olmadığı için **BILINMIYOR** — kütüphane iç davranışı, kodda yazmıyor. Somut sonuç: RN'nin ya yeni bir `POST /api/...` route'una ya da bu protokolün taklidine ihtiyacı var.

**3. Başarılı girişte gövde dönmez.**
`loginAction` başarıda `redirect()` çağırır ve hiçbir şey döndürmez (`app/actions/auth.ts:202-203`). `LoginState` YALNIZ hata taşır (`app/actions/auth.ts:18-30`). RN başarıyı ancak `Set-Cookie` + yönlendirmeden anlayabilir; parse edilecek bir JSON kimlik yanıtı yoktur.

**4. Tüm sayfa kapıları `redirect()` ile çalışır, 401/403 döndürmez.**
`lib/session.ts:37, 44, 46, 69, 76, 149` — hepsi `next/navigation`'ın `redirect()`'i. `requireManualStartAuth` tek istisnadır: `{ok:false, error:"unauthorized"|"out_of_scope"}` döndürür (`lib/session.ts:97-105`). RN tarafında "oturum düştü" tespiti için durum kodu değil, yönlendirme hedefi izlenmek zorunda.

**5. `middleware.ts` YOK → korunan hiçbir yüzey merkezî bir yerden doğrulanamaz.**
Yetki 20 admin sayfası + 5 panel sayfası + ~100 server action'ın içinde tek tek çağrılıyor (bkz. §3). RN için yeni bir API katmanı yazılırsa her uç noktanın kapısını KENDİSİ çağırmak zorunda; unutulan uç nokta tamamen açık kalır (bugünkü fail-closed güvence yalnız "dokunmamaktan" geliyor — `db/migrations/029_fleet_chief.sql:8-13`).

**6. RN doğrudan Supabase'e BAĞLANAMAZ.**
Anon key yok (`.env.example:1-3`), istemci Supabase istemcisi yok, `lib/supabase.ts:1` `server-only`. Üstelik `idle_episodes` dışındaki tüm tablolarda RLS kapalı (§6) — bir anon key eklenip mobile verilseydi tüm veri açığa çıkardı. **Mobil, veriye yalnız sunucu üzerinden erişebilir.**

**7. Kilit sayacı IP tabanlı — mobil ağda toplu kilitlenme riski.**
`identifier = "<ip>|<telefon>"` (`lib/login-lock.ts:68-70`), IP `x-forwarded-for`'un ilk parçasından (`app/actions/auth.ts:53-58`). Aynı NAT arkasındaki farklı telefonlar farklı `identifier` üretir (telefon numarası kimliğe giriyor), yani karşılıklı kilitleme olmaz; ama tek kullanıcının IP'si değiştiğinde (mobil ağ ↔ Wi-Fi geçişi) sayaç sıfırdan başlar — kilit fiilen atlanabilir. Bu davranış kodda böyle, değerlendirme değil gözlem.

**8. Oturum ömrü sabit 30 gün, uzatma yok.**
`maxAge: 60*60*24*30` (`lib/session.ts:26`), `session.save()` yalnız giriş ve PIN değişiminde (`app/actions/auth.ts:198, 257`). Kayan yenileme yok → RN kullanıcısı 30 gün sonra yeniden giriş yapmak zorunda ve bunu önceden haber verecek bir uç nokta yok.

**9. `is_admin` çerezde, `managed_fleet`/`counts_as_driver` DEĞİL.**
RN yerel olarak yalnız `is_admin`, `name`, `phone`, `plate`, `must_change_pin`, `worker_id` bilgisine sahip olabilir (`lib/types.ts:399-408`). Filo şefliği her istekte DB'den okunuyor (`lib/fleet-scope.ts:79-93`) — mobil önbelleğe alınamaz, alınırsa yetki kaldırma 30 gün gecikir (kodun bunu bilinçli reddettiği gerekçe: `lib/fleet-scope.ts:44-48`).

**10. `/panel` tenant bayrağıyla tamamen kapatılabilir.**
`app/panel/layout.tsx:27` — `NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false` olan müşteride (Sendigo) şoför girişi de reddediliyor (`app/actions/auth.ts:185-187`). Mobil uygulama böyle bir tenant'ta şoför için işlevsizdir; bayrağı sunucudan öğrenecek bir uç nokta yok.

---

## 2a) Ekran Envanteri — Yönetici (çekirdek)

### Yönetici ekranları envanteri — 1. bölüm

| Yol | Ne gösterir | Veri kaynağı (tablo/fonksiyon) | Tür | Bayrak |
|---|---|---|---|---|
| `app/admin/page.tsx` | Günün Panosu: operasyon konsolu (tarih aralığı/şoför/durum filtreleri), Günün Panosu roster'ı, Dikkat/Aksiyon listesi, Kapanmamış Vardiyalar, açık şoför bildirimleri, vardiya arşivi tablosu, Excel/PDF/AZG dışa aktarımı, Çalışan Ekle | Doğrudan sorgular: `time_entries` (`app/admin/page.tsx:106`, `:305`), `workers` (`:141`), `driver_reports` (`:222`), `shift_photos` (`:245`). Fonksiyonlar: `getDashboardData()` (`lib/admin-dashboard.ts:287` → `time_entries`, `workers`, `worker_leaves`:463, `vehicle_penalties`:441, `shift_packages`:751, `device_telemetry`:782 + `listVehiclesWithStatus`, `listFleetActiveDtc`, `listLatestVehiclePositions`), `listEditedEntryIds()` (`lib/shift-edit-log.ts:93` → `shift_edit_log`), `getFleetScope`, `getTestScope`, `getDriverScope` | Server (`force-dynamic`, `:31`); istemci gövde `AdminClient` (`app/admin/AdminClient.tsx:1` `"use client"`, 1293 satır). Kapı: `requireFleetView()` (`:84`) — patron + filo şefi | Sayfa kapısı yok. İçerik koşullu: `PACKAGES_ENABLED` (`AdminClient.tsx:99`), `LEAVES_ENABLED` (`lib/admin-dashboard.ts:459`, izinli roster durumu) |
| `app/admin/harita/page.tsx` | Canlı Takip: açık vardiyaların şoför konumları (araç GPS'inden türetilir), araç katmanı, Aktif Vardiya / En Uzun Aktif / tavan aşımı KPI'ları | `time_entries` (`:46`, açık vardiyalar), `workers` (`:69`), `listLatestVehiclePositions(fleetScope)` (`lib/telemetry.ts:629` → `vehicles` + araç başına `device_telemetry`), `dailyCapMs`/`touchesNightWindow` (`lib/azg-rules.ts`) | Server (`force-dynamic`, `:13`); istemci gövde `LiveTrackingClient` (`app/admin/harita/LiveTrackingClient.tsx:1`). Kapı: `requireFleetView()` (`:27`) | Yok |
| `app/admin/araclar/page.tsx` | Araç listesi: plaka, şoför, canlı durum, son sinyal, arıza bayrakları; kayıtlı görünümler (Tümü / Sinyalsiz / Arızalı / Şoförsüz + filo çipleri); araç ekle/düzenle formu | `listVehiclesWithStatus()` (`lib/vehicles.ts:136` → `vehicles`, `time_entries`), `workers` (`:36`, atanmış şoför seçicisi), `getFleetDtc()` (`lib/admin-dashboard.ts:918` → `vehicle_dtc` üzerinden `listFleetActiveDtc`), `listLatestVehiclePositions()` (`:49`) | Server (`force-dynamic`, `:11`); istemci gövde `AraclarClient` (`app/admin/araclar/AraclarClient.tsx:1`). Kapı: `requireAdmin()` (`:14`) | Sayfa kapısı yok. Filo çipleri `ACTIVE_FLEETS` ile koşullu (`AraclarClient.tsx:38`, `:120`) |
| `app/admin/araclar/[id]/page.tsx` | Araç künyesi + bugünün motor saati / mesafe / rölanti / geofence olayları, son telemetri, son 10 cihaz olayı, aktif DTC kodları (sözlükle zenginleştirilmiş), son 15 vardiya, ceza (Strafe) bölümü | `getVehicleDetail(id)` (`lib/vehicles.ts:233` → `vehicles`, `time_entries`, `vehicle_penalties`:325, `workers`:354), `latestVehicleTelemetry` / `listVehicleTrack` / `listVehicleEvents` / `listActiveDtc` (`lib/telemetry.ts` → `device_telemetry`, `vehicle_events`, `vehicle_dtc`), `getActiveGeofences()` (`app/actions/geofences.ts:46` → `geofences`), `computeEngineHours` / `computeDistanceKm` / `computeIdleTime` / `computeGeofenceEvents`, `lookupDtc` (`lib/dtc-codes`), `workers` (`:54`) | Server (`force-dynamic`, `:24`); istemci gövde `VehicleDetailClient` (`app/admin/araclar/[id]/VehicleDetailClient.tsx:1`) + `PenaltiesSection`. Kapı: `requireAdmin()` (`:31`). `params: Promise<{id}>` | Yok |
| `app/admin/araclar/[id]/rota/page.tsx` | Seçilen günün araç rotası (FMC003 cihaz izi) — `RouteReplay` oynatıcı | `vehicles` varlık kontrolü (`:24`), `getVehicleDeviceRoute(id, date)` (`lib/route-history.ts:143` → `vehicles` + `listVehicleTrack` → `device_telemetry`, ardından `buildMatchedGeometry` ile harita eşleme) | Server (`force-dynamic`, `:10`); istemci gövde `RouteReplay` (`components/RouteReplay.tsx:1`). Kapı: `requireAdmin()` (`:19`). `params: {id}` + `searchParams: {date}` (`:17`, `:31`) | Yok |
| `app/admin/workers/page.tsx` | Çalışan Yönetimi: kadro listesi — durum, atanmış plaka, son vardiya, bu ayki saat | `workers` (`:38`), `time_entries` ay başından beri, `fetchAllRows` ile sayfalı (`:42`), `vehicles` (`:55`, `assigned_worker_id` üzerinden plaka türetimi), `startOfMonthVienna`/`workedMs` (`lib/format`) | Server (`force-dynamic`, `:10`); istemci gövde `WorkersClient` (`app/admin/workers/WorkersClient.tsx:1`). Kapı: `requireAdmin()` (`:24`) | Yok |
| `app/admin/workers/[id]/page.tsx` | Personel dosyası: kimlik + kişisel/istihdam/ehliyet/acil durum alanları, aylık özet (vardiya, saat, km, kargo), son 200 vardiya geçmişi, PIN belirle / aktif-pasif / giriş kilidi kaldırma / kişiye özel PDF | `workers` (`:44`), `vehicles` (`:54`, atanmış plaka), `time_entries` ×2 (`:72` ay, `:77` son 200), `getLoginLockState(phone)` (`lib/login-lock.ts:111` → `login_attempts`), `licenseState`/`LICENSE_BADGE` (`lib/worker-ui`) | Server (`force-dynamic`, `:29`); istemci gövde `WorkerDetailClient` (`app/admin/workers/[id]/WorkerDetailClient.tsx:1`). Kapı: `requireAdmin()` (`:36`). `params: {id}` | Sayfa kapısı yok. Aylık özetteki "kargo" kutusu `PACKAGES_ENABLED` ile koşullu (`WorkerDetailClient.tsx:32`, `:133`) |
| `app/admin/alarmlar/page.tsx` | Alarmlar: iki sekme — Genel Bakış (tip kırılımı + dönem trendi) ve Alarm Kaydı (tek tek olaylar). Rölanti satırları epizod modelinden, süreli | `listEventsInRange` (`lib/telemetry.ts:170` → `vehicle_events`), `listIdleEpisodesInRange` (`lib/telemetry.ts:336` → `idle_episodes`), `listVehiclesWithStatus()` (şoför adı için), `getLatestConfigEpoch` (`lib/config-epoch.ts:37` → `device_config_epochs`), `eventTone` (`lib/event-ui`) | Server (`force-dynamic`, `:24`); istemci gövde `AlarmsClient` (`app/admin/alarmlar/AlarmsClient.tsx:1`). Kapı: `requireAdmin()` (`:109`). `searchParams: {range}` (`:107`) | Yok |
| `app/admin/bolgeler/page.tsx` | Bölgeler (geofence) listesi + oluştur/düzenle/sil; kural türü ve amaç (depo vb.) | `getGeofences()` (`app/actions/geofences.ts:39` → `geofences`, `:21`) | Server (`force-dynamic`, `:7`); istemci gövde `BolgelerClient` (`app/admin/bolgeler/BolgelerClient.tsx:1`). Kapı: `requireAdmin()` (`:10`) | Yok |
| `app/admin/izinler/page.tsx` | İzin Takvimi: seçilen ayın personel×gün ızgarası, izin girme/talep, onaylanan/reddedilen izin arşivi (en yeni 200) | `workers` ×2 (`:63` aktif kadro, `:87` `terminated_at` dolu ayrılanlar), `worker_leaves` ×2 (`:110` ayı kesenler, `:135` arşiv), `LEAVE_COLS`/`todayYmdVienna` (`lib/leaves.ts`), eksik onaylayan adları için ek `workers` sorgusu (`:188`) | Server (`force-dynamic`, `:16`); istemci gövde `LeaveCalendar` (`components/admin/LeaveCalendar.tsx:1`, 837 satır). Kapı: `requireFleetView()` (`:42`) — patron + filo şefi. `searchParams: {month}` (`:34`) | **EVET** — `LEAVES_ENABLED` (`:13`, `:37`): kapalıysa `redirect("/admin")`. Varsayılan `true` (`lib/tenant.ts:84`) |
| `app/admin/seferler/page.tsx` | Seferler: planlanan seferler ve durumları, sefer atama formu (şoför seçicisi) | `getAssignments()` (`app/actions/assignments.ts:295` → `assignments`:304 + `workers`:316, `fetchAllRows` ile sayfalı), `workers` (`:27`, aktif şoför seçicisi) | Server (`force-dynamic`, `:10`); istemci gövde `AdminAssignmentsClient` (`app/admin/seferler/AdminAssignmentsClient.tsx:1`) + `AssignmentForm`. Kapı: `requireAdmin()` (`:13`) | Yok |
| `app/admin/telegram/page.tsx` | Telegram: bağlı hesaplar listesi, yöneticinin kendi bağlantı durumu, webhook bilgisi | `workers` ×2 (`:17` `telegram_chat_id` dolu olanlar, `:33` kendi kaydı), `getWebhookInfo()` (`lib/telegram.ts`) | Server (`force-dynamic`, `:8`); istemci gövde `TelegramAdminClient` (`app/admin/telegram/TelegramAdminClient.tsx:1`). Kapı: `requireAdmin()` (`:11`) | Yok |
| `app/admin/analiz/page.tsx` | Analiz: Olay Tipine Göre Top-10 Personel, Şoför Güvenlik Skoru (önceki dönem trendiyle), Rölanti İsraf Panosu, Aylık Alarm Arşivi (tarih aralığından bağımsız, tüm geçmiş) | `listEventsInRange` / `listIdleEpisodesInRange` (`vehicle_events`, `idle_episodes`), `listVehiclesAndWorkers()` (`lib/analytics.ts:219` → `vehicles`:229, `workers`:238), `getVehicleDistanceSpan()` (`lib/analytics.ts:319` → `device_telemetry`, araç başına 2 sorgu), `computeTopDriversByType` / `computeSafetyScores` / `computeIdleWaste` / `computeMonthlyPivot` / `scoreMinKmForSpan` / `FLEET_EPOCH`, `getLatestConfigEpoch` (`device_config_epochs`) | Server (`force-dynamic`, `:26`); istemci gövde `AnalizClient` (`app/admin/analiz/AnalizClient.tsx:1`). Kapı: `requireAdmin()` (`:35`). `searchParams: {aralik, baslangic, bitis}` (`:33`) | Yok |

### Ortak layout ve navigasyon

- **`app/admin/layout.tsx` YOK.** `app/` altındaki tek layout'lar `app/layout.tsx` (kök) ve `app/panel/layout.tsx`. Yetki bu yüzden **her sayfada tek tek** kontrol edilir: her server component'in ilk satırlarından biri `requireAdmin()` ya da `requireFleetView()` çağırır. Dağılım (`app/admin/**/page.tsx`): 3 sayfa `requireFleetView()` — `app/admin/page.tsx:84`, `app/admin/harita/page.tsx:27`, `app/admin/izinler/page.tsx:42`; kalan 17 sayfa `requireAdmin()`. `requireAdmin` `is_admin` yoksa `/panel`'e yönlendirir (`lib/session.ts:46`); `requireFleetView` patronu kısıtsız, filo şefini kapsamla içeri alır, ikisi de değilse `/panel`'e atar (`lib/session.ts:67-78`).
- **Menü tek bileşende:** `components/dashboard/DashboardShell.tsx` (`"use client"`, `:1`). `navItems` üç moda ayrılır (`:121-163`): filo şefi (2-4 öğe), patron (tam menü), şoför (`/panel` menüsü). Her sayfa bu kabuğu kendisi sarar ve `user.isAdmin` / `managedFleet` prop'unu kendisi geçer.
- **Koşullu menü öğeleri** (`DashboardShell.tsx`): `FUEL_ENABLED` → Yakıt (`:147`), `EXPENSE_ENABLED` → Masraflar (`:148`), `LEAVES_ENABLED` → İzinler (`:152`, şefte `:128`), `DRIVER_PANEL_ENABLED` → şefin "Panelime dön" bağlantısı (`:133`). Üst çubuktaki yönetici↔şoför paneli geçişi üç koşulun birlikte sağlanmasını ister: `ADMIN_DRIVER_PANEL_LINK && DRIVER_PANEL_ENABLED && isAdminAccount` (`:119-120`). Komut paleti (⌘K) ve arama düğmeleri yalnız `user.isAdmin` iken render edilir (`:350`, `:369`, `:412`).

### Notlar

1. **Ağır sorgular — `/admin/analiz` en pahalısı.** `getVehicleDistanceSpan` araç **başına 2 `device_telemetry` sorgusu** açar (`lib/analytics.ts:324-345`) ve bu, `loadPeriod` içinde tüm araçlar için paralel koşar (`app/admin/analiz/page.tsx:60-62`); trend engellenmediyse **önceki dönem için ikinci kez** koşar (`:138`). Üstüne aylık pivot arşivi `FLEET_EPOCH`'tan bugüne tüm `vehicle_events` + `idle_episodes` kaydını çeker (`:103-108`). `listLatestVehiclePositions` de araç başına ayrı sorgu yapar (`lib/telemetry.ts:658-659`) ve `/admin/harita`, `/admin/araclar`, `/admin/page.tsx` (dashboard içinden) üçünde birden kullanılır. `/admin/page.tsx` ayrıca `shift_photos`'u UUID öbekleri hâlinde, her öbeği `fetchAllRows` ile sayfalayarak okur (`:240-251`).
2. **Sayfa içi sekmeler yalnız üç yerde var.** `/admin/harita`: yan panelde Şoförler (N) / Araçlar (N) (`LiveTrackingClient.tsx:179-187`). `/admin/alarmlar`: Genel Bakış / Alarm Kaydı (`AlarmsClient.tsx:172`, `:341-349`) — kritik bir alarma tıklamak sekmeyi otomatik "log"a çevirir (`:325`). `/admin/araclar`: sekme değil **kayıtlı görünüm** şeridi — Tümü / Sinyalsiz / Arızalı / Şoförsüz + aktif filo çipleri (`AraclarClient.tsx:108-125`, `:206`). Diğer sayfalar tek akış; `/admin` ve `/admin/analiz` sekme yerine aralık seçici kullanır.
3. **`[id]` ve `searchParams` parametreleri.** Dinamik segment üç sayfada: `araclar/[id]`, `araclar/[id]/rota`, `workers/[id]` — üçü de `params: Promise<{id}>` imzasıyla ve bulunamazsa `notFound()` ile. Sorgu parametreleri: `/admin` → `range|from|to|worker|status` (`page.tsx:73-79`), `/admin/alarmlar` → `range` (dört değer: `epoch|today|7d|30d`, `:31`, geçersizse varsayılana düşer `:117-125`), `/admin/analiz` → `aralik|baslangic|bitis` (`:33`, beş aralık anahtarı `:28`), `/admin/izinler` → `month` (`YYYY-MM` regex doğrulamalı, `:48`), `/admin/araclar/[id]/rota` → `date` (`:31`).
4. **Bayrakla kapatılan tek sayfa `/admin/izinler`.** Envanterdeki 13 sayfadan yalnız o `redirect("/admin")` ile korunuyor (`:37`). Karşılaştırma için envanter dışı iki sayfa aynı deseni kullanıyor: `app/admin/masraflar/page.tsx:11` (`EXPENSE_ENABLED`) ve `app/admin/yakit/page.tsx:13` (`FUEL_ENABLED && MAINTENANCE_ENABLED`). Diğerlerinde bayrak yalnız **içerik seviyesinde**: `PACKAGES_ENABLED` (`AdminClient.tsx`, `WorkerDetailClient.tsx`), `ACTIVE_FLEETS` (`AraclarClient.tsx`), `LEAVES_ENABLED` (`lib/admin-dashboard.ts:459`).
5. **Kapsam elemesi sayfadan sayfaya tutarsız — bilinçli ama eşitsiz.** `/admin`, `/admin/harita`, `/admin/izinler` üç elemeyi birden uygular (test + filo + şoför). `/admin/araclar`, `/admin/seferler`, `/admin/analiz` test + şoför uygular, filo kapsamı geçmez (`listVehiclesWithStatus()` ve `listLatestVehiclePositions()` argümansız çağrılıyor — `araclar/page.tsx:24`, `:49`). `/admin/workers/[id]` **hiçbir kapsam filtresi uygulamıyor**: `time_entries` sorguları yalnız `eq("worker_id", id)` ile bağlı (`:72-83`). `/admin/telegram` yalnız `withoutTestRows` kullanıyor (`:14`).
6. **`lib/session.ts:58`'deki yorum eskimiş.** "Bu kapı SADECE iki sayfada kullanılır. Diğer 17 yönetici sayfası…" yazıyor; `requireFleetView` bugün **üç** sayfada (izinler sonradan eklendi). Aynı eskime `app/admin/page.tsx:82-83`'te de var. Sayı tesadüfen tutuyor: `requireAdmin()` kullanan sayfa sayısı gerçekten 17, ama artık "diğer" değil.

---

## 2b) Ekran Envanteri — Yönetici (raporlar ve bayraklı modüller)

### Sayfa envanteri — raporlar ve bayraklı modüller

| Yol | Ne gösteriyor | Okuduğu tablo / lib | Server / Client | Bayrak durumu |
|---|---|---|---|---|
| `app/admin/raporlar/page.tsx` | Rapor merkezi: 3 kategoride 10 `ReportCard`. Araç: rota geçmişi→`/admin/araclar` (94), mesafe(araç)→`/admin/araclar` (104), filo mesafe→`/admin/raporlar/mesafe` (114), hız→`/admin/raporlar/hiz` (123), yakıt→`/admin/raporlar/yakit` (132), rölanti→`/admin/analiz` (142), olaylar→`/admin/alarmlar` (151). Şoför: performans→`/admin/raporlar/performans` (166), vardiya→`/admin` (176). Analiz: →`/admin/analiz` (192). Her kartın altında sunucuda sayılan veri hacmi | `vehicle_events` (`:59`), `idle_episodes` (`:60`), `time_entries` (`:62`), `vehicles` (`:68`, yalnız `flespi_device_id`/`imei` dolu olanlar) — hepsi `count:"exact", head:true`; `requireAdmin` (`lib/session.ts:42`), `getTestScope`/`withoutTestRows` (`lib/test-data`), `supabaseAdmin` | Server (`async`, `dynamic="force-dynamic"` `:20`); kart bileşeni `components/admin/ReportCard.tsx` de sunucu (dosyada `"use client"` yok) | **Bayrak okumuyor.** Hiçbir `*_ENABLED` import'u yok — yakıt kartı `FUEL_ENABLED=false` iken de görünür (o kart telemetri raporuna gider, fiş modülüne değil) |
| `app/admin/raporlar/yakit/page.tsx` | Telemetriden yakıt raporu: araç başına ort./min./maks. %, tüketim (L veya %), L/100 km, dolum sayısı+litre, şüpheli düşüş, arızalı sensör rozeti; filo toplamları | `buildFuelReport` (`lib/reports.ts:620`) → `vehicles` (`:629`), `workers` (`:641`), RPC `report_fuel_stats` (`:687`), RPC `report_fuel_volume_stats` (`:703`), `device_telemetry` %0 sayımı (`:750`); mesafe/pencere `getVehicleDistanceSpan` + `getVehicleFuelSpan` (`lib/analytics.ts:324`, `:373` — ikisi de `device_telemetry`); aralık `computeAnalyticsRange` (`lib/analytics`); eşikler `lib/metric-thresholds.ts:91,103,126` | Server (`:14`, `dynamic` `:10`); gövde `FuelClient` = `"use client"` (`FuelClient.tsx:1`) | **Bayrak yok.** `FUEL_ENABLED` bu sayfada okunmuyor — modül kapalıyken de erişilebilir |
| `app/admin/raporlar/hiz/page.tsx` | Araç ekseninde aşırı hız: ihlal sayısı, olayın bildirdiği maks. hız, aralıktaki km, 100 km başına ihlal (payda `SPEED_MIN_KM` altındaysa sebep yazılır). Üstte cihaz-konfig epoch uyarısı | `buildSpeedReport` (`lib/reports.ts:181`) → `loadBase` (`:130`): `listVehiclesAndWorkers` (`lib/analytics.ts:229` `vehicles`, `:238` `workers`), `listEventsInRange` (`lib/telemetry.ts:290` → `vehicle_events` + `vehicles`), `listIdleEpisodesInRange` (`lib/telemetry.ts:496` → `idle_episodes` + `vehicles`), `getVehicleDistanceSpan` (`device_telemetry`); ayrıca `getLatestConfigEpoch` (`lib/config-epoch.ts:34` → `device_config_epochs`) | Server (`:16`); `SpeedClient` ve `EpochWarning` `"use client"` | Bayrak yok |
| `app/admin/raporlar/mesafe/page.tsx` | Filo mesafesi: araç başına km (odometre uç-noktaları + km-guard), günlük ortalama km, ölçülebilen araç sayısı; CSV dışa aktarma | `buildDistanceReport` (`lib/reports.ts:239`) → aynı `loadBase` (`vehicles`, `workers`, `vehicle_events`, `idle_episodes`, `device_telemetry`) | Server (`:14`); `DistanceClient` `"use client"` (CSV `document.createElement("a")` ile tarayıcıda) | Bayrak yok |
| `app/admin/raporlar/performans/page.tsx` | Şoför ekseninde: vardiya sayısı, çalışılan süre, km, teslim/teslim edilemeyen, güvenlik skoru, olay kırılımı (sert fren / ani hızlanma / aşırı hız); PDF dışa aktarma | `buildPerformanceReport` (`lib/reports.ts:273`) → `loadBase` + `time_entries` (`:294`, `fetchAllRows` ile sayfalı, `withoutTestRows` + `onlyDrivers`/`getDriverScope`), `computeSafetyScores` + `scoreMinKmForSpan` (`lib/analytics`) | Server (`:14`); `PerformanceClient` `"use client"` | Doğrudan modül bayrağı yok; **`SAFETY_SCORE_CALIBRATED`** (`lib/tenant.ts:187`, `lib/metric-thresholds.ts:57` üzerinden) PDF'e skorun basılıp basılmayacağını belirler (`PerformanceClient.tsx:48`) |
| `app/admin/yakit/page.tsx` | Yakıt **fişi** modülü + bakım modülü tek sayfada: şoför fişlerinin onay/ret listesi (`FuelAdminClient`), bakım kayıtları ve yaklaşan bakımlar (`MaintenanceAdminClient`), aylık CO2 PDF butonu | `getFuelEntries` (`app/actions/fuel.ts` → `fuel_entries`, `workers`), `getMaintenance`/`getDueMaintenance` (`app/actions/maintenance.ts` → `vehicle_maintenance`, `fuel_entries`, `workers`) | Server (`:12`); iki alt bileşen `"use client"` | **`FUEL_ENABLED` + `MAINTENANCE_ENABLED`** (`:8`). İkisi de kapalıysa `redirect("/admin")` (`:13`); yalnız biri açıksa sayfa açılır, kapalı olanın bloğu render edilmez (`:38`, `:39`) ve sorgusu hiç çalışmaz (`:16-18`). **İkisi de bugün varsayılanda kapalı → sayfa fiilen erişilemez** |
| `app/admin/masraflar/page.tsx` | Masraf modülü: şoför masraf kayıtlarının onay/ret listesi, fiş görselleri, toplam kartları | `getExpenseEntries` (`app/actions/expenses.ts` → `expense_entries`, `workers`) | Server (`:10`); `ExpenseAdminClient` `"use client"` | **`EXPENSE_ENABLED`** (`:6`). Kapalıysa `redirect("/admin")` (`:11`). **Varsayılanda kapalı → sayfa fiilen erişilemez** |

Yetki: yedi sayfanın yedisi de `requireAdmin()` ile korunuyor (`lib/session.ts:42-48`) — filo şefi giremez, `is_admin` olmayan `/panel`'e atılır.

### Modül bayrakları

`lib/features.ts` artık **yalnız yeniden dışa aktarım katmanıdır** — 21 satır, içinde tek bir değer yok. Bayrakların tanımı `lib/tenant.ts`'te (`lib/features.ts:2-20`).

| Bayrak | Tanım | Env değişkeni | Varsayılan | Bugünkü değer |
|---|---|---|---|---|
| `FUEL_ENABLED` | `lib/tenant.ts:72` | `NEXT_PUBLIC_FUEL_ENABLED` | `false` | **KAPALI** |
| `EXPENSE_ENABLED` | `lib/tenant.ts:74` | `NEXT_PUBLIC_EXPENSE_ENABLED` | `false` | **KAPALI** |
| `MAINTENANCE_ENABLED` | `lib/tenant.ts:76` | `NEXT_PUBLIC_MAINTENANCE_ENABLED` | `false` | **KAPALI** |
| `LEAVES_ENABLED` | `lib/tenant.ts:84` | `NEXT_PUBLIC_LEAVES_ENABLED` | `true` | **AÇIK** (⚠️ migration 031 gerektirir, `lib/tenant.ts:81-83`) |

"Bugünkü değer" sütununun dayanağı: repoda bu dört değişkene değer atayan hiçbir satır yok — `.env.local` ve `.env.sendigo` bunları içermiyor, `.env.example`'da satırlar boş ve varsayılanları `# [false]/[true]` diye belgeliyor. Dolayısıyla kod varsayılanı geçerlidir. **Uzak Vercel projelerinde (HAK61 / Sendigo / Galzura) bu env'lerin tanımlı olup olmadığı repodan doğrulanamaz — BILINMIYOR.**

İki muhafız betiği varsayılanları kilitliyor: `scripts/check-tenant-defaults.mjs:60-63` (env YOKKEN beklenen değerler) ve `scripts/check-demo-env.mjs:110-113` (Galzura demosunda da bu dördünün kaymaması denetleniyor).

Kapsam dışı ama aynı dosyadaki diğer kurulum ayarları: `DRIVER_PANEL_ENABLED` (`:100`), `ADMIN_DRIVER_PANEL_LINK` (`:122`), `DRIVER_VEHICLE_CHOICE` (`:146`), `PACKAGES_ENABLED` (`:161`), `LENKZEIT_WARNING_ENABLED` (`:174`), `SAFETY_SCORE_CALIBRATED` (`:187`), `ACTIVE_FLEETS` (`:217`), `SHIFT_START_TRIGGER` (`:261`), `SHIFT_AUTO_END` (`:278`), `FLEET_EPOCH_ISO` (`:311`).

### Kapalı bayrak sayfayı gizliyor mu?

**`notFound()` HİÇBİR YERDE bayrak için çağrılmıyor.** Uygulamadaki üç `notFound()` çağrısının üçü de "kayıt bulunamadı" içindir: `app/admin/araclar/[id]/page.tsx:62`, `app/admin/araclar/[id]/rota/page.tsx:29`, `app/admin/workers/[id]/page.tsx:48`. Bayraklar iki katmanda çalışır:

1. **Menüden kaldırma** — `components/dashboard/DashboardShell.tsx`: `/admin/yakit` yalnız `FUEL_ENABLED` ile (`:147`), `/admin/masraflar` yalnız `EXPENSE_ENABLED` ile (`:148-150`), `/admin/izinler` `LEAVES_ENABLED` ile (`:152-154`) diziye giriyor. Şoför menüsünde de aynısı (`:159-162`). **`MAINTENANCE_ENABLED`'ın menü öğesi hiç yok** — bakım tek başına açılırsa sayfaya menüden ulaşılamaz, yalnız URL'den girilir.
2. **Sunucu tarafında `redirect()`** — sayfa render edilmeden `/admin`'e (yöneticide) ya da `/panel`'e (şoförde) atılır: `app/admin/yakit/page.tsx:13`, `app/admin/masraflar/page.tsx:11`, `app/admin/izinler/page.tsx:37`, `app/panel/yakit/page.tsx:12`, `app/panel/masraflar/page.tsx:11`. Yani URL'den de girilemez; sonuç 404 değil, yönlendirmedir.
3. **İzinde ayrıca yazma kapısı** — `app/actions/leaves.ts:86, 221, 252, 283` her server action'ın başında `if (!LEAVES_ENABLED) return { ok:false, error:"disabled" }`. Yakıt/masraf/bakım action'larında böyle bir bayrak kontrolü **yok** (`app/actions/fuel.ts`, `expenses.ts`, `maintenance.ts` içinde `*_ENABLED` geçmiyor) — korumaları yalnız sayfa yönlendirmesi ve menüdür.

`/admin/raporlar` altındaki **beş rapor sayfasının hiçbiri bayrak okumaz**; modül bayrakları kapalıyken de tam çalışır. `/admin/raporlar/yakit` ile `/admin/yakit` bilinçli olarak ayrı yüzeylerdir: ilki telemetri (`device_telemetry` + RPC), ikincisi şoför fişi (`fuel_entries`).

### PDF üretimi

**PDF tamamen TARAYICIDA üretiliyor.** `components/pdf/` altındaki beş bileşenin beşi de `"use client"` ile başlar ve `@react-pdf/renderer`'ın `pdf(<Doc/>).toBlob()` çağrısıyla blob üretip `<a download>` ile indirir — hiçbir sunucu route'u PDF döndürmez.

| Dosya | Belge | `toBlob` | Nereden çağrılır |
|---|---|---|---|
| `components/pdf/ShiftReport.tsx` | Schichtbericht (vardiya/AZG kaydı) | `:261` | `app/admin/AdminClient.tsx:385`, `app/admin/workers/[id]/WorkerDetailClient.tsx:108` (dinamik `import()`) |
| `components/pdf/AZGReport.tsx` | AZG ihlal raporu | `:297` | `app/admin/AdminClient.tsx:250` |
| `components/pdf/CO2Report.tsx` | Aylık CO2 raporu | `:170` | `app/admin/yakit/FuelAdminClient.tsx:45` (yani `FUEL_ENABLED` kapalıyken erişilemez) |
| `components/pdf/FuelReport.tsx` | Kraftstoffbericht | `:195` | `app/admin/raporlar/yakit/FuelClient.tsx:112` |
| `components/pdf/PerformanceReport.tsx` | Fahrerleistungsbericht | `:193` | `app/admin/raporlar/performans/PerformanceClient.tsx:41-43` |

**`lib/report-de.ts`** (228 satır): PDF metinlerinin sabit-Almanca sözlüğü ve firma künyesinin **tek kaynağı**. Belge Avusturya resmî evrakı sayıldığı için dili arayüz diline bağlı değildir (`:1-13`). İçeriği: `REPORT_LOCALE="de"` (`:24`), `COMPANY.name`/`COMPANY.address` (`:70-81`), `COMPANY_UID_LINE` (`:95`), `COMPANY_EXTRA_LINE` (`:105`), `BRAND_MARK` (`:117`), dosya adı önekleri `FILE_PREFIX_UPPER`/`FILE_PREFIX_LOWER` (`:138`, `:140`), `SHIFT_REPORT_DE` başlık sözlüğü (`:142-171`), `reportPeriodDe()` (`:177`), `buildShiftReportRow()` (`:208`). Her değer `pickCompany()` ile **`NEXT_PUBLIC_*` → öneksiz → HAK61 varsayılanı** sırasıyla okunur; `NEXT_PUBLIC_` zorunluluğunun sebebi dosyada yazılı: PDF istemcide üretildiği için öneksiz env tarayıcıda `undefined` kalıyor ve Sendigo'nun belgesine HAK61'in UID'si basılıyordu (`:36-55`). Varsayılanlar: `"HAK61 GmbH"`, `"Josef-Ganahl-Straße 4, 6850 Dornbirn, Österreich"`, `"UID-Nr.: ATU79519228"`, `BRAND_MARK="HAK"`.

**`lib/pdf-font.ts`** (29 satır, `"use client"`): `@react-pdf/renderer`'ın `Font.register` çağrısıyla Geist Regular'ı (`/fonts/Geist-Regular.ttf`) kaydeder; gömülü Helvetica Türkçe (ş ğ ı İ ç ö ü) ve Almanca (ä ö ü ß) glifleri taşımadığı için. Tek ağırlık gömülüdür, `fontWeight:700` aynı dosyaya eşlenir (`:20-26`); ayrıca `registerHyphenationCallback` ile kelime bölme kapatılır (`:28`). `registered` bayrağıyla tek sefer çalışır (`:15-19`) ve beş PDF bileşeninin her biri modül seviyesinde `registerPdfFont()` çağırır.

Modül bayrağı ile PDF ilişkisi iki yerde: `ShiftReport.tsx:15` `PACKAGES_ENABLED`'ı okuyup paket kolonlarını kaldırır; `PerformanceClient.tsx:48` `SAFETY_SCORE_CALIBRATED` kapalıysa güvenlik skorunu kâğıda hiç basmaz.

---

## 2c) Ekran Envanteri — Şoför paneli ve API rotaları

### Ekran envanteri — giriş, PIN, şoför paneli, manifest

| Yol | Ne gösteriyor | Okuduğu tablo / fonksiyon | Server/Client | Bayrak |
|---|---|---|---|---|
| `app/page.tsx` | Giriş ekranı: marka logosu, telefon + PIN formu, dil/tema düğmesi, çift radyal ışık yıkaması | `getSession()` (`lib/session.ts:30`, iron-session çerezi). Sayfanın kendisi DB okumaz. Form gönderimi `loginAction` → `login_attempts` (`app/actions/auth.ts:136`, `:117`), `workers` (`:157`) | Sayfa **server** (`app/page.tsx:38`, `dynamic="force-dynamic"` `:11`); `LoginShell` server fonksiyonu (`:13`); `LoginForm` **client** (`app/LoginForm.tsx:1`) | `DRIVER_PANEL_ENABLED` (`app/page.tsx:9`, yönlendirme `:43`) |
| `app/pin/page.tsx` | Zorunlu PIN değiştirme ekranı — giriş ekranıyla aynı kabuk, DashboardShell YOK (şoför henüz "içeride" değil, `:11-12`) | `requirePinChange()` (`lib/session.ts:146`). Form → `changePinAction` (`app/actions/auth.ts:220`) → `workers.pin_hash`, `must_change_pin` (`:238-253`) | Sayfa **server** (`:33`); `ChangePinForm` **client** (`app/pin/ChangePinForm.tsx:6`) | — (yönlendirme hedefinde `DRIVER_PANEL_ENABLED`, `app/actions/auth.ts:259`) |
| `app/panel/layout.tsx` | Görsel iş: `.driver-surface contents` sarmalayıcı — bu ağacın altındaki cam yüzeylerden `backdrop-filter`'ı kaldırır (`:28`). Ayrıca `/panel` ağacının **tek kapısı** | DB okumaz | **Server** (`"use client"` yok) | `DRIVER_PANEL_ENABLED` → kapalıysa `redirect("/admin")` (`:27`) |
| `app/panel/page.tsx` | Şoför panelinin veri toplayıcısı; kendisi ekran çizmez, `DashboardShell` + `PanelClient`e prop taşır | `requireWorker()` (`:14`), `getManagedFleet()` (`:17`), **time_entries** son 30 gün (`:22-27`), **workers**.telegram_chat_id/username (`:46-50`), **vehicles** atanmış araç (`:61-68`), `getDepotPanel()` (`:95-98` → `lib/depot.ts:209`), `needsSummarySignature()` (`:42-44` → `lib/shift-summary.ts:59`), `startOfTodayVienna/startOfWeekVienna` (`:82-83`) | **Server** (`:13`, `dynamic="force-dynamic"` `:11`) | Alt bileşenlerde `PACKAGES_ENABLED`, `LENKZEIT_WARNING_ENABLED`, `DRIVER_VEHICLE_CHOICE` |
| `app/panel/gecmis/page.tsx` | Şoförün kendi vardiya geçmişi: tarih aralığı filtresi + 25'erli sayfalama tablosu | `requireWorker()`, **time_entries** `count:"exact"` + `range()` (`:27-41`), `PAGE_SIZE=25` (`:12`) | Sayfa **server** (`:14`); `HistoryClient` **client** (`app/panel/gecmis/HistoryClient.tsx:1`) | — |
| `app/panel/seferler/page.tsx` | Şoförün kendi seferleri — aylık takvim ızgarası, gün seçimi, durum rozetleri | `requireWorker()`, `getAssignments({mine:true})` (`app/actions/assignments.ts:295`) → **assignments** + **workers** (`:302-318`) | Sayfa **server** (`:8`); `CalendarClient` **client** (`app/panel/seferler/CalendarClient.tsx:1`) | Sayfa düzeyinde bayrak YOK; panelde linki kaldırılmış (`app/panel/PanelClient.tsx:956-957`), rota duruyor |
| `app/panel/masraflar/page.tsx` | Şoförün masraf girişi + kendi masraf listesi (kategori, fiş fotoğrafı, onay rozeti) | `getExpenseEntries({mine:true})` (`app/actions/expenses.ts:184`) → **expense_entries** + **workers**; yazma `createExpenseEntry`, `getExpenseReceiptUrl` (`ExpenseDriverClient.tsx:26`) | Sayfa **server** (`:10`); `ExpenseDriverClient` **client** (`:1`) | `EXPENSE_ENABLED` → kapalıysa `redirect("/panel")` (`:11`); varsayılan **false** (`lib/tenant.ts:74`) |
| `app/panel/yakit/page.tsx` | Şoförün yakıt fişi girişi + kendi yakıt listesi | `getFuelEntries({mine:true})` (`app/actions/fuel.ts:199`) → **fuel_entries** + **workers**; ayrıca **time_entries**.plate'ten plaka listesi (`:16-26`); yazma `createFuelEntry`, `getFuelReceiptUrl` | Sayfa **server** (`:11`); `FuelDriverClient` **client** (`:1`) | `FUEL_ENABLED` → kapalıysa `redirect("/panel")` (`:12`); varsayılan **false** (`lib/tenant.ts:72`) |
| `app/manifest.json/route.ts` | PWA manifest'i (ad, ikonlar, `display:standalone`, `orientation:portrait`, `start_url:"/"`) | Yalnız `BRAND` (`lib/brand.ts`); DB okumaz | **Server route**, `GET`, `dynamic="force-static"` (`:19`), kimlik doğrulama yok | — |

Üst çubuk menüsü şoförde üç kalemle sınırlı: `/panel`, (bayrak açıksa) `/panel/yakit`, `/panel/masraflar` — `components/dashboard/DashboardShell.tsx:157-163`. `/panel/gecmis` ve `/panel/seferler` menüde YOK; geçmişe `PanelClient.tsx:963-968`'deki alt bağlantıdan gidiliyor.

---

### `app/panel/page.tsx` + `PanelClient.tsx` — şoför panelinin tam davranışı

Panel hiçbir REST uç noktası çağırmaz; tüm yazma yolları **server action**'dır.

#### Ekran seçim sırası (`PanelClient.tsx:536-545`, `589-954`)

1. **İmzasız özet katmanı** — `showSummary = pendingSummary && !summaryLater && !active` (`:540`). Sunucu da aynı kararı iki kez verir: açık vardiya varken `pendingSummary` null döner (`app/panel/page.tsx:41-44`).
2. **Onay katmanı** — `showConfirm = !showSummary && active && active.confirmation_status === "pending" && !confirmLater` (`:541-545`).
3. **Aktif vardiya ekranı** — sayaç + paket + mola/bitir (`:589-735`).
4. **`shiftDoneToday`** — bugün vardiya kapanmış: "gün tamamlandı" kartı + ikincil "yeniden aç" butonu (`:736-777`).
5. **Bekleme ekranı** — kontak beklemesi / manuel başlat / serbest araç seçimi (`:778-954`).

#### Arka plan zamanlayıcıları

- `router.refresh()` her **30 sn** (`:129-132`) — sunucuda oluşan vardiya/özet ekrana kendiliğinden düşsün.
- `pingPanelAction()` mount'ta + her **5 dk** (`:137-141`) → `workers.panel_seen_at` (`app/actions/depot.ts:14-25`, hata yutulur).
- Aktif vardiyada `setNow(Date.now())` her **1 sn** (`:174-178`).

#### Vardiya BAŞLATMA

İstemci `handleManualStart(overrideVehicleId?)` (`:475-505`):
1. `navigator.onLine === false` → `toast.error(t("v2StartOffline"))` ve **çıkar**. Başlatma çevrimdışı kuyruğa **girmez** (`:476-479`) — başlangıç km'sini sunucu telemetriden çözüyor.
2. `startShiftManualAction(overrideVehicleId)` `startTransition` içinde, `try/catch` ile (`:481-492`); ağ hatasında `v2StartNetworkErr` + `router.refresh()`.
3. `ok` → `reopened ? v2ReopenedToast : shiftStarted` + refresh (`:493-497`).
4. `error === "active"` → refresh (kontak cron'u aynı anda açmış olabilir, `:502`).

Sunucu `startShiftManualAction` (`app/actions/shift.ts:102-346`), sırayla:
1. `requireWorker()` (`:112`).
2. `workers.is_active` DB kontrolü → `inactive_worker` (`:118-123`). Çerez 30 gün yaşadığı için `requireWorker` bunu kapsamıyor.
3. **Araç çözümü**: override verilmişse `vehicles` by id — `is_test` ise `no_vehicle`, `status !== "active"` ise `vehicle_unavailable` (`:127-143`); verilmemişse `assigned_worker_id` ile atanmış araç (`:144-162`).
4. **Açık vardiya guard'ı** → `active` (`:166-172`). DB'de `uq_time_entries_one_open` son sözü söyler.
5. **Araç meşgul guard'ı KALDIRILDI** (`:174-182`) — aynı araçta ikinci açık vardiya engellenmiyor, yalnız seçicide uyarı çıkıyor.
6. **Günde tek vardiya** (`:197-250`): `hasShiftToday()` (`lib/shift-day.ts:29`) true ise **yeni satır yazılmaz**, o günün son kapanmış satırı YENİDEN AÇILIR: `ended_at/end_km/end_reason/auto_ended/summary_notified_at/summary_confirmed_at/summary_confirmed_by/still_active_asked_at/undelivered_count` temizlenir, `vehicle_id`+`plate` yeniden yazılır (`:217-236`). `break_minutes` ve `start_km` korunur. Dönüş `{ok:true, reopened:true}`.
7. **Depo kapısı** yalnız yeni vardiyada: `evaluateDepotGate()` (`lib/depot.ts:183`) → `blocked` ise `outside_depot` (`:257-258`).
8. `resolveStartKm()` — odometre → aracın son biten vardiyası → 0 (`:262-263`).
9. `resolveShiftStartAt()` (`lib/depot.ts:460`) — başlangıç anı "şimdi" DEĞİL: bugünkü depo girişi → son 14 günün ortalama geliş saati → now (`:271-273`). `confirmed_at` ayrı ve gerçekten "şimdi".
10. `time_entries` insert: `auto_started=false`, `confirmation_status="confirmed"`, `confirmed_at` (`:274-288`). `23505` → `active` (`:292-294`).
11. `location_unverified` / `start_time_estimated` bayrakları best-effort (`:309-334`).
12. `notifyAdminsShiftStarted()` — test şoförü elenir, `workers` `is_admin=true` + `telegram_chat_id` dolu olanlara Telegram (`:55-85`).
13. `revalidatePath("/panel")`, `revalidatePath("/admin")`.

**Kusur (gözlem):** `outside_depot` kodu istemcinin `mapErr` haritasında YOK (`PanelClient.tsx:443-465`); o dal `return e` ile ham kodu tost olarak basar.

Araç seçici: `openVehiclePicker()` (`:508-521`) → `listPickableVehiclesAction()` (`app/actions/driver-panel.ts:431`) → `listVehiclesForDriverPick()` (`lib/vehicles.ts:62-117`): `vehicles` `status="active"` + `isFleetVisible` + test satırları düşürülür; `time_entries` açık vardiyalardan "kim kullanıyor" türetilir. `pickVehicle()` (`:527-534`): `inUseBy.length > 0` ise önce onay dialogu, **engel değil**.

Serbest seçim kiracısı: `DRIVER_VEHICLE_CHOICE === "free"` (`:212`) — atanmış araç yokken "Araç seç ve başlat" bloğu (`:918-951`).

Depo kilidi: `depotPanel.locked` iken buton opaklaşır ve basınca `toast.warning(v2DepotLocked)` (`:865-884`); sunucu kapısı fail-closed (yukarıda madde 7).

#### MOLA

- `toggleBreak()` (`:307-310`).
- `startBreak()` (`:248-253`): `breakTargetLocal = breakTargetMin(workedMsLive)` — hedef **molanın başladığı anda sabitlenir** (6 sa üstü 30 dk, 9 sa üstü 45 dk; `lib/break-rules.ts:17-24` → `lib/azg-rules.ts`). Ardından `void startBreakAction()` (fire-and-forget, hatası yutulur) → `time_entries.break_started_at` yalnız `IS NULL` iken yazılır (`app/actions/shift.ts:760-771`).
- `endBreak(auto)` (`:262-305`): geçen dakika hesaplanır, **0 dakika dahil her hâlükârda** sunucuya gidilir; `tryServerAction("break", {minutes}, ISO, () => addBreakMinutesAction(elapsedMin))`. Kuyruğa düşerse `queued_toast` + yerel sayaç sıfırlanır.
- `addBreakMinutesAction` (`app/actions/shift.ts:778-814`): `break_minutes += add`, sonra `break_started_at=null` (best-effort).
- Otomatik bitiş: `setTimeout` hedefe kalan süre kadar kurulur, `endBreakRef` üzerinden çağrılır (`:316-333`).
- Moladayken sayaç yer değiştirir: mola süresi 00:00:00'dan büyük punto, vardiya süresi küçülüp alta geçer (`:599-615`).

#### PAKET SAYACI

Tümü `PACKAGES_ENABLED` bayrağına bağlı (`:656`, `:676`, `:1058`, `:1089`).
- Gösterim: `packagesTaken = active?.start_package_count` (`:226`), dev buton `openPkg()` (`:336-339`).
- `savePkg()` (`:341-364`): boş → `null` (temizle), aksi hâlde `Math.floor(Number)`, negatif/`NaN` → `v2PkgErr`. **+1 sayaç yok, düz sayı girişi.**
- `updatePackageCountAction(count)` (`app/actions/shift.ts:828-855`): yalnız **açık** vardiya (`is("ended_at", null)`), `0..MAX_COUNT`, `start_package_count` + `updated_at/updated_by`; eşleşen satır yoksa `no_active`. **Çevrimdışı kuyruğa girmez** — doğrudan çağrılıyor.

#### VARDİYA BİTİRME (kapatma formu)

Sıra kesin: **önce uyarı, sonra form.**
1. "Vardiyayı Bitir" (`:725-733`) → `confirmEndOpen` (`:1218-1252`): "bugün tekrar vardiya açamazsınız" uyarısı. "Evet" → `returnMode = PACKAGES_ENABLED ? null : "none"`, `endUndel=""`, `confirmNeeded=false`, `endOpen=true` (`:1238-1246`).
2. **Adım 1 (yalnız paket açıkken)** — soru + iki dev buton: "hepsini teslim ettim" (`"none"`) / "geri getirdim" (`"some"`) (`:1015-1043`). Paket kapalıyken bu adım hiç yoktur, form doğrudan adım 2'ye açılır (`:164-166`).
3. **Adım 2 form** (`:1048-1210`), `action=` değil `onSubmit` — React 19 form-reset tuzağı yüzünden (`:1046-1047`):
   - gizli `break_minutes = totalBreakSoFar` (`:1055`)
   - gizli `undelivered_count` yalnız `PACKAGES_ENABLED` iken (`:1058-1064`); kapalıyken alan **hiç gönderilmez** → sunucu `null` yazar ("sayılmadı")
   - **KM alanı YOK** (`:1065`) — km cihazdan türetilir
   - `"some"` modunda sayı girişi: `autoFocus` yok, varsayılan boş (`:1067-1084`)
   - büyük hesap satırı: `alınan − geri = teslim edilen`; 0 ise bordoya döner (`:1089-1111`)
   - engel/teyit bantları `classifyUndelivered()` sonucundan (`lib/package-limits.ts:80`)
   - not alanı (`maxLength=500`, `:1177-1186`)
4. `submitEnd(formData)` (`:398-406`): `level==="block"` → sessiz `return`; `level==="confirm" && !confirmNeeded` → teyit adımını aç, gönderme; aksi hâlde `handleEnd`.
5. `handleEnd(formData)` (`:408-441`): süren mola yerelde kapatılır, payload `{notes, break_minutes, undelivered_count}`, `tryServerAction("end", payload, ISO, () => endShiftAction(formData))`. `queued` → uyarı tostu + dialog kapanır; `ok` → `shiftEnded` tostu + `summaryLater=false` (özet hemen çıksın) + refresh.

Sunucu `endShiftAction` (`app/actions/shift.ts:594-753`):
1. `requireWorker()` → `endShiftSchema.safeParse` (`:597-606`).
2. `PACKAGES_ENABLED && undelivered_count == null` → `undelivered_required` (`:615-621`). Kapalıyken `null` geçer.
3. Açık vardiyayı bul (`:623-635`) → yoksa `no_active`.
4. `endedIso = now`; **bitiş km'si cihazdan**: `latestVehicleTelemetry` + `resolveEndKm` (odometre → GPS mesafesi → `null`) (`:644-653`).
5. `checkUndelivered()` (`lib/package-limits.ts:34`) → `undelivered_over:x:y`, `undelivered_no_total`, `undelivered_max:2000`, `undelivered_invalid`.
6. `delivered = max(0, taken − undelivered)`; ikisi de bilinmiyorsa `cargo_count` **yazılmaz** (`:674-691`).
7. Update: `ended_at`, `end_km`, `notes`, `summary_notified_at`, `end_reason="manual"`, `undelivered_count` (+ koşullu `plate`, `break_minutes`, `cargo_count`); kolon yoksa legacy fallback (`:693-708`).
8. `confirmation_status: pending → unconfirmed` (best-effort, `:715-723`).
9. Şoföre Telegram vardiya özeti — km çözülemediyse `"—"` (`:726-748`).
10. `revalidatePath("/panel")`, `"/admin"`.

#### Onay ve imza katmanları

- `ConfirmShiftCard` (`app/panel/ConfirmShiftCard.tsx`): tam ekran `fixed inset-0 z-50`, tek dokunuş → `confirmShiftStartAction()` (`app/actions/driver-panel.ts:113-135`) → `confirmation_status="confirmed"` + `confirmed_at`; idempotent. "Daha sonra" yalnız oturum-yereldir.
- `ShiftSummaryCard` (`app/panel/ShiftSummaryCard.tsx`): süre / km / paket + haftalık alt satır. ONAYLA → `confirmShiftSummaryAction()` (`app/actions/driver-panel.ts:339-365`) — tek kayıt değil, **72 saatteki tüm imzasız kapalı vardiyaları tek update ile** imzalar (`summary_confirmed_at`, `summary_confirmed_by`). Hata sessizce "başarılı" sayılmaz (`:356-360`). km `null` ise kutu çizilmez, sebep yazılır (`:97-107`).
- İmza gerekliliği tek kaynak: `needsSummarySignature()` (`lib/shift-summary.ts:59`) — 72 sa penceresi, sistem kapanışları (`auto_ended`, `end_reason` `auto_idle`/`admin`) ve 25 dk'dan kısa vardiyalar imza istemez.

#### Panelde OLMAYAN ama repoda duran

`app/panel/ShiftPhotoButton.tsx` ve `app/panel/ProblemReportDialog.tsx` hiçbir yerden render EDİLMİYOR (grep: yalnız kendi tanımları + `PanelClient.tsx:672`'deki açıklama satırı). Ayarlar dialogunda yalnız `TelegramLink` var; başlangıç km düzeltme kaldırılmış (`:984-989`).

---

### API rotaları

| Rota | Metod | Kimlik doğrulama | Ne yapıyor |
|---|---|---|---|
| `app/api/cron/shift-watchdog/route.ts` | `GET` (`:148`) + `POST` (`:164`, GET'e devreder) | `CRON_SECRET`; `?secret=` **veya** `Authorization: Bearer <secret>`, `safeEqual` ile zaman-güvenli (`:36-47`). Yoksa 401 | 10 saatten (`ASK_AFTER_MS`, `:18`) uzun açık `time_entries` satırlarını tarar; son 1 saatte sorulmamışsa (`REASK_MS`) şoföre Telegram + inline `shift_yes:<id>`/`shift_no:<id>` düğmeleri (`:106-120`); Telegram'a bağlı olmayan şoför için yöneticilere alarm (`:121-136`); `still_active_asked_at` damgalanır (`:139-142`). Test satırları `getTestScope`/`withoutTestRows` ile elenir. `runtime="nodejs"`, `force-dynamic` |
| `app/api/flespi/ingest/route.ts` | Yalnız `POST` (`:55`) | `flespiAuthorized()` → `FLESPI_SYNC_SECRET`, `?secret=` veya `Bearer`, zaman-güvenli (`lib/flespi-auth.ts:11-19`). Yoksa 401 | flespi HTTP-Stream PUSH: düz noktalı-anahtar JSON dizisi; `ident` → `vehicles.imei` eşlemesi tek sorguda (`:90-107`); `normalize()` → `saveTelemetry` (`:145`); ayrıca `saveIdleEpisodes`, `saveVehicleEvents`, `saveDtc`, `maybeBackfillVin` — her biri kendi try/catch'inde; sonunda **yalnız bu batch'teki araçlar için** `processAutoShifts(touchedVehicleIds)` (`:200-202`). **Her hâlükârda 200** döner (tekrar-teslim döngüsünü önlemek için, `:206-222`); tek istisna `vehicles` sorgusunun geçici hatası → bilinçli 500 (`:99-107`) |
| `app/api/flespi/sync/route.ts` | `GET` (`:197`) + `POST` (`:212`, GET'e devreder) | Aynı `flespiAuthorized()` / `FLESPI_SYNC_SECRET` | REST-poll: `flespi_device_id` dolu tüm araçlar için `lastRecordedAt()`'ten (ilk seferde 1 saat geriye, `FIRST_WINDOW_MS` `:23`) `fetchDeviceMessages` → `saveTelemetry` + idle/events/DTC/VIN; `reconcileDtc` DTC bekçisi (`:142-151`); `reconcileIdleEpisodes()` (`:173`); sonunda **tam tarama** `processAutoShifts()` (`:185`). `vehicles` sorgusu hata verirse throw → 500 (`:48-53`) |
| `app/api/telegram/webhook/route.ts` | Yalnız `POST` (`:170`) | `TELEGRAM_WEBHOOK_SECRET`; tercihen `x-telegram-bot-api-secret-token` başlığı, geriye dönük `?secret=` sorgusu; `safeEqual` (`:176-182`). Yoksa 401 | İki iş: (a) watchdog düğmeleri — `shift_yes` → `still_active_asked_at` sıfırlanır; `shift_no` → vardiya kapatılır, bitiş anı **aracın son `device_telemetry.recorded_at`'i**, yoksa "şimdi" (`:117-153`), `end_reason="watchdog"`, `pending → unconfirmed`. Sahiplik iki kademeli doğrulanır: vardiya id'den, sahip `workers.id`den, `telegram_chat_id` eşleşmesi (`:74-99`) — kimse başkasının vardiyasını kapatamaz. (b) `/start <kod>` → `telegram_link_codes` doğrulanır, eski bağlar temizlenir, `workers.telegram_*` yazılır (`:219-268`); `/help` ve diğer metinler yardım mesajı. Hata olsa da **her zaman 200** (retry fırtınası önlemi) |

---

### Çevrimdışı destek

**`lib/offline-queue.ts`** — IndexedDB sarmalayıcısı (`"use client"`). DB `hak-offline`, store `pending_actions`, sürüm 1, `keyPath:"id"` + `autoIncrement` (`:3-5`, `:26`). Dışa verdiği: `enqueueAction`, `getPendingActions`, `removeAction`, `countPending`. Kuyruk tipleri: `"start" | "end" | "break" | "package" | "report"` (`:7`). IndexedDB yoksa sessizce no-op (`:16-18`).

**`lib/offline-aware.ts`** — iki fonksiyon:
- `tryServerAction(type, payload, clientTime, onlineFn)` (`:32-51`): `navigator.onLine === false` ise doğrudan kuyruğa yazar; çevrimiçiyse action'ı çağırır, **fırlatırsa** yine kuyruğa yazar. Her iki kuyruklama sonrası `registerBackgroundSync()` → service worker `sync` etiketi `"hak-flush"` (`:11-22`). Dönüş `{queued:true}` veya `{queued:false, result}`.
- `flushQueue()` (`:54-77`): bekleyenleri sırayla `processQueuedShift`e verir; `ok` ise siler, **kalıcı hata (`ok:false`) ise de siler** (kuyruğu tıkamasın, `:68-70`); transport hatasında döngüyü kırar, bir sonraki `online` olayında tekrar dener.

**`app/actions/offline.ts`** — `processQueuedShift(item)` server action'ı (`:50`), kuyruğun sunucu tarafındaki tek replay kapısı. `requireWorker()` ile kimlik; `resolveEventTime()` istemci saatini **doğrulanmış pencereye** sıkıştırır: 5 dk'dan fazla gelecek veya 48 saatten eski → sunucu saatine düşer (`:34-44`) — aksi hâlde şoför AZG raporunu ve bordro dışa aktarımını geriye/ileriye tarihleyebilirdi. Dallar:
- `"start"` → **artık no-op**, `{ok:true}` döner (`:55-62`). Çevrimdışı vardiya başlatma 21.07.2026'da kaldırıldı; eski cihazlarda kalmış kuyruk öğesi sessizce düşer.
- `"end"` → açık vardiyayı kapatır; km **cihazdan** (`latestVehicleTelemetry` + `resolveEndKm`, `:78-86`); `checkUndelivered` sınırı online kapanışla aynı (`:100-102`); `cargo_count = alınan − geri` (`:105-111`).
- `"break"` → `break_minutes` toplar **ve `break_started_at`'i temizler** (`:143-150`) — iki yolun ayrışması yöneticide "Molada" takılı kalmaya sebep oluyordu.
- `"package"` → açık vardiya, yoksa olay anını kapsayan vardiya; `shift_packages` insert + `recountShiftPackages` (`:152-197`).
- `"report"` → `reportProblemAction`ı sunucu tarafında yeniden çağırır (`:198-208`).

**Hangi ekranlarda kullanılıyor**
- `app/panel/PanelClient.tsx:286` → `tryServerAction("break", …)`
- `app/panel/PanelClient.tsx:421` → `tryServerAction("end", …)`
- `app/panel/ProblemReportDialog.tsx:51` → `tryServerAction("report", …)` — **ancak bu dialog hiçbir yerden render edilmiyor** (yukarıdaki "panelde olmayan" notu), yani fiilen ölü bir çağrı yeri.
- Vardiya **başlatma** ve **paket sayısı** kuyruğa girmez: ikisi de doğrudan action çağırır (`:483`, `:352`).

**Kuyruk göstergesi ve boşaltma** — `components/OfflineBadge.tsx`, `components/dashboard/DashboardShell.tsx:381`'de render edilir, yani hem yönetici hem şoför yüzeyinde görünür. `countPending()`i 5 sn'de bir yoklar (`:59`), `window online` olayında ve service worker'ın `hak-flush` mesajında `flushQueue()` çağırır (`:46-58`), yeniden giriş için `flushing` ref kilidi vardır (`:27-39`).

**Service worker** — `public/sw.js`: **hiç cache yok**, `fetch` dinleyicisi bilinçli boş (auth/RSC akışları bozulmasın, `:10-12`); tek işi `sync` etiketi `"hak-flush"` geldiğinde açık istemcilere `postMessage({type:"hak-flush"})` atmak (`:14-24`). Yani gerçek replay her zaman istemcide, oturum çerezi elindeyken olur.

**Kullanılmayan** — `hooks/useOnlineStatus.ts` (`:6`) repoda duruyor ama hiçbir dosya içe aktarmıyor (repo geneli grep: yalnız kendi tanımı).

---

### Mobil uygulama için doğrudan ilgili bayraklar (`lib/tenant.ts`)

| Bayrak | Env | Varsayılan | Panel etkisi |
|---|---|---|---|
| `DRIVER_PANEL_ENABLED` | `NEXT_PUBLIC_DRIVER_PANEL_ENABLED` | `true` (`:100`) | Kapalıysa `/panel` ağacının tamamı `/admin`'e yönlenir (`app/panel/layout.tsx:27`), şoför girişi reddedilir (`app/actions/auth.ts:185`) |
| `PACKAGES_ENABLED` | `NEXT_PUBLIC_PACKAGES_ENABLED` | `true` (`:161`) | Paket butonu, kapatma formunun 1. adımı ve `undelivered_count` alanı yok olur; sunucu da zorunluluğu kaldırır (`shift.ts:615`) |
| `DRIVER_VEHICLE_CHOICE` | `NEXT_PUBLIC_DRIVER_VEHICLE_CHOICE` | `"assigned"` (`:146`) | `"free"` → atanmış araç yokken "araç seç ve başlat" akışı (`PanelClient.tsx:918`) |
| `LENKZEIT_WARNING_ENABLED` | `NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED` | `true` (`:174`) | Aktif vardiyada `LenkzeitWarning` bileşeni (`PanelClient.tsx:559`) |
| `FUEL_ENABLED` / `EXPENSE_ENABLED` | `NEXT_PUBLIC_*` | ikisi de `false` (`:72`, `:74`) | `/panel/yakit`, `/panel/masraflar` sayfaları ve menü kalemleri |
| `SHIFT_START_TRIGGER` / `SHIFT_AUTO_END` | öneksiz (yalnız sunucu) | `"depot_entry"` / `"off"` (`:261`, `:278`) | Panelin gördüğü "otomatik başlar" cümlesinin ve otomatik kapanmanın gerçek karşılığı; `assertTenantConfig()` (`:321`) uyumsuz bileşimde fail-closed patlar |

---

## 2d) Server Action envanteri (mobil API yüzeyinin karşılığı)

### Kapsam ve yöntem

`app/actions/` altındaki 16 dosyanın tamamı okundu. Bir dosyadaki **her export edilen `async function`** bir server action ucudur (dosyaların ilk satırı `"use server"` — örn. `app/actions/preferences.ts:1`, `app/actions/azg-report.ts:1`), yani ağdan çağrılabilir. Export edilen `type`'lar action değildir, tabloya alınmadı.

Yetki kapıları `lib/session.ts`'te tanımlı:

| Kapı | Tanım | Davranış |
|---|---|---|
| `requireWorker()` | `lib/session.ts:35` | oturum yoksa `redirect("/")`, `must_change_pin` ise `redirect("/pin")` |
| `requireAdmin()` | `lib/session.ts:42` | yukarıdakiler + `!is_admin` ise `redirect("/panel")` |
| `requireFleetView()` | `lib/session.ts:67` | patron VEYA filo şefi; şefe `fleet` kapsamı döner |
| `requireManualStartAuth(targetWorkerId)` | `lib/session.ts:107` | patron kısıtsız, şef yalnız kendi filosu; **redirect etmez**, `{ok:false,error}` döner |
| `getSession()` | `lib/session.ts:30` | sadece çerezi okur, hiçbir zorlama yok |

🔴 **Mobil API için kritik:** `requireWorker`/`requireAdmin`/`requireFleetView` yetkisizlikte **401 dönmez, `redirect()` fırlatır** (Next.js `NEXT_REDIRECT` istisnası). Mobil istemci bu action'ları doğrudan çağırırsa yetkisizlik durumunda anlamlı bir hata gövdesi değil, bir yönlendirme cevabı görür. Mobil uç için bu kapıların `{ok:false,error:"unauthorized"}` dönen bir kardeşi gerekir — `requireManualStartAuth` bu deseni zaten kuruyor (`lib/session.ts:107-138`).

---

### app/actions/assignments.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| assignments.ts:109 | `createAssignment` | `data: AssignmentInput` (düz obje: worker_id, scheduled_at ISO, category, stops[], package_count?, notes?) | Sefer kaydı açar, şoföre Telegram bildirimi (yarış-güvenli, `:44`), geçmiş tarihi reddeder (`:119`) | `requireAdmin()` :112 | `Promise<AssignmentActionResult>` `{ok, id?, error?}` |
| assignments.ts:146 | `updateAssignment` | `id: string, data: AssignmentInput` | Mevcut seferi günceller (bildirim YOK) | `requireAdmin()` :150 | `Promise<AssignmentActionResult>` |
| assignments.ts:175 | `cancelAssignment` | `id: string, reason: string` | `status='cancelled'` + şoföre iptal Telegram'ı | `requireAdmin()` :179 | `Promise<AssignmentActionResult>` |
| assignments.ts:241 | `startAssignment` | `id: string` | Şoför kendi seferini başlatır; update `eq(worker_id)` + `eq(status,'assigned')` ile satır-düzeyi kapsam (`:253`) | `requireWorker()` :244 | `Promise<AssignmentActionResult>` (eşleşme yoksa `not_allowed`) |
| assignments.ts:265 | `completeAssignment` | `id: string` | Seferi tamamlar; aynı satır-düzeyi kapsam (`:279`) | `requireWorker()` :268 | `Promise<AssignmentActionResult>` |
| assignments.ts:295 | `getAssignments` | `opts?: { mine?: boolean }` | Sefer listesi; admin tümünü, şoför yalnız kendininkini (`:299`); `fetchAllRows` ile 1000 satır tavanı aşılır | `requireWorker()` :298 | `Promise<AssignmentWithWorker[]>` |

### app/actions/auth.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| auth.ts:120 | `loginAction` | `_prev: LoginState, formData: FormData` (phone, pin) | Telefon varyantlarıyla (`lib/phone.ts`) kayıt bulur, bcrypt karşılaştırır (bilinmeyen numarada da dummy hash ile — zamanlama sızıntısı kapalı `:46`), `login_attempts` kilidini uygular (`:136`), oturumu yazar, `DRIVER_PANEL_ENABLED` kapalıysa şoförü reddeder (`:185`) | **KAPI YOK — bilinçli** (giriş noktası) | `Promise<LoginState>`; başarıda `redirect("/pin"\|"/admin"\|"/panel")` fırlatır |
| auth.ts:206 | `logoutAction` | — | `session.destroy()` + `redirect("/")` | **KAPI YOK** (yıkıcı değil, yalnız kendi çerezini siler) | `Promise<void>` (redirect fırlatır) |
| auth.ts:220 | `changePinAction` | `_prev: ChangePinState, formData: FormData` (pin, pin_confirm) | Zorunlu PIN değişimi; eski PIN ile aynıysa reddeder (`:246`), bcrypt hash yazar, `must_change_pin=false` | **ZAYIF:** `getSession()` + `if (!session.worker_id) redirect("/")` :225 — `requireWorker()` bilerek KULLANILMIYOR (`must_change_pin` döngüsü olurdu, `:217` yorumu) | `Promise<ChangePinState>`; başarıda redirect |

### app/actions/azg-report.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| azg-report.ts:106 | `getAZGReportData` | `month: string` (`YYYY-MM`) | § 26 AZG resmî raporunu hesaplar: günlük/haftalık tavan, mola, 11 sa dinlenme, mikro-vardiya ayıklama; test + yönetici satırları elenir (`:142`), çıktı **zorla Almanca** (`:112`) | `requireAdmin()` :107 | `Promise<AZGResult>` = `{ok:true,data:AZGData}` \| `{ok:false,error}` |

### app/actions/depot.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| depot.ts:14 | `pingPanelAction` | — | `workers.panel_seen_at` damgalar (panel yoklaması) | **ZAYIF:** `getSession()` + `if (!session.worker_id) return` :17 — yönlendirme yok, tüm gövde `try/catch` ile sessiz | `Promise<void>` (hata bile sızmaz) |
| depot.ts:36 | `setDepotExemptionAction` | `workerId: string` | Bugün için depo şartı muafiyeti upsert eder | `requireAdmin()` :39 | `Promise<DepotExemptResult>` `{ok,error?}` |
| depot.ts:54 | `clearDepotExemptionAction` | `workerId: string` | Bugünkü muafiyeti siler | `requireAdmin()` :55 | `Promise<DepotExemptResult>` |

### app/actions/driver-panel.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| driver-panel.ts:113 | `confirmShiftStartAction` | — | Aktif vardiyayı `confirmed` işaretler; idempotent (`:118`). Aktif vardiya **sunucuda** çözülür, istemciden `time_entry_id` kabul edilmez (`:24` yorumu) | `requireWorker()` :114 | `Promise<DriverPanelResult>` `{ok,error?}` |
| driver-panel.ts:141 | `addPackageAction` | `input: { lat?, lng?, accuracy?, clientTime? }` (düz obje) | `shift_packages`'a GPS+zaman damgalı satır; `clampEventTime` ile istemci saati +5dk/−48sa penceresine kırpılır (`:55`) | `requireWorker()` :147 | `Promise<AddPackageResult>` `{ok,error?,packageId?,count?}` |
| driver-panel.ts:180 | `undoPackageAction` | `packageId: string` | Yanlış paketi siler; sahiplik `eq(worker_id)` + 10 dk sunucu penceresi (`:30`,`:193`) | `requireWorker()` :184 | `Promise<UndoPackageResult>` `{ok,error?,count?}` |
| driver-panel.ts:220 | `addShiftPhotoAction` | **`formData: FormData`** (photo: File, lat, lng, accuracy) | 📎 **DOSYA YÜKLEME** → `uploadReceipt("shift-photos", …)` (`lib/storage.ts:20`), sonra `shift_photos` satırı | `requireWorker()` :221 | `Promise<DriverPanelResult>` |
| driver-panel.ts:265 | `reportProblemAction` | `input: { type: DriverReportType, lat?, lng?, clientTime? }` | 4 hazır sorun tipinden biri; tip beyaz-listeye karşı denetlenir (`:273`); adminlere best-effort Telegram, test şoförü elenir (`:295`) | `requireWorker()` :271 | `Promise<DriverPanelResult>` |
| driver-panel.ts:339 | `confirmShiftSummaryAction` | — | Şoförün 72 saatteki (`SUMMARY_WINDOW_MS`) TÜM imzasız kapalı vardiyalarını tek update ile imzalar | `requireWorker()` :340 | `Promise<ConfirmSummaryResult>` `{ok,error?,signed?}` |
| driver-panel.ts:371 | `getShiftPhotosAction` | `entryId: string` | Vardiya fotoğraflarını imzalı URL'lerle listeler | `requireWorker()` :372 + **satır sahipliği**: `!is_admin && entry.worker_id !== session.worker_id` → boş dizi (`:382`) | `Promise<ShiftPhotoItem[]>` |
| driver-panel.ts:406 | `resolveDriverReportAction` | `reportId: string` | Şoför bildirimini "çözüldü" işaretler | ⚠️ `requireWorker()` :409 + **elle** `if (!session.is_admin) return not_allowed` :410 — `requireAdmin()` DEĞİL (bu dosyada tek örnek) | `Promise<DriverPanelResult>` |
| driver-panel.ts:431 | `listPickableVehiclesAction` | — | Geçici araç seçicisi için liste (`lib/vehicles.ts:62`); filo kapsamı bilerek uygulanmaz, test araçları elenir | `requireWorker()` :432 | `Promise<PickableVehicle[]>` |

### app/actions/expenses.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| expenses.ts:83 | `createExpenseEntry` | **`formData: FormData`** (spent_at, category, amount, description, vehicle_plate, receipt: File) | zod `createExpenseSchema`; 📎 **fiş ZORUNLU** → `uploadReceipt("expense-receipts")` (`:98`); adminlere Telegram | `requireWorker()` :84 | `Promise<ExpenseResult>` `{ok,error?,id?}` |
| expenses.ts:132 | `approveExpenseEntry` | `id: string` | `pending`→`approved` (durum koşullu update `:143`), şoföre Telegram | `requireAdmin()` :133 | `Promise<ExpenseResult>` |
| expenses.ts:152 | `rejectExpenseEntry` | `id: string, reason: string` | `pending`→`rejected` + sebep | `requireAdmin()` :153 | `Promise<ExpenseResult>` |
| expenses.ts:172 | `getExpenseReceiptUrl` | `id: string` | Fişin imzalı URL'i (1 sa) | `requireWorker()` :173 + sahiplik `:180` | `Promise<string \| null>` |
| expenses.ts:184 | `getExpenseEntries` | `opts?: { mine?: boolean, withUrls?: boolean }` | Masraf listesi; admin tümü, şoför kendisi (`:190`); `fetchAllRows` sayfalama | `requireWorker()` :189 | `Promise<ExpenseEntryWithWorker[]>` |
| expenses.ts:232 | `generatePayrollExpenseCSV` | `month: string` (`YYYY-MM`) | Onaylı masraflardan DATEV/BMD tarzı bordro CSV'si (BOM + CRLF) | `requireAdmin()` :233 | `Promise<PayrollCsvResult>` `{ok:true,csv,filename}` \| `{ok:false,error}` |

### app/actions/fuel.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| fuel.ts:85 | `createFuelEntry` | **`formData: FormData`** (vehicle_plate, fueled_at, liters, total_cost, odometer_km, fuel_type, station_name, notes, receipt: File) | zod `createFuelSchema`; 📎 **fiş ZORUNLU** → `uploadReceipt("fuel-receipts")` (`:103`); adminlere Telegram + `triggerMaintenanceReminder` (`:133`) | `requireWorker()` :86 | `Promise<FuelResult>` |
| fuel.ts:142 | `approveFuelEntry` | `id: string` | `pending`→`approved`, şoföre Telegram | `requireAdmin()` :143 | `Promise<FuelResult>` |
| fuel.ts:162 | `rejectFuelEntry` | `id: string, reason: string` | `pending`→`rejected` + sebep | `requireAdmin()` :163 | `Promise<FuelResult>` |
| fuel.ts:183 | `getFuelReceiptUrl` | `id: string` | Fişin imzalı URL'i | `requireWorker()` :184 + sahiplik `:191` | `Promise<string \| null>` |
| fuel.ts:199 | `getFuelEntries` | `opts?: { mine?: boolean, withUrls?: boolean }` | Yakıt listesi + araç bazlı L/100km zinciri (`:249`) | `requireWorker()` :204 | `Promise<FuelEntryWithWorker[]>` |
| fuel.ts:264 | `generateCO2Report` | `month: string` (`YYYY-MM`) | Onaylı yakıttan aylık CO₂ raporu; test plakaları elenir (`:289`) | `requireAdmin()` :265 | `Promise<CO2Result>` |

### app/actions/geofences.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| geofences.ts:39 | `getGeofences` | — | Tüm bölgeler; `purpose` kolonu yoksa base kolonlara düşer (`:20`) | `requireAdmin()` :40 | `Promise<Geofence[]>` |
| geofences.ts:46 | `getActiveGeofences` | — | Yalnız `active=true` bölgeler | `requireAdmin()` :47 | `Promise<Geofence[]>` |
| geofences.ts:62 | `createGeofence` | **`formData: FormData`** (name, center_lat, center_lng, radius_m, rule_kind, purpose) | zod `geofenceSchema`; daire bölge ekler | `requireAdmin()` :63 | `Promise<GeofenceResultAction>` |
| geofences.ts:89 | `updateGeofence` | **`formData: FormData`** (+ id) | Bölgeyi günceller | `requireAdmin()` :90 | `Promise<GeofenceResultAction>` |
| geofences.ts:115 | `toggleGeofence` | `id: string, active: boolean` | Bölgeyi aç/kapat | `requireAdmin()` :116 | `Promise<GeofenceResultAction>` |
| geofences.ts:129 | `deleteGeofence` | `id: string` | Bölgeyi siler | `requireAdmin()` :130 | `Promise<GeofenceResultAction>` |

### app/actions/leaves.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| leaves.ts:83 | `submitLeaveAction` | `input: LeaveInput` (worker_id, leave_type, start_date/end_date `YYYY-MM-DD`, note?, force?, id?) | İzin girişi VE düzenleme tek giriş; patron→`approved`, şef→`pending`; örtüşme engeli (`:137`), vardiya çakışması **engel değil teyit** (`:145`); `status`/`created_by` sunucuda zorlanır | ⚠️ **Sıra:** `LEAVES_ENABLED` (`:86`) ve zod (`:88`) kapıdan ÖNCE. Kapı `requireFleetView()` :94 (patron VEYA şef) + şef için `scope.isFleetWorker` assert :124 + yönetici-hedef kapısı `:113` + ayrılan-personel kapısı `:119` | `Promise<LeaveActionResult>` `{ok,error?,needConfirm?,conflictShifts?,id?}` |
| leaves.ts:220 | `approveLeaveAction` | `id: string` | `pending`→`approved`, iz yazar | `requireAdmin()` :222 (`LEAVES_ENABLED` önce, `:221`) | `Promise<LeaveActionResult>` |
| leaves.ts:251 | `rejectLeaveAction` | `id: string` | `pending`→`rejected` (kayıt iz için durur) | `requireAdmin()` :253 | `Promise<LeaveActionResult>` |
| leaves.ts:282 | `deleteLeaveAction` | `id: string` | Siler; iz **silmeden ÖNCE** yazılır (`:299`) | `requireFleetView()` :284 + şef yalnız kendi `pending` talebi :288-297 | `Promise<LeaveActionResult>` |

### app/actions/maintenance.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| maintenance.ts:31 | `createMaintenance` | **`formData: FormData`** (vehicle_plate, serviced_at, service_type, odometer_km, cost, description, next_service_km, next_service_date, receipt?: File) | zod `createMaintenanceSchema`; 📎 fiş **opsiyonel** → `uploadReceipt("maintenance-receipts")` (`:52`) | `requireAdmin()` :34 | `Promise<MaintenanceResult>` |
| maintenance.ts:83 | `getMaintenanceReceiptUrl` | `id: string` | Bakım fişinin imzalı URL'i | `requireAdmin()` :84 | `Promise<string \| null>` |
| maintenance.ts:94 | `getMaintenance` | — | Son 100 bakım kaydı + toplu imzalı URL | `requireAdmin()` :95 | `Promise<VehicleMaintenance[]>` |
| maintenance.ts:117 | `getDueMaintenance` | — | 14 gün içinde/geçmiş planlı servisler | `requireAdmin()` :118 | `Promise<VehicleMaintenance[]>` |
| maintenance.ts:135 | `triggerMaintenanceReminder` | `plate: string, currentKm: number` | Eşik geçildiyse (`next_service_km − 1000`) TÜM bağlı yöneticilere Telegram gönderir | 🔴 **KAPI YOK** — hiçbir oturum/rol kontrolü yok. `fuel.ts:133`'ten dahili çağrılıyor ama `"use server"` dosyasından export edildiği için **ağdan çağrılabilir bir uçtur** | `Promise<void>` |

### app/actions/offline.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| offline.ts:50 | `processQueuedShift` | `item: Item` (düz obje; `Item` tipi **export EDİLMEMİŞ**, `:16`): `{ type: "start"\|"end"\|"break"\|"package"\|"report", payload: Record<string,unknown>, clientTime: string }` | Çevrimdışı kuyruktaki olayı yeniden oynatır. `start` dalı **kasıtlı no-op** (`:55-62`). `end`: km cihazdan (`resolveEndKm`), `checkUndelivered` sınırı. `break`: `break_started_at` da temizlenir. `package`: açık ya da olayı kapsayan vardiyaya bağlar. `report`: `reportProblemAction`'ı yeniden çağırır (`:202`). İstemci saati `resolveEventTime` ile +5dk/−48sa penceresine kırpılır (`:37`) | `requireWorker()` :51 | `Promise<QueueProcessResult>` `{ok,error?}` |

### app/actions/preferences.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| preferences.ts:7 | `setLocaleAction` | `locale: "tr" \| "de"` | Dil çerezini 1 yıl için yazar + `revalidatePath("/","layout")` | 🔴 **KAPI YOK** — hiçbir kontrol yok. Yalnız çağıranın kendi çerezini yazdığı için etki alanı dar; yine de kimliksiz çağrılabilir bir uçtur | `Promise<void>` |

### app/actions/shift.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| shift.ts:102 | `startShiftManualAction` | `overrideVehicleId?: string` | Şoför kendi vardiyasını başlatır. Araç: geçici seçim ya da `assigned_worker_id`; test aracı/`status!=='active'` reddedilir. Günde tek vardiya → kapanmışsa **yeniden açar** (`:197`, `reopened:true`). `started_at` "şimdi" değil, `resolveShiftStartAt` ile depo girişinden türetilir (`:271`). `location_unverified`/`start_time_estimated` bayrakları (`:309`) | `requireWorker()` :112 **+ DB'den `is_active` teyidi** :123 (çerez 30 gün yaşıyor) **+ depo kapısı** `evaluateDepotGate` :257 (fail-closed) | `Promise<ShiftResult>` `{ok,error?,reopened?}` |
| shift.ts:368 | `startShiftForWorkerAction` | `input: { workerId: string, startedAt: string (ISO), vehicleId?: string }` | Yönetici/şef BAŞKASI adına vardiya açar. Depo kilidi **uygulanmaz** (bilinçli). `started_at` çağırandan gelir; bugünün Viyana günü içinde + gelecek değil (`:439`). `start_source`/`started_by` izi; kolon yoksa izsiz yeniden dener (`:537`) | `requireManualStartAuth(input.workerId)` :375 (**redirect etmez**, `{ok:false,error:"unauthorized"\|"out_of_scope"}`) + hedef `is_active` :384 + yönetici-hedef kapısı (`counts_as_driver` muafiyetli) :398 + şef için araç kapsamı :415 | `Promise<ShiftResult>` |
| shift.ts:563 | `listStartableVehiclesAction` | — | Manuel başlatma dialogu için aktif+test-değil araçlar; şef yalnız kendi filosu | **ZAYIF:** `getSession()` :566 — oturum yoksa `[]`; admin değilse `getManagedFleet` yoksa `[]` (fail-closed, redirect yok) | `Promise<{id, plate, assigned_worker_id}[]>` |
| shift.ts:594 | `endShiftAction` | **`formData: FormData`** (plate, notes, break_minutes, cargo_count, undelivered_count) | zod `endShiftSchema`; `PACKAGES_ENABLED` ise `undelivered_count` zorunlu (`:615`); bitiş km **cihazdan** (`resolveEndKm`, şoför sayaç girmez `:639`); `cargo_count = alınan − teslim edilemeyen` türetilir; `checkUndelivered` anlamsal sınır (`:671`); şoföre özet Telegram'ı | `requireWorker()` :595 | `Promise<ShiftResult>` |
| shift.ts:760 | `startBreakAction` | — | `break_started_at` damgalar (sunucu tarafı mola bayrağı) | `requireWorker()` :761 | `Promise<ShiftResult>` |
| shift.ts:778 | `addBreakMinutesAction` | `minutes: number` | Mola dakikalarını ekler + `break_started_at` temizler | `requireWorker()` :779 | `Promise<ShiftResult>` |
| shift.ts:828 | `updatePackageCountAction` | `count: number \| null` | Kendi AÇIK vardiyasının `start_package_count`'unu yazar; `MAX_COUNT` sınırı | `requireWorker()` :829 | `Promise<ShiftResult>` |
| shift.ts:861 | `adminUpdateKmAction` | `entryId: string, startKm: number, endKm: number \| null` | Herhangi bir vardiyanın km'sini düzeltir; `MAX_ODOMETER`/`MAX_PER_SHIFT_KM` denetimi (elle, zod değil); `logShiftEdit` izi | `requireAdmin()` :866 | `Promise<ShiftResult>` (hata kodları `km_low:x:y` biçiminde) |
| shift.ts:922 | `adminCloseShiftAction` | `entryId: string` | Kapanmamış vardiyayı kapatır; bitiş anı **son telemetri kaydı** (yoksa şimdi, `:936`), km `resolveEndKm`; `end_reason='admin'` | `requireAdmin()` :923 | `Promise<ShiftResult>` |
| shift.ts:991 | `editEntryAction` | **`formData: FormData`** (id, started_at, ended_at, start_km, end_km, plate, notes, break_minutes, start_package_count, undelivered_count) | zod `editEntrySchema`; teslim edilen **türetilir** (elle girilemez, `:1010`); plaka→`vehicle_id` senkronu (`:1035`); `logShiftEdit` izi | `requireAdmin()` :992 | `Promise<ShiftResult>` |
| shift.ts:1099 | `getShiftEditsAction` | `entryId: string` | Vardiyanın düzenleme geçmişi (`lib/shift-edit-log.ts:100`, limit 50); tablo yoksa boş dizi | `requireAdmin()` :1100 | `Promise<ShiftEditLogRow[]>` |
| shift.ts:1104 | `deleteEntryAction` | `id: string` | Vardiya satırını **kalıcı siler** (iz yazılmaz) | `requireAdmin()` :1105 | `Promise<ShiftResult>` |

### app/actions/telegram.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| telegram.ts:30 | `createTelegramLinkCode` | — | Tek kullanımlık 6 haneli bağlama kodu + `tg://` QR (data URL) üretir; kullanıcının önceki kodunu siler | `requireWorker()` :31 | `Promise<LinkCodeResult>` `{ok:true,code,deepLink,qrDataUrl}` \| `{ok:false,error}` |
| telegram.ts:66 | `unlinkTelegram` | — | Kendi Telegram bağını temizler | `requireWorker()` :67 | `Promise<{ok:boolean}>` |
| telegram.ts:86 | `notifyLenkzeit` | `timeEntryId: string` | 4,5 sa Lenkzeit uyarısını şoförün kendi Telegram'ına; vardiya başına tek atış (atomik `lenkzeit_notified_at` claim `:95`) | `requireWorker()` :87 + update'te `eq("worker_id", session.worker_id)` sahiplik :99 + `LENKZEIT_WARNING_ENABLED` sunucu kapısı :92 | `Promise<{ok:boolean}>` (her durumda `ok:true`) |
| telegram.ts:122 | `sendTestMessage` | `workerId: string, text: string` | Bağlı bir çalışana serbest metin test mesajı; HTML escape (`:13`) | `requireAdmin()` :126 | `Promise<{ok:boolean,error?:string}>` |
| telegram.ts:143 | `getMyTelegramStatus` | — | Kendi bağlantı durumu | `requireWorker()` :147 | `Promise<{linked:boolean, username:string\|null}>` |

### app/actions/vehicles.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| vehicles.ts:15 | `addVehiclePenalty` | `vehicleId: string, input: { penalty_date: string, amount: number\|null, description: string\|null }` (düz obje) | Araca ceza kaydı; **elle** doğrulama (zod yok): tarih regex `:23`, tutar 0–1.000.000 `:29`, açıklama 500 karakter `:35` | `requireAdmin()` :19 | `Promise<{ok:true} \| {ok:false,error}>` |
| vehicles.ts:52 | `setVehiclePenaltyPaid` | `penaltyId: string, paid: boolean` | Cezayı ödendi/ödenmedi işaretler | `requireAdmin()` :54 | `Promise<Result>` |
| vehicles.ts:70 | `deleteVehiclePenalty` | `penaltyId: string` | Ceza kaydını siler | `requireAdmin()` :72 | `Promise<Result>` |
| vehicles.ts:101 | `listVehicles` | — | Tüm araçlar (test araçları elenir, `:104`) | `requireAdmin()` :102 | `Promise<Vehicle[]>` |
| vehicles.ts:226 | `createVehicle` | **`formData: FormData`** (plate, make, model, year, status, fleet, assigned_worker_id, flespi_device_id, imei, inspection_due, insurance_due, tank_capacity_l) | zod `vehicleSchema`; plaka/imei/device benzersizlik ön-kontrolü (`:237`, çakışan plakayı isimlendirir); `assertDriverAssignable` — yönetici hesabı araca atanamaz (`:217`); `applyDriverAssignment` ile `workers.plate` aynası | `requireAdmin()` :227 | `Promise<VehicleActionResult>` `{ok,error?,id?,conflict?}` |
| vehicles.ts:279 | `updateVehicle` | **`formData: FormData`** (+ id, assigned_worker_id_prev) | Aynı doğrulamalar; atama yalnız **gerçekten değiştiyse** yazılır (lost-update koruması `:300`) | `requireAdmin()` :280 | `Promise<VehicleActionResult>` |
| vehicles.ts:357 | `deleteVehicle` | `id: string` | Aracı siler | `requireAdmin()` :358 | `Promise<VehicleActionResult>` |
| vehicles.ts:370 | `listVehiclePlates` | — | ⌘K paleti için hafif dizin (id+plaka) | `requireAdmin()` :371 | `Promise<{id,plate}[]>` |

### app/actions/workers.ts

| Dosya | Fonksiyon | Parametreler (tip) | Ne yapar | Yetki kapısı | Dönen değer |
|---|---|---|---|---|---|
| workers.ts:40 | `createWorkerAction` | **`formData: FormData`** (name, phone, pin, plate, employee_number, is_admin, counts_as_driver + 11 personel-dosyası alanı) | zod `createWorkerSchema`; PIN boşsa `DEFAULT_TEMP_PIN` (`:47`), bcrypt hash, `must_change_pin=true`; telefon kanonikleştirilir + benzersizlik; `employee_number` otomatik (`:25`) | `requireAdmin()` :41 | `Promise<WorkerResult>` `{ok,error?}` |
| workers.ts:172 | `getWorkerVehicleOptions` | `workerId: string` | Düzenle dialogu için araç seçenekleri + şoförün mevcut aracı | `requireAdmin()` :176 | `Promise<{vehicles:{id,plate}[], currentVehicleId:string\|null}>` |
| workers.ts:199 | `updateWorkerAction` | **`formData: FormData`** (+ id, assigned_vehicle_id, assigned_vehicle_id_prev) | zod `updateWorkerSchema`; **yalnız değişen alanı** yazar (`:310`); `plate`/`pin_hash`/`is_active`/`must_change_pin` diff'e girmez. İki yetki kapısı: **kendi kendini düşürme yok** (`:269`), **son yönetici koruması** (`:275`); `counts_as_driver` yetki gidince temizlenir (`:296`); `logWorkerAdminChange` izi | `requireAdmin()` :202 | `Promise<WorkerResult>` |
| workers.ts:344 | `toggleActiveAction` | `workerId: string` | Aktif/pasif çevirir; **aktifleştirme `terminated_at`'i de temizler** (`:370`, hayalet durum düzeltmesi) | `requireAdmin()` :345 | `Promise<WorkerResult>` |
| workers.ts:397 | `terminateWorkerAction` | `workerId: string, lastDay: string` (`YYYY-MM-DD`) | İşten çıkış: `terminated_at` + `is_active=false` + Telegram bağı temizlenir + `managed_fleet=null`. `vehicles.assigned_worker_id` **kasıtlı boşaltılmaz** | `requireAdmin()` :401 + yönetici hesabı çıkarılamaz `:411` | `Promise<WorkerResult>` |
| workers.ts:456 | `clearLoginLockAction` | `workerId: string` | `login_attempts` kilidini kaldırır (`lib/login-lock.ts`), `login_unlock_log`'a yazar. Eşikler/mekanizma yerinde kalır | `requireAdmin()` :459 (şef `/panel`'e atılır — kilit açmak filo işi değil, `:447` yorumu) | `Promise<WorkerResult>` |
| workers.ts:490 | `setWorkerPinAction` | `workerId: string, pin: string, mustChange: boolean` | Şoföre yeni PIN yazar (üzerine yazma; mevcut PIN bcrypt olduğu için **asla okunamaz**); PIN cevap gövdesinde geri **dönmez** (`:520`) | `requireAdmin()` :495 + zod `adminSetPinSchema` :497 | `Promise<WorkerResult>` |

---

### Özet

**Toplam action sayısı: 83** (16 dosyada; export edilen `type`'lar hariç).

Dosya başına: `shift.ts` 12 · `driver-panel.ts` 9 · `vehicles.ts` 8 · `workers.ts` 7 · `assignments.ts` 6 · `expenses.ts` 6 · `fuel.ts` 6 · `geofences.ts` 6 · `telegram.ts` 5 · `maintenance.ts` 5 · `leaves.ts` 4 · `auth.ts` 3 · `depot.ts` 3 · `azg-report.ts` 1 · `offline.ts` 1 · `preferences.ts` 1.

#### Yetki kapısı dağılımı

| Kapı | Adet | Not |
|---|---|---|
| `requireAdmin()` | 45 | Yetkisizlikte `redirect("/panel")` fırlatır |
| `requireWorker()` | 28 | Yetkisizlikte `redirect("/")` fırlatır |
| `requireFleetView()` | 2 | `submitLeaveAction`, `deleteLeaveAction` |
| `requireManualStartAuth()` | 1 | `startShiftForWorkerAction` — tek "redirect etmeyen" kapı |
| **Zayıf** (`getSession()`, yönlendirmesiz) | 3 | `changePinAction` (auth.ts:225), `pingPanelAction` (depot.ts:17), `listStartableVehiclesAction` (shift.ts:566) |
| 🔴 **KAPISIZ** | 4 | `loginAction` + `logoutAction` (bilinçli), **`setLocaleAction` (preferences.ts:7)**, **`triggerMaintenanceReminder` (maintenance.ts:135)** |

🔴 **Mobil API güvenliği için işaretlenenler:**
- `maintenance.ts:135 triggerMaintenanceReminder(plate, currentKm)` — **hiçbir kontrol yok** ve dışa etkisi var: tüm yöneticilerin telefonuna Telegram gönderir. Yalnız `fuel.ts:133`'ten dahili çağrılıyor ama `"use server"` dosyasından export edildiği için bağımsız bir uçtur. Mobil API'ye açılacaksa **dahili yardımcıya taşınmalı** (`"use server"` dosyasından çıkarılmalı) ya da kapı eklenmeli.
- `preferences.ts:7 setLocaleAction(locale)` — kontrol yok; etkisi çağıranın kendi çerezi + `revalidatePath("/","layout")` ile sınırlı.
- `driver-panel.ts:410 resolveDriverReportAction` — yönetici eylemi ama `requireAdmin()` yerine `requireWorker()` + elle `is_admin` kontrolü. Sonuç güvenli (yetkisiz `not_allowed` alır), ama **kapı deseni diğer 45 yönetici action'ından ayrışıyor**; mobil uçta bu tutarsızlık kolayca gözden kaçar.
- `leaves.ts:86-88` — `LEAVES_ENABLED` ve zod doğrulaması yetki kapısından **ÖNCE** çalışıyor. Sızıntı yok (yazma kapıdan sonra) ama kimliksiz çağıran "modül açık mı" ve "girdim şema olarak geçerli mi" bilgisini alabiliyor.

#### zod doğrulaması

**17 action** zod ile doğruluyor:
- **16'sı `lib/validation.ts`'ten**: `createAssignment` + `updateAssignment` (`createAssignmentSchema`), `loginAction` (`loginSchema`), `changePinAction` (`changePinSchema`), `createExpenseEntry` (`createExpenseSchema`), `createFuelEntry` (`createFuelSchema`), `createGeofence` + `updateGeofence` (`geofenceSchema`), `createMaintenance` (`createMaintenanceSchema`), `endShiftAction` (`endShiftSchema`), `editEntryAction` (`editEntrySchema`), `createVehicle` + `updateVehicle` (`vehicleSchema`), `createWorkerAction` (`createWorkerSchema`), `updateWorkerAction` (`updateWorkerSchema`), `setWorkerPinAction` (`adminSetPinSchema`).
- **1'i yerel şema**: `submitLeaveAction` — `leaves.ts:46` içinde kendi `leaveInput` zod şeması (`lib/validation.ts` kullanmıyor).

**Kalan 66 action şemasız.** Bunların bir kısmı elle doğrulama yapıyor — `addVehiclePenalty` (vehicles.ts:22-35), `adminUpdateKmAction` (shift.ts:867-878), `updatePackageCountAction` (shift.ts:833), `terminateWorkerAction` (workers.ts:402), `reportProblemAction` (driver-panel.ts:273 beyaz liste), `startShiftForWorkerAction` (shift.ts:439-444) — ama tek tek elden yazılmış. Mobil API'de bu 66 uç için girdi doğrulaması **yeniden gözden geçirilmeli**: web istemcisi tip güvenliğiyle çağırdığı için bugün ayakta duruyor.

Ayrıca `lib/validation.ts`'ten **sabit** olarak (şema değil) kullanılanlar: `MAX_ODOMETER`, `MAX_PER_SHIFT_KM`, `MAX_COUNT` (shift.ts:20-22, offline.ts:6), `DEFAULT_TEMP_PIN` (workers.ts:12).

#### revalidatePath / revalidateTag — mobilde karşılığı YOK ⚠️

- **`revalidateTag`: 0 kullanım** (repoda hiç yok — grep boş).
- **`revalidatePath`: 54 action** çağırıyor. Bunlar Next.js sunucu-önbelleği tazeleme çağrılarıdır; **mobil istemci için anlamsızdır** ve mobil API katmanında karşılığı yoktur. Mobilde bu 54 ucun her biri için istemci-tarafı önbellek geçersizleştirme (veya sunucudan "hangi ekranlar bayatladı" sinyali) ayrıca tasarlanmalıdır.

| Dosya | revalidatePath çağıran action | Tazelenen yollar |
|---|---|---|
| assignments.ts | 5 (`getAssignments` hariç hepsi) | `/admin/seferler`, `/panel`, `/panel/seferler` |
| depot.ts | 2 (`pingPanelAction` hariç) | `/admin`, `/panel` |
| driver-panel.ts | 7 (`getShiftPhotosAction`, `listPickableVehiclesAction` hariç) | `/panel`, `/admin` |
| expenses.ts | 3 (create/approve/reject) | `/panel/masraflar`, `/admin/masraflar` |
| fuel.ts | 3 (create/approve/reject) | `/panel/yakit`, `/admin/yakit` |
| geofences.ts | 4 (get* hariç) | `/admin/bolgeler` |
| leaves.ts | 4 (hepsi) | `/admin/izinler`, `/admin` |
| maintenance.ts | 1 (`createMaintenance`) | `/admin/yakit` |
| offline.ts | 1 | `/panel`, `/admin` |
| preferences.ts | 1 | `/` (layout kapsamlı) |
| shift.ts | 10 (`listStartableVehiclesAction`, `getShiftEditsAction` hariç) | `/panel`, `/admin`, `/admin/workers` |
| telegram.ts | 1 (`unlinkTelegram`) | `/panel`, `/admin/telegram` |
| vehicles.ts | 6 (`listVehicles`, `listVehiclePlates` hariç) | `/admin/araclar`, `/admin/workers`, `/panel`, `/admin`, `/admin/araclar/{id}` |
| workers.ts | 6 (`getWorkerVehicleOptions` hariç) | `/admin`, `/admin/workers`, `/admin/workers/{id}`, `/admin/araclar`, `/admin/izinler`, `/panel` |

**Çağırmayan 29 action** ağırlıkla okuma uçları (`get*`/`list*`) — mobil API'ye doğrudan çevrilebilecek olanlar bunlar.

#### FormData alanlar (mobilde JSON'a çevrilmesi gerekir)

**14 action `FormData` alıyor:**

| Action | Not |
|---|---|
| `auth.ts:120 loginAction(_prev, formData)` | React `useActionState` imzası: **ilk parametre önceki state** — mobil uçta bu parametre atılmalı |
| `auth.ts:220 changePinAction(_prev, formData)` | Aynı `useActionState` imzası |
| `driver-panel.ts:220 addShiftPhotoAction(formData)` | 📎 dosya taşır — multipart kalmalı |
| `expenses.ts:83 createExpenseEntry(formData)` | 📎 dosya taşır |
| `fuel.ts:85 createFuelEntry(formData)` | 📎 dosya taşır |
| `geofences.ts:62 createGeofence(formData)` | saf alan → JSON'a çevrilebilir |
| `geofences.ts:89 updateGeofence(formData)` | saf alan |
| `maintenance.ts:31 createMaintenance(formData)` | 📎 dosya taşır (opsiyonel) |
| `shift.ts:594 endShiftAction(formData)` | saf alan |
| `shift.ts:991 editEntryAction(formData)` | saf alan |
| `vehicles.ts:226 createVehicle(formData)` | saf alan |
| `vehicles.ts:279 updateVehicle(formData)` | saf alan; gizli `assigned_worker_id_prev` alanı **taşınmalı** (lost-update koruması buna bağlı) |
| `workers.ts:40 createWorkerAction(formData)` | saf alan |
| `workers.ts:199 updateWorkerAction(formData)` | saf alan; gizli `assigned_vehicle_id_prev` **taşınmalı** |

⚠️ FormData eşlemesinde dikkat: `formData.get("x") || null` deseni **boş string'i null'a düşürüyor** (örn. expenses.ts:90, workers.ts:53) ve `formData.get("is_admin") === "on"` **checkbox sözleşmesine** bağlı (workers.ts:55, 213). JSON'a çevirirken bu iki dönüşüm birebir korunmalı, yoksa "alanı temizle" ve "yetki ver" semantiği sessizce bozulur.

**Kalan 69 action düz obje / skaler parametre alıyor** — doğrudan JSON'a çevrilebilir. İçlerinde yapılandırılmış obje alanlar: `createAssignment`/`updateAssignment` (`AssignmentInput`), `addVehiclePenalty` (`input` objesi), `addPackageAction` / `reportProblemAction` (`input` objesi), `submitLeaveAction` (`LeaveInput`), `startShiftForWorkerAction` (`input` objesi), `processQueuedShift` (`Item` — ⚠️ **tipi export edilmemiş**, offline.ts:16; mobil istemci için dışa açılması gerekir), `getAssignments`/`getFuelEntries`/`getExpenseEntries` (`opts` objesi).

#### Dosya yükleme

**Var — 4 action yazıyor, hepsi `lib/storage.ts` üzerinden:**

| Action | Bucket | Zorunlu mu |
|---|---|---|
| `driver-panel.ts:231 addShiftPhotoAction` | `shift-photos` | evet (`:229` `no_file`) |
| `expenses.ts:99 createExpenseEntry` | `expense-receipts` | evet (`:98` `receipt_required`) |
| `fuel.ts:104 createFuelEntry` | `fuel-receipts` | evet (`:103` `receipt_required`) |
| `maintenance.ts:53 createMaintenance` | `maintenance-receipts` | hayır (opsiyonel, `:52`) |

`lib/storage.ts:20 uploadReceipt` sunucu-tarafı kısıtları: **max 5 MB** (`:4`), izinli MIME `image/jpeg|png|webp|heic` (`:5`), yol `{workerId}/{yyyy}/{mm}/{uuid}.{ext}` (`:33`), service-role ile private bucket'a (RLS bypass), `upsert:false`.

**Okuma tarafı — 7 action imzalı URL üretiyor** (`signedReceiptUrl` / `signedReceiptUrls`, varsayılan 1 saat): `getExpenseReceiptUrl`, `getFuelReceiptUrl`, `getMaintenanceReceiptUrl`, `getShiftPhotosAction`, `getExpenseEntries(withUrls)`, `getFuelEntries(withUrls)`, `getMaintenance`.

**`lib/image-resize.ts` hiçbir server action'da kullanılmıyor** — yalnız iki istemci bileşeninde: `app/panel/ShiftPhotoButton.tsx:8` ve `components/PhotoUpload.tsx:7`. Yani **yeniden boyutlandırma tarayıcıda yapılıyor**; mobil istemci ham fotoğraf gönderirse 5 MB tavanına çarpma riski var ve sunucuda telafi eden bir katman **yok**.

---

## 3a) Hesaplama Nerede — Vardiya / Mola / AZG

### Özet: üç hesap katmanının dağılımı

Vardiya/mola/AZG matematiğinin **tamamı JavaScript'te** yapılıyor. Veritabanı yalnız ham alan tutar; hiçbir hesap SQL'de yaşamıyor.

**(A) veritabanı fonksiyonu/SQL — HİÇBİR DEĞER İÇİN KULLANILMIYOR.** `db/` altındaki tüm `create ... function` tanımları taransa (`db/migrations/006_assignments.sql:54`, `007_fuel_expenses.sql:90`, `026_report_rpcs.sql:33,139,171`, `027_fuel_stats_edge_fix.sql:34`, `039_fuel_volume.sql:42`) yalnız iki şey çıkar: `updated_at` trigger'ları (assignments/fuel_entries/expense_entries/vehicle_maintenance) ve `device_telemetry` üzerinde çalışan yakıt/soğutma suyu RPC'leri. `time_entries` üzerinde **tek bir fonksiyon veya trigger yok**. Tablodaki tek hesap-benzeri kısıt `break_minutes >= 0` check'idir (`db/migrations/002_add_break_cargo.sql:18-26`).

---

### 1. Vardiya süresi

- **Değer:** çalışılan süre (ms) = `bitiş − başlangıç − mola`
- **Hesap yeri:** **(B) sunucu kodu** — tüm rapor/panel/AZG yolları. **(C) tarayıcı** yalnızca *canlı sayaç* için (aynı fonksiyonun `now` parametresiyle saniyelik yeniden çağrılması).
- **Dosya:satır + fonksiyon:**
  - Tek kaynak formül: `lib/format.ts:129` `workedMs(entry, now = Date.now())` → `Math.max(0, endTs - startTs - breakMs)`; `ended_at` null ise `endTs = now` (`lib/format.ts:135`).
  - Ham süre (mola düşülmemiş): `lib/format.ts:140` `rawDurationMs()`.
  - Sunucu çağıranları: `app/actions/azg-report.ts:213`, `lib/admin-dashboard.ts:837` (`buildTodayOps`), `lib/admin-dashboard.ts:1132` (Dikkat kalemleri), `lib/reports.ts:360`, `lib/report-de.ts:215` (PDF), `app/actions/shift.ts:733` (Telegram özeti), `lib/auto-shift.ts:687`, `app/admin/page.tsx:175,188,192`, `app/admin/workers/page.tsx:87`, `app/admin/workers/[id]/page.tsx:92`.
  - **Kopya formül uyarısı:** `app/panel/page.tsx:100-109` `sumWorkedMs()` `workedMs`'i ÇAĞIRMIYOR, aynı aritmetiği elle tekrar yazıyor (`Math.max(0, en - s - br)`, satır 104-107). Davranış bugün aynı ama iki ayrı yerde yaşıyor.
  - Canlı sayaç (tarayıcı): şoför paneli `app/panel/PanelClient.tsx:233-242` (`workedMsLive`), tick `app/panel/PanelClient.tsx:173-178` (`setInterval(..., 1000)`), gösterim `app/panel/PanelClient.tsx:612` ve `:622` (`formatDuration(workedMsLive)`). Yönetici tarafı `components/admin/LiveWorked.tsx:14-21` — kendi 1 sn'lik tick'i var, `workedMs(entry, now)` çağırır; `app/admin/AdminClient.tsx:485,940,1257` yalnız açık vardiyada bu bileşeni basar, kapalı vardiyada `formatDurationShort(workedMs(e), locale)`.
- **Girdi tablosu/kolonları:** `time_entries` — `started_at`, `ended_at`, `break_minutes`. (`shifts` diye bir tablo YOK; tablo adı `time_entries`, tanımı `db/migrations/001_initial.sql:42-52`, `break_minutes` `db/migrations/002_add_break_cargo.sql:5-6` ile eklendi.)
- **`started_at` nereden geliyor:** "şimdi" değil. `lib/depot.ts:460-489` `resolveShiftStartAt(vehicleId)` — sıra: bugünkü depo girişi (`depot_entry`, verified=true) → son 14 günün ortalama geliş dakikası (`avg_arrival`) → `now`. Sunucuda çalışır; şoför saat girmez (`app/actions/shift.ts:271-273`). Yönetici/şef elle başlatırken `started_at` çağırandan gelir ve sunucuda sınırlanır (`app/actions/shift.ts:439-445`: gelecek değil, bugünün Viyana günü içinde).
- **Devam eden vardiya:** sunucuda `ended_at=null` iken `workedMs` `now`'u kullanır; tarayıcıda ayrıca saniyede bir `setNow(Date.now())` ile sayaç döner. **Canlı sayaç client'ta döner**, ama formül sunucuyla aynı fonksiyondur.
- **Mobil notu:** mobil istemci bu hesabı **tekrar yapabilir** — girdi üç alandan ibaret (`started_at`, `ended_at`, `break_minutes`) ve formül `lib/format.ts:129`'da 6 satır. Canlı sayaç için zaten client tarafı hesap gerekir (aksi hâlde saniyede bir sunucu çağrısı gerekirdi). Sunucudan hazır gelmesi gereken tek şey `started_at`'ın kendisidir (depo türetmesi, `lib/depot.ts:460`) — o mobilde tekrarlanamaz.

---

### 2. Mola süresi

- **Değer:** `time_entries.break_minutes` (dakika, kümülatif) + `time_entries.break_started_at` (yalnız "şu an molada mı" BAYRAĞI, süre değil)
- **Hesap yeri:** **(C) tarayıcı** ölçer, **(B) sunucu** yalnız toplar ve yazar. (A) yok.
- **Dosya:satır + fonksiyon:**
  - Mola başlangıcı yerelde tutulur: `app/panel/PanelClient.tsx:190` `breakStartLocal`, başlatma `app/panel/PanelClient.tsx:248-253` `startBreak()`.
  - Süren molanın geçen süresi (ekrandaki 00:00:00'dan sayan sayaç): `app/panel/PanelClient.tsx:246` `breakElapsedMs = now - breakStartLocal`, gösterim `app/panel/PanelClient.tsx:605`.
  - Yazılacak dakika **tarayıcıda hesaplanır**: `app/panel/PanelClient.tsx:262-264` `endBreak()` → `elapsedMin = Math.max(0, Math.floor((Date.now() - breakStartLocal) / 60_000))`.
  - Sunucu tarafı yalnız toplama: `app/actions/shift.ts:778-814` `addBreakMinutesAction(minutes)` → `newBreak = (active.break_minutes ?? 0) + add` (satır 791), ardından `break_started_at: null` (satır 805). Bayrağı SET eden: `app/actions/shift.ts:760-771` `startBreakAction()`.
  - Çevrimdışı kuyruk replay'i aynı işi yapar: `app/actions/offline.ts:129-151` (`break_minutes` toplar + `break_started_at` temizler).
  - Vardiya kapanışında son söz: `app/actions/shift.ts:654-655` `finalBreak = parsed.data.break_minutes ?? active.break_minutes ?? 0` — kapatma formundaki değer sunucuya gider.
- **Girdi tablosu/kolonları:** `time_entries.break_minutes` (`db/migrations/002_add_break_cargo.sql:6`), `time_entries.break_started_at` (`db/migrations/009_vehicles.sql:31`).
- **30 dakikada otomatik biter mi?** Otomatik biter, ama **hedef sabit 30 değil**: `lib/azg-rules.ts:66-70` `breakTargetMin(workedMs)` → çalışılan süre 9 saati aşmışsa **45**, aksi hâlde **30** dakika. Hedef molanın BAŞLADIĞI anda sabitlenir (`app/panel/PanelClient.tsx:249`, `setBreakTargetLocal(breakTargetMin(workedMsLive))`) — mola ortasında 30→45 sıçraması bilinçli olarak engellenmiş (`app/panel/PanelClient.tsx:191-197` yorumu).
- **Otomatik bitiş mantığı NEREDE:** **yalnız tarayıcıda.** `app/panel/PanelClient.tsx:327-333` — `setTimeout(() => endBreakRef.current(true), breakTargetLocal*60_000 - (Date.now()-breakStartLocal))`. **Sunucuda karşılığı YOKTUR**: panel kapalıysa mola kendiliğinden bitmez, `break_started_at` DB'de SET kalır. Sunucu tarafında `break_started_at` yalnız TÜKETİLİR, temizlenmez: `lib/auto-shift.ts:614` (`if (vehicleShift.break_started_at) continue` — molada olan vardiya otomatik kapatılmaz), `lib/admin-dashboard.ts:700` ("Molada" sayacı), `lib/admin-dashboard.ts:1006` (roster durumu `on_break`), `lib/vehicles.ts:188,270`, `app/admin/AdminClient.tsx:413`.
- **Mobil notu:** **tekrar yapılabilir ve yapılmalı** — mola sayacı doğası gereği istemci-yerel (uygulama molayı ölçer, bitince sunucuya dakika yollar). Mobil istemcinin taşıması gereken tek kural `breakTargetMin` (`lib/azg-rules.ts:66`) ve `addBreakMinutesAction` sözleşmesidir (tek parametre: `minutes`). ⚠️ Sunucu tarafında otomatik bitiş olmadığı için mobil istemci molayı bitirmezse `break_started_at` asılı kalır ve şoför yönetici ekranında "Molada" görünmeye devam eder — bu tuzak `app/panel/PanelClient.tsx:272-284`'te canlı vaka olarak belgelenmiş.

---

### 3. AZG aşımı

- **Hesap yeri:** **(B) sunucu kodu**, tek istisna satır rozeti (aşağıda (C)).
- **Eşiklerin TEK kaynağı: `lib/azg-rules.ts`.** Tam liste:

| Sabit | Değer | Satır | Dayanak |
|---|---|---|---|
| `AZG_DAILY_MAX_MS` | 12 saat | `lib/azg-rules.ts:27` | § 9 Abs. 1 — aşılması İHLAL |
| `AZG_NIGHT_DAILY_MAX_MS` | 10 saat | `lib/azg-rules.ts:34` | § 14 Abs. 2 — gece çalışılan günde tavan |
| `AZG_BREAK_AFTER_6H_MIN` | 30 dk | `lib/azg-rules.ts:40` | § 13c Abs. 1 |
| `AZG_BREAK_AFTER_9H_MIN` | 45 dk | `lib/azg-rules.ts:42` | § 13c Abs. 1 |
| `AZG_BREAK_TIER1_MS` | 6 saat | `lib/azg-rules.ts:45` | mola kademe 1 eşiği |
| `AZG_BREAK_TIER2_MS` | 9 saat | `lib/azg-rules.ts:46` | mola kademe 2 eşiği |
| `NIGHT_WINDOW_START_H` / `NIGHT_WINDOW_END_H` | 00:00 / 04:00 (Viyana) | `lib/azg-rules.ts:74-75` | gece penceresi tanımı |
| `OVER_LIMIT_MS` | = 12 saat | `lib/azg-rules.ts:131` | pano İHLAL kartı (bordo) |
| `BREAK45_THRESHOLD_MS` | = 9 saat | `lib/azg-rules.ts:133` | pano MOLA UYARISI kartı (gold) |

  Kademe fonksiyonları: `lib/azg-rules.ts:52-56` `requiredBreakMin(workedMs)` → `>9sa → 45`, `>6sa → 30`, aksi `0`; `lib/azg-rules.ts:66-70` `breakTargetMin(workedMs)` → `>9sa → 45`, aksi `30` (6 saat dolmadan mola verene de anlamlı hedef döner). Gece tespiti `lib/azg-rules.ts:88-119` `touchesNightWindow(startedAt, endedAt, now)` — vardiyanın kapsadığı her Viyana günü için 00:00–04:00 penceresiyle kesişim, en fazla 4 gün (`lib/azg-rules.ts:110`); açık vardiyada `now` bitiş sayılır. Tavan seçimi `lib/azg-rules.ts:125-127` `dailyCapMs(night)`.
  Almanca hukuki etiketler `lib/azg-rules.ts:136-147` `AZG_REF` (dailyMax, nightMax, break30, break45, rest11 = § 12 Abs. 1 11 saat, weeklyMax = 60 sa, weeklyAvg = 48 sa/17 hafta, weeklyNormal = 40 sa).
  `lib/break-rules.ts` bağımsız bir kaynak DEĞİL, `lib/azg-rules.ts`'i yeniden dışa vuran ince katman (`lib/break-rules.ts:17-24`) + varsayılan `BREAK_TARGET_MIN = 30` (`lib/break-rules.ts:34`).

- **`lib/azg-rules.ts` DIŞINDA yaşayan, dosyada olmayan ek eşikler** (rapora özel, aynı yerde sabit yazılmış): mikro-vardiya `MICRO_MS = 5 dk` (`app/actions/azg-report.ts:200`), dinlenme `REST_MS = 11 saat` (`app/actions/azg-report.ts:316`), günlük toplam `> 8 saat` uyarısı (`app/actions/azg-report.ts:369`), haftalık `> 60` ihlal / `> 48` uyarı / `> 40` uyarı (`app/actions/azg-report.ts:393,404,415`).
- **Hesap nerede koşuyor:**
  - Resmî § 26 AZG raporu: `app/actions/azg-report.ts:106` `getAZGReportData(month)`, "use server" (satır 1). Vardiya döngüsü `:211-312`, tekil vardiya tavanı `:242-259`, mola ihlali `:261-280`, dinlenme `:314-340`, günlük toplam `:345-386`, haftalık `:388-427`.
  - Yönetici panosu kartları: `lib/admin-dashboard.ts:836-843` `buildTodayOps()` — `overLimit` (satır 839) ve `needsBreak45` (satır 841).
  - Dikkat/Aksiyon kalemleri: `lib/admin-dashboard.ts:1131-1162` — `overLimit` (satır 1137) ve `break45` (satır 1152); ikisi bilerek ayrı kalemler.
  - Sunucu bileşeni filtre/sayaç: `app/admin/page.tsx:175` (`statusFilter === "over"`) ve `app/admin/page.tsx:192`.
  - **(C) tarayıcı — tek yer:** `app/admin/AdminClient.tsx:415` `over = workedMs(e) > dailyCapMs(touchesNightWindow(...))`, satır rozeti için. Aynı sabitler, aynı fonksiyonlar; ayrı bir kural değil.
- **Girdi tablosu/kolonları:** `time_entries` — `started_at`, `ended_at`, `break_minutes` (AZG raporunun `select`'i tam olarak bu üç alan + `id`, `worker_id`: `app/actions/azg-report.ts:146`). Personel adı için `workers.id, name` (`app/actions/azg-report.ts:184-187`). Kapsam filtreleri: `withoutTestRows` + `onlyDrivers` (`app/actions/azg-report.ts:142-156`). Elle düzeltilmiş kayıt sayısı `shift_edit_log` üzerinden (`app/actions/azg-report.ts:507` → `lib/shift-edit-log.ts:133` `listEditedEntryIds`).
- **Mobil notu:** **sunucudan hazır gelmeli.** Üç gerekçe: (1) rapor `§ 26 AZG` resmî belgesidir ve tek bir sayı sapması denetimde savunulamaz; (2) hesap tek vardiyayla bitmiyor — günlük toplam, haftalık ISO toplam ve vardiyalar arası dinlenme analizi tüm ay verisini gerektirir (`app/actions/azg-report.ts:282-340`), mobil istemcide bu veri bütünüyle yok; (3) kapsam filtreleri (`test-data`, `driver-scope`) sunucu tarafı kaynaklarına bağlı. Mobilin tekrar yapabileceği tek parça, TEK vardiyalık "bugün tavanı aştım mı / molam yetiyor mu" göstergesidir (`dailyCapMs` + `requiredBreakMin` + `touchesNightWindow`) — bu üç fonksiyon saf, girdisi iki zaman damgası ve bir sayı.

---

### 4. Vardiya özeti / imza

- **Değer:** "bu vardiya şoförden imza ister mi?" (boolean) + imza damgası
- **Hesap yeri:** **(B) sunucu kodu**. Karar sunucuda verilir, ekran client'ta çizilir.
- **`lib/shift-summary.ts` ne döndürüyor:** bir hesap değil, **bir KARAR**. `lib/shift-summary.ts:59-78` `needsSummarySignature(e: SummaryCandidate, nowMs = Date.now()): boolean`. Sırayla eler:
  1. `summary_confirmed_at` doluysa → `false` (satır 63)
  2. `ended_at` null (açık vardiya) → `false` (satır 64)
  3. bitiş 72 saatten eski → `false` (satır 68; `SUMMARY_WINDOW_MS = 72 * 60 * 60 * 1000`, `lib/shift-summary.ts:25`)
  4. sistem kapanışı → `false` (satır 70; `isSystemClosed`, `lib/shift-summary.ts:47-53`: `auto_ended === true || end_reason === 'auto_idle' || end_reason === 'admin'`. `'watchdog'` KASITLI olarak dışarıda — şoförün kendi dokunuşu)
  5. süre 25 dakikadan kısa → `false` (satır 73; `SUMMARY_MIN_SHIFT_MS = 25 * 60 * 1000`, `lib/shift-summary.ts:28`)
  
  Modül ayrıca iki sabit dışa vurur: `SUMMARY_WINDOW_MS` ve `SUMMARY_MIN_SHIFT_MS`.
- **Kim çağırıyor (iki tüketici, tek kaynak olması bilinçli):**
  1. `app/panel/page.tsx:44` — sunucu bileşeni, `pendingSummary`'yi seçer. Açık vardiya varken özet HİÇ gösterilmez (`app/panel/page.tsx:42-44`, ternary'nin `active ? null` dalı).
  2. `app/actions/driver-panel.ts:12` — `SUMMARY_WINDOW_MS`'i import eder; `app/actions/driver-panel.ts:339-365` `confirmShiftSummaryAction()` TOPLU imza atar: şoförün 72 saatteki tüm imzasız kapalı vardiyalarını TEK `update` ile imzalar (`:344-354`), `signed` sayısını döner. İstemci kayıt SEÇMEZ.
- **Görsel özet değerleri (C, tarayıcı):** `app/panel/ShiftSummaryCard.tsx:44-46` — `worked = workedMs(entry)`, `km = kmDiff(entry)`, `packages = entry.cargo_count ?? 0`. Km `null` ise kutu hiç çizilmez, sebep yazılır (`app/panel/ShiftSummaryCard.tsx:97-107`). Onay düğmesi `:127-138` → `confirmShiftSummaryAction()`.
- **Girdi/çıktı tablosu ve kolonları:** okunan `time_entries`: `started_at`, `ended_at`, `summary_confirmed_at`, `end_reason`, `auto_ended` (`lib/shift-summary.ts:31-37` `SummaryCandidate`) + ekran için `cargo_count`, `start_km`, `end_km`, `break_minutes`. Yazılan: `summary_confirmed_at`, `summary_confirmed_by` (`app/actions/driver-panel.ts:346-347`); kolonlar `db/migrations/020_driver_panel_v2.sql:36-37`. İlgili kolon kısıtları: `end_reason in ('manual','auto_idle','watchdog','admin')` (`db/migrations/020_driver_panel_v2.sql:48-51`).
- **Mobil notu:** **karar sunucudan hazır gelmeli, gösterim mobilde yapılabilir.** `needsSummarySignature` saf bir fonksiyon (girdisi 5 alan) ve teorik olarak mobilde tekrarlanabilir; ama 22.07.2026'daki "özet döngüsü" olayının sebebi tam olarak panel ile action'ın kuralının ayrışmasıydı (`lib/shift-summary.ts:5-8` modül başlığı). Üçüncü bir istemci aynı kuralı ayrı kodlarsa aynı arıza sınıfı geri gelir. Doğru sözleşme: sunucu "imzalanacak vardiya listesi"ni döndürsün, mobil yalnız çizsin; imza atma zaten tek action (`confirmShiftSummaryAction`, parametresiz, idempotent).

---

### Ek: değiştirilebilirlik ve iz

AZG'yi besleyen üç alanın (`started_at`, `ended_at`, `break_minutes`) hepsi yönetici tarafından serbestçe düzenlenebilir (`app/actions/shift.ts:991` `editEntryAction`, `lib/shift-edit-log.ts:10-13` yorumu). İz **(B) sunucuda** yazılır: `lib/shift-edit-log.ts:57-97` `logShiftEdit(timeEntryId, changedBy, before, after)`, izlenen alan listesi `lib/shift-edit-log.ts:23-34` (`started_at`, `ended_at`, `start_km`, `end_km`, `plate`, `notes`, `break_minutes`, `start_package_count`, `undelivered_count`, `cargo_count`). Zaman alanlarında 1 saniyeden küçük fark değişiklik sayılmaz (`lib/shift-edit-log.ts:73-80`). Tablo `shift_edit_log` (`db/migrations/040_shift_edit_log.sql:23-35`); tablo yoksa yazma sessizce düşer (`lib/shift-edit-log.ts:92-96`) — yani migration 040 çalıştırılmadıysa **iz hiç tutulmaz ve hata da vermez**.

### Ek: `lib/shift-packages.ts` ve `lib/package-limits.ts` (görev listesinde vardı, süre hesabıyla ilgisi yok)

- `lib/shift-packages.ts:12` `recountShiftPackages(timeEntryId)` — **(B)**. `shift_packages` tablosunu `count: exact, head: true` ile SAYAR ve `time_entries.cargo_count`'a yazar (artırma değil, her seferinde yeniden sayım). Çağıranlar: `app/actions/driver-panel.ts:171` (+1 paket) ve `:206` (geri al).
- `lib/package-limits.ts` — **(B) + (C) aynı fonksiyonlar**. `MAX_SHIFT_PACKAGES = 2000` (`lib/package-limits.ts:22`); `checkUndelivered()` (`:34-59`) sunucunun son sözü (`app/actions/shift.ts:671`, `:1017`); `classifyUndelivered()` (`:80-102`) arayüz katmanı, `app/panel/PanelClient.tsx:383`'te client tarafında çağrılıyor. Üç seviye: `block` / `confirm` / `ok`.

---

## 3b) Hesaplama Nerede — Güvenlik skoru, rölanti, yakıt, km, CO₂

### Kapsam ve yöntem

Aşağıdaki her satır okunan koddan; hiçbir değer canlı ölçümle doğrulanmadı (görev salt-okunur). Repo kökünde **ayrı bir mobil istemci dizini yok** (`ls` çıktısı: `app/ components/ db/ docs/ hooks/ i18n/ lib/ messages/ public/ scripts/`) — "mobil", aynı Next.js sayfasının duyarlı görünümüdür. Bu yüzden her maddedeki *Mobil notu* bugünkü sapma riskini değil, **ayrı bir istemci yazılırsa** doğacak riski tarif eder.

**Hesap yeri kısaltmaları:** (A) SQL/RPC · (B) sunucu Node · (C) tarayıcı.

---

### 1. Güvenlik skoru

| | |
|---|---|
| **Hesap yeri** | **(B)** — tamamı sunucu Node. SQL'de skor hesabı yok. |
| **Fonksiyon** | `computeSafetyScores` — `lib/analytics.ts:490-603` |
| **0–100 mü** | Evet, ama **`null` olabilir**: `Math.max(0, Math.min(100, …))` `lib/analytics.ts:572-577`; tip `number \| null` — `lib/analytics-shared.ts:94` |

**Formül** (`lib/analytics.ts:568-577`):

```
effectiveMinKm  = minKm(vehicleIds)                      // fonksiyon olarak geçiriliyor
qualifies       = reliableKm != null && reliableKm >= effectiveMinKm
penaltyPer1000  = qualifies ? penalty / (reliableKm/1000) : 0     // :571
score           = qualifies
                  ? clamp(0,100, round(100 * K / (K + penaltyPer1000)))   // :575
                  : null
```

**Sabitler**
- `SAFETY_SCORE_K = 500` — `lib/metric-thresholds.ts:64` (27.07.2026 canlı medyan 496,1'den yuvarlanmış, dosya yorumu `lib/metric-thresholds.ts:44-47`)
- `SCORE_MIN_KM_PER_DAY = 40` — `lib/metric-thresholds.ts:74`; `lib/analytics.ts:75`'te yeniden dışa veriliyor
- Ceza ağırlıkları `SAFETY_SCORE_WEIGHTS` — `lib/analytics-shared.ts:18-25`:
  `overspeeding 25 · jamming 25 · harsh_braking 12 · harsh_acceleration 12 · harsh_cornering 12 · idling 5`

**Girdiler**
- Nokta-olaylar: `vehicle_events` → `listEventsInRange` (`lib/telemetry.ts:290-318`), döngü `lib/analytics.ts:515-521`
- Rölanti: `idle_episodes` → `listIdleEpisodesInRange` (`lib/telemetry.ts:496-526`), döngü `lib/analytics.ts:522-526` (epizot **başına** sabit 5 puan; süre skora girmez)
- Payda: araç odometre mesafesi → `getVehicleDistanceSpan` (`lib/analytics.ts:319-361`), şoför bazında toplanır `lib/analytics.ts:548-557`
- **Ham hız DEĞERİ skora GİRMEZ.** Yalnız `overspeeding` *olayı* sayılır. `e.speed_kmh` sadece Top-10 rozetinde (`lib/analytics.ts:454-456`) ve hız raporunda (`lib/reports.ts:195`) kullanılıyor. Sert fren / hızlanma / viraj üçü de olay olarak, aynı 12 ağırlığıyla girer.
- Olay şoföre **araç üzerinden** bağlanır (`vehicles.assigned_worker_id`, `lib/analytics.ts:516-517`); atanmamış araç skorlanmaz.

**Yeterli-veri kapısı:** `scoreMinKmForSpan` — `lib/analytics.ts:110-128`. Eşik aralık uzunluğuyla değil, **odometre ölçümünün gerçekten kapsadığı gün sayısıyla** ölçekleniyor; birden çok araçta *en geniş* pencere alınıyor (`:123`, union değil).

**Gösterildiği ekranlar**
- `/admin/analiz` › "Şoför Güvenlik Skoru" — üretim `app/admin/analiz/page.tsx:89-96`, kolon `app/admin/analiz/AnalizClient.tsx:141-155`, tablo `AnalizClient.tsx:436-443`, yetersiz-veri rozetleri `AnalizClient.tsx:446-464`
- `/admin/raporlar/performans` — üretim `lib/reports.ts:313-331`, skor kolonu `app/admin/raporlar/performans/PerformanceClient.tsx:90-101`, ortalama skor + "en iyi şoför" kartları `PerformanceClient.tsx:183-210`
- PDF `components/pdf/PerformanceReport.tsx` — yeniden hesap yok, ekran değeri basılıyor (`components/pdf/PerformanceReport.tsx:19-21`)

**🔴 Bulgu — kalibrasyon bayrağı asimetrik uygulanmış.** `SAFETY_SCORE_CALIBRATED` (`lib/tenant.ts:187-190`, varsayılan `true`) yalnız Performans raporunda kontrol ediliyor (`PerformanceClient.tsx:48, 90, 186, 196, 226, 259`). `app/admin/analiz/AnalizClient.tsx` içinde bu sabit **hiç geçmiyor** (grep: 0 eşleşme). Bayrak `false` yapılan bir tenant'ta (Sendigo/Galzura kurulum dokümanları bunu öneriyor — `docs/SENDIGO-KURULUM.md:172`) skor Performans raporunda gizlenir ama `/admin/analiz`'de görünmeye devam eder.

**Mobil notu:** Skor tek yerde (`computeSafetyScores`) üretilip prop olarak iniyor; istemci yalnız biçimlendiriyor. Ayrı bir mobil istemci bunu tekrar hesaplarsa **üç ayrı sapma kaynağı** doğar: (1) K=500 ve ağırlıklar, (2) `scoreMinKmForSpan` pencere-ölçekli kapı, (3) `dropNonDrivers` şoför evreni (`lib/analytics.ts:259`). Üçünden biri kayarsa iki ekran aynı insan için farklı sayı gösterir.

---

### 2. Rölanti israfı (EUR)

| | |
|---|---|
| **Hesap yeri** | **(B)** — `computeIdleWaste`, `lib/analytics.ts:668-699` |
| **Litre/saat** | `IDLE_FUEL_L_PER_HOUR = 0.9` — `lib/analytics-shared.ts:28` |
| **EUR/litre** | `DIESEL_EUR_PER_L = 1.65` — `lib/analytics-shared.ts:29` |

Her iki sabitin **tek kaynağı** `lib/analytics-shared.ts` (istemci-güvenli dosya); `lib/analytics.ts:19-20` içe aktarıp `:39-40`'ta yeniden dışa veriyor.

**Formül**
```
hours  = totalMs / 3_600_000                       // lib/analytics.ts:690
liters = hours * IDLE_FUEL_L_PER_HOUR              // :691
euro   = liters * DIESEL_EUR_PER_L                 // :692
totalEuro = (totalMs/3.6e6) * 0.9 * 1.65           // :696-697
```

**Epizod modeli (`idle_episodes`)**
- Tablo: `db/migrations/024_idle_episodes.sql:14-32`. Kritik değişmez: araç başına **en fazla bir açık epizod** — kısmi unique indeks `024:36-38`.
- Durum makinesi: `saveIdleEpisodes` — `lib/telemetry.ts:366-437`.
  `idle=true` & açık yok → INSERT (`:387-405`) · `idle=true` & açık var → yalnız `last_seen_at` ileri (`:408-414`) · `idle=false` / kontak kapalı / hız ≥ 3 km/h → kapat (`:418-432`). Yarış koruması: `23505` hatasında mevcut açık alınır (`:400`).
- Bekçi: `reconcileIdleEpisodes` — `lib/telemetry.ts:446-477`. `last_seen_at` üstünden `MAX_GAP_MS` geçmiş açıklar `ended_at = last_seen_at`, `end_reason='gap_timeout'` ile kapanır. `MAX_GAP_MS = 5 dk` — `lib/metrics-idle.ts:31`.
- Süre: `idleEpisodeDurationMs` — `lib/analytics.ts:401-405`
  `max(0, (ended_at ?? last_seen_at) − started_at) + IDLE_TRIGGER_S × 1000`

**`IDLE_TRIGGER_S = 300`** — `lib/telemetry.ts:27`. Teltonika param **11205**, saniye. Dosya yorumu (`lib/telemetry.ts:15-26`): flespi API'si 11205'i geri okutmuyor, tek doğruluk kaynağı 26 cihaza basılan `setparam 11200:1;11205:300` kurulum komutu. **DB'ye asla yazılmaz**, yalnız ekranda süreye eklenir.

**Gösterildiği ekranlar:** `/admin/analiz` KPI "rölanti €" (`AnalizClient.tsx:348-356`) ve "rölanti saat" (`:341-347`); Bölüm 3 tablosunda litre kolonu (`:226-232`) ve € kolonu (`:234-242`).

**🟡 Bulgu — süre formülü iki yerde kopyalanmış.** `lib/analytics.ts:404` ile `app/admin/alarmlar/page.tsx:146` aynı ifadeyi bağımsız yazıyor. Değerler bugün aynı; tek kaynak değiller.
**🟡 Bulgu — yorum kodla çelişiyor.** `app/admin/alarmlar/page.tsx:141` "flespi'den 11205 okunamadığı için **şu an 0** = ham span" diyor, oysa `:146` `IDLE_TRIGGER_S`(=300) ekliyor. Yorum eski.

**Mobil notu:** Litre/EUR türevi tamamen sunucuda; istemciye `liters`/`euro` hazır iniyor (`IdleWasteRow`, `lib/analytics-shared.ts:105-112`). Ayrı bir istemci hesaplarsa risk **iki katman**: hem 0,9 / 1,65 sabitleri, hem de +300 sn tetik telafisi. İkincisi sessiz: 100 kısa epizot × 5 dk = 8,3 saat fark eder.

---

### 3. Yakıt tüketimi / L100km

**RPC mi Node mu: İKİSİ DE.** Toplulaştırma SQL'de, litreye çevrim ve tüm kapılar Node'da.

| Katman | Ne yapıyor | Yer |
|---|---|---|
| (A) SQL | `report_fuel_stats` — % serisinden de-glitch + dolum/düşüş/ilk/son | `db/migrations/026_report_rpcs.sql:33-132`, **027 ile değiştirildi** `db/migrations/027_fuel_stats_edge_fix.sql:34-145` |
| (A) SQL | `report_fuel_volume_stats` — litre serisinin ikizi | `db/migrations/039_fuel_volume.sql:42-128` |
| (B) Node | RPC çağrıları | `lib/reports.ts:687-690` (yüzde), `lib/reports.ts:703-706` (litre) |
| (B) Node | %→litre çevrim, denge kimliği, üç kapı, filo ortalaması | `lib/reports.ts:805-997` |

**De-glitch (uç-satır) kuralı — TAM METİN, tamamı SQL katmanında** (`027_fuel_stats_edge_fix.sql:75-105`):

```sql
bounded: bwd_max = max(fuel) OVER (PARTITION BY vehicle_id ORDER BY recorded_at
                                   ROWS BETWEEN 30 PRECEDING AND CURRENT ROW)
         fwd_max = max(fuel) OVER (… ROWS BETWEEN CURRENT ROW AND 30 FOLLOWING)
         rn  = row_number() OVER (PARTITION BY vehicle_id ORDER BY recorded_at)
         cnt = count(*)     OVER (PARTITION BY vehicle_id)

clean:   WHERE NOT (
           CASE WHEN rn = 1   THEN fwd_max - fuel >= 10          -- ilk satır: tek taraflı
                WHEN rn = cnt THEN bwd_max - fuel >= 10          -- son satır: tek taraflı
                ELSE bwd_max - fuel >= 10 AND fwd_max - fuel >= 10 -- orta: iki taraflı
           END)
```

Pencere **satır** (`rows`) tabanlı, zaman (`range`) değil — gerekçe `027:71-73`. Eşik **10 puan** = dolum eşiğiyle aynı. 026'daki kusur: `rn=1`'de `bwd_max = fuel` olduğu için koşul yapısal olarak sağlanamıyor, baştaki glitch elenmiyordu (`027:1-15`).

**Diğer SQL eşikleri (027)**
- Dolum: ardışık iki temiz okuma arası `fuel - prev_fuel >= 10` puan — `027:124, 126-128`
- Şüpheli düşüş (kaçak): `prev_fuel - fuel >= 8` **ve** `odo - prev_odo < 1` km **ve** iki okuma arası `<= 3600` sn — `027:129-142`. Odometre yoksa bayrak yok.

**Node tarafı (`lib/reports.ts`)**
```
consumedPct     = max(0, refill_pct + (first_pct − last_pct))     // :903  yakıt denge kimliği
consumedLiters  = cap != null ? (consumedPct/100) * cap : null    // :904
lPer100Km       = gate === null ? (consumedLiters / km) * 100 : null // :921-922
```
Depo kapasitesi `vehicles.tank_capacity_l` (`lib/reports.ts:630`) — **hiçbir migration bu kolonu yaratmıyor**, `scripts/gen-install-sql.mjs:59-68` "KÖPRÜ 1" ile telafi ediliyor.

**Üç kapı — `l100Gate`, `lib/reports.ts:770-803`** (hepsi Node):
1. Payda: `km >= FUEL_MIN_KM = 50` — `lib/metric-thresholds.ts:91`, çağrı `lib/reports.ts:785`
2. Pay: `consumedPct >= FUEL_MIN_CONSUMED_PCT = 15` — `lib/metric-thresholds.ts:103`, çağrı `:787`
3. Pencere örtüşmesi: `overlapMs / fuelMs >= FUEL_MIN_WINDOW_OVERLAP_RATIO = 0.8` — `lib/metric-thresholds.ts:116`, hesap `lib/reports.ts:791-801`
Ayrıca kolon kapısı: `days >= FUEL_L100_MIN_DAYS = 7` — `lib/metric-thresholds.ts:126`, `lib/reports.ts:663-664`.
Yakıt penceresi ayrı sorguyla: `getVehicleFuelSpan` — `lib/analytics.ts:368-399`.

**`report_fuel_volume_stats` ne farklı yapıyor** (`039_fuel_volume.sql`)
- Kaynak kolon `fuel_volume_l` (`039:67, 72`), kısmi indeks `039:26-28`
- Eşikler litreye çevrilmiş: de-glitch çukuru **10 puan → 5 L** (`039:90`), dolum **10 → 5 L** (`039:109, 112`), şüpheli düşüş **8 → 5 L** (`039:117, 121`)
- **Yeni alan** `max_step_l = max(abs(fuel − prev_fuel))` (`039:124-125`) → Node'da gürültü muhafızı: `> FUEL_VOLUME_MAX_STEP_L = 5` ise araç rapora **hiç girmez** (`lib/reports.ts:576, 710`)
- Depo kapasitesi gerekmiyor; %15 eşiğinin yerini `FUEL_MIN_CONSUMED_L = 5` alıyor (`lib/reports.ts:584, 830`)
- **Yüzdenin yerine değil, yokluğunda** devreye giriyor: `lib/reports.ts:818` — `(!s || sample_count === 0) ? volStats.get(v.id) : undefined`

**🔴 Bulgu — 027'nin uç-satır düzeltmesi 039'a taşınmamış.** `039_fuel_volume.sql:87-91` hâlâ 026-tarzı iki taraflı koşul: `WHERE NOT (bwd_max - fuel >= 5 AND fwd_max - fuel >= 5)`. `rn`/`cnt` yok. Yani litre yolunda serinin **ilk ve son** satırındaki glitch elenmiyor — 027'de düzeltilen hatanın birebir aynısı litre hattında yaşıyor.
**🟠 Bulgu — 039'un şüpheli-düşüş filtresinde zaman koşulu yok.** `039:116-123` yalnız `>=5 L` + `odo − prev_odo < 1`; 026/027'deki `extract(epoch …) <= 3600` (`027:134, 141`) karşılığı yok. İki okuma arası günlerce olsa da "kaçak" sayılabilir.

**Arızalı sensör tespiti — (A) sayım + (B) karar**
- Sayım: `device_telemetry` üzerinde `fuel_level_pct = 0` için `count: "exact", head: true` — `lib/reports.ts:749-755`. **HAM veri üzerinde**, de-glitch öncesi (gerekçe `lib/reports.ts:736-744`). Satır taşınmıyor.
- Karar Node'da: `zeroRatio = min(1, zeroCount / max(1, sample_count))` (`:896`), `unreliable = zeroRatio > UNRELIABLE_ZERO_RATIO = 0.1` (`:548, :905`).
- Sonuç: satır sayıları gizlenir (`lPer100Reason = "unreliable_sensor"`, `:779`) **ve** filo toplamlarından çıkarılır (`:980-985`).
- SQL de-glitch bunu bilerek elemiyor — gerekçe `027:24-28`.
- **Litre yolunda ayrı arızalı-sensör kapısı YOK:** `dataUnreliable` sabit `false` (`lib/reports.ts:861`); yerini `max_step_l` muhafızı alıyor.

**Filo L/100km:** yalnız üç kapıyı geçen araçların litre ve km'si ayrı biriktirilip bölünüyor — `lib/reports.ts:974-997`. Gizlenen aracın değeri toplama girmiyor (`:980-985`).

**Mobil notu:** Yakıt zincirinin **hiçbir parçası** istemcide değil; `FuelClient.tsx` yalnız `r.lPer100Km`'i biçimlendiriyor veya `r.lPer100Reason`'ı metne çeviriyor (`app/admin/raporlar/yakit/FuelClient.tsx:89-94, 132-134, 275-286`). Ayrı bir mobil istemcinin bunu tekrar hesaplaması pratikte imkânsız (RPC + 6 eşik + iki farklı yol); risk hesaplama değil, **kapı sebebini taşımayı unutmak** — sayı gizlenir ama "neden yok" kaybolursa ekran "panel bozuk" izlenimi verir (`lib/metric-thresholds.ts:14-19`).

---

### 4. Mesafe / km

**İki tamamen ayrı zincir var ve karışmıyorlar.**

**(a) Rapor + analiz mesafesi = ODOMETRE uç noktaları — (B)**
- `getVehicleDistanceSpan` — `lib/analytics.ts:319-361`. Aralıktaki **en erken** ve **en geç** dolu `odometer_km` okuması, iki indeksli `limit(1)` sorgusu (`:324-345`); fark Node'da alınıyor (`:354`).
- Muhafızlar: `diff < 0` → `inconsistent` (`:355`); `diff > spanDays × MAX_PLAUSIBLE_KM_PER_DAY` → `inconsistent` (`:356-359`). `MAX_PLAUSIBLE_KM_PER_DAY = 800` — `lib/analytics.ts:271`.
- Sebep tipi: `DistanceUnavailableReason = "no_odometer" | "inconsistent" | null` — `lib/analytics.ts:297`.
- Tüketiciler: `loadBase` (`lib/reports.ts:130-163`, üç raporun ortak tabanı), yakıt raporu (`lib/reports.ts:720-725`), analiz sayfası (`app/admin/analiz/page.tsx:60-66`).

**(b) GPS haversine — (B), saf fonksiyon**
- `computeDistanceKm` — `lib/metrics-distance.ts:70-112`. Ardışık noktalar arası büyük-çember kirişleri toplanıyor (`haversineM`, `:48-63`).
- Sabitler `lib/metrics-distance.ts:22-28`: `D_MIN_M = 10` (park kayması), `V_MAX_KMH = 160` (GPS sıçraması), `GAP_MAX_MS = 10 dk` (boşluk köprülenmez), `EARTH_R_M = 6_371_000`.
- Yalnız **iki** tüketici: araç detayı (`app/admin/araclar/[id]/page.tsx:70`) ve `resolveEndKm` yedeği (`lib/auto-shift.ts:258`).

**Coalesce zinciri — soruda `lib/metrics-distance.ts` deniyor ama orada coalesce YOK.** `metrics-distance.ts` saf GPS toplamı. Coalesce iki ayrı yerde:

1. **Alan bazlı coalesce** (seyrek CAN kareleri için) — `lib/telemetry.ts:556-572`:
   `CAN_COALESCE_FIELDS` listesinde `odometer_km` var (`:560`); `LATEST_COALESCE_WINDOW = 40` satır geriye taranıyor (`:572`); uygulama `lib/telemetry.ts:606-615`. En yeni satırda alan `null` ise geriye doğru ilk dolu değer alınıyor.
2. **Vardiya km zinciri** — `lib/auto-shift.ts`:
   - `normalizeOdometerKm` (`:170-177`): `> MAX_ODOMETER` ise `/1000` denenir (metre raporlayan kurulum varsayımı), hâlâ makul değilse `null`.
   - `resolveStartKm` (`:212-230`): **odometre → aracın son biten vardiyasının `end_km` → o vardiyanın `start_km` → 0**
   - `resolveEndKm` (`:242-267`): **odometre (`start_km ≤ odo` ve `odo − start_km ≤ MAX_PER_SHIFT_KM`) → GPS `computeDistanceKm` → null**. Sıra bilinçli, gerekçe `:238-241`.
   - `MAX_ODOMETER = 2_000_000`, `MAX_PER_SHIFT_KM = 5_000` — `lib/validation.ts:92-93`.

**Günlük km hangi katmanda toplanıyor — ÜÇ FARKLI YER**

| Değer | Katman | Yer | Kaynak |
|---|---|---|---|
| Araç başına `kmPerDay` | (B) | `lib/reports.ts:254` — `km / days`; `days` = `rangeDays` `lib/reports.ts:118-123` | telemetri odometresi |
| Filo günlük ortalaması | **(C) tarayıcı** | `app/admin/raporlar/mesafe/DistanceClient.tsx:103` — `report.totalKm / report.days` | telemetri odometresi |
| Panonun "bugünkü km"si | (B) | `buildTodayOps` `lib/admin-dashboard.ts:824-873`, `totalKmToday` `:873`; `kmDiff` `lib/format.ts:149-155` | **`time_entries.end_km − start_km`** |

**🟠 Bulgu — iki farklı km kaynağı aynı gün için farklı sayı verebilir.** Yönetici panosunun `totalKmToday`'i **vardiya alanlarından** (`start_km`/`end_km`), mesafe raporunun km'si **telemetri odometresinin uç noktalarından** geliyor. İkisi normalde aynı odometreye dayanır (`resolveStartKm`/`resolveEndKm` odometreyi tercih ediyor) ama sapabilirler: (i) `resolveEndKm` GPS yedeğine düştüyse (`lib/auto-shift.ts:256-262`) pano GPS km'si gösterir, rapor odometre farkı; (ii) rapor aralığı vardiya dışı hareketi de sayar; (iii) rapor `MAX_PLAUSIBLE_KM_PER_DAY` muhafızıyla `null`'a düşerken pano düşmez.

**Mobil notu:** İki zincirin **karışması** en büyük risk. Ayrı bir mobil istemci "km" isterse hangi tanımı çağırdığı belirtilmezse aynı ekranda odometre-km ile GPS-km yan yana gelebilir; GPS eksik sayar (boşluk köprülenmez, `metrics-distance.ts:83-87`), odometre sıçrayabilir. Ayrıca `DistanceClient.tsx:103`'teki bölme zaten istemcide — mobil karşılığı bunu tekrar yazarsa yuvarlamada ayrışabilir.

---

### 5. CO₂

| | |
|---|---|
| **Hesap yeri** | **(B)** — `lib/co2.ts:11-13` ve `app/actions/fuel.ts:264-339` |
| **Formül** | `co2Kg(liters, fuelType) = liters * (CO2_FACTORS[fuelType] ?? CO2_FACTORS.diesel)` — `lib/co2.ts:12` |

**Sabitler** — `lib/co2.ts:4-9`, birim **kg CO₂ / yakılan litre**, "EU well-to-tank tailpipe" konvansiyonu (dosya yorumu `lib/co2.ts:3`):

| Yakıt | Katsayı |
|---|---|
| diesel | **2.64** |
| benzin | **2.31** |
| lpg | **1.51** |
| elektro | **0** |

**Girdi TELEMETRİ DEĞİL — yakıt FİŞİ.** `generateCO2Report` `fuel_entries` tablosundan `status = 'approved'` satırları okuyor (`app/actions/fuel.ts:276-285`). Araç bağlantısı `vehicle_id` değil `vehicle_plate` TEXT'i üzerinden (`app/actions/fuel.ts:286-289`).

Türev hesaplar (hepsi `app/actions/fuel.ts`):
```
v.co2   += liters * (CO2_FACTORS[fuel_type] ?? diesel)   // :303
km       = max(0, maxKm − minKm)   // fişlerin odometer_km'lerinden, :304-305, :311
lPer100  = km > 0 ? (liters/km)*100 : null               // :316
gPerKm   = km > 0 ? (co2*1000)/km  : null                // :318
avgGPerKm= totalKm > 0 ? (totalCo2*1000)/totalKm : null  // :335
```

**🟡 Bulgu — `co2Kg()` ölü kod.** Grep sonucu `co2Kg(` yalnız `lib/co2.ts:11`'de **tanım** olarak var; tek çağıran `app/actions/fuel.ts:303` katsayı tablosunu doğrudan kullanıyor. Formül bir kez daha elle yazılmış.
**🟡 Bulgu — CO₂ zinciri eşiksiz, bilinçli olarak.** `lib/metric-thresholds.ts:137-143` "KAPSAM DIŞI" notu: CO₂ g/km ve fiş zinciri L/100km aynı payda hastalığını taşıyor ama HAK61'de fiş modülü kullanılmadığı için eşik konulmamış. Kod bunu doğruluyor: tek koruma `km > 0` (`app/actions/fuel.ts:316, 318, 335`), `FUEL_MIN_KM` benzeri bir kapı yok.
**Modül durumu:** `FUEL_ENABLED` varsayılanı **`false`** (`lib/tenant.ts:72`); CO₂ raporu ekranı `app/admin/yakit/page.tsx:13, 38` ile kapalı. Yani bu yol varsayılan kurulumda **erişilemez**.

**Mobil notu:** Sapma riski bugün sıfır — yol kapalı ve tek tüketici bir PDF (`components/pdf/CO2Report.tsx`). Modül açılırsa risk: katsayı tablosunun ikinci kopyası ve `km > 0` dışında payda kapısı olmaması — 5 km'lik fiş aralığında `gPerKm` yüzlerce kata fırlar.

---

### 6. PostgREST 1000 satır tavanı — koda yansıma durumu

**Evet, kapsamlı biçimde yansımış.** Merkezî çözüm `lib/supabase.ts`:

| Öğe | Yer | Değer/işlev |
|---|---|---|
| `PAGE_SIZE` | `lib/supabase.ts:18` | `1000` — "sorgudaki `.limit()` bunu AŞAMAZ" |
| `PAGE_LIMIT` | `lib/supabase.ts:23` | `100` sayfa = 100.000 satır emniyet tavanı |
| `warnTruncated` | `lib/supabase.ts:31-36` | Tavana dayanınca `console.warn` — sessiz kırpma yasağı |
| `fetchAllRows` | `lib/supabase.ts:49-69` | 1000'lik sayfalarla sonuna kadar okur |
| `fetchPagesUntil` | `lib/supabase.ts:83-106` | Sayfalı + erken çıkış (aranan şey serinin başında) |
| `chunkIds` | `lib/supabase.ts:109-113` | `.in()` URL uzunluğu için, varsayılan 100 |

**`.range()` çağrılarının tamamı (18 adet)** — hepsi sayfalama amaçlı:

`lib/admin-dashboard.ts:367` · `lib/depot.ts:298` · `lib/reports.ts:302` · `lib/telemetry.ts:304, 465, 511, 733, 890` · `app/actions/assignments.ts:309` · `app/actions/azg-report.ts:157` · `app/actions/expenses.ts:201, 258` · `app/actions/fuel.ts:216, 284` · `app/admin/page.tsx:129, 248` · `app/admin/workers/page.tsx:51` · `app/panel/gecmis/page.tsx:41`

İkisi `fetchAllRows` kullanmadan **elle** sayfalıyor:
- `listVehicleTrack` — `lib/telemetry.ts:713-739`; `TRACK_PAGE = 1000`, `TRACK_MAX_PAGES = 100` (`:700-701`)
- `app/panel/gecmis/page.tsx:41` — kullanıcı sayfalaması (`PAGE_SIZE`)

**`.limit()` çağrıları (56 adet) — hiçbiri 1000'i aşmıyor.** Dağılım:
- **`.limit(1)` / `.maybeSingle()` — 40+ adet.** Uç-nokta veya varlık sorguları; tavana yapısal olarak takılmazlar. Örn. `lib/analytics.ts:333, 343, 382, 392` (odometre/yakıt uç noktaları), `lib/telemetry.ts:42, 341, 353, 667`, `lib/admin-dashboard.ts:787, 798, 811`.
- **Bilinçli küçük tavanlar:** `app/admin/izinler/page.tsx:140` `ARCHIVE_LIMIT = 200` (`:23`) — tavana çarpma UI'ye `archiveCapped` olarak taşınıyor (`:226`); `app/admin/workers/[id]/page.tsx:82` `.limit(200)`; `app/actions/maintenance.ts:100` `.limit(100)`; `app/admin/page.tsx:226` `.limit(50)`; `lib/leave-edit-log.ts:141` ve `lib/shift-edit-log.ts:107` `.limit(50)`; `lib/login-unlock-log.ts:51` / `lib/worker-admin-log.ts:51` `.limit(20)`; `lib/vehicles.ts:250` `.limit(15)`; `app/actions/auth.ts:161` `.limit(2)`.
- **Pencere okuması:** `lib/telemetry.ts:597` `.limit(LATEST_COALESCE_WINDOW)` = 40 satır.
- **QA betiği:** `scripts/verify-autoshift-parity.mjs:143` `.limit(1000)` — tam tavanda.

**Kod içinde yazılı kurallar ve olay kayıtları**
- `lib/depot.ts:271-279` — `.limit(3000)` sessizce 1000'e kırpılıyordu; yoğun araçta günlük fix 1930–3127, bir gün bile tek sayfaya sığmıyor.
- `lib/depot.ts:429-435` — **canlı hata kaydı:** `.limit(40000)` isteniyordu, PostgREST 1000 döndürüyordu (gerçek 23.217 satırın %4'ü); "14 günün ortalaması" fiilen tek kısmi günden hesaplanıyordu. Çözüm: gün gün + sayfalı (`:437-450`).
- `lib/reports.ts:280-283` — `time_entries` sayfalandı; ~29 şoför × 1 vardiya/gün ile tavan ~34 günde doluyordu.
- `lib/telemetry.ts:450-452` — `reconcileIdleEpisodes` sayfalandı.
- `lib/telemetry.ts:995-998` — **yazılı kural:** "`fetchAllRows` sayfalaması bu dosyada başka altı çağrıda YAŞIYOR — PostgREST 1000 satır tavanı kuralı yürürlükte, ham `.limit()` hâlâ yasak."
- `lib/admin-dashboard.ts:772-774` — "Satır çekmez, VARLIK sorar (`.limit(1)`) — bu yüzden 1000 satır tavanına takılmaz."
- `app/actions/fuel.ts:274-275` — "CO₂ raporu müşteriye çıkar: 1000 satır tavanında sessiz kesinti olmaması için sonuna kadar sayfalanır."

**🔴 Bulgu — kural yazılı ama OTOMATİK MUHAFIZ YOK.** `lib/telemetry.ts:997` "ham `.limit()` hâlâ yasak" diyor; ancak `scripts/check-test-filters.mjs` içinde `limit`/`range`/`1000` geçmiyor (grep: 0 eşleşme) ve `package.json` `verify` zinciri (`lint` → `lint:test-filters` → `build` → `lint:tenant-defaults`) böyle bir denetim içermiyor. Test-verisi ve tenant-varsayılanı için muhafız betiği var, sayfalama için yok — kural yalnız yorumla korunuyor.

**🟡 Bulgu — muhafızsız ama pratikte küçük kalan sorgular.** Ne `.limit()` ne `.range()` taşıyan, yüksek hacimli tabloya giden birkaç sorgu var; hepsinde satır sayısı yapısal olarak küçük:
- `app/admin/workers/[id]/page.tsx:73-77` — `time_entries.select("*")` bir şoförün bir ayı (günde tek vardiya kuralıyla ≤31)
- Açık vardiya sorguları `.is("ended_at", null)`: `lib/vehicles.ts:88-90, 145-148`, `app/admin/harita/page.tsx:47-50` — filo büyüklüğüyle sınırlı (~30)
Bunlar bugün güvenli; tavan denetimi olmadığı için **sessiz büyümeye karşı korumasızlar**.

**🟡 Bulgu — ölü kod.** `listRecentEvents` (`lib/telemetry.ts:256-265`, varsayılan `limit = 100`) için grep'te tanım dışında çağıran yok.

---

## 3c) Hesaplama Nerede — Alarmlar ve performans kutuları

### 1. Alarm sayıları ve gruplama

**Kaynak tablo — İKİ tablo, tek listede birleşiyor**

| Değer | Hesap yeri | dosya:satır |
|---|---|---|
| Nokta-olaylar (`vehicle_events`) | (A) SQL sadece **çekim**; filtre `gte/lte occurred_at`, sayfalama `fetchAllRows` | `lib/telemetry.ts:290-319` |
| Rölanti epizotları (`idle_episodes`) | (A) SQL çekim, `gte/lte started_at` | `lib/telemetry.ts:496-526` |
| İkisinin birleşimi + sıralama | **(B) Node** — `[...events, ...idleRows].sort(...)` | `app/admin/alarmlar/page.tsx:143-164` |
| Epizot → alarm satırı dönüşümü (süre = `ended_at ?? last_seen_at` − `started_at` + `IDLE_TRIGGER_S*1000`) | (B) Node | `app/admin/alarmlar/page.tsx:143-160`; `IDLE_TRIGGER_S = 300` → `lib/telemetry.ts:27` |

**Sayım SQL `count` DEĞİL.** Hiçbir yerde `count: "exact"` kullanılmıyor; bütün alarm sayıları JS dizi işlemleridir:

- **Tip tile'ları (Genel Bakış)** — `Map<event_type, {count, crit, last}>`, **(C) tarayıcı**, `app/admin/alarmlar/AlarmsClient.tsx:207-219`. `useMemo` içinde, `"use client"` (`AlarmsClient.tsx:1`).
- **Alarm Kaydı filtresi + sayacı** — `events.filter(...)`, ekrandaki `logRows.length / events.length` metni **(C) tarayıcı**, `AlarmsClient.tsx:222-236` ve `538-542`.
- **Trend kovaları (gün/saat)** — `Map` + `bump()`, **(B) Node (sunucu bileşeni)**, `app/admin/alarmlar/page.tsx:61-102`.
- **Dönem toplamı / önceki dönem** — `cur.events.length + cur.episodes.length`, (B) Node, `page.tsx:99-100`.

**Gruplama ekseni nerede karar veriliyor**

Ekran-üstü gruplama ekseni **ARAÇ × OLAY TİPİ** (şoför değil, kova değil). Karar tek satırda:

```
getKey: (e) => e.event_type === "idling" ? `idle:${e.id}` : `${e.vehicle_id}:${e.event_type}`
```
`app/admin/alarmlar/AlarmsClient.tsx:570`. Pencere `STORM_WINDOW_MS = 10 * 60 * 1000` (`AlarmsClient.tsx:75`), `AlarmsClient.tsx:571-572`'de `getTime`/`windowMs` olarak geçiyor. `idling` bilinçli olarak gruplama dışı (her epizoda benzersiz anahtar).

Gruplamayı gerçekten uygulayan algoritma **(C) tarayıcı**: `buildItems()` — ardışık satırlar aynı anahtar VE pencere içindeyse tek "grup satırı" olur, `components/ui-v2/DataTable.tsx:68-100`, `useMemo` ile `DataTable.tsx:158`.

Şoför ekseni yalnız **etiket** düzeyinde var, gruplama ekseni değil: şoför adı `vehicles.driver_name`'den araç id üzerinden türetiliyor (`page.tsx:208-212`, `AlarmsClient.tsx:180-184`) — geçmişe dönük kusur kodda açıkça yazılı (`page.tsx:201-207`).

Şoför ekseni ayrıca **Analiz/Performans** tarafında var ve orada da araç üzerinden türetiliyor: `vehicleWorker` haritası, `lib/reports.ts:335-350`; skor tarafında `vehiclesById.get(e.vehicle_id).assigned_worker_id`, `lib/analytics.ts:515-526`.

**Kritik bant nasıl ayrılıyor**

Kritik bant **ayrı bir liste bölümü değil**. Üç yerde ayrışıyor, üçü de `eventTone(...) === "critical"` ile:

| Yer | Hesap yeri | dosya:satır |
|---|---|---|
| Tile'daki kırmızı sayaç rozeti (`tile.crit`) | (C) tarayıcı | `AlarmsClient.tsx:212`, render `AlarmsClient.tsx:421-425` |
| Trend barının kritik kısmı (`bucket.critical`) | (B) Node | `app/admin/alarmlar/page.tsx:92` |
| "Şiddet" pill filtresi (critical/warning/neutral) | (C) tarayıcı | `AlarmsClient.tsx:226`, seçenekler `AlarmsClient.tsx:526-533` |

Tablo sıralamasında kritik öne alınıyor ama **gruplamadan muaf değil**: `EVENT_TONE_RANK` farkı, `AlarmsClient.tsx:231-233`; sıralama ağırlıkları `lib/event-ui.ts:65-74`. `buildItems` kritik satırı istisna tutmuyor (`DataTable.tsx:68-100`).

**Aralık (pencere) kararı** — `epoch | today | 7d | 30d`, hepsi **(B) Node**: `computeRange`, `app/admin/alarmlar/page.tsx:35-46`. Varsayılan: `device_config_epochs` kaydı varsa `epoch`, yoksa `7d` (`page.tsx:117-125`). Epoch kaydı `lib/config-epoch.ts:34-57` (migration 033). Trend karşılaştırması eşik sınırını kesiyorsa **hiç yapılmıyor** (`page.tsx:176-187`, kural `lib/config-epoch.ts:84-97`).

**Mobil notu (alarm)**
- Tile ızgarası: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — mobilde tek kolon, `AlarmsClient.tsx:394`.
- Tabloda "Hız" kolonu mobilde **gizli**: `hideBelow: "sm"` (`AlarmsClient.tsx:317`), sınıf eşlemesi `DataTable.tsx:51-53` (`hidden sm:table-cell`).
- Trend grafiği mobilde de render ediliyor, sabit `height={150}` (`AlarmsClient.tsx:483`); recharts `ResponsiveContainer` (`components/ui-v2/MiniTrend.tsx:6`).
- Filtre pill'leri `flex-wrap` (`AlarmsClient.tsx:492`).
- Kapsam notu: `/admin/alarmlar` `requireAdmin()` ile korunuyor (`page.tsx:109`) ve **filo kapsamı UYGULANMIYOR** — `listEventsInRange`/`listIdleEpisodesInRange` kapsam parametresi almıyor, `listVehiclesWithStatus()` argümansız çağrılıyor (`page.tsx:134-138`; imza `lib/vehicles.ts:136-138`). Yalnız test-verisi elemesi var (`lib/telemetry.ts:306-307`, `513-514`).

---

### 2. Alarm türleri (kodda tanımlı TÜM olay türleri)

Kanonik liste migration'da yazılı: `db/migrations/018_vehicle_events.sql:11-12`. Etiketler `messages/tr.json` → `alarms.type`.

| event_type | TR etiket | UI tonu (ChipTone) | Eski severity | Kaynak sistem |
|---|---|---|---|---|
| `crash` | Çarpma | `critical` | `red` | **flespi** — `crash.event` (AVL 247), `lib/flespi.ts:387-398` |
| `towing` | Çekilme | `critical` | `red` | **flespi [VARSAYIM]** — `towing.event` / `towing.status` / `towing.detection.status`; parametre adı dokümanda bulunamadı, `lib/flespi.ts:429-432` (uyarı `lib/flespi.ts:361-362`) |
| `unplug` | Cihaz Söküldü | `critical` | `gray` | **flespi [VARSAYIM]** — `unplug.event` / `unplug.status` / `battery.unplug.status`, `lib/flespi.ts:433-435` |
| `jamming` | Sinyal Karıştırma | `critical` | `gray` | **flespi** — `gsm.jamming.alarm.status` (AVL 249), `lib/flespi.ts:426-428` |
| `overspeeding` | Aşırı Hız | `warning` | `yellow` | **flespi** — `overspeeding.status` VEYA `geofence.overspeeding.status` (AVL 157/248), değer `overspeeding.speed`, `lib/flespi.ts:413-420` |
| `idling` | Uzun Rölanti | `warning` | `gray` | **TÜRETİLMİŞ** — `vehicle_events`'te ARTIK üretilmiyor; `idle.status` geçişleri `idle_episodes` durum makinesine yazılıyor (migration 024). Gerekçe `lib/flespi.ts:421-425`; epizot çıkarımı `lib/flespi.ts:440-449`; alarm satırına dönüşüm `app/admin/alarmlar/page.tsx:143-160` |
| `harsh_acceleration` | Ani Hızlanma | `neutral` | `orange` | **flespi** — `harsh.acceleration.event` (AVL 253), `lib/flespi.ts:399-401` |
| `harsh_braking` | Ani Fren | `neutral` | `orange` | **flespi** — `harsh.braking.event`, `lib/flespi.ts:402-404` |
| `harsh_cornering` | Sert Viraj | `neutral` | `orange` | **flespi** — `harsh.cornering.event` + `harsh.cornering.angle` (AVL 254), `lib/flespi.ts:405-412` |

**Ton eşlemesi — İKİ ayrı tablo, ikisi de `lib/event-ui.ts`:**
- `EVENT_SEVERITY` (eski, red/orange/yellow/gray): `lib/event-ui.ts:10-20`. Kullanımı `EVENT_BADGE` (`:23-28`) ve `EVENT_ICON_STYLE` (`:31-36`).
- `EVENT_TONE` (yürürlükteki UI V2 eşlemesi): `lib/event-ui.ts:48-58`. FARK bilinçli — `jamming` ve `unplug` eski tabloda `gray` iken burada `critical` (gerekçe `lib/event-ui.ts:42-45`).
- Sıralama ağırlığı `EVENT_TONE_RANK`: `lib/event-ui.ts:65-74`. Şerit rengi `EVENT_STRIPE`: `lib/event-ui.ts:77-86`.

**Skorda kullanılan alt küme (6 tür):** `SAFETY_SCORE_WEIGHTS` — `overspeeding:25`, `jamming:25`, `harsh_braking:12`, `harsh_acceleration:12`, `harsh_cornering:12`, `idling:5` (`lib/analytics-shared.ts:18-25`). `crash`, `towing`, `unplug` skorda **ağırlıksız** → `weight === undefined` → atlanıyor (`lib/analytics.ts:518-519`).

**Analiz Top-10 / aylık pivot alt kümesi (6 tür):** `TOP10_EVENT_TYPES` — `crash/towing/unplug` yine dışarıda, `lib/analytics-shared.ts:31-38`.

**Çift-yazım koruması (A) SQL:** `uq_vehicle_events_dedup (vehicle_id, event_type, occurred_at)` — `db/migrations/018_vehicle_events.sql:35-36`.

**DTC (arıza kodu) alarm DEĞİL, ayrı yüzey.** `vehicle_dtc` tablosu, şiddet alanı YOK (`lib/telemetry.ts:863-873`). Sözlük `lib/dtc-codes.ts:29+` (`DTC_CODES`, TR+DE, `server-only` — `lib/dtc-codes.ts:1`); sözlükte olmayan kod için tanım uydurulmuyor (`lib/dtc-codes.ts:5-9`). Migration 022 yalnız `first_seen_odometer_km` kolonu ekliyor (`db/migrations/022_dtc_enrichment.sql:13-14`). Filo özeti **(B) Node** — `listFleetActiveDtc`, sayım `row.count++` ile JS'te, `lib/telemetry.ts:879-915`.

**`lib/status-ui.ts` alarmla ilgili DEĞİL:** yalnız 17 satır, onay durumu (`ApprovalStatus`) rozet/şerit eşlemesi — `lib/status-ui.ts:3-17`.

---

### 3. Performans kutuları (7 günlük pencere)

**Ekran:** `/admin/raporlar/performans` — `app/admin/raporlar/performans/page.tsx`.

| Değer | Hesap yeri | dosya:satır |
|---|---|---|
| Aralık anahtarı (varsayılan `hafta`) | (B) Node | `app/admin/raporlar/performans/page.tsx:21-23` |
| Pencere hesabı | (B) Node | `computeAnalyticsRange`, `lib/analytics.ts:162-184` |
| Rapor gövdesi | (B) Node | `buildPerformanceReport`, `lib/reports.ts:273-416` |
| Kutuların render'ı | (C) tarayıcı (yalnız biçimleme) | `PerformanceClient.tsx:195-220`, `ReportStatBand` |

**Pencere KAYAN (sliding), takvim DEĞİL.** Kesin kod:

```
function slidingWindow(days) { start: addCalendarDaysVienna(startOfTodayVienna(), -(days - 1)), end: endOfTodayVienna() }
```
`lib/analytics.ts:135-140`. `SLIDING_WEEK_DAYS = 7`, `SLIDING_MONTH_DAYS = 30` — `lib/analytics.ts:131-132`. `case "hafta"` → `slidingWindow(7)`, `lib/analytics.ts:180-183`. Gerekçe (takvim penceresinin haftanın başında çökmesi, canlı ölçüm) `lib/analytics.ts:142-161`. Aynı kayan pencere yönetici panosunda da kullanılıyor — `app/admin/page.tsx:49-60`.

**Kutu olan metrikler (`ReportStat[]`, 2–4 kutu):**

| Kutu | Değer | Hesap yeri | dosya:satır |
|---|---|---|---|
| Ortalama skor | `avgScore` (skorlanmışların ortalaması, `null`'lar sayılmaz) | (B) Node | hesap `lib/reports.ts:408-410`, kutu `PerformanceClient.tsx:196-204` |
| En iyi şoför | 3 şart birden: ≥`TOP_DRIVER_MIN_SCORED`(=2) skorlanmış, en yüksek > ikinci, en yüksek > 0 | **(C) tarayıcı** | `PerformanceClient.tsx:182-191`; eşik `lib/metric-thresholds.ts:82` |
| Vardiya | `totalShifts` | (B) Node | `lib/reports.ts:411` |
| Çalışma | `totalWorkedMs` | (B) Node | `lib/reports.ts:412` |

⚠️ İlk iki kutu **`SAFETY_SCORE_CALIBRATED` false ise HİÇ render edilmiyor** (`PerformanceClient.tsx:196` ve `:186`). Bayrak müşteriye özel: `lib/metric-thresholds.ts:57` → `export { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant"`. HAK61 için açık (gerekçe `lib/metric-thresholds.ts:32-51`); yeni kurulumda kapalı başlıyor (`lib/metric-thresholds.ts:53-56`).

`totalKm` ve `scoredCount` **rapor tipinde var ama kutu DEĞİL** — `totalKm` (`lib/reports.ts:413`) hiçbir `ReportStat`'ta kullanılmıyor; `scoredCount` yalnız ortalama-skor kutusunun `scope` alt metni (`PerformanceClient.tsx:201`).

**Satır metrikleri (kolon, kutu değil):** `shifts`, `workedMs`, `km`, `delivered`, `undelivered`, `safetyScore`, `events` (+ `harshBraking`/`harshAcceleration`/`overspeeding` kırılımı) — tip `lib/reports.ts:95-106`, doldurma `lib/reports.ts:373-395`, kolonlar `PerformanceClient.tsx:79-167`.

**Güvenlik skoru formülü — (B) Node:** `100 × K / (K + ceza/1000km)`, `lib/analytics.ts:571-577`. `SAFETY_SCORE_K = 500` (`lib/metric-thresholds.ts:64`). Yeterli-veri kapısı: `reliableKm >= effectiveMinKm` değilse skor `null` (`lib/analytics.ts:570`). Eşik **aralık uzunluğuna değil şoförün odometre penceresine** göre ölçekleniyor: `scoreMinKmForSpan`, `lib/analytics.ts:110-128`; `SCORE_MIN_KM_PER_DAY = 40` (`lib/metric-thresholds.ts:74`). Performans raporu bu fonksiyonu Analiz sayfasıyla aynı şekilde geçiriyor (`lib/reports.ts:323-329`).

**Vardiya verisi (A+B):** SQL `time_entries` sorgusu `gte/lte started_at`, `fetchAllRows` ile sayfalı (PostgREST 1000 satır tavanı), üç kapsam elemesi — test + şoför (`lib/reports.ts:284-310`). Toplama **(B) Node**, `shiftByWorker` döngüsü `lib/reports.ts:352-371`. Olay sayıları **(B) Node**, `evByWorker` döngüsü `lib/reports.ts:340-350`.

**Mobil notu (performans)**
- Ölçüm bandı: `grid gap-px sm:grid-cols-2 lg:grid-cols-{3|4}` — **mobilde tek kolon, alt alta**, `components/admin/ReportStatBand.tsx:48-49`.
- Tablo kolonları mobilde gizli: `worked` → `hideBelow: "sm"` (`PerformanceClient.tsx:120`); `km` ve `delivered` → `hideBelow: "md"` (`PerformanceClient.tsx:131`, `:142`). Yani mobilde yalnız Ad / Vardiya / Olay (+ skor açıksa) görünüyor.
- PDF dışa aktarma butonu mobilde de var, skor sütunu `showScore: SAFETY_SCORE_CALIBRATED` ile koşullu (`PerformanceClient.tsx:48`).

---

### 4. Dikkat/Aksiyon panosu kalemleri (`lib/admin-dashboard.ts`)

Tip birliği `AttentionItem`: `lib/admin-dashboard.ts:74-191`. Kurulum **(B) Node**: `buildAttention()`, `lib/admin-dashboard.ts:1075-1379`. Çağrı `lib/admin-dashboard.ts:720-735`. Render **(C) tarayıcı**: `components/admin/AttentionList.tsx` (`"use client"`, satır 1), yerleşim `app/admin/AdminClient.tsx:730-738`.

| # | kind | Ne tetikliyor | Eşik | Sorgu / kaynak | Hesap yeri | dosya:satır |
|---|---|---|---|---|---|---|
| 1 | `overLimit` | Vardiya günlük yasal tavanı aştı | **12 sa**; gece penceresine (00:00–04:00 Viyana) değiyorsa **10 sa** | `time_entries` bugün + hâlâ açık olan her vardiya | (B) Node | kalem `:1131-1149`; eşik `lib/azg-rules.ts:27,34,125-127`; gece testi `lib/azg-rules.ts:88-119` |
| 2 | `break45` | 9 saati aştı ve molası gerekenin altında | **9 sa** (`BREAK45_THRESHOLD_MS`), gereken mola **45 dk** (>9 sa) / 30 dk (>6 sa) | aynı `azgEntries` kümesi | (B) Node | `:1151-1161`; `lib/azg-rules.ts:45-56,133`. `overLimit` düşen vardiya buraya girmiyor (`:1148 continue`) |
| 3 | `inspection` | Muayene tarihi yaklaştı/geçti | `\|days\| ≤ 30` — **iki taraflı** (`DOC_DUE_WINDOW_DAYS`) | `vehicles.inspection_due` | (B) Node | `:1170-1179`; sabit `:36-37` |
| 4 | `insurance` | Sigorta tarihi yaklaştı/geçti | aynı, ≤30 gün iki taraflı | `vehicles.insurance_due` | (B) Node | `:1170-1179` |
| 5 | `undelivered` | Vardiyada teslim edilemeyen paket çok | **≥ 5** (`UNDELIVERED_THRESHOLD`) | aralıktaki `time_entries.undelivered_count` | (B) Node | `:1182-1193`; sabit `:35` |
| 6 | `penalty` | Ödenmemiş araç cezası (araç başına toplanır) | eşik yok, `paid=false` olan her kayıt | `vehicle_penalties` `.eq("paid", false)`, **araç ekseniyle** filo daraltması | (A) SQL filtre + (B) Node toplama | sorgu `:439-449`; toplama `:1196-1215` |
| 7 | `license` | Şoför ehliyeti doldu/dolmak üzere | **≤ 30 gün** — **alt sınır YOK** (dolmuş ehliyet listede kalır) | `workers.license_expiry`, `is_active=true`, driver-scoped | (A) SQL filtre + (B) Node gün hesabı | sorgu `:414-437`; kalem `:1222-1234`; sabit `:39`; gerekçe `:1217-1221` |
| 8 | `silent` | Cihazlı aktif araç uzun süredir hiç telemetri yok | **≥ 24 saat** (`TELEMETRY_SILENT_HOURS`) | `listLatestVehiclePositions(fleetScope)` (araç başına indeksli limit-1) | (B) Node | `:1249-1260`; sabit `:47`; gerekçe (saatlik heartbeat kanıtı) `:40-46` |
| 9 | `movingNoShift` | Araç kontak açık + taze telemetri, o araçta AÇIK vardiya YOK, **ama atanmış şoförü VAR** | tazelik **15 dk** (`MOVING_FRESH_MS`), `ignition_on === true` | `positions` × `openVehicleIds` | (B) Node | `:1275-1286`; sabit `:50`; `openVehicleIds` `:573-575` |
| 10 | `unassignedMoving` | Aynı tarama, ama `assigned_worker_id === null` | aynı (15 dk + kontak) | aynı | (B) Node | `:1281-1285` (üçlü operatörün ilk dalı); gerekçe `:1268-1274` |
| 11 | `driverless` | Aktif aracın atanmış şoförü **işten ayrılmış** (`is_active === false`) | eşik yok | `vehicles` × `inactiveWorkerIds` | (B) Node | `:1291-1301`; küme `:578-580` |
| 12 | `locationUnverified` | Bugün açılan vardiyada depo kapısı konumu doğrulayamadı | eşik yok, bayrak `true` | `time_entries.location_unverified = true` + `started_at ≥ bugün` | (A) SQL filtre + (B) Node isim çözme | sorgu `:479-496`; kalem `:1305-1311`; ayrıştırma migration `db/migrations/038_start_time_estimated.sql:17-19` |
| 13 | `startEstimated` | Bugün açılan vardiyanın başlangıç ANI kestirim (14 gün ortalaması ya da "şimdi") | eşik yok, bayrak `true` | `time_entries.start_time_estimated = true` + bugün | (A) SQL filtre + (B) Node | sorgu `:501-518`; kalem `:1315-1321`; migration `038_start_time_estimated.sql:27-32` (+ geriye dönük ayrıştırma `:39-60`) |
| 14 | `vehicleIdle` | Auto vardiya uzun süre açık AMA araçtan hiç hareket kanıtı yok | vardiya yaşı **≥ 3 sa** (`IDLE_VEHICLE_MS`); hareket eşikleri: hız **> 5 km/h** (`IDLE_MOVE_SPEED_KMH`) VEYA `ignition_on` VEYA odometre **≥ 1 km** (`IDLE_MIN_ODOMETER_DELTA_KM`) | `shift_packages` varlık sorgusu + `device_telemetry` üç sorgu (`.limit(1)`, satır çekmez) | (A) SQL varlık sorguları + (B) Node karar | aday seçimi `:616-624`; karar `:625-646`; `vehicleMovedSince` `:775-822`; `shiftHasPackages` `:748-760`; sabitler `:743-745`; kalem `:1324-1326` |
| 15 | `manualStart` | **Filo şefi** bir personelin mesaisini elle başlattı | eşik yok; **yalnız `start_source = 'chief'`** (patron başlatmaları gösterilmiyor) | `time_entries.start_source='chief'` + bugün; eksik `started_by` isimleri ayrı `workers` sorgusuyla | (A) SQL filtre + (B) Node isim çözme | sorgu `:524-541`; isim çözme `:652-690`; kalem `:1330-1338`; migration 037 |

**`vehicleIdle` fail-quiet kuralı (kritik):** `vehicleMovedSince` üç değer döndürüyor — `true` (hareket var), `false` (telemetri VAR ama hareket yok), `null` (hiç fix yok / sorgu hatası). Uyarı **yalnız `false`** için çıkıyor: `if (moved !== false) return null`, `lib/admin-dashboard.ts:636`. Gerekçe `:613-615` — sessiz cihazın kendi kalemi (`silent`) zaten var.

**Sıralama (öncelik) — (B) Node, `weight()` fonksiyonu, `lib/admin-dashboard.ts:1341-1378`.** Küçük ağırlık = üstte:

`license` (`days − 0.5`) → `inspection`/`insurance` (`days`) → `silent` (`50 − saat/24`) → `manualStart` (78) → `vehicleIdle` (80) → `locationUnverified` (85) → `startEstimated` (86) → `movingNoShift` (90) → `unassignedMoving` (92) → `driverless` (95) → `penalty` (`100 − count`) → `overLimit` (`1000 − saat`) → `break45` (`1500 − saat`) → `undelivered` (`2000 − count`).

**Kapsam elemesi — üç eksen, hepsi sorgu seviyesinde:** test verisi (`withoutTestRows`, migration 028), filo (`onlyFleet`, migration 029), şoför (`onlyDrivers`, `lib/driver-scope.ts`). Kurulum `lib/admin-dashboard.ts:304-307`; her sorguda uygulanışı `:328-541`. Ceza sorgusu bilinçli olarak **araç** ekseniyle daraltılıyor, şoför ekseniyle değil (`:444-448`).

**Aralık:** Dikkat panosu `getDashboardData(rangeStart, rangeEnd, fleetScope)` ile besleniyor (`app/admin/page.tsx:149`); yönetici panosunun aralık seçicisi de **kayan pencere** (7/30 gün) — `app/admin/page.tsx:44-68`. Ama AZG kalemleri (1-2) aralığın tamamını taramıyor: **bugün başlayanlar + hâlâ açık olan her vardiya** (`lib/admin-dashboard.ts:1127-1129`, gerekçe `:1124-1126`). Kalem 12/13/15 de yalnız **bugün** (`.gte("started_at", todayStart)`).

**Mobil notu (Dikkat panosu)**
- Yerleşim `grid gap-5 lg:grid-cols-3` — **mobilde tam genişlik, tek kolon**, `app/admin/AdminClient.tsx:729`.
- Liste gövdesi `max-h-[320px] overflow-y-auto` — mobilde de **iç kaydırma**, `components/admin/AttentionList.tsx:213`.
- Uyarı metni her ekran boyutunda **sarıyor**, kırpılmıyor: `flex-1 text-sm break-words` (`AttentionList.tsx:236`); eski `sm:truncate` bilinçli kaldırılmış (gerekçe `AttentionList.tsx:230-235`).
- Tek mobil kısaltma: `undelivered` kalemindeki "Düzelt" butonunun **metni** mobilde gizli, ikon kalıyor — `hidden sm:inline`, `AttentionList.tsx:249`.
- Sessiz araç sayacı Dikkat panosuyla aynı kaynaktan türetiliyor (iki yerde farklı sayı çıkamaz): `dashboard.attention.filter(a => a.kind === "silent").length`, `app/admin/AdminClient.tsx:190-193`.

---

## 4) Veritabanı Fonksiyonları (RPC) ve Şema

### 1. VERİTABANI FONKSİYONLARI (RPC)

#### 1.1 Rapor RPC'leri

| Fonksiyon | Parametreler | Dönen tip (kolonlar) | Ne hesaplar | Tanım (dosya:satır) | Kod içinde çağrıldığı yer |
|---|---|---|---|---|---|
| `public.report_fuel_stats` | `p_from timestamptz`, `p_to timestamptz` (varsayılan YOK) | `TABLE(vehicle_id uuid, sample_count bigint, avg_pct double precision, min_pct double precision, max_pct double precision, first_pct double precision, last_pct double precision, refill_count bigint, refill_pct double precision, drop_count bigint, drop_pct double precision)` | `device_telemetry.fuel_level_pct` üzerinden araç başına yakıt YÜZDESİ istatistiği: örnek sayısı, ort/min/maks, aralığın ilk/son okuması; DOLUM = ardışık iki okuma arası ≥ +10 puan sıçrama (sayı + toplam puan); ŞÜPHELİ DÜŞÜŞ = ≥8 puan düşüş + odometre farkı < 1 km + iki okuma arası ≤ 3600 sn. Öncesinde 30-satırlık `rows` penceresiyle "V-çukuru" de-glitch. Birim-bağımsız (yalnız %); litre çevrimi uygulamada `vehicles.tank_capacity_l` ile yapılır. | `db/migrations/026_report_rpcs.sql:33` (ilk sürüm) ve `db/migrations/027_fuel_stats_edge_fix.sql:34` (geçerli sürüm); kurulum dosyasında `db/install/sendigo-full.sql:1328` ve `db/install/sendigo-full.sql:1542` | `lib/reports.ts:687` (`supabaseAdmin.rpc("report_fuel_stats", { p_from, p_to })`); `scripts/verify-metrics-sane.mjs:84` |
| `public.report_coolant_stats` | `p_from timestamptz`, `p_to timestamptz` | `TABLE(vehicle_id uuid, sample_count bigint, avg_c double precision, max_c double precision, min_c double precision, hot_count bigint)` | `device_telemetry.coolant_temp_c` üzerinden araç başına soğutma suyu sıcaklığı: örnek sayısı, ort/maks/min °C ve `hot_count` = ≥105 °C okuma sayısı. | `db/migrations/026_report_rpcs.sql:139`; `db/install/sendigo-full.sql:1434` | **Repoda çağrı yeri YOK.** `db/`, `node_modules/`, `.next/` dışındaki tüm dosyalarda `rpc(` ve `report_coolant_stats` araması yalnız `report_fuel_stats` / `report_fuel_volume_stats` çağrılarını buluyor (`lib/reports.ts:687`, `lib/reports.ts:703`, `scripts/verify-metrics-sane.mjs:84`). |
| `public.report_coolant_daily` | `p_from timestamptz`, `p_to timestamptz` | `TABLE(day date, avg_c double precision, max_c double precision, sample_count bigint)` | Filo geneli GÜNLÜK sıcaklık trendi; gün anahtarı `(recorded_at at time zone 'Europe/Vienna')::date`, `order by day`. | `db/migrations/026_report_rpcs.sql:171`; `db/install/sendigo-full.sql:1466` | **Repoda çağrı yeri YOK** (yukarıdaki aynı arama). |
| `public.report_fuel_volume_stats` | `p_from timestamptz`, `p_to timestamptz` | `TABLE(vehicle_id uuid, sample_count bigint, avg_l double precision, min_l double precision, max_l double precision, first_l double precision, last_l double precision, refill_count bigint, refill_l double precision, drop_count bigint, drop_l double precision, max_step_l double precision)` | `device_telemetry.fuel_volume_l` (LİTRE) üzerinden `report_fuel_stats`'ın ikizi. Aynı iskelet, eşikler litreye çevrilmiş: de-glitch çukuru 5 L, dolum eşiği ≥5 L, şüpheli düşüş ≥5 L + odometre farkı < 1 km. **Fark 1:** ek kolon `max_step_l` = ardışık okumalar arası en büyük MUTLAK sıçrama (gürültü muhafızı). **Fark 2:** yüzde sürümündeki `<= 3600 sn` zaman koşulu litre sürümünde YOK (`db/migrations/039_fuel_volume.sql:116-119`). **Fark 3:** uç-satır (rn/cnt) düzeltmesi litre sürümünde YOK — de-glitch iki taraflı kalmış (`db/migrations/039_fuel_volume.sql:90`). | `db/migrations/039_fuel_volume.sql:42`; `db/install/sendigo-full.sql:2263` | `lib/reports.ts:703-706` (`supabaseAdmin.rpc("report_fuel_volume_stats", { p_from, p_to })`); gürültü muhafızı `lib/reports.ts:710` (`max_step_l > FUEL_VOLUME_MAX_STEP_L` ise satır atılır) |

#### 1.2 `report_fuel_stats` çift tanımı — hangisi geçerli

- **İmza DEĞİŞMİYOR.** 026 ve 027 aynı parametre listesini (`p_from timestamptz, p_to timestamptz`) ve **birebir aynı `returns table (...)` kolon kümesini** kullanıyor: `026:33-49` ile `027:34-50` karşılaştırıldığında 11 kolon adı ve tipi aynı. Bu yüzden PostgreSQL yeni bir overload YARATMAZ; `create or replace function` mevcut fonksiyonun gövdesini değiştirir.
- **027, 026'yı ezer.** Kurulum dosyasında sıra korunmuş: 026 gövdesi `db/install/sendigo-full.sql:1328`, 027 gövdesi `db/install/sendigo-full.sql:1542`. Dosyanın tamamı tek transaction (`sendigo-full.sql:40` `begin;` → `sendigo-full.sql:2545` `commit;`), sonuncu `create or replace` kazanır.
- **Canlıda geçerli olan: 027 sürümü.** İki gövde arasındaki tek fark de-glitch `clean` CTE'si:
  - 026 (`026_report_rpcs.sql:91`, kurulumda `sendigo-full.sql:1386`): `where not (bwd_max - fuel >= 10 and fwd_max - fuel >= 10)` — iki taraflı koşul.
  - 027 (`027_fuel_stats_edge_fix.sql:95-104`): `bounded` CTE'sine `row_number() over (...) as rn` ve `count(*) over (...) as cnt` eklenmiş (`027:86-89`); `clean` bir `case` ile uçlarda tek taraflı karar veriyor — `rn = 1` iken yalnız `fwd_max`, `rn = cnt` iken yalnız `bwd_max`, ortada kural değişmiyor.
- 027'nin başlığı bunu açıkça söylüyor: "026 GERİYE DÖNÜK DEĞİŞTİRİLMEDİ: onu çalıştırmış kurulumlar bu dosyayı da çalıştırır; sıfırdan kurulanlar 026 → 027 sırasıyla doğru sonuca ulaşır." (`027_fuel_stats_edge_fix.sql:30-31`).

#### 1.3 EXECUTE yetkileri

- `026_report_rpcs.sql:199-204`: üç fonksiyon için `revoke execute ... from public` + `grant execute ... to service_role`. Kurulumda `sendigo-full.sql:1494-1499`.
- `027_fuel_stats_edge_fix.sql:147-148`: `report_fuel_stats` için revoke/grant tekrarlanıyor.
- `report_fuel_volume_stats` için **hiç revoke/grant YOK** — `039_fuel_volume.sql` dosyasında (satır 42-130) yalnız fonksiyon tanımı ve `notify pgrst` var; kurulum dosyasında da (`sendigo-full.sql:2263-2351`) aynı.
- Her migration sonunda `notify pgrst, 'reload schema';` (`026:207`, `027:150`, `039:130`).

#### 1.4 Trigger fonksiyonları ve trigger'lar

| Fonksiyon | Dil / dönüş | Ne yapar | Tanım | Bağlı trigger'lar |
|---|---|---|---|---|
| `update_assignments_updated_at()` | `plpgsql`, `returns trigger` | `new.updated_at = now(); return new;` | `db/install/sendigo-full.sql:326-332` (kaynak: `db/migrations/006_assignments.sql`) | `trg_assignments_updated_at` — `before update on public.assignments for each row` (`sendigo-full.sql:334-337`) |
| `update_updated_at()` | `plpgsql`, `returns trigger` | `new.updated_at = now(); return new;` (genel sürüm; assignments 006'daki kendi fonksiyonunu kullanır) | `db/install/sendigo-full.sql:433-439` (kaynak: `db/migrations/007_fuel_expenses.sql`) | `trg_fuel_entries_updated_at` (`sendigo-full.sql:441-444`), `trg_expense_entries_updated_at` (`sendigo-full.sql:446-449`), `trg_vehicle_maintenance_updated_at` (`sendigo-full.sql:451-454`) — üçü de `before update ... for each row` |

Kurulum dosyasının tamamında başka `create trigger` / trigger fonksiyonu YOK (grep: `^create trigger` yalnız 335, 442, 447, 452 satırlarını veriyor).

Not: `worker_leaves.updated_at` (`sendigo-full.sql:1918`) ve `time_entries.updated_at` (`sendigo-full.sql:134`) için trigger YOK — bu kolonlar yalnız uygulama tarafından yazılır.

#### 1.5 İki kurulum dosyası

`db/install/galzura-full.sql` ile `db/install/sendigo-full.sql` `diff`'i **tek satır** fark veriyor: 2. satırdaki başlık (`GALZURA` vs `SENDIGO`). Şema, RPC'ler, indeksler ve seed satırları birebir aynı.

---

### 2. TABLO ENVANTERİ (`db/install/sendigo-full.sql`)

Kurulum dosyası 26 `public` tablosu yaratıyor (+ `storage.buckets`'a 4 bucket satırı ekliyor). Kolonlar birden çok migration bloğuna dağılmış; aşağıda her tablo için tüm bloklar birleştirilmiştir.

#### 2.1 Mobil için kritik tablolar (tam kolon listesi)

##### `workers` — şoför + yönetici kayıtları (giriş, PIN, personel dosyası)

| Kolon | Tip / kısıt | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `sendigo-full.sql:94` |
| `name` | `text not null` | `:95` |
| `phone` | `text not null unique` | `:96` |
| `pin_hash` | `text not null` (bcrypt) | `:97` |
| `plate` | `text` (türetilmiş ayna) | `:98` |
| `is_admin` | `boolean not null default false` | `:99` |
| `is_active` | `boolean not null default true` | `:100` |
| `created_at` | `timestamptz not null default now()` | `:101` |
| `employee_number` | `text` (kısmi UNIQUE indeks) | `:203` |
| `telegram_chat_id` | `text` | `:239` |
| `telegram_username` | `text` | `:240` |
| `telegram_linked_at` | `timestamptz` | `:241` |
| `telegram_locale` | `text` | `:242` |
| `must_change_pin` | `boolean not null default false` | `:905` |
| `birth_date` | `date` | `:1278` |
| `email` | `text` | `:1279` |
| `address` | `text` | `:1280` |
| `social_security_no` | `text` | `:1281` |
| `employment_start` | `date` | `:1282` |
| `employment_type` | `text check (in ('full_time','hourly'))` | `:1283-1284` |
| `license_no` | `text` | `:1285` |
| `license_expiry` | `date` | `:1286` |
| `emergency_contact_name` | `text` | `:1287` |
| `emergency_contact_relation` | `text` | `:1288` |
| `emergency_contact_phone` | `text` | `:1289` |
| `is_test` | `boolean not null default false` | `:1693` |
| `managed_fleet` | `text check (null or in ('bordo','mavi'))` — filo şefliği | `:1836-1837` |
| `terminated_at` | `date` (son çalışma günü; null = çalışıyor) | `:1974` |
| `panel_seen_at` | `timestamptz` (şoför paneli son aktiflik) | `:2105` |
| `counts_as_driver` | `boolean not null default false` (araç kullanan yönetici muafiyeti) | `:2447` |

Ek kısıt: `workers_phone_temiz` → `check (phone is null or phone ~ '^\+?[0-9]{6,20}$')` (`:1873-1875`).
FK: yok (workers hiçbir tabloya FK vermiyor; diğer tablolar ona referans veriyor).

##### `time_entries` — vardiyalar

| Kolon | Tip / kısıt | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:107` |
| `worker_id` | `uuid not null references public.workers(id) on delete cascade` | `:108` |
| `started_at` | `timestamptz not null default now()` | `:109` |
| `ended_at` | `timestamptz` (null = açık vardiya) | `:110` |
| `start_km` | `integer not null` | `:111` |
| `end_km` | `integer` | `:112` |
| `plate` | `text` | `:113` |
| `notes` | `text` | `:114` |
| `created_at` | `timestamptz not null default now()` | `:115` |
| `break_minutes` | `integer default 0` | `:132` |
| `cargo_count` | `integer` | `:133` |
| `updated_at` | `timestamptz` | `:134` |
| `updated_by` | `uuid references public.workers(id)` | `:135` |
| `nine_hour_notified_at` | `timestamptz` | `:264` |
| `lenkzeit_notified_at` | `timestamptz` | `:265` |
| `summary_notified_at` | `timestamptz` | `:266` |
| `vehicle_id` | `uuid references public.vehicles(id) on delete set null` | `:535` |
| `break_started_at` | `timestamptz` | `:536` |
| `start_package_count` | `int` | `:537` |
| `undelivered_count` | `int` | `:569` |
| `still_active_asked_at` | `timestamptz` | `:582` |
| `auto_started` | `boolean not null default false` | `:932` |
| `confirmation_status` | `text not null default 'confirmed'` | `:939` |
| `confirmed_at` | `timestamptz` | `:940` |
| `auto_ended` | `boolean not null default false` | `:942` |
| `end_reason` | `text` | `:944` |
| `summary_confirmed_at` | `timestamptz` | `:947` |
| `summary_confirmed_by` | `uuid references public.workers(id)` | `:948` |
| `location_unverified` | `boolean not null default false` (konum doğrulanamadı) | `:2068` |
| `started_by` | `uuid references public.workers(id) on delete set null` | `:2137` |
| `start_source` | `text not null default 'self' check (in ('self','auto','admin','chief'))` | `:2140-2141` |
| `start_time_estimated` | `boolean not null default false` (başlangıç anı kestirim) | `:2181` |

Kısıtlar: `time_entries_break_nonneg` (`:148-150`), `time_entries_cargo_nonneg` (`:159-161`), `time_entries_confirmation_status_chk` → `in ('pending','confirmed','unconfirmed')` (`:954-956`), `time_entries_end_reason_chk` → `null or in ('manual','auto_idle','watchdog','admin')` (`:958-962`).
KRİTİK değişmez: `uq_time_entries_one_open` UNIQUE `(worker_id) where ended_at is null` (`:1021-1023`) — bir şoförde aynı anda en fazla BİR açık vardiya.

##### `vehicles` — filo

| Kolon | Tip / kısıt | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:514` |
| `plate` | `text unique not null` | `:515` |
| `make` | `text` | `:516` |
| `model` | `text` | `:517` |
| `year` | `int` | `:518` |
| `status` | `text not null default 'active'` (active / maintenance / inactive — CHECK YOK, yorumla belirtilmiş) | `:519` |
| `assigned_worker_id` | `uuid references public.workers(id) on delete set null` | `:520` |
| `inspection_due` | `date` (§57a Pickerl) | `:522` |
| `insurance_due` | `date` | `:523` |
| `notes` | `text` | `:524` |
| `created_at` | `timestamptz not null default now()` | `:525` |
| `tank_capacity_l` | `numeric` — **KÖPRÜ kolonu**, hiçbir migration'da yok, yalnız kurulum dosyasında (`:553-554`, açıklama `:542-552`) | `:554` |
| `flespi_device_id` | `bigint` (kısmi UNIQUE) | `:686` |
| `imei` | `text` (kısmi UNIQUE; flespi stream "ident") | `:816` |
| `vin` | `text` | `:1137` |
| `fleet` | `text not null default 'mavi' check (in ('bordo','mavi'))` | `:1204-1205` |
| `is_test` | `boolean not null default false` | `:1696` |
| `auto_start_enabled` | `boolean not null default true` | `:2102` |

##### `device_telemetry` — FMC003/flespi araç telemetrisi (araç eksenli, vardiyadan bağımsız)

| Kolon | Tip | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:710` |
| `vehicle_id` | `uuid not null references public.vehicles(id) on delete cascade` | `:711` |
| `flespi_device_id` | `bigint not null` | `:712` |
| `latitude` | `double precision not null` | `:713` |
| `longitude` | `double precision not null` | `:714` |
| `speed_kmh` | `double precision` | `:715` |
| `heading` | `int` (0..359) | `:716` |
| `ignition_on` | `boolean` | `:717` |
| `recorded_at` | `timestamptz not null` (cihaz RTC zamanı) | `:718` |
| `ingested_at` | `timestamptz not null default now()` | `:719` |
| `fuel_level_pct` | `double precision` (% 0..100, `can.fuel.level`) | `:839` |
| `odometer_km` | `double precision` (`can.vehicle.mileage`) | `:840` |
| `engine_rpm` | `int` | `:1122` |
| `engine_load_pct` | `double precision` | `:1123` |
| `coolant_temp_c` | `double precision` | `:1124` |
| `fuel_consumption` | `double precision` | `:1125` |
| `power_voltage` | `double precision` | `:1126` |
| `battery_voltage` | `double precision` | `:1127` |
| `gsm_signal` | `int` (0..100) | `:1128` |
| `altitude_m` | `double precision` | `:1129` |
| `satellites` | `int` | `:1130` |
| `dtc_number` | `int` | `:1131` |
| `fuel_volume_l` | `numeric` (`can.fuel.volume`, litre) | `:2243` |

##### `vehicle_events` — cihaz kaynaklı olay/alarm kayıtları

| Kolon | Tip | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:855` |
| `vehicle_id` | `uuid not null references public.vehicles(id) on delete cascade` | `:856` |
| `event_type` | `text not null` — CHECK YOK; kanonik değerler yorumda: `harsh_braking`, `harsh_acceleration`, `harsh_cornering`, `overspeeding`, `crash`, `towing`, `unplug`, `idling`, `jamming` (`:857-858`) | `:859` |
| `event_value` | `jsonb` (ham detay) | `:861` |
| `latitude` | `double precision` (nullable) | `:863` |
| `longitude` | `double precision` (nullable) | `:864` |
| `speed_kmh` | `double precision` | `:865` |
| `occurred_at` | `timestamptz not null` | `:866` |
| `created_at` | `timestamptz not null default now()` | `:867` |

##### `idle_episodes` — rölanti EPİZOD modeli (ping değil, aralık)

| Kolon | Tip | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:1226` |
| `vehicle_id` | `uuid not null references public.vehicles(id) on delete cascade` | `:1227` |
| `started_at` | `timestamptz not null` | `:1230` |
| `ended_at` | `timestamptz` (NULL = hâlâ açık) | `:1233` |
| `last_seen_at` | `timestamptz not null` | `:1236` |
| `end_reason` | `text check (in ('idle_off','ignition_off','moving','gap_timeout'))` | `:1238` |
| `latitude` | `double precision` | `:1240` |
| `longitude` | `double precision` | `:1241` |
| `created_at` | `timestamptz not null default now()` | `:1242` |

KRİTİK değişmez: `uq_idle_open_per_vehicle` UNIQUE `(vehicle_id) where ended_at is null` (`:1247-1249`).

##### `worker_leaves` — izin takvimi (aralık modeli)

| Kolon | Tip | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:1903` |
| `worker_id` | `uuid not null references public.workers(id) on delete cascade` | `:1904` |
| `leave_type` | `text not null check (in ('jahresurlaub','krankenstand','pflegefreistellung','unbezahlt','hochzeit','sonderurlaub','todesfall','umzug','geburt','karenz'))` | `:1905-1908` |
| `start_date` | `date not null` | `:1909` |
| `end_date` | `date not null` | `:1910` |
| `status` | `text not null default 'approved' check (in ('pending','approved','rejected'))` | `:1911-1912` |
| `note` | `text` | `:1913` |
| `created_by` | `uuid references public.workers(id) on delete set null` | `:1914` |
| `approved_by` | `uuid references public.workers(id) on delete set null` | `:1915` |
| `decided_at` | `timestamptz` | `:1916` |
| `created_at` | `timestamptz not null default now()` | `:1917` |
| `updated_at` | `timestamptz not null default now()` (trigger YOK — uygulama yazar) | `:1918` |

Kısıt: `worker_leaves_range_ck check (end_date >= start_date)` (`:1919`). `unique(worker_id, day)` BİLİNÇLİ olarak YOK (`:1890-1892`).

##### `assignments` — sefer atama

| Kolon | Tip | Kaynak satır |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | `:279` |
| `worker_id` | `uuid not null references public.workers(id) on delete cascade` | `:280` |
| `scheduled_at` | `timestamptz not null` | `:283` |
| `started_at` | `timestamptz` | `:284` |
| `completed_at` | `timestamptz` | `:285` |
| `cancelled_at` | `timestamptz` | `:286` |
| `stops` | `jsonb not null default '[]'::jsonb` (çoklu durak: `[{label, address}]`) | `:290` |
| `start_km` | `integer` | `:293` |
| `end_km` | `integer` | `:294` |
| `category` | `text not null check (in ('lieferung','abholung','kurier','verteilung'))` | `:297` |
| `package_count` | `integer default 0` | `:298` |
| `notes` | `text` | `:299` |
| `status` | `text not null default 'assigned' check (in ('assigned','started','completed','cancelled'))` | `:302` |
| `cancel_reason` | `text` | `:303` |
| `assignment_notified_at` | `timestamptz` | `:306` |
| `created_by` | `uuid references public.workers(id)` | `:309` |
| `created_at` | `timestamptz not null default now()` | `:310` |
| `updated_at` | `timestamptz not null default now()` (trigger `trg_assignments_updated_at` yazar) | `:311` |

#### 2.2 Diğer tablolar (amaç + önemli kolonlar)

| Tablo | Amaç | Önemli kolonlar (FK + tarih) | Tanım |
|---|---|---|---|
| `driver_locations` | Telefon GPS izleri; yalnız açık bir vardiyaya bağlı olabilir (yasal değişmez). | `worker_id` → `workers(id)` cascade; `time_entry_id` → `time_entries(id)` **cascade + NOT NULL** (`:489-498` ile 003'teki `set null` değiştirildi); `recorded_at timestamptz not null default now()` | `:174-182` |
| `telegram_link_codes` | Bot `/start <code>` eşleştirmesi için tek kullanımlık kodlar. | `code text primary key`; `worker_id` → `workers(id)` cascade; `expires_at timestamptz not null default (now()+15 min)`; `used_at timestamptz` | `:251-257` |
| `fuel_entries` | Şoför yakıt fişi kaydı + onay akışı. | `worker_id` → `workers(id)` set null; `approved_by`, `created_by` → `workers(id)`; `vehicle_plate text not null` (FK DEĞİL, düz metin); `fueled_at`, `approved_at`, `created_at`, `updated_at` timestamptz; `cost_per_liter` GENERATED STORED (`total_cost/liters`) | `:349-374` |
| `expense_entries` | Masraf fişi (maut/verpflegung/parking/diesel/sonstige) + onay. | `worker_id`, `approved_by`, `created_by` → `workers(id)`; `vehicle_plate text` (FK DEĞİL); `spent_at`, `approved_at`, `created_at`, `updated_at` | `:381-402` |
| `vehicle_maintenance` | Bakım/servis kaydı. | `created_by` → `workers(id)`; `vehicle_plate text not null` (FK DEĞİL); `serviced_at timestamptz not null`, `next_service_date timestamptz`, `created_at`, `updated_at` | `:409-427` |
| `login_attempts` | Giriş kaba-kuvvet sayacı; `identifier = "<ip>|<phone>"`. | FK YOK; `identifier text primary key`; `locked_until timestamptz`, `first_attempt_at`, `last_attempt_at` | `:606-612` |
| `vehicle_penalties` | Araç cezası (Strafe) takibi. | `vehicle_id` → `vehicles(id)` cascade; `created_by` → `workers(id)` set null; `penalty_date date not null`, `paid_at timestamptz`, `created_at` | `:748-758` |
| `geofences` | Daire bölge tanımları (uyarı bölgesi + depo). | FK YOK; `type text check(in ('circle'))`, `rule_kind check(in ('forbidden','allowed_only'))`, `purpose text not null default 'rule' check(in ('rule','depot'))` (`:2043-2045`); `center_lat/center_lng/radius_m` CHECK'li; `created_at` | `:779-793` |
| `vehicle_dtc` | Arıza kodları (aktif + geçmiş). | `vehicle_id` → `vehicles(id)` cascade; `first_seen timestamptz not null`, `last_seen timestamptz not null`, `cleared_at timestamptz`, `created_at`; `first_seen_odometer_km double precision` (`:1186`) | `:1143-1152` |
| `shift_packages` | "+1 PAKET" olayları (GPS + zaman damgalı iz). | `time_entry_id` → `time_entries(id)` cascade; `worker_id` → `workers(id)` cascade; `recorded_at timestamptz not null default now()`, `created_at` | `:1029-1038` |
| `shift_photos` | Vardiya fotoğrafları (kategorisiz tek akış). | `time_entry_id` → `time_entries(id)` cascade; `worker_id` → `workers(id)` cascade; `storage_path text not null`; `taken_at timestamptz not null default now()`, `created_at` | `:1046-1056` |
| `driver_reports` | Şoför sorun bildirimi (4 hazır tür). | `worker_id` → `workers(id)` cascade; `time_entry_id` → `time_entries(id)` **set null**; `vehicle_id` → `vehicles(id)` set null; `resolved_by` → `workers(id)`; `report_type check(in ('vehicle_fault','address_issue','damaged_package','other'))`; `resolved_at timestamptz`, `created_at` | `:1070-1084` |
| `leave_edit_log` | İzin değişiklik izi. | `leave_id uuid not null` — **FK YOK** (silme izi hayatta kalsın, `:1931`); `changed_by` → `workers(id)` set null; `action check(in ('create','update','delete','approve','reject'))`; `changed_at timestamptz not null default now()` | `:1929-1939` |
| `device_config_epochs` | Cihaz ayarı değişim dönemleri (ör. hız eşiği). | FK YOK; `changed_at timestamptz not null default now()`, `params text`, `note text`. Kurulumda VERİ SATIRI bilinçli çıkarıldı (`:2006-2022`) | `:1998-2003` |
| `depot_exemptions` | Bir şoför için o günlük depo şartı muafiyeti. | `worker_id` → `workers(id)` cascade; `created_by` → `workers(id)` set null; `exempt_date date not null`; `unique (worker_id, exempt_date)`; `created_at` | `:2070-2077` |
| `shift_edit_log` | Vardiya alan düzeltme izi (AZG denetim dayanağı). | `time_entry_id` → `time_entries(id)` **cascade**; `changed_by` → `workers(id)` set null; `field text not null`, `old_value`, `new_value text`; `changed_at timestamptz not null default now()` | `:2380-2392` |
| `login_unlock_log` | Giriş kilidinin elle kaldırılma izi. | `unlocked_by` → `workers(id)` set null; `worker_id` → `workers(id)` set null; `cleared_rows int not null default 0`; `unlocked_at timestamptz not null default now()` | `:2482-2488` |
| `worker_admin_log` | `workers.is_admin` değişiklik izi. | `changed_by` → `workers(id)` set null; `worker_id` → `workers(id)` set null; `granted boolean not null`; `changed_at timestamptz not null default now()` | `:2524-2530` |

#### 2.3 Tablo dışı kurulum kalemleri

- Uzantı: `create extension if not exists pgcrypto` — `:89`, `:604`, `:2480`, `:2522`.
- `storage.buckets` satırları (tablo yaratmaz, satır ekler): `fuel-receipts`, `expense-receipts`, `maintenance-receipts` (`:459-464`) ve `shift-photos` (`:1063-1066`). Dördü de `public=false`, 5 MB, yalnız `image/jpeg|png|webp|heic`.
- Seed verisi: `do $$ ... $$` bloğu bir test şoförü (`+430000000001`, `is_test=true`) ve `TEST-001` plakalı test aracı yaratır (`:1726-1794`).

---

### 3. RLS (Row Level Security)

**Hiçbir yerde `create policy` YOK.** `db/install/sendigo-full.sql` içinde `create policy` / `CREATE POLICY` araması **0 sonuç** veriyor. Yani hiçbir tabloda tanımlı politika bulunmuyor.

RLS ile ilgili tek ifadeler şunlar (grep sonucu, tamamı):

| Satır | İfade | Sonuç |
|---|---|---|
| `sendigo-full.sql:1262` | `alter table public.idle_episodes enable row level security;` | RLS AÇIK ama **politika YOK** → anon/authenticated için varsayılan DENY; `service_role` RLS'i bypass eder. Gerekçe dosyada yazılı (`:1259-1261`). |
| `sendigo-full.sql:1945` | `alter table public.worker_leaves disable row level security;` | RLS kapalı (açık erişim; yalnız service-role anahtarı kullanıldığı varsayımıyla). |
| `sendigo-full.sql:1946` | `alter table public.leave_edit_log disable row level security;` | RLS kapalı. |
| `sendigo-full.sql:2004` | `alter table public.device_config_epochs disable row level security;` | RLS kapalı. |
| `sendigo-full.sql:2078` | `alter table public.depot_exemptions disable row level security;` | RLS kapalı. |

**Kalan 21 tabloda hiçbir RLS ifadesi yok** — PostgreSQL varsayılanı gereği RLS kapalıdır. Dosya bunu birkaç yerde açıkça belirtiyor: "RLS stays OFF (consistent with the rest of the schema)" (`:618-619` login_attempts, `:732-734` device_telemetry, `:798-800` geofences, `:1164-1166` vehicle_dtc, `:900-901` workers.must_change_pin).

**Özet: RLS POLİTİKASI TANIMLI DEĞİL.** Tek tablo (`idle_episodes`) RLS'i açık ama politikasız (fiilen "service-role dışında kimse okuyamaz"); geri kalan tablolarda RLS kapalıdır ve tüm erişim kontrolü uygulama katmanında + service-role anahtarındadır.

---

### 4. İNDEKSLER (`db/install/sendigo-full.sql`)

#### 4.1 `device_telemetry`

| İndeks | Tanım | Satır |
|---|---|---|
| `idx_device_telemetry_vehicle_recorded` | **UNIQUE** `(vehicle_id, recorded_at)` — dedup + "araç başına son konum" | `:725-726` |
| `idx_device_telemetry_device_recorded` | `(flespi_device_id, recorded_at desc)` | `:729-730` |
| `idx_device_telemetry_fuel_volume` | `(vehicle_id, recorded_at) WHERE fuel_volume_l is not null` (kısmi) | `:2247-2249` |

#### 4.2 `vehicle_events`

| İndeks | Tanım | Satır |
|---|---|---|
| `idx_vehicle_events_vehicle_time` | `(vehicle_id, occurred_at desc)` | `:871-872` |
| `idx_vehicle_events_time` | `(occurred_at desc)` | `:875-876` |
| `uq_vehicle_events_dedup` | **UNIQUE** `(vehicle_id, event_type, occurred_at)` — çift teslim koruması (stream + poll) | `:881-882` |

#### 4.3 `time_entries`

| İndeks | Tanım | Satır |
|---|---|---|
| `idx_time_entries_worker` | `(worker_id)` | `:119-120` |
| `idx_time_entries_started_date` | `(date(started_at at time zone 'Europe/Vienna'))` — ifade indeksi | `:137-138` |
| `idx_time_entries_vehicle` | `(vehicle_id)` | `:539` |
| `idx_time_entries_open` | `(started_at) WHERE ended_at is null` (kısmi) | `:585-587` |
| `uq_time_entries_one_open` | **UNIQUE** `(worker_id) WHERE ended_at is null` (kısmi) | `:1021-1023` |
| `idx_time_entries_start_source` | `(start_source, started_at)` | `:2144-2145` |
| `idx_time_entries_start_time_estimated` | `(start_time_estimated, started_at)` | `:2184-2185` |

#### 4.4 `workers`

| İndeks | Tanım | Satır |
|---|---|---|
| `idx_workers_employee_number` | **UNIQUE** `(employee_number) WHERE employee_number is not null` | `:223-225` |
| `idx_workers_telegram_chat` | `(telegram_chat_id) WHERE telegram_chat_id is not null` — **`:668`'de `drop index if exists` ile DÜŞÜRÜLÜR**, kurulum sonunda yoktur | `:244-246` (yaratma), `:668` (düşürme) |
| `idx_workers_telegram_chat_unique` | **UNIQUE** `(telegram_chat_id) WHERE telegram_chat_id is not null` | `:670-672` |
| `idx_workers_is_test` | `(id) WHERE is_test` (kısmi) | `:1704-1705` |
| `idx_workers_managed_fleet` | `(managed_fleet) WHERE managed_fleet is not null` (kısmi) | `:1843-1844` |

#### 4.5 `vehicles`

| İndeks | Tanım | Satır |
|---|---|---|
| `idx_vehicles_plate` | `(plate)` | `:528` |
| `idx_vehicles_assigned` | `(assigned_worker_id)` | `:529` |
| `idx_vehicles_flespi_device` | **UNIQUE** `(flespi_device_id) WHERE flespi_device_id is not null` | `:690-692` |
| `idx_vehicles_imei` | **UNIQUE** `(imei) WHERE imei is not null` | `:820-822` |
| `idx_vehicles_is_test` | `(id) WHERE is_test` (kısmi) | `:1706-1707` |

#### 4.6 Diğer tablolar

| Tablo | İndeks | Tanım | Satır |
|---|---|---|---|
| `driver_locations` | `idx_driver_locations_worker_recent` | `(worker_id, recorded_at desc)` | `:184-185` |
| `driver_locations` | `idx_driver_locations_time_entry` | `(time_entry_id) WHERE time_entry_id is not null` | `:187-189` |
| `telegram_link_codes` | `idx_telegram_link_codes_expires` | `(expires_at)` | `:259-260` |
| `assignments` | `idx_assignments_worker_date` | `(worker_id, scheduled_at desc)` | `:314-315` |
| `assignments` | `idx_assignments_status_date` | `(status, scheduled_at) WHERE status in ('assigned','started')` | `:317-319` |
| `assignments` | `idx_assignments_pending_notification` | `(id) WHERE assignment_notified_at is null` | `:321-323` |
| `fuel_entries` | `idx_fuel_entries_worker_date` | `(worker_id, fueled_at desc)` | `:376` |
| `fuel_entries` | `idx_fuel_entries_status` | `(status) WHERE status = 'pending'` | `:377` |
| `fuel_entries` | `idx_fuel_entries_vehicle` | `(vehicle_plate, fueled_at desc)` | `:378` |
| `expense_entries` | `idx_expense_entries_worker_date` | `(worker_id, spent_at desc)` | `:404` |
| `expense_entries` | `idx_expense_entries_status` | `(status) WHERE status = 'pending'` | `:405` |
| `expense_entries` | `idx_expense_entries_category` | `(category, spent_at desc)` | `:406` |
| `vehicle_maintenance` | `idx_vehicle_maintenance_plate_date` | `(vehicle_plate, serviced_at desc)` | `:429` |
| `vehicle_maintenance` | `idx_vehicle_maintenance_next_service` | `(next_service_date) WHERE next_service_date is not null` | `:430` |
| `login_attempts` | `login_attempts_last_attempt_idx` | `(last_attempt_at)` | `:615-616` |
| `vehicle_penalties` | `idx_vehicle_penalties_vehicle` | `(vehicle_id)` | `:760-761` |
| `vehicle_penalties` | `idx_vehicle_penalties_unpaid` | `(vehicle_id) WHERE paid = false` | `:764-766` |
| `geofences` | `idx_geofences_active` | `(active)` | `:796` |
| `shift_packages` | `idx_shift_packages_entry` | `(time_entry_id)` | `:1040-1041` |
| `shift_photos` | `idx_shift_photos_entry` | `(time_entry_id)` | `:1058-1059` |
| `driver_reports` | `idx_driver_reports_open` | `(created_at desc) WHERE resolved_at is null` | `:1087-1089` |
| `driver_reports` | `idx_driver_reports_worker` | `(worker_id, created_at desc)` | `:1091-1092` |
| `vehicle_dtc` | `idx_vehicle_dtc_active` | **UNIQUE** `(vehicle_id, code) WHERE cleared_at is null` | `:1156-1158` |
| `vehicle_dtc` | `idx_vehicle_dtc_vehicle` | `(vehicle_id, last_seen desc)` | `:1161-1162` |
| `idle_episodes` | `uq_idle_open_per_vehicle` | **UNIQUE** `(vehicle_id) WHERE ended_at is null` | `:1247-1249` |
| `idle_episodes` | `idx_idle_vehicle_time` | `(vehicle_id, started_at desc)` | `:1252-1253` |
| `idle_episodes` | `idx_idle_time` | `(started_at desc)` | `:1256-1257` |
| `worker_leaves` | `idx_worker_leaves_worker` | `(worker_id, start_date)` | `:1922-1923` |
| `worker_leaves` | `idx_worker_leaves_range` | `(start_date, end_date)` | `:1924-1925` |
| `worker_leaves` | `idx_worker_leaves_status` | `(status)` | `:1926-1927` |
| `leave_edit_log` | `idx_leave_edit_log_leave` | `(leave_id, changed_at desc)` | `:1941-1942` |
| `shift_edit_log` | `idx_shift_edit_log_entry` | `(time_entry_id, changed_at desc)` | `:2398-2399` |
| `login_unlock_log` | `login_unlock_log_worker_idx` | `(worker_id, unlocked_at desc)` | `:2494-2495` |
| `worker_admin_log` | `worker_admin_log_worker_idx` | `(worker_id, changed_at desc)` | `:2536-2537` |

İndeksi olmayan tablolar (kurulum dosyasında hiç `create index` almayan): `device_config_epochs` (`:1998`), `depot_exemptions` (`:2070` — yalnız `unique (worker_id, exempt_date)` tablo kısıtı var, bu da örtük bir unique indeks yaratır).

---

## 5) Çok Müşterili Katman

### 1. `lib/tenant.ts` — kurulum modu katmanı

Dosya "uygulama nasıl **ÇALIŞIR**" sorusunun tek kaynağı; "nasıl **GÖRÜNÜR**" sorusu `lib/brand.ts`'te (lib/tenant.ts:2-5). Hiçbir `server-only` içe aktarımı yok — bu bilinçli: muhafız betikleri modülü ham Node'da yükleyebilsin diye (scripts/check-tenant-defaults.mjs:222-225).

**Yardımcılar (dışa aktarılmaz)**

| Fonksiyon | Satır | Davranış |
|---|---|---|
| `envBool(value, fallback)` | lib/tenant.ts:43-49 | `"true"/"1"/"yes"` → true, `"false"/"0"/"no"` → false, **tanınmayan/boş → fallback (sessizce)** |
| `envInt(value, fallback)` | lib/tenant.ts:51-54 | sonlu ve > 0 ise `Math.round`, değilse fallback |
| `envEnum(value, allowed, fallback)` | lib/tenant.ts:56-63 | küçük harfe indirir, listede yoksa **sessizce** fallback |

Üçü de hatayı sessizce yutar; `scripts/check-demo-env.mjs` tam olarak bu sessizliği kırmak için yazılmış (check-demo-env.mjs:6-20).

**Dışa aktarılan sabitler**

| Export | Satır | Ne yapar |
|---|---|---|
| `FUEL_ENABLED` | 72 | Yakıt modülü (`/admin/yakit`, `/panel/yakit`) |
| `EXPENSE_ENABLED` | 74 | Masraf modülü |
| `MAINTENANCE_ENABLED` | 76-79 | Bakım modülü (yakıt sayfasını paylaşır) |
| `LEAVES_ENABLED` | 84 | İzin takvimi (`/admin/izinler`); migration 031 gerekir |
| `DRIVER_PANEL_ENABLED` | 100-103 | `/panel` ağacı; kapalıyken şoför girişi reddedilir |
| `ADMIN_DRIVER_PANEL_LINK` | 122-125 | Yönetici üst çubuğunda "Şoför Paneli" geçişi (yalnız BAĞLANTI; `lib/driver-scope.ts` eleme mantığını DEĞİŞTİRMEZ) |
| `DriverVehicleChoice` (tip) | 127 | `"assigned" \| "free"` |
| `DRIVER_VEHICLE_CHOICE` | 146-150 | Şoför vardiyayı atanmış araçla mı, o an seçtiği plakayla mı açar. Yalnız GÖRÜNÜM — sunucu iki modda da aynı (lib/tenant.ts:141-144) |
| `PACKAGES_ENABLED` | 161-164 | Paket sayacı alanları/sütunları/PDF kolonları. Veri modeli aynen durur |
| `LENKZEIT_WARNING_ENABLED` | 174-177 | 4 sa / 4,5 sa sürüş-dinlenme uyarısı |
| `SAFETY_SCORE_CALIBRATED` | 187-190 | Güvenlik skorunun "kalibre" iddiası (K sabiti HAK61 filosuna ait) |
| `FLEET_LABELS` | 197-200 | `{bordo, mavi}` etiket ezmesi; boş dize = i18n sözlüğü kazanır |
| `ACTIVE_FLEETS` | 217-227 | Arayüzde gösterilen filolar. Yalnız `bordo`/`mavi` tanınır; tanınmayan/boş liste **iki filoya geri düşer** |
| `isFleetVisible(fleet)` | 230-232 | `ACTIVE_FLEETS` üyeliği; `null` filo → `true` |
| `ShiftStartTrigger` (tip) | 238 | `"depot_entry" \| "first_ignition" \| "off"` |
| `ShiftAutoEndMode` (tip) | 239 | `"off" \| "depot_idle"` |
| `SHIFT_START_TRIGGER` | 261-265 | Vardiya başlangıç tetiği — **sunucu-only** |
| `SHIFT_AUTO_END` | 278-282 | Otomatik kapanma — **sunucu-only** |
| `SHIFT_AUTO_END_IDLE_MIN` | 292-295 | `depot_idle` hareketsizlik eşiği (dk) — **sunucu-only** |
| `SHIFT_AUTO_END_MIDNIGHT_FALLBACK` | 301-304 | Depoya dönmeyen araç son hareket anında kapanır — **sunucu-only** |
| `FLEET_EPOCH_ISO` | 311-312 | "Tüm zamanlar" tabanı — **sunucu-only** |
| `assertTenantConfig()` | 321-338 | Fail-closed kurulum denetimi: iki yasak bileşim |

**`assertTenantConfig()` iki kapı kurar** (lib/tenant.ts:322-337):
- `!DRIVER_PANEL_ENABLED && SHIFT_AUTO_END === "off"` → throw (vardiyayı kapatacak kimse kalmaz)
- `!DRIVER_PANEL_ENABLED && SHIFT_START_TRIGGER === "off"` → throw (başlatacak kimse kalmaz)

Çağrı yeri tek: app/layout.tsx:15 — modül yüklenirken, ilk render'da.

**Env okuma mekanizması: STATİK / DÜZ LİTERAL.** Her erişim `process.env.NEXT_PUBLIC_X` biçiminde, çağrı yerinde yazılı; yardımcılara env **adı geçirilmez, hazır DEĞER geçirilir** (lib/tenant.ts:27-39). Gerekçe kod içinde ölçümle yazılı: 03.08.2026'da dosya `process.env[ad]` ile dinamik okuyordu, Sendigo'nun canlı paketinde `r("NEXT_PUBLIC_PACKAGES_ENABLED",!0)` olarak kalmıştı — sunucu doğru, istemci varsayılana düşmüş (lib/tenant.ts:34-39; docs/SENDIGO-KABUL-TESTI-2.md:352-362). Aynı kural lib/report-de.ts:56-60'ta tekrarlanır.

**Sunucu-istemci ayrımı.** İstemciye ulaşabilen her ayar `NEXT_PUBLIC_` öneklidir (lib/tenant.ts:15-20). Öneksiz beş ayar yalnız sunucu modüllerinde tüketilir: lib/auto-shift.ts (dosya başında `import "server-only"`, auto-shift.ts:1, 21-26) ve lib/analytics.ts (analytics.ts:1, 4, 66). Bayrak görünürlüğü kapatır; kapatılan modülün **sunucu eylemi de aynı bayrağı denetler** (lib/tenant.ts:22-25) — doğrulandı:
- app/panel/layout.tsx:27 (`redirect("/admin")`), app/actions/auth.ts:185 (giriş reddi)
- app/actions/leaves.ts:86, 221, 252, 283 (`return {ok:false, error:"disabled"}`)
- app/admin/izinler/page.tsx:37, app/admin/yakit/page.tsx:13, app/admin/masraflar/page.tsx:11, app/panel/yakit/page.tsx:12, app/panel/masraflar/page.tsx:11
- app/actions/shift.ts:616 (paket), app/actions/telegram.ts:92 (Lenkzeit)

---

### 2. Env değişkenlerinin tam listesi

#### 2.1 `NEXT_PUBLIC_` önekli (32 ad — hepsi `.env.example`'da)

| Değişken | Varsayılan | Neyi açar/kapatır | Okunduğu dosya:satır |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yok (zorunlu) | Supabase proje URL'i; eksikse hata fırlatır | lib/supabase.ts:4 |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `hak_transport_bildirim_bot` | Bot derin bağlantısı | components/TelegramLink.tsx:26 · app/actions/telegram.ts:34 |
| `NEXT_PUBLIC_APP_URL` | `https://hak-transport-takip.vercel.app` | Telegram "Panele Git" butonlarının adresi | app/actions/assignments.ts:12 · fuel.ts:18 · expenses.ts:16 · maintenance.ts:16 |
| `NEXT_PUBLIC_TENANT` | `hak61` | Marka künyesi anahtarı + `data-tenant` CSS kancası | lib/brand.ts:30 |
| `NEXT_PUBLIC_BRAND_NAME` | künye (`HAK61`) | Kısa ad: bildirim/Telegram başlığı | lib/brand.ts:182 |
| `NEXT_PUBLIC_BRAND_LEGAL_NAME` | künye (`HAK61 GmbH`) | Footer telif satırı, logo `alt` | lib/brand.ts:183 |
| `NEXT_PUBLIC_BRAND_CITY` | künye (`Wien`) | Giriş ekranı alt satırı | lib/brand.ts:184 |
| `NEXT_PUBLIC_BRAND_APP_TITLE` | künye (`HAK61 — Schicht & KM`) | Sekme başlığı + PWA adı | lib/brand.ts:185 |
| `NEXT_PUBLIC_BRAND_DESCRIPTION` | künye | metadata + manifest açıklaması | lib/brand.ts:186 |
| `NEXT_PUBLIC_BRAND_SHORT_NAME` | künye (`HAK61`) | manifest `short_name` | lib/brand.ts:187 |
| `NEXT_PUBLIC_BRAND_LOGO_RATIO` | künye (`915/300`) | `BrandLogo` genişlik hesabı | lib/brand.ts:188 |
| `NEXT_PUBLIC_BRAND_THEME_COLOR` | künye (`#0d0e10`) | manifest `theme_color` | lib/brand.ts:189 |
| `NEXT_PUBLIC_BRAND_BACKGROUND_COLOR` | künye (`#0a0b0e`) | manifest `background_color` | lib/brand.ts:190-193 |
| `NEXT_PUBLIC_COMPANY_NAME` | `HAK61 GmbH` | PDF anteti firma adı | lib/report-de.ts:72 |
| `NEXT_PUBLIC_COMPANY_ADDRESS` | `Josef-Ganahl-Straße 4, 6850 Dornbirn, Österreich` | PDF anteti adres | lib/report-de.ts:77 |
| `NEXT_PUBLIC_COMPANY_REG_LINE` | `UID-Nr.: ATU79519228` | PDF sicil satırı (UID ya da FN) | lib/report-de.ts:96 |
| `NEXT_PUBLIC_COMPANY_EXTRA_LINE` | `""` (satır basılmaz) | Antetin 4. satırı | lib/report-de.ts:106 |
| `NEXT_PUBLIC_PDF_BRAND_MARK` | `HAK` | PDF kapak amblemi **+ indirilen dosya adı öneki** | lib/report-de.ts:118, türev 136-140 |
| `NEXT_PUBLIC_DRIVER_PANEL_ENABLED` | `true` | `/panel` ağacı, şoför girişi, menü | lib/tenant.ts:100-103 |
| `NEXT_PUBLIC_DRIVER_VEHICLE_CHOICE` | `assigned` | Şoförün vardiya açarken plaka seçebilmesi | lib/tenant.ts:146-150 |
| `NEXT_PUBLIC_ADMIN_DRIVER_PANEL_LINK` | `false` | Yönetici üst çubuğunda panel geçişi | lib/tenant.ts:122-125 |
| `NEXT_PUBLIC_PACKAGES_ENABLED` | `true` | Paket sayacı alanları/sütunları/PDF kolonları | lib/tenant.ts:161-164 |
| `NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED` | `true` | Lenkzeit uyarısı + Telegram bildirimi | lib/tenant.ts:174-177 |
| `NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED` | `true` | Güvenlik skoru sütunu/rozeti | lib/tenant.ts:187-190 |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `tr` | Çerezi olmayan ziyaretçinin dili (`tr`/`de`) | i18n/request.ts:11-13 |
| `NEXT_PUBLIC_FLEET_BORDO_LABEL` | `""` → i18n | Bordo filonun görünen adı | lib/tenant.ts:198 |
| `NEXT_PUBLIC_FLEET_MAVI_LABEL` | `""` → i18n | Mavi filonun görünen adı | lib/tenant.ts:199 |
| `NEXT_PUBLIC_FLEETS` | `bordo,mavi` | Arayüzde gösterilen filolar | lib/tenant.ts:218 |
| `NEXT_PUBLIC_FUEL_ENABLED` | `false` | Yakıt modülü | lib/tenant.ts:72 |
| `NEXT_PUBLIC_EXPENSE_ENABLED` | `false` | Masraf modülü | lib/tenant.ts:74 |
| `NEXT_PUBLIC_MAINTENANCE_ENABLED` | `false` | Bakım modülü | lib/tenant.ts:76-79 |
| `NEXT_PUBLIC_LEAVES_ENABLED` | `true` | İzin takvimi | lib/tenant.ts:84 |

#### 2.2 Öneksiz (sunucu-only)

| Değişken | Varsayılan | Ne yapar | Dosya:satır |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | yok (zorunlu) | service_role istemcisi | lib/supabase.ts:5 |
| `SESSION_PASSWORD` | yok (zorunlu) | iron-session şifreleme | lib/session.ts:13 |
| `TELEGRAM_BOT_TOKEN` | yok | Bot API çağrıları | lib/telegram.ts:7 |
| `TELEGRAM_WEBHOOK_SECRET` | yok | Webhook POST doğrulaması | app/api/telegram/webhook/route.ts:176 |
| `CRON_SECRET` | yok | `/api/cron/shift-watchdog` koruması | app/api/cron/shift-watchdog/route.ts:37 |
| `FLESPI_TOKEN` | yok | flespi REST çekişi | lib/flespi.ts:116 |
| `FLESPI_SYNC_SECRET` | yok | `/api/flespi/sync` koruması | lib/flespi-auth.ts:12 |
| `SHIFT_START_TRIGGER` | `depot_entry` | Vardiya başlangıç tetiği (`depot_entry`/`first_ignition`/`off`) | lib/tenant.ts:262; türev `AUTO_START_ENABLED` lib/auto-shift.ts:104 |
| `SHIFT_AUTO_END` | `off` | Otomatik kapanma modu | lib/tenant.ts:279 |
| `SHIFT_AUTO_END_IDLE_MIN` | `30` | `depot_idle` eşiği (dk) | lib/tenant.ts:293; ayrıca lib/auto-shift.ts:116 |
| `SHIFT_AUTO_END_MIDNIGHT_FALLBACK` | `true` | Gece yarısı emniyeti | lib/tenant.ts:302 |
| `FLEET_EPOCH` | `2026-06-01T00:00:00.000Z` | "Tüm zamanlar" tabanı | lib/tenant.ts:312 → lib/analytics.ts:66 |
| `AUTO_SHIFT_IDLE_END_MINUTES` | yok | **Eski ad**, geriye dönük; yeni ad tanımlıysa okunmaz. `.env.example`'da YOK | lib/auto-shift.ts:119 |
| `COMPANY_NAME` · `COMPANY_ADDRESS` · `COMPANY_REG_LINE` · `COMPANY_EXTRA_LINE` · `PDF_BRAND_MARK` | HAK61 sabitleri | Öneksiz **geriye dönük** PDF künyesi; sıra `NEXT_PUBLIC_` → öneksiz → sabit | lib/report-de.ts:73, 78, 97, 107, 119 (`pickCompany`, 62-68) |
| `NODE_ENV` | — | Çerez `secure` bayrağı | lib/session.ts:23 |

---

### 3. Tenant farkları — kodda nerede tanımlı

**Kayıt defteri (marka).** `REGISTRY` yalnız iki künye tutar: `hak61` ve `sendigo` (lib/brand.ts:125-128). `galzura-demo` kayıtlı DEĞİLDİR → `fallbackDescriptor()` devreye girer (lib/brand.ts:135-159) ve tüm görseller `public/brands/galzura-demo/` altında beklenir; metinler env'den gelmek zorundadır.

| Boyut | HAK61 | SENDIGO | GALZURA-DEMO | Kaynak |
|---|---|---|---|---|
| Künye | `REGISTRY.hak61` | `REGISTRY.sendigo` | yedek künye + env | lib/brand.ts:76-99 / 102-123 / 135-161 |
| Ad · unvan · şehir | `HAK61` · `HAK61 GmbH` · `Wien` | `SENDIGO` · `Sendigo GmbH` · `Dornbirn` | `Galzura Fleet` · `Galzura Fleet` · `Wien` (env) | brand.ts:77-79 / 103-105 · check-demo-env.mjs:45-48 |
| Sekme/PWA adı | `HAK61 — Schicht & KM` | `Sendigo — Fuhrpark` | `Galzura Fleet` | brand.ts:80 / 106 · check-demo-env.mjs:48 |
| Logo oranı | `915/300 ≈ 3.05` | `1320/1290 ≈ 1.02` | `1` (yedek) — kare değilse env | brand.ts:83 / 109 / 143 |
| Görsel yolları | **KÖK** (`/logo.png`, `?v=2` damgalı ikonlar) | `/brands/sendigo/*` | `/brands/galzura-demo/*` | brand.ts:86-98 / 112-122 / 147-157 |
| Tema/zemin rengi | `#0d0e10` / `#0a0b0e` | aynı | aynı (yedek HAK61'i miras alır) | brand.ts:84-85 / 110-111 / 145-146 |
| Dil (varsayılan) | `tr` | `de` (env) | env yok → `tr` | i18n/request.ts:11-13 · docs/SENDIGO-KURULUM.md:168 · check-demo-env.mjs (ENV'de YOK) |
| Filo kimliği | 2 filo, bordo+mavi | 1 filo, etiket `Flotte` | 1 filo, etiket `Filo`, renk `#0F766E` | tenant.ts:217-227 · SENDIGO-KURULUM.md:173-174 · check-demo-env.mjs:56-57 |
| Filo rengi ezmesi | yok | yok | `[data-tenant="galzura-demo"]` bloğu | app/globals.css:407-419; kanca app/layout.tsx:62 |
| PDF künyesi | `HAK61 GmbH` · Josef-Ganahl-Straße 4 · `UID-Nr.: ATU79519228` · amblem `HAK` | `Sendigo GmbH` · Bildgasse 10 · `FN 681377a (Landesgericht Feldkirch)` · `Geschäftsführer: Gökhan Kalkanlı` · amblem `SEN` | **BİLİNMİYOR** — check-demo-env.mjs'in ENV setinde `COMPANY_*` / `PDF_BRAND_MARK` yok, docs/GALZURA-KURULUM.md'de de geçmiyor; kod HAK61 varsayılanına düşer (report-de.ts:70-121) | lib/report-de.ts:70-121 · docs/SENDIGO-KURULUM.md:151-155 |
| Şoför paneli | açık | **kapalı** (`false`) | açık (`true`) | tenant.ts:100-103 · SENDIGO-KURULUM.md:169 · check-demo-env.mjs:60 |
| Araç seçimi | `assigned` | belgelenmemiş (bkz. aşağıdaki tutarsızlık) | `free` | tenant.ts:146-150 · check-demo-env.mjs:61 |
| Paket sayacı | açık | kapalı | kapalı | tenant.ts:161 · SENDIGO-KURULUM.md:170 · check-demo-env.mjs:62 |
| Lenkzeit uyarısı | açık | kapalı | açık (varsayılan) | tenant.ts:174 · SENDIGO-KURULUM.md:171 · check-demo-env.mjs:115 |
| Güvenlik skoru | kalibre (açık) | kapalı | açık — aynı 29 aracı okuduğu için | tenant.ts:187 · SENDIGO-KURULUM.md:172 · check-demo-env.mjs:116-118 |
| Vardiya başlangıcı | `depot_entry` | `first_ignition` | `first_ignition` | tenant.ts:261-265 · SENDIGO-KURULUM.md:175 · check-demo-env.mjs:67 |
| Otomatik kapanış | `off` | `depot_idle` / 20 dk | `depot_idle` / 20 dk | tenant.ts:278-295 · SENDIGO-KURULUM.md:176-177 · check-demo-env.mjs:68-70 |
| `FLEET_EPOCH` | `2026-06-01` | `2026-08-01` | `2026-08-07` | tenant.ts:311-312 · SENDIGO-KURULUM.md:178 · check-demo-env.mjs:74 |
| Yakıt/Masraf/Bakım | üçü de kapalı | aynı (girilmez) | aynı (girilmez) | tenant.ts:72-79 · SENDIGO-KURULUM.md:180-183 · check-demo-env.mjs:110-112 |
| İzin takvimi | açık | açık | açık | tenant.ts:84 · SENDIGO-KURULUM.md:182 · check-demo-env.mjs:113 |

**Şema farkı yok.** `scripts/gen-install-sql.mjs:13-16`: müşteri adı **yalnız dosya adına ve başlığa** girer, gövde her müşteride bayt bayt aynıdır. `db/` altında hiçbir migration'da `tenant` kelimesi geçmiyor (grep, 0 eşleşme) — yani veritabanı seviyesinde kiracı ayrımı YOKTUR; ayrım müşteri başına **ayrı Supabase projesidir** (docs/YENI-MUSTERI-KURULUM.md:116-117, docs/GALZURA-KURULUM.md:137-138).

**Kodda yakaladığım iki tutarsızlık:**
1. `lib/tenant.ts:113-116` ve `133-144` yeni iki ayarın (`ADMIN_DRIVER_PANEL_LINK`, `DRIVER_VEHICLE_CHOICE='free'`) gerekçesi olarak **Sendigo**'yu adlandırıyor ("Gökhan hem yönetici hem sürücü", "araç↔şoför sabit ataması olmayan filo"), fakat `docs/SENDIGO-KURULUM.md:169` hâlâ `NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false` diyor ve iki yeni env belgede hiç geçmiyor. Sendigo'nun **canlı Vercel env'i repoda olmadığı için gerçek değerleri BİLİNMİYOR** — belge ile kod yorumu çelişiyor.
2. `BRAND.themeColor` yalnız `app/manifest.json/route.ts:29`'da kullanılıyor; `app/layout.tsx:40-47`'deki `viewport.themeColor` **sabit** (`#fbfbfc` / `#0d0e10`) ve markadan türemiyor.

---

### 4. Muhafız betikleri

#### `scripts/check-tenant-defaults.mjs` — iki fazlı, `npm run verify`'ın son halkası

Zincir: `lint → lint:test-filters → build → lint:tenant-defaults` (package.json:16). Sıra zorunlu: Faz 2 `.next/static` okur (check-tenant-defaults.mjs:25-27, 314-323).

**FAZ 1 — varsayılanlar: 45 alan.** `EXPECTED` tablosu (satır 58-133) 31.07.2026 öncesi düz metin değerlerin kaydıdır. Dağılım:
- `tenant.*` — **17** alan (satır 60-94): dört modül bayrağı, `DRIVER_PANEL_ENABLED`, `DRIVER_VEHICLE_CHOICE`, `ADMIN_DRIVER_PANEL_LINK`, `PACKAGES_ENABLED`, `LENKZEIT_WARNING_ENABLED`, `SAFETY_SCORE_CALIBRATED`, dört vardiya-otomatı ayarı, `FLEET_EPOCH_ISO`, `ACTIVE_FLEETS`, `FLEET_LABELS`
- `brand.*` — **20** alan (satır 97-118): tenant kodu, 6 metin, 2 renk, 8 görsel yolu (`?v=2` damgaları dahil), `splashWidth/Height`, `cityLine()`, `copyright(2026)`
- `company.*` — **8** alan (satır 121-132): ad, adres, sicil satırı, ek satır, amblem, logo oranı, iki dosya adı öneki

Ölçüm yöntemi: `lib/tenant.ts` + `lib/brand.ts` + `lib/report-de.ts` **ayrı bir süreçte, ortamı boşaltılmış olarak** yüklenir (`cleanEnv` = yalnız `PATH`, `SystemRoot`, boş `NODE_OPTIONS`; satır 231-249), `--experimental-strip-types` ile. `@/` takma adları geçici sonda `registerHooks` ile çözülür (satır 154-166). Sayı karşılaştırması 1e-9 toleranslı (satır 268-271).

**FAZ 2 — istemci paketi: iki kural, derlenmiş chunk metninde ölçülür** (satır 292-425). Denetlenen ad listesi `.env.example`'dan `^(NEXT_PUBLIC_[A-Z0-9_]+)\s*=` ile çıkarılır → **32 ad** (satır 351-358); yeni bir env eklendiği anda kapsama kendiliğinden girer.
- **K1 (kusur imzası)** — bir env adı chunk'ta tırnak içinde (`"NEXT_PUBLIC_X"`) geçemez. Geçiyorsa env bir yardımcıya AD olarak veriliyor demektir; derleyici değeri gömemez. Env tanımlı olsun olmasın geçerlidir (satır 382-384).
- **K2 (gömülme ispatı)** — build anında değeri olan bir env'in adı chunk'ta `.ADI` biçiminde özellik erişimi olarak kalmamalıdır (satır 385-387). `buildEnv` = `.env` → `.env.local` → `process.env` (satır 344-349).

Faz 2 yoksa `.next/static` → çıkış kodu 1 (satır 316-323).

#### `scripts/check-demo-env.mjs` — ters yönlü muhafız (Galzura)

`check-tenant-defaults.mjs` "env YOKKEN HAK61 korunuyor mu" sorar; bu betik "env VARKEN demo gerçekten kuruluyor mu" sorar (check-demo-env.mjs:18-20). 17 satırlık `ENV` setini (satır 42-75) uygular, `lib/tenant.ts` + `lib/brand.ts` yükler, **26** çözülmüş değeri `EXPECTED` ile karşılaştırır (satır 81-119). `--print` bayrağı Vercel'e yapıştırılacak bloğu basar (satır 121-125). Sırlar bilerek yok (satır 36-41). Yakaladığı sınıf: `envEnum`/`envBool`'un **sessiz düşüşü** — `depot-idle` (tire) → `off`, `NEXT_PUBLIC_FLEETS=galzura` → `['bordo','mavi']` (satır 8-14). `npm run verify` zincirinde DEĞİL; elle çağrılır (docs/GALZURA-KURULUM.md:226).

#### `scripts/check-test-filters.mjs` — kapsam muhafızı (üç ayrı kural, tek tarama)

`app/` ve `lib/` altındaki `.ts`/`.tsx` dosyalarında `.from("<tablo>")` çağrılarını bulur (satır 32-37, 181). Korunan tablolar (satır 47-61): `workers`, `vehicles`, `time_entries`, `driver_reports`, `vehicle_events`, `idle_episodes`, `worker_leaves`.

Pencere mantığı: KEYED için yalnız kendi ifadesi (`.from()` → `;`, en fazla 26 satır — geriye BAKMAZ, satır 185-194); muafiyet yorumu için üstteki blok (8 satır, satır 196-210); filtre için geniş pencere (satır 212-217).

| Kural | Kapsam | Kabul eden işaretler | Satır |
|---|---|---|---|
| **Test verisi** | tüm dosyalar, 7 tablo | `withoutTestRows(`, `dropTestRows(`, `// test-filtered:`, `// test-visible: <gerekçe>`, ya da ANAHTARLI zincir | 87, 154, 221-229 |
| **Şoför kapsamı** | 10 yüzey (`DRIVER_SURFACES`), `vehicles` HARİÇ | `onlyDrivers(`, `dropNonDrivers(`, `// driver-scoped: <gerekçe>` — `// test-visible:` burada MUAF TUTMAZ | 125-151, 235-244 |
| **Filo kapsamı** | 4 yüzey (`FLEET_SURFACES`) | `onlyFleet(`, `dropOtherFleets(`, `// fleet-scoped:` | 98-107, 246-253 |

ANAHTARLI sayılan 18 zincir parçası satır 64-84'te (`.eq("id"`, `.in("id"`, `.single()`, `.insert(` …). Çıkış kodu 1 = `npm run lint:test-filters` ve `npm run verify` kırılır. Çok-müşteri katmanıyla doğrudan ilgisi yok — kiracı sızıntısını değil, test/şoför/filo sızıntısını denetler.

---

### 5. Mobil notu — tenant seçimi DERLEME zamanında belirlenir

**Kesin cevap: DERLEME (build) zamanı. Çalışma zamanında tenant seçimi yoktur.** Dayanaklar:

1. **İstemci tarafı ölçülmüş biçimde derleme zamanıdır.** Next/Turbopack yalnız düz literal `process.env.NEXT_PUBLIC_X` erişimini build anında METİN olarak değiştirir (lib/tenant.ts:27-32). `check-tenant-defaults.mjs` Faz 2 bunu kod okuyarak değil **derlenmiş chunk metninde** doğrular (satır 292-389) — yani gömülme build çıktısında ispatlanmış bir olgudur.
2. **Sunucu tarafı da fiilen deploy zamanıdır.** `lib/tenant.ts` ve `lib/brand.ts`'teki her ayar **modül seviyesinde `const`**tir (tenant.ts:72-312, brand.ts:30, 161, 180-195); süreç başına bir kez değerlendirilir, istek başına değil. `assertTenantConfig()` da modül yüklenirken çağrılır (app/layout.tsx:15).
3. **Per-request tenant çözümleyicisi yok.** Projede `middleware.ts` YOKTUR (glob: yalnız `node_modules` eşleşmeleri). Host/alan adı tabanlı çözümleme yok: `headers().get("host")`, `x-forwarded-host`, `nextUrl.hostname` — grep 0 eşleşme.
4. **Veritabanında kiracı kolonu yok.** `db/` altında `tenant` geçen tek dosya bile yok (grep -i, 0 eşleşme). Ayrım müşteri başına ayrı Supabase projesidir.
5. **Mimari açıkça "müşteri başına ayrı Vercel projesi, aynı repo ve aynı `main` dalı"dır** (docs/GALZURA-KURULUM.md:71-76: "üç proje aynı koddan beslenir, ayrışan yalnız env'dir"; docs/YENI-MUSTERI-KURULUM.md:107-108). Env değişikliği **Redeploy** gerektirir (docs/SENDIGO-KURULUM.md:161-162, 127).
6. `app/manifest.json/route.ts:19` → `export const dynamic = "force-static"`: PWA manifest'i bile build anında dondurulur.

**Mobil için sonucu:** tek bir derleme = tek bir müşteri. Tek bir mobil paket/bundle çalışma anında müşteri değiştiremez; her müşteri kendi build'ini (kendi Vercel projesi / kendi webview adresi) gerektirir. Bir istemci uygulamasının tenant'ı sunucudan sorup davranışını değiştirebilmesi için bugün böyle bir uç nokta yoktur — bayraklar istemci paketine sabit metin olarak gömülüdür.

---

## 6) Bildirimler (Telegram)

### 1. Mimari

**Bot token ve env**

| Env | Nerede okunuyor | Kapsam |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `lib/telegram.ts:7` (`botToken()`) | Yalnız sunucu (dosya başında `import "server-only"`, `lib/telegram.ts:1`) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `app/actions/telegram.ts:34` (deep link üretimi), `components/TelegramLink.tsx:26` (görünen `t.me/…` etiketi) | İstemciye gömülü |
| `TELEGRAM_WEBHOOK_SECRET` | `app/api/telegram/webhook/route.ts:176` | Sunucu |
| `NEXT_PUBLIC_APP_URL` | `app/actions/assignments.ts:11`, `app/actions/fuel.ts:17`, `app/actions/expenses.ts:15`, `app/actions/maintenance.ts` (`APP_URL`) — mesajlardaki "Panele Git" butonu | İstemciye gömülü |
| `CRON_SECRET` | `app/api/cron/shift-watchdog/route.ts:37` | Sunucu |

Tek bir global bot token vardır; müşteri başına ayrı bot = ayrı deployment/env (`docs/YENI-MUSTERI-KURULUM.md:123`, `docs/SENDIGO-KURULUM.md:131-133`). API tabanı `https://api.telegram.org` (`lib/telegram.ts:4`).

**Gönderim fonksiyonu**

```ts
// lib/telegram.ts:26
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" | null = "HTML",
  inlineKeyboard?: InlineButton[][]
): Promise<boolean>
```

`InlineButton = { text; url } | { text; callback_data }` (`lib/telegram.ts:22-24`). Gövdede `disable_web_page_preview: true` sabit (`lib/telegram.ts:46`); `parseMode: null` verilirse `parse_mode` hiç gönderilmez (serbest metin adresler HTML'i bozmasın diye — `lib/telegram.ts:42-44`).

Yardımcılar: `answerCallbackQuery(callbackQueryId, text?)` (`lib/telegram.ts:73`), `getWebhookInfo()` (`lib/telegram.ts:101`), `isTelegramConfigured()` (`lib/telegram.ts:10` — **hiçbir yerden çağrılmıyor**, grep'te tek eşleşme tanımın kendisi).

**Hata durumunda ne oluyor — tamamen sessiz, asla patlamaz**

- Token yoksa veya `chatId` boşsa: `return false`, hiçbir istek yapılmaz (`lib/telegram.ts:33`). README'de de bu şekilde belgelenmiş: token tanımsızsa uygulama çalışır, "sessiz no-op" (`README.md:235`).
- `fetch` istisna atarsa: `catch { return false }` (`lib/telegram.ts:63-65`). Log **yok**.
- HTTP hata döndüyse ve `error_code` 403 veya 400 ise: o `chat_id`'ye sahip **tüm** worker satırlarında `telegram_chat_id / telegram_username / telegram_linked_at` NULL'lanır (`lib/telegram.ts:52-61`). Yani bot engellenince bağlantı kendiliğinden kopar.
- Diğer hata kodları (429 rate-limit dâhil): sadece `false`; yeniden deneme yok, kuyruk yok, log yok.
- `fetch` çağrısında **timeout / `AbortSignal` yok** (`lib/telegram.ts:36-48`). Aynı kusur `getWebhookInfo` için `docs/UX-AUDIT.md:354`'te ayrıca tespit edilmiş.
- Çağıran taraflar dönüş değerini genelde yok sayar; tek istisna `sendTestMessage`, `false` dönerse kullanıcıya `send_failed` gösterir (`app/actions/telegram.ts:140`).
- Fan-out döngüleri **seri** `await`'tir (`app/api/cron/shift-watchdog/route.ts:125-134`, `app/actions/fuel.ts:43-54` vb.); paralellik yok.

---

### 2. Bağlama akışı

**Kod + QR + deep link (kod tabanlı, tek kullanımlık)**

1. Şoför/yönetici panelde "Telegram Bildirimleri Bağla"ya basar (`components/TelegramLink.tsx:116`); bileşen `/panel`'de (`app/panel/PanelClient.tsx:988`) ve `/admin/telegram`'da (`app/admin/telegram/TelegramAdminClient.tsx:78`) render edilir.
2. `createTelegramLinkCode()` (`app/actions/telegram.ts:30`): `requireWorker()` → o kullanıcının önceki kodları **silinir** (`app/actions/telegram.ts:38-41`, "tek aktif kod" kuralı) → 6 haneli rastgele kod (`sixDigit()`, `app/actions/telegram.ts:21`) en fazla 5 denemeyle `telegram_link_codes` tablosuna yazılır (`app/actions/telegram.ts:47-53`, `locale` de saklanır).
3. Üretilenler: QR = `tg://resolve?domain=<bot>&start=<kod>` , tıklanabilir yedek = `https://t.me/<bot>?start=<kod>` (`app/actions/telegram.ts:59-61`). `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` tanımsızsa `{ ok:false, error:"not_configured" }` (`app/actions/telegram.ts:35`).
4. İstemci 3 saniyede bir `getMyTelegramStatus()` ile yoklar, en fazla 100 tik ≈ 5 dk (`components/TelegramLink.tsx:61-72`).
5. Kod ömrü: `expires_at` varsayılanı `now() + interval '15 minutes'` (`db/migrations/005_telegram.sql:24`).

**Webhook ne işliyor** (`app/api/telegram/webhook/route.ts`)

- Kimlik: `X-Telegram-Bot-Api-Secret-Token` başlığı, yedek olarak eski `?secret=` query; karşılaştırma `safeEqual` ile timing-safe; eşleşmezse 401 (`:176-182`).
- `runtime = "nodejs"`, `dynamic = "force-dynamic"` (`:13-14`).
- **`callback_query`** varsa önce o işlenir (`:193-200`) → `handleShiftCallback` (`:56`).
- **`/start <kod>`**: kod `telegram_link_codes`'tan okunur; `used_at` boş ve `expires_at` gelecekte olmalı (`:225-228`). Geçerliyse:
  - Aynı `chat_id`'ye bağlı **başka** worker'ların bağlantısı önce NULL'lanır (`:241-250`) — migration 013'ün UNIQUE indeksine takılmamak için.
  - Hedef worker'a `telegram_chat_id`, `telegram_username`, `telegram_linked_at`, `telegram_locale` yazılır (`:252-260`).
  - Kod `used_at` ile mühürlenir (`:262-265`) ve onay mesajı gönderilir (`:267`).
- **`/help`** ve tanınmayan her metin → iki dilli yardım metni (`:271-278`).
- Her yolda 200 döner (`catch` içinde bile, `:279-282`) — Telegram'ın retry fırtınası yapmaması için bilinçli.

**Hangi tabloya yazılıyor**

- `workers.telegram_chat_id / telegram_username / telegram_linked_at / telegram_locale` (`db/migrations/005_telegram.sql:7-11`).
- `telegram_link_codes(code PK, worker_id, locale, expires_at, used_at)` (`db/migrations/005_telegram.sql:20-26`).
- Vardiya başına bildirim tekilleştirme bayrakları: `time_entries.nine_hour_notified_at / lenkzeit_notified_at / summary_notified_at` (`db/migrations/005_telegram.sql:32-35`), `still_active_asked_at` (`db/migrations/011_shift_watchdog.sql:6-7`).
- Migration 013: `idx_workers_telegram_chat` (non-unique) düşürülüp `idx_workers_telegram_chat_unique` **kısmi UNIQUE** indeksiyle değiştirildi; önce dedup çalıştırılıyor (`db/migrations/013_telegram_chat_unique.sql:16-47`). Düzeltilen hata dosyanın başında yazılı: aynı chat birden çok worker'a bağlıyken webhook'un `.maybeSingle()` araması hata döndürüyor, watchdog Evet/Hayır butonları sessizce hiçbir şey yapmıyordu (`:5-7`).
- Bağlantıyı koparan yollar: kullanıcı kendisi (`unlinkTelegram`, `app/actions/telegram.ts:66-80`), gönderim 403/400 aldığında otomatik (`lib/telegram.ts:52-61`), yeni bir chat aynı worker'a bağlanırken (`webhook:241-250`).

**"Hayır, bitti" butonunun güvenliği** (`app/api/telegram/webhook/route.ts:56-168`): `callback_data` deseni `shift_(yes|no):<time_entry_id>`; vardiya önce **id ile** (birincil anahtar) ve `ended_at IS NULL` şartıyla çekilir (`:74-79`), sonra sahibinin `telegram_chat_id`'si mesajı gönderen chat ile karşılaştırılır (`:90-99`). "Hayır" ise `ended_at` tercihen aracın **son telemetri kaydından** alınır, yoksa "şimdi" (`:117-128`); kapanışa `end_reason:"watchdog"` yazılır, kolon yoksa kolonsuz tekrar denenir (`:130-153`); `confirmation_status` `pending` ise `unconfirmed`'e çekilir (`:156-164`).

---

### 3. OLAY LİSTESİ

| Olay | Tetikleyen dosya:satır | Kime | Mesaj özeti | Koşul / eşik |
|---|---|---|---|---|
| Bağlantı başarılı (`/start <kod>`) | `app/api/telegram/webhook/route.ts:267` | Bağlanan kişinin chat'i | "✅ `<marka>` bildirimleriniz aktif!" | Kod var, `used_at` boş, `expires_at` gelecekte (`:225-228`) |
| `/start` kodsuz | `app/api/telegram/webhook/route.ts:215` | O chat | "Panelden eşleştirme kodunuzu alın" (TR+DE) | `text.split()[1]` boş (`:212-216`) |
| Kod geçersiz/süresi dolmuş | `app/api/telegram/webhook/route.ts:231` | O chat | "Kod geçersiz veya süresi dolmuş" (TR+DE) | `valid === false` (`:230`) |
| `/help` | `app/api/telegram/webhook/route.ts:272` | O chat | Bot ne yapar + nasıl bağlanılır (TR+DE) | Metin `/help` ile başlıyor |
| Tanınmayan mesaj | `app/api/telegram/webhook/route.ts:277` | O chat | Aynı yardım metni | Diğer tüm metinler |
| Watchdog "Evet, devam" dokunuşu | `app/api/telegram/webhook/route.ts:109` | Dokunan şoför | "👍 Teşekkürler… 1 saat sonra tekrar soracağım" (`lib/telegram-messages.ts:203`) | Vardiya açık + chat sahibi eşleşiyor (`:74-99`) |
| Watchdog "Hayır, bitti" dokunuşu | `app/api/telegram/webhook/route.ts:167` | Dokunan şoför | "✅ Vardiya kapatıldı… km/kargo panelden" (`lib/telegram-messages.ts:211`) | Aynı sahiplik kontrolü; kapanış yapıldıktan sonra |
| Uzun açık vardiya sorusu | `app/api/cron/shift-watchdog/route.ts:109` | Şoför | "⏳ Vardiyan **X,X** saattir açık. Hâlâ devam ediyor mu?" + \[Evet\]\[Hayır\] inline butonları (`lib/telegram-messages.ts:177`, `:196`) | `ended_at IS NULL` **ve** `started_at ≤ now-10 sa` (`ASK_AFTER_MS`, `:18`); son sorudan ≥ 1 sa geçmiş (`REASK_MS`, `:19`, `:70-73`); test vardiyaları elenmiş (`:58-66`) |
| Şoför Telegram'da değil — uzun açık vardiya | `app/api/cron/shift-watchdog/route.ts:126` | `is_admin=true` **ve** chat'i bağlı tüm yöneticiler (`:90-95`) | "⚠️ `<ad>` (`<plaka>`) X,X saattir açık vardiyaya sahip ve Telegram'dan ulaşılamıyor" (`lib/telegram-messages.ts:225`) | Aynı eşikler + `w.telegram_chat_id` yok (`:106`/`:121`) |
| Şoför vardiyayı **elle** başlattı (kendi paneli) | `app/actions/shift.ts:76` (çağrı `:336`) | Bağlı tüm yöneticiler (`:68-72`) | "🟢 `<ad>` (`<plaka>`) vardiyayı başlattı, saat …" (`lib/telegram-messages.ts:50`) | Test şoförü ise **hiç gönderilmez** (`:64-65`). Yalnız `startShiftManualAction`'dan çağrılır — `startShiftForWorkerAction` (yönetici/şef adına başlatma, `app/actions/shift.ts:348+`) bildirim **göndermez** |
| Otomatik vardiya başladı → şoföre | `lib/auto-shift.ts:561` | Vardiyanın şoförü | "🟢 Kontak açıldı (`<plaka>`) — vardiyan `<saat>` itibarıyla başladı… panelden onayla" (`lib/telegram-messages.ts:94`) | `AUTO_START_ENABLED` (`SHIFT_START_TRIGGER ≠ "off"`, `lib/auto-shift.ts:104`) + insert başarılı (`:540`) + şoförün chat'i var (`:560`) |
| Otomatik vardiya başladı → yöneticilere | `lib/auto-shift.ts:571` | Bağlı tüm yöneticiler (`linkedAdmins()`, `:333-345`) | "🟢 Kontak açıldı: `<ad>` (`<plaka>`) vardiyası otomatik başlatıldı… Şoför onayı bekleniyor" (`lib/telegram-messages.ts:71`) | Aynı koşul; hepsi tek `try/catch` içinde, hata vardiyayı etkilemez (`:559`, `:580-582`) |
| Otomatik kapanış özeti → şoföre | `lib/auto-shift.ts:696` | Vardiyanın şoförü | "✅ Vardiya Tamamlandı — çalışma/km/kargo/mola" (`lib/telegram-messages.ts:149`) | **Şu an ulaşılamaz kod**: `if (!AUTO_END_ENABLED) continue` (`lib/auto-shift.ts:606`), `AUTO_END_ENABLED = SHIFT_AUTO_END !== "off"` (`:71`) ve `SHIFT_AUTO_END` varsayılanı `"off"` (`lib/tenant.ts:278-282`) |
| Manuel vardiya kapanışı özeti → şoföre | `app/actions/shift.ts:738` | Vardiyayı kapatan şoför | Aynı özet mesajı (`lib/telegram-messages.ts:149`) | Şoförün chat'i varsa (`:731`). **Test elemesi YOK** bu yolda |
| Lenkzeit 4,5 sa ihlali | `app/actions/telegram.ts:113` | Şoförün kendisi | "⚠️ Lenkzeit Uyarısı — 4.5 saat sürüş, 45 dk mola" (`lib/telegram-messages.ts:248`) | İstemci sayacı `VIOLATION_MIN = 270 dk` (`components/LenkzeitWarning.tsx:20`, `:136-139`) → sunucu `LENKZEIT_WARNING_ENABLED` kapalıysa sessizce çıkar (`app/actions/telegram.ts:92`); atomik tek-atış kilidi `lenkzeit_notified_at` NULL→now (`:95-104`) |
| Şoför "Sorun Bildir" | `app/actions/driver-panel.ts:304` | Bağlı tüm yöneticiler (`:298-302`) | "⚠️ `<ad>` (`<plaka>`) bildirdi: Araç Arızası / Adres Sorunu / Hasarlı Paket / Diğer" (`lib/telegram-messages.ts:114`) | Kayıt yazıldıktan sonra; test şoförü ise gönderilmez (`:294-295`); tümü `try/catch` (`:292`, `:313-315`) |
| Yeni sefer atandı | `app/actions/assignments.ts:84` | Sefer atanan şoför | 📦 sefer başlığı, tarih-saat, kategori, paket sayısı, duraklar; her durak için "Yol tarifi" URL butonu + "Paneli aç" (`:66-82`) | Yalnız `assignment_notified_at` NULL→now'u çeviren çağrı gönderir (yarış güvenli, `:45-52`); şoförün chat'i olmalı (`:59`). **Test elemesi YOK** |
| Sefer iptal edildi | `app/actions/assignments.ts:220` | Seferin şoförü | ❌ iptal, tarih-saat, ilk→son durak, (varsa) gerekçe (`:211-216`) | `cancelAssignment` başarılı + chat var (`:205`) |
| Yakıt kaydı gönderildi | `app/actions/fuel.ts:53` | Bağlı tüm yöneticiler (`:38-42`) | "🧾 yeni yakıt kaydı · ad · plaka · L · €" + "Onaylar" butonu (`:46-52`) | Test plakası ise gönderilmez (`:35-36`). Modül bayrağı `FUEL_ENABLED` varsayılanı **false** (`lib/tenant.ts:72`) |
| Yakıt onay/ret | `app/actions/fuel.ts:81` | Kaydı giren şoför | ✅/❌ + L·€ + tarih (+ ret gerekçesi) + "Panel" butonu (`:74-80`) | `approveFuelEntry:157` / `rejectFuelEntry:177`, yalnız `status='pending'` satır güncellenmişse (`:153-156`, `:173-176`) |
| Masraf kaydı gönderildi | `app/actions/expenses.ts:53` | Bağlı tüm yöneticiler (`:38-42`) | "🧾 yeni masraf · ad · kategori · €" + "Onaylar" butonu (`:46-52`) | Test şoförü ise gönderilmez (`:36`). `EXPENSE_ENABLED` varsayılanı **false** (`lib/tenant.ts:74`) |
| Masraf onay/ret | `app/actions/expenses.ts:80` | Kaydı giren şoför | ✅/❌ + kategori·€ + tarih (+ gerekçe) + "Panel" butonu (`:73-79`) | `approveExpenseEntry:147` / `rejectExpenseEntry:167` |
| Bakım hatırlatması | `app/actions/maintenance.ts:177` | Bağlı tüm yöneticiler (`:167-171`) | "🔧 `<plaka>` — `<mevcut km>` / `<servis km>`" + "Panel" butonu (`:175-176`) | Yakıt kaydından tetiklenir (`app/actions/fuel.ts:133`); yalnız `next_service_km - 1000` eşiğini **bu kayıt geçiyorsa** (`:150-162`); test plakası elenir (`:164-165`). `MAINTENANCE_ENABLED` varsayılanı **false** (`lib/tenant.ts:76`) |
| Yönetici test mesajı | `app/actions/telegram.ts:139` | Seçilen çalışan | "🔔 `<marka>` — Test" + yöneticinin yazdığı serbest metin (HTML-escape'li, `:138`) | `requireAdmin()` (`:126`); hedefin chat'i yoksa `not_linked` (`:135`). UI: `app/admin/telegram/TelegramAdminClient.tsx:58` |

**Ölü/kullanılmayan mesaj**: `nineHourMessage` (`lib/telegram-messages.ts:27`) — grep'te tek eşleşme tanımın kendisi; dosya içi yorum da "ŞU AN ÇAĞRILMIYOR (ölü kod, 22.07.2026)" diyor (`:21`). `time_entries.nine_hour_notified_at` kolonu duruyor ama TypeScript'te yalnız `lib/types.ts:86`'da tip alanı olarak geçiyor, hiçbir yerde okunmuyor/yazılmıyor.

---

### 4. Zamanlayıcı

**Tetikleme yolu**: repoda **`vercel.json` YOK** (glob `vercel.json` → sonuç yok) ve **`.github/workflows/*.yml` YOK**. Yani cron tanımı kod tabanında değil, **harici zamanlayıcıda** (cron-job.org / GitHub Actions) yaşıyor: `app/api/cron/shift-watchdog/route.ts:22-24`, `docs/shift-watchdog.md:17-29`.

- **Kimlik**: `CRON_SECRET` zorunlu; hem `?secret=` hem `Authorization: Bearer <secret>` kabul edilir, karşılaştırma `safeEqual` ile timing-safe; env tanımsızsa **fail-closed** 401 (`app/api/cron/shift-watchdog/route.ts:36-47`, `:149-151`). GET ve POST aynı gövdeyi çalıştırır (`:148`, `:164-166`).
- **Sıklık**: belgelenen değer **15 dakika** (`docs/shift-watchdog.md:18`, `:25`). Yeni müşteri belgelerinde **saatlik** yazıyor (`docs/YENI-MUSTERI-KURULUM.md:147`, `docs/SENDIGO-KURULUM.md:319`, `docs/GALZURA-KURULUM.md:249`). Gerçekte kayıtlı olan aralık **BİLİNMİYOR** — harici bir serviste tanımlı, repoda kanıtı yok.
- **Ne yapıyor** (`runWatchdog`, `:49-146`): açık (`ended_at IS NULL`) ve `started_at ≤ now-10sa` vardiyaları çeker, test satırlarını eler (`withoutTestRows`, `:58-66`), son 1 saat içinde sorulmamış olanları süzer (`:70-73`), şoföre inline butonlu soru ya da (bağlı değilse) yöneticilere uyarı gönderir, sonra `still_active_asked_at`'i damgalar (`:139-142`). Dönüş: `{ ok, open, due, asked, adminAlerts }`.
- **Vardiyayı kendisi kapatmaz** — kapanış yalnız şoför "Hayır" derse webhook üzerinden olur (`docs/shift-watchdog.md:38-39`).

**İkinci zamanlayıcı (bildirim üreten asıl yol)**: `/api/flespi/sync` — `FLESPI_SYNC_SECRET` ile korunur, ~30–60 sn'de bir harici scheduler tarafından çağrılması amaçlanmış (`app/api/flespi/sync/route.ts:26-35`) ve sonunda `processAutoShifts()` çağırır (`:185`) — otomatik vardiya başlatma Telegram mesajları buradan çıkar. `/api/flespi/ingest` de dokunulan araçlar için aynı fonksiyonu çağırır (`app/api/flespi/ingest/route.ts:201`).

**Kill-switch'ler ve değerleri**

| Bayrak | Tanım | Kod varsayılanı | Bildirime etkisi |
|---|---|---|---|
| `AUTO_END_ENABLED` | `lib/auto-shift.ts:71` = `SHIFT_AUTO_END !== "off"` | `SHIFT_AUTO_END` varsayılanı `"off"` (`lib/tenant.ts:278-282`, `.env.example:131`) → **false** | `lib/auto-shift.ts:606` erken çıkar; otomatik kapanış özeti (`:696`) hiç gönderilmez |
| `AUTO_START_ENABLED` | `lib/auto-shift.ts:104` = `SHIFT_START_TRIGGER !== "off"` | `SHIFT_START_TRIGGER` varsayılanı `"depot_entry"` (`lib/tenant.ts:261-265`, `.env.example:126`) → **true** | Kapalıysa otomatik başlatma mesajları (`:561`, `:571`) gitmez |
| `LENKZEIT_WARNING_ENABLED` | `lib/tenant.ts:174-177` | **true** (`.env.example:98`) | Kapalıysa `notifyLenkzeit` sunucuda sessizce çıkar (`app/actions/telegram.ts:92`) |
| `FUEL_ENABLED` | `lib/tenant.ts:72` | **false** | Yakıt bildirimleri fiilen kullanılmıyor (sayfalar `/panel`e yönlendiriyor, `app/panel/yakit/page.tsx:12`) |
| `EXPENSE_ENABLED` | `lib/tenant.ts:74` | **false** | Masraf bildirimleri fiilen kullanılmıyor |
| `MAINTENANCE_ENABLED` | `lib/tenant.ts:76-79` | **false** | Bakım hatırlatması fiilen kullanılmıyor |

⚠️ Yukarıdakiler **kod varsayılanlarıdır**. Üç tenant'ın (HAK61 / Sendigo / Galzura) Vercel'de fiilen tanımlı env değerleri **BİLİNMİYOR** — bu repo salt okunur incelendi, Vercel env okunmadı. Belgelenen niyet: Sendigo'da `SHIFT_START_TRIGGER=first_ignition` ve `NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED=false` (`docs/SENDIGO-KURULUM.md:171`, `:175`), Galzura'da `SHIFT_START_TRIGGER=first_ignition` (`docs/GALZURA-KURULUM.md:122`).

Ayrıca `lib/tenant.ts:322-325` fail-closed bir denetim içerir: `NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false` iken `SHIFT_AUTO_END='off'` olamaz (kapatacak kimse kalmaz).

---

### 5. Mobil notu

**Telegram dışında bildirim kanalı var mı**

- **Web push: YOK.** `public/sw.js` yalnız `install`, `activate`, `fetch`, `sync` olaylarını dinler (`public/sw.js:7-14`) — `push` / `notificationclick` dinleyicisi yok. Kod tabanında `pushManager`, VAPID, FCM, OneSignal, expo-notifications geçmiyor (grep: eşleşme yok). Abonelik tablosu da yok.
- **Yerel (push olmayan) tarayıcı bildirimi: VAR, tek yerde.** `components/LenkzeitWarning.tsx:79-97` — sayfa **açıkken**, istemci sayacı 270 dk'yı geçince `new Notification(BRAND.name, …)` gösterir ve gerekirse izin ister. Sunucudan tetiklenemez; sekme kapalıyken çalışmaz.
- **In-app toast**: `sonner` (`app/layout.tsx:6` `<Toaster>`), her yerde `toast.*` ile eylem geri bildirimi. Bildirim kanalı değil, UI geri bildirimi.
- **Ses**: `/sounds/lenkzeit-alarm.wav` (`components/LenkzeitWarning.tsx:61`) — yalnız panel açıkken.
- **E-posta / SMS / WhatsApp: YOK.** nodemailer, resend (SDK olarak), sendgrid, smtp, twilio araması yalnız tasarım yorumlarında geçen "Resend" (tasarım referansı) ve `package-lock.json` hash'lerine düştü; gerçek bir gönderim istemcisi yok.
- **Panel-içi "Dikkat" listeleri** (yönetici panosu) bir kanal değil, sayfa açıldığında okunan sorgular.

**Mobil push için anlamlı olan olaylar** (yukarıdaki tablodan, alıcı ekseninde)

Şoföre giden, gerçek zamanlı ve eyleme çağıran olanlar — push'un asıl kazancı burada:
- Watchdog "vardiyan hâlâ açık mı?" + Evet/Hayır (`app/api/cron/shift-watchdog/route.ts:109`) — hâlihazırda **inline butonlu**, yani push'ta action button karşılığı doğrudan var.
- Otomatik vardiya başladı → şoför (`lib/auto-shift.ts:561`).
- Yeni sefer atandı (`app/actions/assignments.ts:84`) ve sefer iptal (`:220`) — konum/durak butonlarıyla birlikte, mobilde en yüksek değerli olay.
- Lenkzeit 4,5 sa (`app/actions/telegram.ts:113`) — **şu an panel açık değilse hiç ulaşmıyor**; push bunu gerçekten düzeltir.
- Yakıt/masraf onay-ret (`app/actions/fuel.ts:81`, `app/actions/expenses.ts:80`) — modüller kapalı olduğu için bugün etkisiz.

Yöneticiye giden, "toplu alarm" karakterli olanlar — push'ta gürültü riski yüksek, gruplama/susturma gerekir:
- Vardiya başladı (`app/actions/shift.ts:76`) ve otomatik vardiya başladı (`lib/auto-shift.ts:571`): şoför sayısı kadar sabah mesajı üretir.
- Ulaşılamayan uzun vardiya (`app/api/cron/shift-watchdog/route.ts:126`): saat başı tekrarlanır, aynı vardiya için birden çok kez gelir.
- Şoför "Sorun Bildir" (`app/actions/driver-panel.ts:304`): seyrek ve acil — push'a en uygun yönetici olayı.

Push'a taşınırsa **birebir korunması gereken kapılar**: test verisi elemesi (`getTestScope` / `withoutTestRows` — `shift.ts:64-65`, `driver-panel.ts:294-295`, `shift-watchdog:58-66`), tek-atış kilitleri (`lenkzeit_notified_at`, `assignment_notified_at`, `still_active_asked_at`) ve alıcı çözümlemesinin **id ekseninde** yapılması (`webhook:74-99`'daki sahiplik kontrolünün nedeni migration 013'te yazılı).

Not: `app/actions/assignments.ts:44-85` (yeni sefer) ve `app/actions/shift.ts:725-748` (manuel kapanış özeti) yollarında test-verisi elemesi **yoktur**; diğer bildirim yollarında vardır. Push kanalı eklenirse bu iki yol, test hesabının mesajını gerçek cihazlara düşürür.

---

## 7) Kapsanmamış Alanlar (bağımsız eleştiri)

### Kapsanmamış Alanlar

#### 1. Dosya/foto yükleme — mobil için kullanılabilir bir yol yok

- **Dört özel bucket, hepsi service-role arkasında.** `fuel-receipts`, `expense-receipts`, `maintenance-receipts` (`db/migrations/007_fuel_expenses.sql:113-118`) ve `shift-photos` (`db/migrations/020_driver_panel_v2.sql:152-155`). Dördü de `public=false`, `file_size_limit=5242880` (5 MB), `allowed_mime_types = image/jpeg|png|webp|heic`. Migration yorumu bunu açıkça yazıyor: *"Uploads/reads happen via the service-role client in server actions, which bypasses RLS, so no object policies are required"* (`db/migrations/007_fuel_expenses.sql:111-112`). **Sonuç: tek bir Storage RLS politikası yok** — React Native istemcisi Supabase Storage'a doğrudan yazamaz veya okuyamaz; her byte server action üzerinden geçmek zorunda.
- **Yükleme yalnız `FormData` + server action.** `uploadReceipt` `File` alıyor ve `server-only` işaretli (`lib/storage.ts:1`, `lib/storage.ts:20-42`); çağrı noktası `formData.get("photo") as File` (`app/actions/driver-panel.ts:229`). Presigned-upload URL üreten hiçbir kod yok.
- **1 MB gövde tavanı ayarlanmamış.** `next.config.ts` (13 satırın tamamı) `experimental.serverActions.bodySizeLimit` içermiyor. Kod tabanının kendi notu: *"uploads travel through a server action FormData body, and Next.js caps that at ~1 MB by default"* (`lib/image-resize.ts:10-11`). Yani 5 MB'lık bucket sınırına pratikte hiç ulaşılmıyor — gerçek sınır istemci-taraf küçültmedir.
- **Küçültme Canvas'a bağımlı.** `lib/image-resize.ts:12-49` `FileReader` + `document.createElement("canvas")` + `canvas.toBlob` kullanıyor. React Native'de bu API'lerin hiçbiri yok; 1600px/q0.85 sözleşmesinin (`lib/image-resize.ts:26`, `:42`) native karşılığı seçilmemiş.
- **HEIC yolu belirsiz.** Sunucu HEIC'i kabul ediyor (`lib/storage.ts:5`) ama tarayıcı çözemediği için orijinal dosya olduğu gibi yükleniyor (`lib/image-resize.ts:46-48`). iOS'ta varsayılan HEIC çıktı 1 MB gövde tavanını aşarsa yükleme sessizce başarısız olur — bu senaryonun ele alındığı bir kod yok.
- **İmzalı URL'in ömrü 1 saat ve yenileme yolu yok.** `expiresIn = 3600` iki fonksiyonda da sabit varsayılan (`lib/storage.ts:48`, `lib/storage.ts:66`). URL sunucu render'ında üretilip doğrudan `<img src>`'ye gömülüyor (`components/ReceiptThumb.tsx:43-47`). Uzun süre açık kalan bir mobil listede görseller 1 saat sonra kırılır; "imzayı tazele" diye bir action yok.
- **Fotoğraf çevrimdışı kuyruğa GİRMİYOR.** `QueuedActionType = "start" | "end" | "break" | "package" | "report"` (`lib/offline-queue.ts:7`); kuyruk `payload: Record<string, unknown>` tutuyor (`lib/offline-queue.ts:12`), binary saklama yok. Kapsama alanı olmayan bir şoför fotoğrafı kaydedemez.

#### 2. Çok dilli yapı — dil kaynağı mobilde yeniden tanımlanmalı

- Diller **yalnız iki**: `SUPPORTED_LOCALES = ["tr", "de"]` (`i18n/request.ts:4`). Çeviriler `messages/tr.json` + `messages/de.json`; 31 üst düzey ad alanı, **her iki dosyada da 1545 yaprak anahtar ve anahtar kümeleri birebir aynı** (iki dosyayı düzleştirip karşılaştırdım: her iki yönde de 0 eksik).
- **Dil seçimi tek kaynaktan gelir: HTTP çerezi.** `LOCALE_COOKIE = "hak_locale"` okuması `cookies()` üzerinden (`i18n/request.ts:14-21`), yazması `setLocaleAction` ile (`app/actions/preferences.ts:9-13`). `Accept-Language` başlığı ya da cihaz dili müzakeresi kod tabanında hiç yok. React Native'de çerez katmanı olmadığı için dil sözleşmesi sıfırdan tanımlanmalı.
- `timeZone: "Europe/Vienna"` next-intl config'ine sabit gömülü (`i18n/request.ts:29`) — mobil istemcinin cihaz saat dilimini ne yapacağı tanımsız.
- **Hata kodu → kullanıcı metni eşlemesi merkezi değil, ekran ekran kopyalanmış.** Şoför paneli kendi `if` zincirini tutuyor (`app/panel/PanelClient.tsx:445-465`), yönetici diyaloğu ayrı bir `KNOWN_ERRORS` dizisi (`components/admin/StartShiftForWorkerDialog.tsx:56-68` + `:125-128`). Mobil bu eşlemeyi üçüncü kez kopyalamak zorunda kalır ve iki mevcut kopya birbiriyle aynı bile değil (bkz. madde 6).

#### 3. Harita katmanı — API anahtarı yok, ama render yığınının tamamı web'e bağlı

- **Tile sağlayıcı OpenFreeMap, API anahtarı GEREKTİRMİYOR.** Açık tema `https://tiles.openfreemap.org/styles/liberty` (`lib/map-tiles.ts:10`), koyu tema `.../styles/dark` (`lib/map-tiles.ts:22`). Atıf **zorunlu** ve dosya bunu şart koşuyor (`lib/map-tiles.ts:7-9`, dize `lib/map-tiles.ts:24-25`). Mobilde de aynı atıf yükümlülüğü devam eder — MapLibre RN'de bunun nereye basılacağı tanımlanmamış.
- **Render yığını: Leaflet + maplibre-gl köprüsü.** `L.maplibreGL({...})` çağrısı `@maplibre/maplibre-gl-leaflet` üzerinden (`components/VectorBaseLayer.tsx:4-7`, `:27-35`); `package.json` bağımlılıkları `leaflet`, `react-leaflet`, `maplibre-gl`, `@maplibre/maplibre-gl-leaflet`. React Native'de `react-leaflet` yok; hangi native harita kütüphanesinin kullanılacağı seçilmemiş.
- **Marker'lar HTML.** `L.divIcon` ile üretiliyor (`components/FleetMap.tsx:56`), üstüne react-leaflet `Tooltip` ve `Popup` (`components/FleetMap.tsx:183-230`). Native haritalarda HTML marker karşılığı yoktur; 297 satırlık `FleetMap` mobilde yeniden yazım demektir (`components/FleetMap.tsx`, ayrıca `RouteReplayMap.tsx` 172 satır, `GeofencePickerMap.tsx` 61 satır).
- **Rota yol-eşleme public OSRM demo sunucusuna bağlı.** `https://router.project-osrm.org/match/v1/driving/` (`lib/route-history.ts:32`), istek başına 90 koordinat sınırı ve 180 girdi tavanı (`lib/route-history.ts:33-34`, çağrı `:50`). SLA'sız üçüncü taraf; kota/hız sınırı davranışı için yedek yol tanımlı değil (yalnız `matched:false` ile ham noktaya düşüş, `lib/route-history.ts:23-25`).
- Replay nokta tavanı 900 (`lib/route-history.ts:105-108`) — mobil için ayrı bir bütçe tanımlanmamış.
- **Ters jeokodlama hiç yok.** Kod tabanında Nominatim ya da herhangi bir geocode çağrısı geçmiyor; konum her yerde koordinat olarak taşınıyor. Mobilde "araç nerede" sorusunun adres cevabı bugün üretilemiyor.

#### 4. Gerçek zamanlı güncelleme — Supabase Realtime kullanılmıyor, mekanizma web'e özgü

- **Realtime YOK.** `.channel(`, `postgres_changes`, `.subscribe()` ifadeleri `app/`, `lib/`, `components/`, `hooks/` altında hiç geçmiyor. WebSocket bağlantısı kuran hiçbir kod yok.
- **Tek mekanizma `router.refresh()` ile yoklama:** yönetici panosu 20 sn (`app/admin/AdminClient.tsx:265`), canlı harita 30 sn (`app/admin/harita/LiveTrackingClient.tsx:39` + `:80`), araç detayı sekme görünürlüğüne kapılı (`app/admin/araclar/[id]/VehicleDetailClient.tsx:124-125`). `router.refresh()` bir RSC yeniden-render'ı tetikler; **React Native'de karşılığı yoktur** — mobil kendi veri çekme/yenileme protokolünü sıfırdan tanımlamak zorunda.
- **ISR/`revalidate` süresi hiç kullanılmıyor.** Sayfalar `export const dynamic = "force-dynamic"` (ör. `app/admin/page.tsx:31`, `app/admin/harita/page.tsx:13`, `app/panel/gecmis/page.tsx:11`). Yani sunucu tarafında önbelleğe alınmış, mobilin çekebileceği bir temsil yok; her istek tam hesap.
- Tazeleme sinyali olarak `revalidatePath("/panel")` / `revalidatePath("/admin")` kullanılıyor (ör. `app/actions/driver-panel.ts:132-133`, `app/actions/offline.ts:211-212`) — bu da Next önbelleğine özgüdür, mobil istemciye hiçbir şey iletmez.

#### 5. PWA / service worker / bildirim — arka plan bildirim kanalı hiç yok

- **Manifest dinamik rota**, `BRAND`'den türetiliyor (`app/manifest.json/route.ts:19-46`); URL bilinçli olarak `/manifest.json` (`app/manifest.json/route.ts:11-14`).
- **Service worker 24 satır ve önbellek YAPMIYOR**: `fetch` dinleyicisi kasten boş (`public/sw.js:10-12`), tek işlevi Background Sync etiketini istemciye postalamak (`public/sw.js:14-23`). Kayıt `components/providers.tsx:9`. Yani çevrimdışı kabiliyeti sadece IndexedDB kuyruğudur (`lib/offline-queue.ts`), varlık/veri önbelleği yoktur.
- **Web Push YOK.** `pushManager`, VAPID, `web-push` kod tabanında hiç geçmiyor. Tek istemci bildirimi, sayfa açıkken çalışan `new Notification(...)` (`components/LenkzeitWarning.tsx:79-97`). Arka plan bildirimi **yalnız Telegram** üzerinden (`lib/telegram.ts:4`). → FCM/APNs cihaz-token tablosu, kayıt akışı ve gönderim yolu **hiç yok**; mobil bildirim mimarisi sıfırdan tasarlanacak.
- Alarm sesi `<audio>` ile `/sounds/lenkzeit-alarm.wav` (`components/LenkzeitWarning.tsx:61`, tek dosya `public/sounds/`) — RN'de ses kanalı/asset yolu tanımsız.
- Şoförün konum izni akışı yok: `getGeoFix` **asla reddetmez**, izin reddi/başarısızlık sessizce `{lat:null,lng:null}` döner (`app/panel/geo.ts:16-32`). React Native açık izin isteme akışı gerektirir; "izin reddedildi" durumunun kullanıcıya nasıl gösterileceği hiçbir yerde tanımlı değil. Arka plan konum takibi de yok.

#### 6. Hata yönetimi / dönüş formatı — mobil için standart DEĞİL

- Baskın desen ayrık birleşim: `{ ok: true } | { ok: false, error: "<kod>" }`. **`app/actions/` altında `throw new Error` hiç yok** (16 dosyanın tamamında 0 eşleşme). Buraya kadarı iyi. Sorun tekdüzelikte:
- **(a) Bazı action'lar hiç değer döndürmüyor, `redirect()` atıyor.** `loginAction` başarıda `redirect("/pin")` / `redirect("/admin")` (`app/actions/auth.ts:202-203`), `logoutAction` `redirect("/")` (`app/actions/auth.ts:209`). `redirect` bir `NEXT_REDIRECT` istisnası fırlatır ve Next'in RSC protokolüne bağlıdır — mobil istemci bunu yorumlayamaz.
- **(b) Hata kodu taşımayan dönüşler.** `Promise<{ ok: boolean }>` (`app/actions/telegram.ts:66`, `app/actions/telegram.ts:86`) — başarısızlık sebebi kaybediliyor.
- **(c) Kod içine gömülü parametreler.** `"undelivered_over:<got>:<taken>"` ve `"undelivered_max:<max>"` dizeden `split(":")` ile ayrıştırılıyor (`app/panel/PanelClient.tsx:450-456`). Yapısal alan yok; her istemci aynı ayrıştırmayı yeniden yazmak zorunda.
- **(d) `error` alanı bazen kod, bazen ham veritabanı metni.** `return { ok: false, error: error.message }` — Supabase'in mesajı doğrudan dışa veriliyor: `app/actions/driver-panel.ts:130`, `:202`, `:247`, `:289`, `:360`, `:420`; `app/actions/fuel.ts:155`, `:175`; `app/actions/offline.ts:128`. Ayrıca `uploadReceipt` da Storage hatasını aynen geçiriyor (`lib/storage.ts:40` → `app/actions/driver-panel.ts:232`). Mobil için bu, sabit bir kod kümesine eşleme yapmayı imkânsız kılar.
- **(e) Bilinmeyen kod politikası iki yerde iki farklı.** Şoför paneli kodu **ham dize olarak ekrana basıyor** (`app/panel/PanelClient.tsx:465`: `return e;`), yönetici diyaloğu ise generic metne düşüyor (`components/admin/StartShiftForWorkerDialog.tsx:126-127`).
- **(f) HTTP durum kodu yok.** Server action her zaman 200 döner; beklenmeyen sunucu istisnası için bir zarf/hata tipi tanımlı değil. Mobilde "ağ hatası mı, yetki hatası mı, iş kuralı reddi mi" ayrımı yapılamaz.
- **Sonuç: mevcut sözleşme mobil için standart değil.** Kullanılabilir hale gelmesi için en az üç şey gerekir: hata kodlarının tek bir kaynakta (kod tabanında böyle bir dosya yok) sabitlenmesi, ham DB mesajlarının sızmasının kesilmesi, `redirect()` yolunun veri döndüren bir yola çevrilmesi.

#### 7. Sayfalama/limit — üç ayrı strateji, ortak sözleşme yok

- **(a) Kullanıcıya görünen tek sayfalama şoför geçmişinde:** `PAGE_SIZE = 25`, `count: "exact"`, `?page` offset'i (`app/panel/gecmis/page.tsx:12`, `:24-25`, `:29`, `:39-44`). Offset tabanlı; cursor yok.
- **(b) Sunucu tarafı tam-tarama:** `fetchAllRows` 1000'lik sayfalarla tüm sonucu belleğe alır, 100 sayfa (100.000 satır) emniyet tavanı vardır ve tavana dayanınca yalnız `console.warn` basar (`lib/supabase.ts:18-23`, `:31-36`, `:49-69`). Bu, RSC içinde tüketilmek üzere tasarlanmış — sonucu parça parça dışarı verecek bir arayüz yok.
- **(c) Yönetici listeleri hiç sayfalanmıyor**, yalnız tarih aralığıyla sınırlanıyor (`app/admin/alarmlar/page.tsx:105-110`).
- `.in()` sorguları için 100'lük parçalama (`lib/supabase.ts:109-113`) — istemciye görünmeyen, tamamen sunucu-içi bir detay.
- **Hiçbir yerde cursor/`next_cursor`/`has_more` üretilmiyor.** Sonsuz kaydırma (mobilde varsayılan liste deseni) için kullanılabilir bir sözleşme yok; `count: "exact"` de yalnız 11 çağrı noktasında var (`app/panel/gecmis/page.tsx:29`, `app/actions/leaves.ts:71`, `app/actions/workers.ts:277`, `app/admin/raporlar/page.tsx:59-69`, `lib/auto-shift.ts:694`, `lib/reports.ts:751`, `lib/shift-packages.ts:15`, `lib/telemetry.ts:947`).

#### 8. HTTP veri API'si hiç yok — mobilin okuma yüzeyi sıfır

- `app/api/` altında **yalnız 4 rota** var ve **dördü de makine-makine**: `app/api/cron/shift-watchdog/route.ts` (paylaşılan sır `CRON_SECRET`, `:34-38`), `app/api/flespi/sync/route.ts` (`FLESPI_SYNC_SECRET`, `:32-34`), `app/api/flespi/ingest/route.ts`, `app/api/telegram/webhook/route.ts`. Kullanıcı verisi döndüren tek bir JSON endpoint yok.
- Her okuma RSC içinde `supabaseAdmin` ile yapılıyor ve bu istemci `server-only` (`lib/supabase.ts:1`, `:13-15`). Yani mobil uygulamanın çekebileceği hiçbir veri yüzeyi mevcut değil — server action'lar RSC protokolüne bağlı, route handler'lar iş verisi taşımıyor.
- Var olan iki kimlik doğrulama deseni (`?secret=` veya `Authorization: Bearer <sır>`, timing-safe karşılaştırma — `lib/secure-compare.ts` üzerinden) **paylaşılan sabit sırdır**, kullanıcı başına token değil. Mobil için taşınabilir bir örnek değil.

#### 9. Tarih/saat — sağlam ama iki çatlak var

- **date-fns bağımlılıkta olmasına rağmen sınır hesapları için kullanılmıyor**; `startOfDayVienna` / `startOfWeekVienna` / `startOfMonthVienna` elle `Intl.DateTimeFormat` ile yazılmış ve DST için çift-geçişli düzeltme yapıyor (`lib/format.ts:172-227`, `:245-309`). Tek saat dilimi `VIENNA_TZ = "Europe/Vienna"` (`lib/format.ts:172`). Depoda saat dilimi kullanıcı ayarı yok.
- **Çatlak 1 — sunucu yerel saatine düşen bir filtre kalmış.** `app/panel/gecmis/page.tsx:33-37` gün sonunu `to.setHours(23,59,59,999)` ile kuruyor; bu, Vienna değil **çalıştıran makinenin** yerel saatidir. Aynı dosyanın kendi kütüphanesindeki `endOfDayViennaFromYmd` (`lib/format.ts:305-309`) kullanılmıyor. UTC host'ta gün sınırı 1-2 saat kayar — mobil aynı sorgu yolunu klonlarsa hatayı aynen taşır.
- **Çatlak 2 — `formatRelative` `Date.now()` kullanıyor** ve yalnız istemcide/mount sonrası çağrılmalı (`lib/format.ts:96-98`, `:102`). Mobilde hidrasyon kaygısı yok ama sözleşme (hangi fonksiyon sunucuda güvenli) hiçbir yerde makine-okunur değil.
- **İstemci saatine güven penceresi tanımlı ve mobilde de geçerli olmalı:** gelecek yönde +5 dk, geçmiş yönde −48 sa; dışına çıkan `clientTime` sessizce sunucu saatine düşürülüyor (`app/actions/offline.ts:34-44`). Bu kural yalnız çevrimdışı kuyruk yolunda uygulanıyor, genel bir girdi doğrulaması değil.

#### 10. Modül bayrakları derleme zamanında gömülüyor — mobilde bu model çalışmaz

- 17 ayar `lib/tenant.ts`'te `export const` olarak, **düz literal** `process.env.NEXT_PUBLIC_*` okumasıyla tanımlı: `FUEL_ENABLED` (`:72`), `EXPENSE_ENABLED` (`:74`), `MAINTENANCE_ENABLED` (`:76`), `LEAVES_ENABLED` (`:84`), `DRIVER_PANEL_ENABLED` (`:100`), `PACKAGES_ENABLED` (`:161`), `LENKZEIT_WARNING_ENABLED` (`:174`), `SAFETY_SCORE_CALIBRATED` (`:187`).
- Dosyanın kendi uyarısı: değerler **derleme anında metin olarak** paket içine gömülür, dinamik erişim istemciye gömülmez (`lib/tenant.ts` başlık bloğu, "HER ERİŞİM DÜZ LİTERAL OLMAK ZORUNDA").
- React Native'de tenant başına ayrı derleme yapmadan bu model çalışmaz; bayrakların **çalışma zamanında sunucudan** gelmesi gerekir ve bunu döndüren hiçbir action/endpoint yok.
- Aynısı marka için de geçerli: `BRAND` tümüyle `NEXT_PUBLIC_*` + derleme-zamanı kayıt defteri (`lib/brand.ts:30`, `:125-128`, `:180-195`); görsel yolları `/brands/<tenant>/...` biçiminde **HTTP yolları** (`lib/brand.ts:113-122`), native asset karşılığı yok.

#### 11. Rapor/dışa aktarım katmanı tamamen web API'lerine bağlı

- **PDF**: `@react-pdf/renderer` istemci tarafında, 5 rapor bileşeni (`components/pdf/`). Font `Font.register` ile **HTTP yolundan** yükleniyor: `/fonts/Geist-Regular.ttf` (`lib/pdf-font.ts:21-24`). RN'de bu paket ve bu yol çalışmaz.
- **CSV**: `Blob` + `URL.createObjectURL` + `<a download>` ile indiriliyor; yönetici panosunda UTF-16LE BOM elle kuruluyor (`app/admin/AdminClient.tsx:259-380`), masraf ekranında UTF-8 (`app/admin/masraflar/ExpenseAdminClient.tsx:50-51`), bordro CSV'si BOM'lu UTF-8 + CRLF (`app/actions/expenses.ts:291`). Mobilde dosya kaydetme/paylaşma yolu tanımsız — üstelik iki farklı kodlama sözleşmesi var.
- **Grafikler**: `recharts` (`components/ui-v2/MiniTrend.tsx:10`, `next.config.ts:9`'da optimize ediliyor) — SVG/DOM tabanlı, RN karşılığı yok.

#### 12. İstemci sürümü ve kötüye kullanım koruması

- **Sürüm/zorunlu-güncelleme mekanizması yok.** Kod tabanında `APP_VERSION` benzeri bir sabit yok; sunucu istemcinin hangi sürüm olduğunu göremiyor. Mobilde eski sürüm istemcilerin sunucu sözleşmesi değiştiğinde ne yapacağı tanımsız — özellikle çevrimdışı kuyruk 48 saate kadar eski olay gönderebildiği için (`app/actions/offline.ts:35`) bu gerçek bir risk.
- **Giriş dışında hız sınırlama yok.** `rate limit`/`Ratelimit` benzeri hiçbir kod yok; tek koruma PIN denemesi kilidi (`lib/login-lock.ts`). Fotoğraf yükleme, `+1 PAKET` ve `SORUN BİLDİR` gibi mobilden yüksek frekansla tetiklenebilecek action'ların hiçbirinde kota yok.

---

## 8) Mobil Geçiş Zorlukları (kanıta dayalı)

### Mobil Geçiş Zorlukları

---

#### 1. Oturum tamamen çerez tabanlı — kullanıcı için token yolu HİÇ YOK (en zor)

**Sorun.** Kimlik doğrulama `iron-session` + httpOnly çerez üzerine kurulu. Kodda mobil istemcinin kullanabileceği hiçbir `Authorization` kabul yolu yok.

**Kanıt.**
- `lib/session.ts:2` `cookies()` importu; `lib/session.ts:20-28` çerez adı `hak_session`, `httpOnly: true`.
- Guard'lar başarısızlıkta HTTP durum kodu değil **yönlendirme** üretir: `lib/session.ts:37-38` (`redirect("/")`, `redirect("/pin")`), `:44-46`, `:69-70`, `:76`, `:148-149`. Bir mobil istemci 401 yerine 307 + HTML alır.
- Guard çağrı yeri sayısı **115**: `requireWorker()` 37, `requireAdmin()` 70, `requireFleetView()` 6, ayrıca `getSession()` 14.
- Kodda geçen **her** `Authorization` başlığı makineden-makineye paylaşılan sırdır, kullanıcı kimliği değil: `lib/flespi-auth.ts:16-17` (`Bearer` = `FLESPI_SYNC_SECRET`), `app/api/cron/shift-watchdog/route.ts:44`, `lib/flespi.ts:319,511` (`FlespiToken`, flespi'ye giden dış çağrı). Kullanıcı başına token doğrulayan tek satır yok.
- `loginAction` başarı durumunda **hiçbir şey döndürmez**, `redirect()` atar: `app/actions/auth.ts:202-203`. Dönüş tipi `LoginState` yalnızca hata taşır (`app/actions/auth.ts:18-30`). Yani mobilin tutabileceği bir kimlik çıktısı üretilmiyor.
- `middleware.ts` yok (kökte ve `app/` altında bulunamadı) — merkezî bir yerden token doğrulaması enjekte edilecek tek nokta da mevcut değil.

**İş yükü notu.** Yeni bir token verme/yenileme mekanizması sıfırdan yazılmalı, `lib/session.ts`'e çerez **veya** token okuyan ikinci bir yol eklenmeli ve 115 guard çağrı yerinin davranışı "redirect" yerine "hata döndür" hâline getirilmeli. `redirect()` fırlatan guard'lar API içinde kullanılamaz; guard'ların API varyantı ayrıca üretilmelidir.

---

#### 2. RLS yok, her şey service_role — mobil doğrudan Supabase'e bağlanamaz

**Sorun.** Yetkilendirme tamamen uygulama kodunda; veritabanı katmanında kullanıcı bazlı koruma yok. Mobil için "doğrudan Supabase" kestirmesi kapalı, araya sunucu şart.

**Kanıt.**
- `lib/supabase.ts:5,13-15` — tek istemci `supabaseAdmin`, `SUPABASE_SERVICE_ROLE_KEY` ile kurulu.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `anonKey` kullanımı **0** (grep `lib`, `app` — hiç sonuç yok).
- `create policy` sayısı **0** (`db/migrations/`, `db/install/`). Kurulum SQL'inde **28** `create table` var.
- RLS çoğu tabloda açıkça **kapatılmış**: `db/migrations/031_worker_leaves.sql:63-64`, `db/migrations/033_device_config_epochs.sql:22`, `db/migrations/035_depot_lock.sql:25`. Tek `enable row level security` (`db/migrations/024_idle_episodes.sql:51`) politikası olmadığı için service_role dışına kapalıdır.
- Kapsam kuralları kodda: `lib/fleet-scope.ts`, `lib/driver-scope.ts`, `lib/test-data.ts` (`getTestScope/withoutTestRows`), `app/admin/page.tsx:2-5`.

**İş yükü notu.** service_role anahtarı mobil pakete konulamaz. Mobil API bir BFF olmak zorunda ve mevcut kapsam fonksiyonlarını (`getFleetScope`, `getDriverScope`, `getTestScope`) her uç noktada yeniden uygulamalı — bu filtreler bugün sayfa/action gövdelerinde tek tek çağrılıyor, ortak bir zorunlu kapı yok.

---

#### 3. Okuma yolu için servis katmanı YOK — sayfalar veriyi kendi çekiyor

**Sorun.** Yazma yolu `app/actions/` altında toplu; okuma yolunun önemli kısmı sayfa gövdelerinde satır içi Supabase sorgusu. Mobil API bu sorguları yeniden yazmak zorunda.

**Kanıt.**
- 27 `page.tsx`'ten **14**'ü doğrudan `supabaseAdmin` import ediyor: `app/admin/page.tsx`, `app/admin/izinler/page.tsx`, `app/admin/workers/page.tsx`, `app/admin/workers/[id]/page.tsx`, `app/admin/araclar/page.tsx`, `app/admin/araclar/[id]/page.tsx`, `app/admin/araclar/[id]/rota/page.tsx`, `app/admin/harita/page.tsx`, `app/admin/raporlar/page.tsx`, `app/admin/seferler/page.tsx`, `app/admin/telegram/page.tsx`, `app/panel/page.tsx`, `app/panel/gecmis/page.tsx`, `app/panel/yakit/page.tsx`.
- Sayfa içi satır içi sorgu (`.from(`) sayısı **61**; en yoğunları `app/admin/izinler/page.tsx` (10), `app/admin/page.tsx` (9), `app/admin/workers/[id]/page.tsx` (8), `app/panel/page.tsx` (6), `app/admin/workers/page.tsx` (5), `app/admin/raporlar/page.tsx` (5).
- Somut örnek — şoför panelinin ana sorgusu sayfanın içinde: `app/panel/page.tsx:22-27` (`time_entries` 30 günlük çekim), ardından türetme `:29-31` ve `:41-44`.
- Kısmî servis katmanı **var** ama her sayfayı kapsamıyor: `lib/admin-dashboard.ts` (`getDashboardData`, `app/admin/page.tsx:19`), `lib/depot.ts` (`getDepotPanel`, `app/panel/page.tsx:7`), `lib/reports.ts`, `lib/analytics.ts`.

**İş yükü notu.** Mobil API için bu 61 sorgunun `lib/` altına taşınması gerekir; hâlihazırda `lib/admin-dashboard.ts` ve `lib/depot.ts` bu desenin nasıl kurulacağını gösteriyor, yani yeni mimari icat edilmeyecek — mevcut desen 14 sayfaya genişletilecek.

---

#### 4. 83 action Next'e bağlı — ama bağ KENARDA, ortada değil (bu iyi haber)

**Sorun.** Tüm yazma yolu `"use server"` action'larda; `revalidatePath` ve FormData mobil tarafta çalışmaz.

**Kanıt — bağın büyüklüğü.**
- 16 dosyada `"use server"`, toplam **5.262** satır; en büyüğü `app/actions/shift.ts` (1.111).
- `revalidatePath` çağrısı toplam **92**; dosya bazında en yoğun: `shift.ts` 24, `workers.ts` 18, `vehicles.ts` 12, `driver-panel.ts` 11, `leaves.ts` 11.
- `next/cache` importu **14** dosyada (hepsi `app/actions/*`, ör. `app/actions/shift.ts:3`).
- `next/navigation` importu **46** dosyada, `next/headers` **3** dosyada (`app/actions/auth.ts:4`, `app/actions/preferences.ts:3`, `lib/session.ts:2`).
- Toplam **83** exported action; bunların **14**'ü `FormData` alıyor (`app/actions/auth.ts:122,222`, `driver-panel.ts:221`, `expenses.ts:83`, `fuel.ts:85`, `geofences.ts:63,90`, `maintenance.ts:32`, `shift.ts:594,991`, `vehicles.ts:227,280`, `workers.ts:40,199`), `formData.get()` çağrısı **105**. Kalan **69** action zaten tipli JSON argüman alıyor ya da argümansız.

**Kanıt — bağın KENARDA olduğu (çıkarılabilirlik).** `endShiftAction` (`app/actions/shift.ts:594-753`) temsilî örnek:
- Next'e özgü çağrılar yalnız iki uçta: `:595` `requireWorker()` (çerez + redirect) ve `:750-751` `revalidatePath("/panel"|"/admin")`.
- Aradaki ~150 satır Next'ten bağımsız ve iş mantığını zaten `lib/`'e devrediyor: `latestVehicleTelemetry` (`:646`), `resolveEndKm` (`:647`), `checkUndelivered` (`:671`), `workedMs` (`:733`), `shiftSummaryMessage` (`:740`), `sendTelegramMessage` (`:738`).
- Yani gövde olduğu gibi bir servis fonksiyonuna taşınabilir; kenarlardaki 2 çağrı değiştirilir.

**Karşı örnek — çıkarılamayan, yeniden yazılması gereken action.** `loginAction` (`app/actions/auth.ts:120-204`): `clientIp()` `headers()` okur (`:53-58`, kilit kimliğinin parçası `:133`) ve başarı yolu `redirect()` ile biter (`:202-203`), dönüş değeri üretmez. Burada Next bağı iş mantığının içinde; mobil için yeniden yazım şart.

**İş yükü notu.** Ölçülen dağılım işi ikiye ayırıyor: 69 action tipli argüman aldığı için üzerine ince bir HTTP kabuğu geçirilebilir; 14 FormData action'ı (105 `formData.get()`) tipli girdiye çevrilmeli; 92 `revalidatePath` çağrısının mobil karşılığı yok, istemci tarafı tazeleme sözleşmesiyle ikame edilmeli.

---

#### 5. `lib/` katmanı büyük ölçüde Next'ten BAĞIMSIZ — en büyük kolaylaştırıcı

**Sorun.** (Burada engel değil, ölçülmüş avantaj — planlamayı doğrudan etkilediği için listede.)

**Kanıt.**
- `lib/*.ts` toplam **17.418** satır.
- Bunların içinde `next/` importu yalnız **3** dosyada: `lib/session.ts:2` (`next/headers`), `lib/session.ts:4` (`next/navigation`), `lib/flespi-auth.ts:2` — sonuncusu `import type { NextRequest }`, yani yalnız tip, derlemede silinir. Gerçek bağ tek dosyada: `lib/session.ts`.
- İş mantığının ağırlığı burada: `lib/reports.ts` (1.025), `lib/telemetry.ts` (995), `lib/auto-shift.ts` (720), `lib/analytics.ts` (699), `lib/admin-dashboard.ts` (1.379), `lib/azg-rules.ts` (147), `lib/package-limits.ts` (102), `lib/shift-summary.ts` (78).
- Doğrulama şemaları ortak: `lib/validation.ts` (344 satır), action'larda zod şemaları paylaşılıyor (`app/actions/auth.ts:8`, `app/actions/shift.ts` `endShiftSchema`).

**Sınır — dikkat.** `lib/*.ts` dosyalarının **30**'u `server-only` içeriyor (ör. `lib/supabase.ts:1`, `lib/session.ts:1`, `lib/storage.ts:1`). Bu kod sunucu tarafında yeniden kullanılabilir; React Native paketine **konulamaz**. Yani paylaşım "mobil API sunucusuyla" mümkündür, "cihazla" değil.

---

#### 6. Çok-müşteri yapılandırması derleme anında gömülü — tek mobil paket birden çok kiracıya hizmet edemez

**Sorun.** Kiracı davranış bayrakları `NEXT_PUBLIC_*` env ile ve **derleme anında metin olarak** gömülüyor. Her müşteri ayrı bir derleme/dağıtım. Mobil paket ise tek binary olup kiracıyı çalışma anında öğrenmek zorunda.

**Kanıt.**
- `lib/tenant.ts:16-22` — istemciye ulaşan her ayar `NEXT_PUBLIC_` önekli okunmak zorunda; öneksiz env tarayıcıda `undefined`.
- `lib/tenant.ts:29-32` — "Next/Turbopack `process.env.X` ifadesini derleme anında METİN olarak değiştirir; `process.env[ifade]` gibi DİNAMİK bir erişimi değiştiremez ve istemcide `undefined` kalır."
- `lib/tenant.ts:35-40` — 03.08.2026'da canlıda ölçülmüş vaka: dinamik okuma yüzünden `PACKAGES_ENABLED`, `DRIVER_PANEL`, `LENKZEIT_WARNING`, `SAFETY_SCORE_CALIBRATED` istemcide varsayılana takıldı.
- Bayrak sunucu davranışını da sürüyor: `app/actions/auth.ts:185` (`DRIVER_PANEL_ENABLED` kapalıysa şoför girişi reddediliyor), `app/actions/shift.ts:616` (`PACKAGES_ENABLED`).
- Veritabanı da kiracı başına ayrı: `lib/supabase.ts:4` tek `NEXT_PUBLIC_SUPABASE_URL`; ayrı kurulum dosyaları `db/install/sendigo-full.sql`, `db/install/galzura-full.sql`.

**İş yükü notu.** Mobil API'nin kiracı yapılandırmasını **çalışma anında** döndüren bir uç noktası olmalı (bugün böyle bir uç nokta yok — aşağıya bakınız). Kiracı başına ayrı Supabase örneği olduğu için bu uç noktanın kiracı→bağlantı eşlemesini de çözmesi gerekir; mevcut kodda tek bir sabit URL var.

---

#### 7. Hiç önbellek/süre bütçesi ayarı yok, ağır raporlar zaman aşımına canlıda takılmış

**Sorun.** Mobil ağ üzerinde ağır rapor uçları için ne önbellek ne süre sınırı tanımlı.

**Kanıt.**
- `export const revalidate` → **0 sonuç** (`app`, `lib`).
- `unstable_cache` / `"use cache"` / `fetchCache` → **0 sonuç**.
- `export const maxDuration` → **0 sonuç**. `vercel.json` **yok**.
- Buna karşılık `export const dynamic = "force-dynamic"` **26** sayfa/route'ta: `app/admin/page.tsx:31`, `app/admin/raporlar/page.tsx:20`, `app/admin/analiz/page.tsx:26`, `app/admin/alarmlar/page.tsx:24`, `app/admin/araclar/[id]/page.tsx:24`, `app/admin/workers/[id]/page.tsx:29`, `app/panel/page.tsx:11`, `app/admin/harita/page.tsx:13`, `app/admin/izinler/page.tsx:16`, `app/admin/raporlar/{hiz:12,mesafe:10,performans:10,yakit:10}/page.tsx`, `app/admin/{araclar:11,bolgeler:7,masraflar:8,seferler:10,telegram:8,workers:10,yakit:10}/page.tsx`, `app/page.tsx:11`, `app/pin/page.tsx:9`, `app/panel/{gecmis:11,masraflar:8,seferler:6,yakit:9}/page.tsx`, ve 4 API route. Tek istisna `app/manifest.json/route.ts:19` (`force-static`).
- Zaman aşımı gerçek ve belgeli: `lib/reports.ts:590` "57014 = query_canceled (statement timeout) — canlıda soğuk cache'te görüldü"; sınıflandırıcı `lib/reports.ts:594-607`.
- Yük göstergesi: `fetchAllRows` (1000'lik sayfalama, `lib/supabase.ts:52`) **12** dosyada kullanılıyor; sorgu yoğunluğu `lib/telemetry.ts` 32 `.from(`, `lib/admin-dashboard.ts` 15, `lib/analytics.ts` 6, `lib/reports.ts` 4.
- `lib/supabase.ts:17-19` — PostgREST sunucu tarafı sayfa boyu 1000, `.limit()` bunu aşamaz; `:31-36` sessiz kırpma uyarısı.

**İş yükü notu.** Mobil için her ağır uca açıkça süre sınırı ve önbellek politikası eklenmeli — bugün sıfırdan başlanacak, mevcut ayar devralınamaz. `lib/reports.ts:594-607`'deki hata sınıflandırması API'de de kullanılabilir durumda.

---

#### 8. Tazeleme modeli `router.refresh()` üzerine kurulu — mobilde karşılığı yok

**Sorun.** Mutasyon sonrası veri tazeleme sunucu `revalidatePath` + istemci `router.refresh()` ikilisine dayanıyor; ikisi de React Native'de çalışmaz.

**Kanıt.**
- `router.refresh()` çağrısı **52**; `useRouter` kullanan dosya **33**.
- `next/navigation` importu **46** dosyada, bunun **15**'i `components/` altında.
- Sunucu tarafı eşi: 92 `revalidatePath` (madde 4).
- Buna karşılık `useActionState`/`useFormState` yalnız **2** dosyada, `useFormStatus` **0** — yani form durumu yönetimi Next'e derinden bağlı değil, asıl bağ yönlendirici tazelemesinde.

**İş yükü notu.** 52 tazeleme noktasının her biri mobilde açık bir yeniden-çekme ya da istemci durum güncellemesine çevrilmeli. Sunucu bu bilgiyi bugün taşımıyor: `revalidatePath("/panel")` bir *yol* adı; hangi veri kümesinin bayatladığını API'nin döndürebilmesi için yeni bir sözleşme gerekir.

---

#### 9. Kullanıcıya dönük HİÇBİR JSON API'si yok — sıfırdan başlanacak

**Sorun.** Mevcut 5 route handler'ın hiçbiri uygulama verisi sunmuyor.

**Kanıt.** Tüm route handler envanteri:
- `app/api/cron/shift-watchdog/route.ts` — cron, paylaşılan sır (`:44`), `GET :148` / `POST :164`
- `app/api/flespi/sync/route.ts` — `GET :197` / `POST :212`, sır tabanlı (`lib/flespi-auth.ts`)
- `app/api/flespi/ingest/route.ts` — `POST :55`, sır tabanlı
- `app/api/telegram/webhook/route.ts` — `POST :170`, webhook
- `app/manifest.json/route.ts` — PWA manifesti, `force-static`

Dördü de `export const runtime = "nodejs"` (`shift-watchdog:13`, `flespi/ingest:24`, `flespi/sync:18`, `telegram/webhook:13`). Kullanıcı oturumuyla korunan tek bir veri ucu yok.

**Olumlu istisna — mobil için hazır tek sözleşme.** `app/actions/offline.ts` çevrimdışı kuyruğu zaten **tipli JSON** alıyor: `Item` tipi (`:16-20`), `processQueuedShift(item)` (`:50`), istemci saati doğrulaması (`:36-43`, ileri 5 dk / geri 48 sa penceresi), istemci tarafı kuyruk `lib/offline-queue.ts:7-14`. Beş olay türü (`start`/`end`/`break`/`package`/`report`) mobilin en çok ihtiyaç duyacağı yazma yolunu kapsıyor ve FormData'ya bağlı değil.

**İş yükü notu.** API yüzeyi sıfırdan kurulacak; `app/actions/offline.ts` + `lib/offline-queue.ts` ikilisi hem tipli sözleşme örneği hem de çevrimdışı senkron semantiği için hazır bir temel sunuyor.

---

#### 10. Dosya yükleme yolu `File`/FormData'ya bağlı

**Sorun.** Fotoğraf/fiş yükleme `File` nesnesi bekliyor; mobil çok parçalı istek gövdesi ya da base64 ile gelir.

**Kanıt.**
- `lib/storage.ts:20-24` — `uploadReceipt(bucket, workerId, file: File)`; sınırlar `:4-5` (5 MB, `image/jpeg|png|webp|heic`); `:17-18` service_role ile özel bucket'a yazıyor, RLS baypas.
- FormData ile besleyen çağrı yerleri: `app/actions/driver-panel.ts:221` (`addShiftPhotoAction`), `app/actions/expenses.ts:83` (`createExpenseEntry`), `app/actions/fuel.ts:85` (`createFuelEntry`), `app/actions/maintenance.ts:32`.
- Okuma tarafı imzalı URL üretiyor: `app/actions/expenses.ts:172` `getExpenseReceiptUrl`, `app/actions/fuel.ts:183` `getFuelReceiptUrl`, `app/actions/maintenance.ts:83`, `app/actions/driver-panel.ts:371` `getShiftPhotosAction`.

**İş yükü notu.** `lib/storage.ts` içindeki doğrulama ve yol şeması (`{workerId}/{yyyy}/{mm}/{uuid}.{ext}`, `:18`) olduğu gibi korunabilir; yalnız 4 çağrı yerinin girdi biçimi değişir. İmzalı URL okuma yolu mobilde doğrudan kullanılabilir.

---

### Özet ölçümler

| Ölçüm | Değer |
|---|---|
| Toplam TS/TSX (`app`+`lib`+`components`) | 246 dosya |
| Exported server action | 83 (16 dosya, 5.262 satır) |
| `FormData` alan action | 14 (105 `formData.get()`) |
| `revalidatePath` çağrısı | 92 |
| `next/navigation` / `next/cache` / `next/headers` importu | 46 / 14 / 3 dosya |
| `router.refresh()` çağrısı | 52 (33 dosya `useRouter`) |
| Auth guard çağrı yeri | 115 |
| Kullanıcıya dönük JSON API ucu | 0 (5 route handler, hepsi M2M/PWA) |
| RLS politikası | 0 (26 tablo, yalnız service_role) — *düzeltildi: 28 rakamı iki yorum satırını sayıyordu, bkz. rapor başındaki düzeltme notu* |
| `export const revalidate` / `unstable_cache` / `maxDuration` | 0 / 0 / 0 |
| `force-dynamic` sayfa+route | 26 |
| `supabaseAdmin` çağıran sayfa | 14 / 27 (61 satır içi sorgu) |
| `lib/` toplam satır | 17.418 |
| `lib/` içinde `next/` importu | 3 dosya (1'i yalnız tip) → gerçek bağ **1** dosya |

**BİLİNMİYOR:** Mobil uygulamanın kapsamı (yalnız şoför paneli mi, yönetici de mi) görevde belirtilmediği ve kod tabanında bir mobil hedef tanımı bulunmadığı için, yukarıdaki sayıların ne kadarının fiilen mobile taşınacağı belirlenemedi; sayılar tüm yüzeyi kapsar.
