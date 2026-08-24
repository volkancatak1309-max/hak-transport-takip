# Galzura Fleet — demo ortamı kurulumu

Üçüncü müşteri (`galzura-demo`), **satış demosu** amaçlı. HAK61'in 29 aracının
GERÇEK telemetrisini okur, kimlikleri TAKMADIR. Adres: `demo.galzura.com`.

> **⚠️ Sırlar bu dosyada YOKTUR.** Supabase anahtarları, `SESSION_PASSWORD`,
> `FLESPI_TOKEN`, `FLESPI_SYNC_SECRET`, `CRON_SECRET` yalnız Vercel'e girilir.
> Repoya sır yazılmaz.

Bu belge **Bölüm 2**'yi kapsar: şema, Vercel projesi, env, DNS. Kimlik maskeleme
tohumu (araçlar/şoförler) ve güvenlik katmanı ayrı adımlardır.

---

## 0. Mimari karar — neden ayrı çekiş (ölçüldü 06.08.2026)

Demo, HAK61 ile **aynı flespi cihazlarını** okur ama **kendi cron'u** ile
**kendi Supabase'ine** yazar. HAK61'in sync'ine dokunulmaz.

Bunun güvenli olduğu ölçüldü:

| Ölçüm | Sonuç |
|---|---|
| Aynı pencere 3 kez okundu | Üçünde de aynı sha256, aynı satır sayısı |
| 8 paralel okuma (2 tüketici benzetimi) | 8× HTTP 200, hepsi birebir aynı |
| `from` vermeden tekrar okuma | Aynı sonuç → sunucuda tüketici imleci YOK |
| 40 istekli burst | 0× HTTP 429, hız-limiti başlığı yok |

`GET /gw/devices/{id}/messages` **depoyu okur, kuyruktan tüketmez**; API
yüzeyinde `DELETE .../messages` yoktur. Saklama zamana bağlıdır
(`messages_ttl = 365 gün`, `messages_rotate = 0`), okuyucudan bağımsız.
Polling imleci tüketicinin KENDİ veritabanındadır
(`lib/telemetry.ts` → `lastRecordedAt`), flespi'de değil — bu yüzden iki
tüketici yapısal olarak birbirini göremez.

> ⚠️ **Ölçülemeyen tek şey hesap kotası.** Mevcut `FLESPI_TOKEN` master token
> değil (`/platform/customer` → 403). Plan limitine flespi panelinden bakın:
> ikinci tüketici 29 cihaz × 60 sn'lik turla günde ~42.000 ek REST isteği ekler.

---

## 1. Şema — tek parça kurulum SQL'i

```bash
node scripts/gen-install-sql.mjs galzura
# → db/install/galzura-full.sql   (45 migration · 2546 satır)
```

Üretilen dosyanın **gövdesi Sendigo'nunkiyle bayt bayt aynıdır**; yalnız başlık
satırı farklıdır. Şema müşteriden bağımsızdır.

**Uygulama:** Supabase → yeni proje → SQL Editor → dosyanın tamamını yapıştır → Run.

- Tamamı **tek transaction**: bir ifade patlarsa hiçbir şey uygulanmaz.
- İlk blok **boşluk denetimi** yapar; veritabanı doluysa kendini durdurur.
- 001→043 dahildir: `041_counts_as_driver`, `042_login_unlock_log`,
  `043_worker_admin_log` üçü de içinde.

