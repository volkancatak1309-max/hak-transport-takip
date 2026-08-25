# Zamanlayıcı (cron) kayıtları — GERÇEK DURUM

> Son ölçüm: **25.08.2026**. Bu dosya, dış zamanlayıcıya (cron-job.org /
> GitHub Actions / Vercel Cron) girilecek işlerin **tek kaynağıdır**.
> Kurulum belgeleri (`SENDIGO-KURULUM.md`, `GALZURA-KURULUM.md`,
> `YENI-MUSTERI-KURULUM.md`) buraya işaret eder — liste üç yerde
> tekrarlandığı için bir kez bayatladı ve silinmiş bir ucu aylarca
> anlatmaya devam etti.

Her kiracının **kendi dağıtımı ve kendi veritabanı** var (bkz. `lib/brand.ts`).
Yani bu kayıtlar **her kiracı için ayrı ayrı** kurulur; sırlar da o kiracının
Vercel projesinden alınır.

---

## Özet tablo

| # | İş | URL | Sır | Sıklık | Hangi kiracı |
|---|----|-----|-----|--------|--------------|
| 1 | flespi senkronu | `/api/flespi/sync` | `FLESPI_SYNC_SECRET` | **30–60 sn** | Cihazı olan her kiracı |
| 2 | Yakıt fiyatı | `/api/cron/fuel-price-sync` | `CRON_SECRET` | **günde 1 · 06:00** | Yakıt maliyeti isteyen her kiracı (migration 077) |
| 3 | Belge uyarısı | `/api/cron/document-alerts` | `CRON_SECRET` | **günde TAM 1 · 06:00** | Belge takibi açık kiracı (migration 078 — bugün yalnız HAK61) |
| 4 | Demo telemetri temizliği | `/api/cron/demo-retention` | `CRON_SECRET` | günde 1 · gece | **YALNIZ galzura-demo** |
| 5 | Periyodik bakım uyarısı | `/api/cron/bakim-alerts` | `CRON_SECRET` | **günde TAM 1 · 06:15** | Bakım planı kuran her kiracı (migration 081) |
| ~~6~~ | ~~Vardiya bekçisi~~ | ~~`/api/cron/shift-watchdog`~~ | — | — | **KALDIRILDI — kaydı SİL** |

Sır iki biçimde de kabul edilir ve karşılaştırma zamanlama-güvenlidir
(`safeEqual`):

```
GET https://<alan-adı>/<yol>?secret=<SIR>
GET https://<alan-adı>/<yol>          + Authorization: Bearer <SIR>
```

`?secret=` dış zamanlayıcılar için, `Bearer` Vercel Cron için pratiktir
(Vercel başlığı kendisi ekler). `POST` da aynı gövdeyi çalıştırır.

> **Sır tanımsızsa uç KAPALIDIR (fail-closed) ve 401 döner.** Env'i unutmak
> "herkese açık" anlamına gelemez — ama zamanlayıcıda da sessiz bir 401
> demektir. Kaydı kurduktan sonra **ilk çağrının 200 döndüğünü doğrula.**

---

## 1 · flespi senkronu — DOKUNMA

```
GET https://<alan-adı>/api/flespi/sync?secret=<FLESPI_SYNC_SECRET>     — her 30–60 sn
```

| Kod | Anlamı |
|-----|--------|
| 200 | Tur tamam (gövdede araç/satır sayısı) |
| 401 | Sır yanlış ya da `FLESPI_SYNC_SECRET` tanımsız |
| 500 | Tur sırasında hata — gövdede sebep |

Motor **yalnız kendi veritabanındaki** `flespi_device_id` dolu araçları çeker;
kiracılar arası sızıntı yapısal olarak imkânsızdır. Bu kayıt atlanırsa
`device_telemetry` boş kalır — Sendigo'da bir kez tam olarak bu oldu.

## 2 · Yakıt fiyatı senkronu

```
GET https://<alan-adı>/api/cron/fuel-price-sync?secret=<CRON_SECRET>   — günde 1, 06:00
```

