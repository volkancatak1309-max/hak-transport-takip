# Çok duraklı sefer (migration 082)

Sefer artık TEK hedefli değil: sıralı bir **durak listesi** taşıyor. Bu belge
kararların gerekçesini, ölçümleri ve provayı tutar.

---

## 1 · Neden

Sefer (066) `zone_id` adında **tek** bir hedef kolonuyla doğdu. Dünya pazarında
çok duraklı tur standarttır:

- son-mil dağıtım: günde 30–80 durak
- ağır nakliye: çoklu yükleme/boşaltma noktası
- servis/bakım filoları: gün içinde N müşteri

Onfleet, Track-POD, Bringg, Routific, Samsara — hepsi durak listesiyle çalışır.
Tek hedefli model bu pazarın dışında kalıyordu.

---

## 2 · ÖNCE ÖLÇÜLDÜ (25.08.2026)

### 2.1 Mevcut `seferler.zone_id` nasıl taşınacak

PostgREST üzerinden canlı sayım:

| Kiracı | sefer | `zone_id` DOLU | `vehicle_id` DOLU | `vardi_at` DOLU | teslimat | takip linki |
|---|---:|---:|---:|---:|---:|---:|
| HAK61 | 11 | **0** | 0 | 0 | 0 | 0 |
| Sendigo | 0 | 0 | 0 | 0 | 0 | 0 |
| galzura-demo | ölçülemedi (service anahtarı verilmiyor) | | | | | |

**Sonuç:** geriye taşıma HAK61 ve Sendigo'da **hiçbir satıra dokunmuyor**. Yine
de yazıldı — galzura ve ileride açılacak kiracılar için doğru olmak zorunda.

Kural: `zone_id` DOLU olan her sefer **1 numaralı durağını** alır; `zone_id`
BOŞ olan sefer **durak almaz**. Boş hedefli bir sefere isimsiz yer tutucu durak
açmak, olmayan bir veriyi uydurmak olurdu.

Taşınan alanlar: durak adı bölgenin O ANKİ adından dondurulur; durum seferin
durumundan türetilir (kapanmış sefer → `tamamlandi`, `vardi_at` varsa
→ `varildi`, `varis_kaynak='otomatik'` — o damgayı 070 köprüsü yazmıştı).

### 2.2 Serbest adres mi, her durak bir bölge mi — sektör ne yapıyor

Üretici belgeleri (25.08.2026):