**Doğrulama (SQL Editor'da):**
```sql
select count(*) from information_schema.tables where table_schema='public';  -- 20+
select plate, is_test from public.vehicles;                                   -- TEST-001, true
```

Sonra ilk yönetici: `npm run bootstrap:admin`.

---

## 2. Vercel projesi

1. **Add New → Project** → aynı GitHub reposu (`hak-transport-takip`) → **Import**.
2. Proje adı: `galzura-demo`.
3. Framework: Next.js (otomatik algılanır). Build/Output ayarlarına dokunma.
4. **Production Branch = `main`** (Settings → Git). HAK61 ve Sendigo ile aynı dal;
   üç proje aynı koddan beslenir, ayrışan yalnız env'dir.
5. Env'leri gir (§3) → **Deploy**.
6. Deploy sonrası Settings → Domains → `demo.galzura.com` ekle (§4).

> Bir repo birden çok Vercel projesine bağlanabilir; HAK61 ve Sendigo
> projelerine dokunulmaz.

**Marka görselleri.** `NEXT_PUBLIC_TENANT=galzura-demo` kayıt defterinde
(`lib/brand.ts` REGISTRY) yok → yedek künye devreye girer ve tüm görseller
`public/brands/galzura-demo/` altında beklenir:

```
public/brands/galzura-demo/logo.png  splash.png  favicon.ico
favicon-32x32.png  icon-192.png  icon-512.png  apple-touch-icon.png
```

Dosyalar konmazsa uygulama çalışır ama logo/ikon kırık görünür.
Logo kare değilse `NEXT_PUBLIC_BRAND_LOGO_RATIO` gir (genişlik/yükseklik).

---

## 3. Env seti

Davranış env'lerinin tek kaynağı `scripts/check-demo-env.mjs`. Yapıştırılacak
listeyi oradan al:

```bash
node scripts/check-demo-env.mjs --print   # env bloğu
node scripts/check-demo-env.mjs           # doğrula (26/26 olmalı)
```

### 3.1 Davranış (betikten gelir)

| Env | Değer | Neden |
|---|---|---|
| `NEXT_PUBLIC_TENANT` | `galzura-demo` | Marka + CSS token ezmesinin anahtarı |
| `NEXT_PUBLIC_BRAND_NAME` | `Galzura Fleet` | |
| `NEXT_PUBLIC_BRAND_LEGAL_NAME` | `Galzura Fleet` | Footer telif satırı |
| `NEXT_PUBLIC_BRAND_CITY` | `Wien` | Giriş ekranı alt satırı |
| `NEXT_PUBLIC_BRAND_APP_TITLE` | `Galzura Fleet` | Sekme + PWA adı |
| `NEXT_PUBLIC_BRAND_DESCRIPTION` | `Fuhrpark- und Schichtverfolgung` | |
| `NEXT_PUBLIC_BRAND_SHORT_NAME` | `Galzura` | manifest short_name |
| `NEXT_PUBLIC_FLEETS` | `mavi` | **Tek filo.** Aşağıdaki uyarıya bak |
| `NEXT_PUBLIC_FLEET_MAVI_LABEL` | `Filo` | Kullanıcıya görünen ad |
| `NEXT_PUBLIC_DRIVER_PANEL_ENABLED` | `true` | |
| `NEXT_PUBLIC_DRIVER_VEHICLE_CHOICE` | `free` | Yalnız GÖRÜNÜM; atama yine de auto-shift'i sürer |
| `NEXT_PUBLIC_PACKAGES_ENABLED` | `false` | Paket sayacı kapalı |
| `SHIFT_START_TRIGGER` | `first_ignition` | Depo tetiğinin seyrek-fix körlüğünü atlar |
| `SHIFT_AUTO_END` | `depot_idle` | Kapanış gündüz, depoya dönüşte |
| `SHIFT_AUTO_END_IDLE_MIN` | `20` | Hareketsizlik eşiği |
| `SHIFT_AUTO_END_MIDNIGHT_FALLBACK` | `true` | Depoya dönmeyen araç gece boyu açık kalmasın |
| `FLEET_EPOCH` | `2026-08-07T00:00:00.000Z` | Kurulum günü — "tüm zamanlar" boş geçmiş göstermesin |

> ⚠️ **`NEXT_PUBLIC_FLEETS=galzura` YAZMAYIN.** `ACTIVE_FLEETS` yalnız
> `bordo`/`mavi` kabul eder (migration 023 CHECK) ve tanımadığı değeri
> **sessizce yok sayıp iki filoya geri döner**. DB kod adı `mavi` KALIR;
> değişen yalnız etiket ("Filo") ve renktir (§5).

### 3.2 Sırlar (elle, Vercel'e)

| Env | Kaynak |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yeni Supabase projesi |
| `SUPABASE_SERVICE_ROLE_KEY` | Yeni Supabase projesi |
| `SESSION_PASSWORD` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FLESPI_SYNC_SECRET` | Aynı komut — **yeni üret, HAK61'inkini kullanma** |
| `CRON_SECRET` | Aynı komut |
| `FLESPI_TOKEN` | flespi paneli — §3.3'teki ACL ile |

### 3.3 flespi token — salt-okuma ACL

flespi paneli → **Tokens → + →** ACL'li standart token (master DEĞİL).
Erişim girdileri (`uri` + `methods`) yalnız şunlar:

| URI | Methods | Ne için |
|---|---|---|
| `gw/devices/*/messages` | `GET` | Telemetri çekişi (`fetchDeviceMessages`) |
| `gw/devices/*/telemetry/*` | `GET` | DTC bekçisi (`fetchLastKnownDtc`) |
| `gw/devices` | `GET` | Cihaz listesi (teşhis) |

**Yazma yetkisi VERMEYİN.** Demo cihaz ayarı değiştirmemeli, komut
göndermemeli, mesaj silmemeli. `POST`/`PUT`/`DELETE` hiçbir girdide olmasın.
`ttl` 1 yıl yeterli.

---

## 4. Cloudflare DNS

Cloudflare → `galzura.com` bölgesi → **DNS → Add record**:

| Alan | Değer |
|---|---|
| Type | `CNAME` |
| Name | `demo` |
| Target | `cname.vercel-dns.com` |
| Proxy status | **DNS only (gri bulut)** |
| TTL | Auto |

> ⚠️ **Turuncu bulut (proxied) AÇMAYIN.** Vercel sertifikayı kendi üretir;
> Cloudflare proxy'si araya girerse yönlendirme döngüsü ve sertifika
> doğrulama hatası olur.

Vercel → Settings → Domains → `demo.galzura.com` → doğrulama yeşile dönene
kadar bekleyin (genelde birkaç dakika).

---

## 5. Galzura yeşili nasıl açıldı (#0F766E)

Filo rengi eskiden `--accent-claret` / `--accent-sky` idi ve **doğrudan**
kullanılıyordu. Bunları ezmek filo çipiyle birlikte "sevkiyatta" durum çipini,
`--status-active`i ve `--chart-4`ü de yeşile çevirirdi. Bu yüzden filo kimliği
**kendi token ailesine** alındı:

```
--fleet-bordo / --fleet-bordo-text / --fleet-bordo-fg
--fleet-mavi  / --fleet-mavi-text  / --fleet-mavi-fg
```

`app/globals.css`'te bunlar accent'lerin **takma adıdır** → HAK61 ve Sendigo'da
hesaplanan renk birebir eskisidir. Müşteri ezmesi tek blokla iner:

```css
[data-tenant="galzura-demo"] { --fleet-mavi: #0f766e; --fleet-mavi-text: #115e59; --fleet-mavi-fg: #fff; }
.dark[data-tenant="galzura-demo"] { --fleet-mavi-text: #14b8a6; }
```

Kancası `app/layout.tsx`'teki `data-tenant={BRAND.tenant}`.

**Dolgu ≠ metin — ölçüldü** ("en kötü zemin" kuralı, çip metni kendi %15 tinti
üstünde):

| Rol | Ton | Açık | Koyu |
|---|---|---|---|
| Dolgu (çip/nokta/şerit) | `#0F766E` | 4.80:1 | 3.69:1 |
| Metin | `#115E59` / `#14B8A6` | **5.45:1** ✅ | **7.07:1** ✅ |
| Harita pili metni | `#ffffff` | **5.47:1** ✅ | — |

`#0F766E`'i metin olarak kullanmak açık temada 3.93:1 verir — AA değil.
Harita pilinde bugünkü sabit koyu metin (`#0c1626`) yeşilin üstünde 3.31:1'e
düşerdi; bu yüzden `--fleet-mavi-fg` de token'a alındı.

Etkilenen dosyalar: `app/globals.css`, `lib/vehicle-ui.ts`,
`components/FleetMap.tsx` (üçü de eskiden ayrı ayrı renk basıyordu),
`app/layout.tsx`.

---

## 6. Kurulum sonrası doğrulama

```bash
node scripts/check-demo-env.mjs      # 26/26 — env sessizce düşmedi
npx tsc --noEmit                     # 0 hata
npm run build                        # 0 hata
node scripts/check-test-filters.mjs  # kapsam muhafızı
npm run build && node scripts/check-tenant-defaults.mjs   # HAK61 varsayılanları sağlam
```

`check-demo-env.mjs` **sessiz düşüşü** yakalar: `SHIFT_AUTO_END=depot-idle`
(tire) yazarsan `envEnum` onu sessizce `off`a düşürür ve vardiyalar hiç
kapanmaz. Betik bunu kırmızıya çevirir.

---

## 7. Bu belgenin kapsamadıkları

- **Kimlik maskeleme tohumu** — 29 araç (takma plaka, gerçek cihaz), 29 takma
  şoför, 1:1 atama, iki depo geofence'i.
  ⚠️ `lib/telemetry.ts:980 maybeBackfillVin` demo tenant'ında **kapatılmalı**:
  VIN'i kopyalamasan da ilk sync turunda cihazın bildirdiği GERÇEK VIN
  `vehicles.vin`e yazılır ve maskeleme kendini bozar.
- **Güvenlik katmanı** — oturum/cihaz izleme, tek oturum kilidi, eylem izi,
  dışa aktarma kapatma, PDF filigranı, hız sınırı, uzaktan dondurma.
- **Zamanlayıcı kayıtları** — `/api/flespi/sync` (~30–60 sn) ve demo'ya özel
  `/api/cron/demo-retention` (günde 1, gece) cron-job.org kayıtları.
  Sendigo'da bu adım atlandığı için `device_telemetry` boş kalmıştı.
  Tam liste ve dönüş kodları: [`CRON-KAYITLARI.md`](CRON-KAYITLARI.md).
  ⚠️ `/api/cron/shift-watchdog` **kaldırıldı** (Telegram sökümü) — kurma.