AB Weekly Oil Bulletin'den ülke dizel fiyatını çeker (`fuel_price_reference`).
Kaynak **haftalık** yayınlanır ama iş **günlük** koşar: yayın saati garanti
değil ve kaçan bir haftayı 7 gün sonra fark etmek istemiyoruz. Yazma
idempotenttir, aynı satır yeniden yazılır.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Fiyat yazıldı / zaten günceldi | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 502 | Muhafızlardan biri durdurdu (kaynak okunamadı, biçim değişti) | Gövdedeki `guard` alanına bak |
| 503 | migration **077** çalıştırılmamış | SQL'i çalıştır; tekrar denemek işe yaramaz |

## 3 · Belge uyarısı — GÜNDE TAM BİR KEZ

```
GET https://<alan-adı>/api/cron/document-alerts?secret=<CRON_SECRET>   — günde 1, 06:00
```

Süresi yaklaşan/dolmuş şoför belgelerini (SRC, ADR, oturma izni…) **dönüm
noktalarında** bildirir: eşik günü (tür başına `warn_days`, varsayılan 30) ·
7 gün kala · 1 gün kala · dolduğu gün · dolduktan sonra haftada bir.

> ⚠️ **Günde birden fazla çağırma.** Tetikleme "en son ne zaman bildirdim"
> kolonundan değil, **o günün kalan gün sayısından** türetiliyor. İkinci çağrı
> aynı dönüm noktasını yeniden bulur ve **aynı bildirimi tekrar gönderir**.
>
> Saat 06:00 (Europe/Vienna) öneriliyor: gün sınırı UTC'de hesaplandığı için
> gece yarısından uzak durmak, koşumun gün değişimine denk gelmesini önler.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Hesap yapıldı (`esiktekiBelge`, `bildirilen`, `kalemler`) | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **078** çalıştırılmamış | Belge takibi o kiracıda kapalı demektir; ya SQL'i çalıştır ya kaydı kurma |

**Kurmadan önce kuru koşum** — hangi bildirimlerin gideceğini **göndermeden**
gösterir:

```
GET https://<alan-adı>/api/cron/document-alerts?secret=<CRON_SECRET>&kuru=1
```

Pano kalemi bu işten **bağımsızdır**: Dikkat listesinde belge, eşiğe girdiği
andan düzeltilene kadar her gün durur. Cron yalnız *dürtme*; kaçan bir gün
kalemi kaybettirmez, yalnız o günün bildirimini kaçırır.

## 4 · Demo telemetri temizliği — YALNIZ galzura-demo

```
GET https://<alan-adı>/api/cron/demo-retention?secret=<CRON_SECRET>    — günde 1, gece
```

`device_telemetry`de 14 günden eski satırları parça parça siler (tur başına
20.000, çağrı başına en çok 25 tur = 500 bin satır).

| Kod | Anlamı |
|-----|--------|
| 200 | Silindi (`deleted`, `rounds`) |
| 401 | Sır yanlış/tanımsız |
| 403 | `tenant_locked` — bu dağıtım galzura-demo DEĞİL |

> 🔴 **HAK61 ve Sendigo'da bu kaydı KURMA.** Oralarda ham telemetrinin saklama
> süresi hukuki bir konudur (§ 132 BAO). Üç savunma katmanı var ve üçü de
> bağımsız: (a) tenant kilidi 403 verir, (b) `CRON_SECRET` ayrıdır,
> (c) silme fonksiyonu o veritabanlarında **hiç kurulmaz** —
> `054_demo_telemetry_retention.sql` kurulum SQL'ine bilerek dahil edilmez.

## 5 · Periyodik bakım uyarısı — GÜNDE TAM BİR KEZ

```
GET https://<alan-adı>/api/cron/bakim-alerts?secret=<CRON_SECRET>      — günde 1, 06:15
```

İki iş yapar, tek geçişte:

1. **İş emri açar.** Eşiğe giren (ya da geçmiş) her bakım planı için
   `kaynak='periyodik'` bir iş emri açar. Aynı araçta AÇIK periyodik emir
   varsa **ikincisini açmaz** — ölçüldü: ikinci tur `isEmriAcilan=0`.
2. **Bildirim gönderir.** Alıcı YALNIZ yönetim tarafıdır (patronlar + o
   ARACIN filosunun şefleri). Şoföre gitmez: bakım randevusunu o almıyor.

**Dönüm noktaları** — belge cron'uyla aynı gerekçe (her sabah bağıran bir
kanal susturulur):