| Ürün | Hedef biçimi | Jeokodlama |
|---|---|---|
| **Samsara** | kayıtlı **Address** (kendi geofence'i, varsayılan 250 m, özelleştirilebilir) **ya da** `singleUseLocation` = `address` + `latitude` + `longitude`, dairesel geofence, varsayılan 300 m (`radiusMeters` ile geçilebilir) | singleUseLocation için **YOK** — koordinatı çağıran verir |
| **Onfleet** | `destination.address`; `unparsed` alanı verilirse otomatik jeokodlanır | `[lng,lat]` verilirse **ATLANIR** |
| **Routific** | `location.coords` yoksa `location.address` jeokodlanır | coords varsa **ATLANIR** |

Üçünde de ortak: hedef ya **kayıtlı** bir yer ya **serbest** bir yer, ve serbest
yerde koordinat verilebiliyorsa jeokodlama atlanıyor.

**Kararımız — ikisi de var, biri seçilir:**
- `zone_id` → kayıtlı bölge (`geofences`). Varış `zone_visits` motorundan gelir,
  yarıçap bölgenin kendi `radius_m`sidir.
- `adres` + `latitude`/`longitude` + `yaricap_m` → serbest hedef.

İkisi **birden** olamaz (Samsara'nın Address ↔ singleUseLocation ayrımı): hangisinin
gerçek hedef olduğu belirsiz kalırdı. Kural iki katmanda birden — formda sekme,
sunucuda `satiraCevir()` diğer biçimi temizler.

### 2.3 Jeokodlama gerekiyor mu — hangi servis, maliyet ne

**Depoda jeokodlama YOK** (`grep` → Nominatim/Mapbox/Google/HERE çağrısı sıfır;
`docs/MOBIL-KESIF.md:2331` aynı şeyi söylüyor). Bu turda da **eklenmedi**. Üç ölçüm:

1. **Nominatim'in kullanım politikası bu ürünü ADIYLA dışarıda bırakıyor:**
   *"Applications and services whose primary function is related to geocoding must
   run their own service, including package/vehicle tracking applications"* +
   kamuya açık uçta **saniyede 1 istek** tavanı. Meşru yol kendi sunucumuzu
   işletmek — bir jeokodlama sunucusu bu turun konusu değil.
2. **Ticari servis maliyeti (1.000 istek):** Google 5,00 $ · HERE 0,83 $ ·
   Mapbox 0,75 $ · LocationIQ 0,49 $. Ücretsiz kademe: HERE 250k/ay,
   Mapbox 100k/ay, LocationIQ 5k/gün. Günde 80 durak × 30 araç ≈ **72k/ay** →
   ücretsiz kademeye sığar, ama üçüncü tarafa YENİ bir dış bağımlılık ve her
   kiracıya ayrı anahtar demek.
3. **Gerek yok:** koordinat zaten haritadan tıklanarak alınıyor
   (`components/GeofencePickerMap.tsx` bugün bölge merkezi için tam bunu yapıyor)
   ve Samsara'nın singleUseLocation'ı da koordinatı çağırandan istiyor.
   **Adres bir ETİKET, koordinat bir ÖLÇÜMDÜR.**

⚠️ **Şema jeokodlamaya hazır:** `adres` dolu + koordinat boş bir durak BUGÜN
meşrudur (otomatik varış çalışmaz, şoför elle işaretler; ekran bunu söylüyor).
Jeokodlama bir gün eklenirse o satırların koordinatını doldurur — **şema değişmez.**

### 2.4 070 varış köprüsü durak eksenine nasıl taşınır

070 bugün `zone_visits` okuyup `seferler.vardi_at` damgalıyor. Aynı üç kural
durak eksenine taşındı:

1. hedef aynı (bölge kimliği ya da daire içinde nokta),
2. gözlem seferin GÜNÜ içinde ve **durağın açıldığı andan** sonra
   (070'te `sefer.atandi_at` kullanılıyordu; sefer sabah açılıp durak öğlen
   eklenmiş olabilir),
3. **vardiya kimlik kontrolü** — `zone_visits.worker_id`'ye GÜVENİLMEZ
   (kâğıt üzerindeki atama; 15.08'de skorda kapatılan eksen uyuşmazlığı).

İki ölçüm yolu:
- **bölgeli durak** → `zone_visits`. Motor aynen kullanılır, tek satır bile yazılmaz.
- **koordinatlı durak** → flespi turunun **bellekteki** noktalarıyla dairesel test.
  **Ek sorgu YOK**; noktalar tur içinde zaten çekiliyor
  (`app/api/flespi/sync/route.ts` → `seferVarisKoprusu(now, noktaHaritasi)`).

⚠️ **Bilinen fark:** koordinatlı durakta **histerezis yok**. Bölgeli durakta
`min_dwell_s` (varsayılan 120 sn) eşiği vardır; koordinatlıda "içeriden geçen ilk
nokta" varış sayılır. Bu yüzden serbest hedefin varsayılan yarıçapı daha DAR
(150 m; Samsara 250–300 m) ve alt sınırı 50 m. Eşiği buraya taşımak
`zone_visits`in ikinci bir kopyasını doğururdu — 064'ün öğrettiği hata.

**Sıra zorunlu değil:** araç 5. durağın sahasına girdiyse 2. durak beklerken de
damgalanır. Bu bir GÖZLEMDİR, plan değil; gerçekten olmuş bir varışı "plana
uymadı" diye atmak sistemin gördüğünü yok saymak olurdu.

`seferler.vardi_at` anlamını koruyor: seferin **ilk** varışı.

---

## 3 · Model

### 3.1 Tek cümlelik kural

> **Durak listesi varsa duraklar konuşur; yoksa eski tek hedef.**

`seferler.zone_id` düşürülmedi ama artık hiçbir yüzey onu doğrudan okumuyor.
Hedef çözümü TEK yerde: `lib/sefer-duraklari.ts → seferHedefi()`. Yeni seferler
o kolonu **yazmıyor** (panel formu ve mobil POST 1 numaralı durağı yazar) —
yazsaydı, 1. durak silindiğinde kolon bayat bir hedef taşımaya devam ederdi.

### 3.2 Durum çizgisi

```
bekliyor → varildi → tamamlandi
bekliyor | varildi → atlandi (SEBEBİYLE)
```

- `bekliyor → tamamlandi` de meşru: şoför "vardım"a basmadan işi bitirebilir ve
  o zaman `varildi_at` **boş kalır** — ölçmediğimiz bir anı uydurmuyoruz.
- **Geri dönüş yok.** Atlanan durağa yeniden gidilecekse **yeni bir durak** açılır
  (080'in "yeniden teslim denemesi YENİ BİR DURAK numarasıdır" kuralı).
- Yanlış basılan düğmenin düzeltme yolu **yöneticidedir** (`durumSifirla`,
  damgalar temizlenir). Kendi damgasını silebilen bir kayıt kanıt olmaktan çıkar.
- `varis_kaynak` = `sofor` | `otomatik`: "sistem mi gördü, şoför mü söyledi"
  sorusu sonradan cevaplanamaz olmamalı.

### 3.3 İlerleme

`biten = tamamlanan + atlanan`. Atlanan durak da **kapanmıştır** — şoför oraya
bir daha gitmeyecek; atlananı bekleyen saymak günü hiç bitmeyen bir listeye
çevirirdi. Sayı ayrıca AYRI taşınıyor: "7 tamam · 2 atlandı · 3 bekliyor".

### 3.4 Teslimat kanıtı (080) bağlandı

080 kanıtı zaten `durak_no` ile seferin BİR DURAĞINA bağlıyordu. Eksik olan tek
şey: `durak_no` bir SAYI, durak ise artık bir SATIR. `teslimatlar.durak_id`
eklendi (kalıcı bağ; yeniden sıralamada değişmez) ve **değişmezlik tetikleyicisi
onu da kapsıyor** — kapsamasaydı kanıtın hangi teslimata ait olduğunu söyleyen
alan, kanıtın tek değiştirilebilir alanı olurdu.

Tekillik ikiye bölündü, garanti korunarak:
- `durak_id` BOŞ satırlar (duraksız sefer) → eski `(sefer_id, durak_no)` tekilliği
- `durak_id` DOLU satırlar → `unique (durak_id) where iptal_at is null`, yani
  bir durağın **aynı anda tek GEÇERLİ kanıtı**. İptal edilmiş kanıt yeni denemeyi
  engellemez — yanlış kanıt sebebiyle kayıtta durur, üstüne doğrusu yazılabilir.

### 3.5 Bilinen sınır — takip linki

Takip linki **sefere** bağlı (079), durağa değil. Çok duraklı bir seferde müşteri
kendi durağının değil **aracın sıradaki durağının** ETA'sını görür.
Onfleet/Track-POD linkleri göreve (=durağa) bağlıdır; bu farkı kapatmak 079'a
`durak_id` eklemeyi gerektirir ve bu turun kapsamında değil. Bugünkü davranış
yanlış değil, **dar**: araç yaklaştıkça sıradaki durak müşterininki olur.

---

## 4 · Yüzeyler

| Yüzey | Yol | Ne yapar |
|---|---|---|
| Panel | `/admin/seferler` → sefer detayı | durak ekle/düzenle/sil, yukarı-aşağı sırala, durumu sıfırla, ilerleme rozeti |
| Şoför | `/panel/seferler` | sıralı liste, **sıradaki durak vurgulu**, Vardım/Tamamlandı/Atla, durak başına teslimat kanıtı, ilerleme çubuğu |
| Mobil | `GET/POST/PUT /api/mobile/sefer/[id]/duraklar` | liste (şoför kendi seferi) · ekle · yeniden sırala (yönetici) |
| Mobil | `PATCH/DELETE /api/mobile/sefer/[id]/duraklar/[durakId]` | düzenle / durumu sıfırla / sil (yönetici) |
| Mobil | `POST /api/mobile/sefer/[id]/duraklar/[durakId]/durum` | durumu ilerlet (atanan şoför) |

**Sürükle-bırak yerine yukarı/aşağı düğmeleri:** dokunmatikte kaydırma
hareketiyle çakışır, klavye/ekran okuyucuyla erişilemez, 80 satırda hedef bulmayı
zorlaştırır. İki düğme her girdi biçiminde çalışır ve her hareket TEK sunucu
çağrısıdır — yarım bir sürükleme yarım sıralama bırakmaz.

⚠️ **`PATCH /api/mobile/sefer/[id]` gövdesindeki `bolgeId`, duraklı seferde
409 `duraklarla_yonetiliyor` döner.** Sessizce kabul etmek "değiştirdim"
yanılgısı üretirdi.

---

## 5 · Prova (yerel Docker yığını)

Üretim veritabanında sahte tur üretmemek için harness ayrı.

```bash
# 1) Postgres
docker run -d --name hak-qa -e POSTGRES_PASSWORD=qa -e POSTGRES_DB=hak \
  -p 55432:5432 postgres:16
docker exec hak-qa psql -U postgres -d hak -c \
  "create role service_role; create role anon; create role authenticated;"

# 2) Supabase'e özgü nesnelerin şimi + şema (001→082)
docker exec -i hak-qa psql -U postgres -d hak <<'SQL'
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create schema if not exists auth;
create extension if not exists pgcrypto;
SQL
docker cp db/install/galzura-full.sql hak-qa:/tmp/full.sql
docker exec hak-qa psql -U postgres -d hak -v ON_ERROR_STOP=1 -f /tmp/full.sql

# 3) YETKİLER — ⚠️ BYPASSRLS ŞART
docker exec hak-qa psql -U postgres -d hak -c "
  grant usage on schema public to service_role, anon, authenticated;
  grant all privileges on all tables in schema public to service_role;
  grant all privileges on all sequences in schema public to service_role;
  grant execute on all functions in schema public to service_role;
  alter role service_role bypassrls;"

# 4) PostgREST
docker run -d --name hak-qa-rest -p 55434:3000 \
  -e PGRST_DB_URI="postgres://postgres:qa@host.docker.internal:55432/hak" \
  -e PGRST_DB_SCHEMAS="public" -e PGRST_DB_ANON_ROLE="anon" \
  -e PGRST_JWT_SECRET="<en az 32 karakter>" \
  --add-host=host.docker.internal:host-gateway postgrest/postgrest:v12.2.3

# 5) supabase-js `/rest/v1` önekini soyan proxy (:55433 → :55434) ve
#    `role: service_role` iddialı bir HS256 JWT — ikisi de küçük Node betikleri.
#    Ardından ENV_FILE'a NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55433 yazın.
```

> 🔴 **`alter role service_role bypassrls` atlanırsa** `zone_visits` (RLS açık,
> policy yok) **sessizce boş** döner ve varış köprüsü "hiçbir şey damgalamadı"
> diye suçlanır. Bu tam olarak bir kez oldu (25.08.2026) ve doğrulama betiğine
> "ziyaret satırı GERÇEKTEN yazıldı" iddiası bu yüzden eklendi.

### Koşum

```bash
# Sunucu eylemleri + köprü + ePOD + mobil uçlar (55 iddia)
ENV_FILE=<qa env> node --import ./scripts/ts-server.mjs \
  scripts/verify-sefer-duraklari.mjs

# Sayfaların KENDİSİ (SSR HTML)
set -a; . <qa env>; set +a
npm run build && npx next start -p 3300 &
node scripts/verify-sefer-duraklari-render.mjs
```

### Harness'ın iki bağı

- **`QA_SESSION_COOKIE`** (`scripts/next-headers-stub.mjs`): verilirse çerez
  deposu `hak_session`'ı döndürür. Mühür GERÇEK `SESSION_PASSWORD` ile üretilir —
  kapılar (`requireFleetView` / `requireWorker`) **atlanmaz**, yalnız tarayıcının
  taşıdığı çerez yerine konur. Değişken yoksa depo eskisi gibi BOŞ.
- **`next/cache` şimi** (`scripts/next-cache-stub.mjs`): `revalidatePath()` istek
  kapsamı dışında fırlatıyor ve sunucu eylemleri yazdıktan sonra onu çağırıyor.
  Önbellek işareti bir iş kuralı değil; no-op olması ölçülen davranışı değiştirmez.

⚠️ **`NEXT_PUBLIC_*` derleme anında gömülür.** QA yığınına bakan bir `next start`
için QA env'iyle YENİDEN DERLEMEK şart; üretim derlemesiyle koşulursa
"Invalid API key" alınır (ölçüldü). Prova bitince **üretim env'iyle yeniden
derleyin** — yoksa `.next` QA adresine bakar kalır.

---

## 6 · Kurulum

- `db/migrations/082_sefer_duraklari.sql` → Supabase SQL Editor.
- `scripts/gen-install-sql.mjs` ORDER listesine eklendi; `*-full.sql` ve
  `*-hizalama-078.sql` yeniden üretildi (`lint:install-sql` yeşil).
- **082 uygulanmazsa:** çok duraklı sefer KAPALI kalır, sefer eski TEK hedefli
  davranışını sürdürür. Panelde bölüm "bu kurulumda kapalı" der, şoförde bölüm
  hiç çıkmaz (yapabileceği bir şey olmayan uyarı göstermek yanlış olurdu).
  Aynı kademeli düşüş 056/058/077/078/079/080'de de var.
- ⚠️ `teslimatlar.durak_id` de 082 ile geliyor; `lib/teslimat-db.ts` okuma
  yolunda 42703'e düşerse ESKİ kolon listesine geri düşer ve durumu **bir kez**
  loglar — 080 ile gelen çalışan bir özellik yeni bir migration'a rehin olmasın.