| Eksen | Ne zaman bildirir |
|-------|-------------------|
| süre  | eşiğe giriş günü (`uyari_gun`, varsayılan 14) · 7 · 1 · 0 · sonra haftada bir |
| km    | yalnız **eşiğe giriş** ve **geçiş** anları |

> Km'de "gün" diye bir şey yoktur: eşik takvime değil aracın ne kadar
> çalıştığına bağlıdır. "1.200 km kaldı" ile "1.150 km kaldı" arasında
> yöneticinin davranışını değiştirecek bir fark yok.

> ⚠️ **Günde birden fazla çağırma.** Belge cron'undaki tuzağın aynısı:
> tetikleme "en son ne zaman bildirdim" kolonundan değil, o günün kalan
> gün/km sayısından türetiliyor. İkinci çağrı aynı bildirimi tekrar gönderir.
> (İş emri tarafı idempotenttir — tekrar çağırmak ikinci emir açmaz.)
>
> Saat **06:15** öneriliyor: belge uyarısı 06:00'da koşuyor, iki iş aynı
> dakikaya binmesin.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Hesap yapıldı (`esikte`, `isEmriAcilan`, `bildirilen`, `kmOlculemeyen`, `kalemler`) | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **081** çalıştırılmamış | Bakım o kiracıda kapalı demektir; ya SQL'i çalıştır ya kaydı kurma |

**Kurmadan önce kuru koşum** — ne yazılacağını ve kimin bildirim alacağını
**yazmadan ve göndermeden** gösterir:

```
GET https://<alan-adı>/api/cron/bakim-alerts?secret=<CRON_SECRET>&kuru=1
```

Gövdedeki **`kmOlculemeyen`** alanına bak: odometresi 72 saattir okunamayan
araç sayısıdır. O araçlarda km eşiği hesaplanmaz (uydurulmaz) ve plan yalnız
süre ekseninden tetiklenir — sayı beklediğinden büyükse cihaz tarafında bir
sorun var demektir, bakım tarafında değil.

Pano kalemi bu işten **bağımsızdır**: yaklaşan/gecikmiş bakım Dikkat
listesinde her gün durur. Kaçan bir gün kalemi kaybettirmez.

> **Plan yoksa iş boştur.** Bakım kuralları `/admin/bakim` ekranından kurulur;
> hiç plan yoksa uç 200 döner ve `esikte: 0` der. Kaydı bugünden kurmak
> zararsızdır.

## ~~6 · Vardiya bekçisi — KALDIRILDI~~

`/api/cron/shift-watchdog` **artık yok**. Telegram katmanının tamamı
20.08.2026'da söküldü (kod + şema); bekçi de o gün silindi, çünkü tek işi
uzun süredir açık kalan vardiyayı şoföre **Telegram'dan** sormaktı.

**Yapılacak:** cron-job.org (ya da hangi zamanlayıcı kullanılıyorsa) üzerindeki
`shift-watchdog` kaydını **sil**. Kayıt duruyorsa saatte bir 404 alıyor ve
zamanlayıcı sonunda "iş sürekli başarısız" diye kapatabilir — o gürültü gerçek
bir arızayı gölgeler.

Vardiya kapatma kuralı bugün şöyle: **vardiyayı yalnız personel kapatır.**
Otomatik kapanış kaldırıldı; kapanmamış vardiyalar Dikkat panosundaki
"Kapanmamış Vardiyalar" kartında görünür.

---

## Yeni kiracıda kurulum sırası

1. Kurulum SQL'ini çalıştır (`db/install/<musteri>-full.sql`) — şema 001→081.
2. Vercel env'leri gir: `FLESPI_SYNC_SECRET`, `CRON_SECRET`, `FLESPI_TOKEN`.
3. **1 numaralı** kaydı kur (flespi) — telemetri akmadan hiçbir şey çalışmaz.
4. `device_telemetry`ye satır düştüğünü doğrula:
   `select count(*) from device_telemetry where recorded_at > now() - interval '1 hour';`
5. **2** ve **3** numaralı kayıtları kur; ilk çağrılarının **200** döndüğünü gör
   (503 alıyorsan ilgili migration çalışmamıştır).
6. Bakım planı kuracaksan **5**'i de kur (kuru koşumla doğrula).
7. Demo değilse **4**'ü kurma. `shift-watchdog` diye bir iş **yok**.
