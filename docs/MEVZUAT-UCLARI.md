# Faz D-4 — Mevzuat mobil uçları

Dal: `feat/mevzuat-uclari` · Ölçüm: **22.09.2026**
Taban: `main a359bce` · migration **086 üç kiracıda da kurulu** (yeni migration YOK)

---

## 1 · İki uç — üçüncüsü AÇILMADI

| uç | kapı | çekirdek |
|---|---|---|
| `GET /api/mobile/mevzuat` | **fleetView** | `mevzuatAyari` · `mevzuatPanosu` · `uyariListesi` · `mevzuatBelgeleri` |
| `PATCH /api/mobile/mevzuat` | **yönetici** | `kademeDenetle` + `mevzuatAyariYaz` + `auditChange` |
| ~~`POST /api/mobile/mevzuat/uyari/[id]/kapat`~~ | — | **YOK — §2** |

Kapılar panelin kapılarının ikizi: `app/admin/mevzuat/page.tsx` okumayı
`requireFleetView`, `app/actions/mevzuat.ts` ayarı `requireAdmin` ile koruyor.

---

## 2 · 🔴 Görevin üç varsayımı üründe yok — ölçüldü

### 2.1 Uyarı KAPATMA yok, dolayısıyla üçüncü uç da yok

Görev "panelde kapatma varsa aynı çekirdek; yoksa uç yok, söyle" diyordu.
**Yok** — ve bu bir eksiklik değil, yazılı bir ürün kararı:

| nerede | ne diyor |
|---|---|
| şema (086) | `mevzuat_uyarilari`da `kapandi_at` / `kapatan` / `not` **kolonu yok** |
| panel | `MevzuatClient.tsx`te kapatma/silme düğmesi **yok** (`kapat` orada yalnız ayar formunu kapatan fonksiyon) |
| CRUD muhafızı | `scripts/check-crud-ekranlari.mjs` MUAF listesi: *"Ekranın ürettiği uyarı kaydı (`mevzuat_uyarilari`) bilerek **DEĞİŞMEZDİR**: gönderilmiş bir bildirimin silinmesi, gönderilmemiş gibi görünmesine yol açar ve tekil indeksin spam korumasını da bozar."* |

İkinci zarar birincisinden sinsi: `mevzuat_uyari_tekil (worker_id, gun, kural,
kademe)` indeksi **spam'in şema düzeyindeki tek engeli**. Kapatma satırı
silseydi aynı kademe bir sonraki taramada yeniden gönderilirdi; kapatma satırı
işaretleseydi bile "kapalı olanı atla" diye bir kod yolu yok — tarama tekil
indekse çarpar ve hiçbir şey değişmezdi. Yani kapatma ucu ya işe yaramaz ya da
zararlı olurdu.

### 2.2 `?durum=acik|kapali` süzgeci → **400**

(2.1)'in doğrudan sonucu: kapanış diye bir durum yoksa süzülecek eksen de yok.
Uç sessizce yutup tüm listeyi döndürmüyor:

```
GET /api/mobile/mevzuat?durum=acik
→ 400 { error: "invalid", alan: "durum", sebep: "kapanis_ekseni_yok",
        uyariKapatmaUcu: null }
```

Türetilmiş bir "açık" tanımı (ör. *"dayandığı vardiya hâlâ açıksa açık"*)
uydurmak mümkündü ve **bilerek yapılmadı**: o sayı ölçüm gibi okunurdu, oysa
kimsenin kapattığı bir şey yok. `{kategori, gun}` kararının aynısı (090 turu).

### 2.3 "Eksik belge" tespiti yok → `belgeler` bloğu **SÜRE** eksenli

078'de bir belge türünün **zorunlu** olduğunu söyleyen alan yok:
`document_types` = `code, label, warn_days, requires_number, active,
sort_order`. `requires_number` belgenin **numarasının** zorunluluğudur, kendisinin
değil. Yani *"Ali'de SRC yok"* cümlesini kuracak veri yok; sistem yalnız
**girilmiş** belgelerin tarihini bilir.

Eksen bilerek böyle: tür listesi kiracıya ait (TR'de SRC + psikoteknik, DACH'ta
Aufenthaltstitel, AB'de CPC) ve "kimde hangisi zorunlu" sorusu ülkeye ve yüke
göre değişir.

Uç ölçülebileni döndürüyor — süresi **dolmuş** + eşiğe **girmiş** belgeler — ve
iddiasını gövdede açıkça sınırlıyor:

```jsonc
"belgeler": { "satirlar": [...], "dolmus": 0, "yaklasan": 0, "turSayisi": 0 },
"yetenekler": { "eksikBelgeTespiti": false }
```

`turSayisi` "0 satır"ın **sebebini** ayırt ettiriyor: tür hiç tanımlı değilse
eksen kapalıdır, tanımlıysa gerçekten temizdir. (Demo'da `turSayisi: 0`.)

---

## 3 · ⚠️ Kapsam: mobil daraltıyor, panel daraltmıyor — AÇIK KARAR

**Ölçülen durum:** `/admin/mevzuat` şefi `requireFleetView` ile içeri alıyor
ama `mevzuatPanosu` satırları filoya **daraltmıyor**. Yani bir filo şefi bugün
panelde **tüm** açık vardiyaları, adlarıyla görüyor.

Mobil uç bu davranışı **taşımadı**, fail-closed tarafta durdu:

| okuma | mobilde kapsam |
|---|---|
| canlı satırlar (`time_entries`) | `onlyFleet(worker_id)` |
| uyarı defteri (`mevzuat_uyarilari`) | `onlyFleet(worker_id)` |
| belgeler (`worker_documents`) | `withoutTestRows` → `onlyDrivers` → `onlyFleet` — `/admin` Dikkat panosundaki üçlünün aynısı |
| `?sofor=` kapsam dışı | **403 `kapsam_disi`** (404 değil: şoför VAR, yetki yok) |

Gerekçe: muhafız kuralının kendisi — *"kapı gevşemese bile SÜZGEÇ düşerse şef
başka filonun plakasını görür"*. Yeni bir yüzeyin mevcut bir gediği taşıması,
gediği iki katına çıkarmak olurdu.

**Fark gizlenmiyor**, gövdede duruyor:

```jsonc
"kapsam": { "filo": null, "sef": false, "daraltildi": false }
```

**Panel bu turda DEĞİŞTİRİLMEDİ** ve bu bilinçli: `mevzuatPanosu`a eklenen
`fleetScope` parametresinin varsayılanı `UNRESTRICTED`, yani panelin ve tarama
cron'unun okuduğu küme **bir satır bile** değişmedi. Muhafız her iki ucu da
tutuyor (varsayılanın `UNRESTRICTED` kalması + panel action'ının kapsam
geçmemesi).

> 🔶 **VOLKAN'IN KARARI BEKLİYOR:** panel de daraltılsın mı? Daraltılırsa
> HAK61'deki şefler `/admin/mevzuat`ta bugün gördükleri satırların bir kısmını
> kaybeder — canlı müşteride bir ekranı sessizce daraltmak ayrı bir karardır ve
> kendi ölçümünü ister.

---

## 4 · Gövde — ne var, nereden geliyor

| blok | kaynak | not |
|---|---|---|
| `ayar.kuralSeti` | `tenant_mevzuat.kural_seti` | **ülke ekseni budur** — §5 |
| `ayar.kurallar[]` | `lib/mevzuat.ts KURAL_SETLERI` | `ad · temel · tur · esikDk · geceEsikDk · gerekenMolaDk · dayanak` |
| `ayar.kademe` | `tenant_mevzuat` | 60/30/15 |
| `ayar.kuralSetleri` | `Object.keys(KURAL_SETLERI)` | istemci listeyi gömmesin |
| `canli.satirlar[]` | `mevzuatPanosu` | şu an sahadaki açık vardiyalar + kural durumu |
| `uyarilar` | `uyariListesi` | **sayfalı** (`page: {limit, offset, total, hasMore}`), `?gun=` penceresi 1–90 (varsayılan 7) |
| `belgeler` | `mevzuatBelgeleri` | §2.3 |
| `adlar` | `workers` (anahtarlı `.in("id")`) | defterdeki şoför bugün sahada olmayabilir |
| `kapsam` · `yetenekler` · `sinirlar` | uç | §3 · §2 · istemci sayı gömmesin |

### AZG mı Lenkzeit mi — `temel` alanı söylüyor

Her kuralda `temel` var: `calisma_suresi` **ÖLÇÜLÜR** (AZG/ArbZG),
`surus_tahmini` **TAHMİN EDİLİR** (Lenkzeit, AB 561/2006). İkisi gövdede asla
tek bir "süre" alanında birleşmiyor — 086 başlığındaki hata payı ölçümlerinin
(*sürüş/vardiya medyan %46,5 · telemetri boşluğu %32,2 · 12 vardiyanın 3'ünde
hiç telemetri yok*) sebebi tam olarak bu.

---

## 5 · `tenant_mevzuat`ta ülke kolonu YOK

Görev "ayar (ülke, …)" diyordu. Şemada `ulke_kodu` **yok**; ülke bilgisi kural
setinin **kendisinde**: `AT_AZG` · `DE_ARBZG` · `EU_561`. (`ulke_kodu` taşıyan
`tenant_saklama` **başka** bir ayardır, başka bir amaçla — veri saklama süresi.)

Uydurma bir `ulke` alanı iki ayarı birbirine karıştırırdı, o yüzden PATCH onu
reddediyor ve **doğrusunu söylüyor**:

```
PATCH { "ulke": "AT" }
→ 400 { alanlar: ["ulke"], izinli: ["kuralSeti","surusTahmini","kademe"],
        sebep: "ulke_kolonu_yok",
        aciklama: "… ülke ekseni kural setinin kendisidir … `kuralSeti` gönderin." }
```

---

## 6 · PATCH — sınırlar çekirdekten, 503 değil 400

Kademe sırası kuralı (`erken > yaklasti > son > 0`) **üç yerde** geçerli: şema
CHECK'i, yazma yolu, uç. Üçü de aynı cümleyi söylesin diye kural
`lib/mevzuat.ts` → **`kademeDenetle`** olarak saf katmana çıkarıldı;
`mevzuatAyariYaz` artık onu çağırıyor, uç da **aynı fonksiyonu** çağırıyor.
Uçta elle yazılmış ikinci bir karşılaştırma yok — `ayarDenetle` (090) kararının
aynısı.

Ucun kendi katkısı yalnız **hata kodu**: yazma yoluna bırakılsaydı sıra hatası
bir DB hatası gibi 503 dönerdi.

| gövde | yanıt |
|---|---|
| `{kademe:{erken:61}}` | **200** · kısmi yama, `yaklasti`/`son` korunur |
| `{kademe:{erken:10}}` | **400** `kademe_sirasi` |
| `{kademe:{…, son:0}}` | **400** `kademe_sirasi` |
| `{kademe:{erken:60.5}}` | **400** `bicim: tamsayi` (kolon `integer`; 503 değil) |
| `{kuralSeti:"XX"}` | **400** + `gecerli: [AT_AZG, DE_ARBZG, EU_561]` |
| `{ulke:"AT"}` | **400** `ulke_kolonu_yok` |
| `{}` | **400** `bos_govde` |

**`surusTahmini` reddedilmiyor, UYARILIYOR.** Alan yalnız `EU_561`'de anlamlı
ama şemada bir kısıt yok ve panel de reddetmiyor. Uç ret yerine yanıtta
`surusTahminiEtkisiz` / `surusEkseniKapali` taşıyor — olmayan bir reddi
uydurmak, panelde kabul edilen bir değeri telefonda reddetmek olurdu (090'daki
`yasalCipaAltinda` kararının aynısı).

**İz `auditChange` ile, alan farkıyla:** `tenant_mevzuat (kaynak=mobil)` ·
`singleton` · `before/after`. Panelin düz `audit` satırı yalnız yeni değeri
yazıyordu.

---

## 7 · Muhafız — `npm run lint:mevzuat-uclari`

`verify` zincirine eklendi (`lint:saklama-haftalik` ile `build` arasına).
**Arıza enjeksiyonuyla sınandı: 14/14 yakalandı, 0 kaçtı.**

| enjeksiyon | sonuç |
|---|---|
| PATCH kapısı şefe açıldı | ✓ yakalandı |
| `uyariListesi` çağrısından kapsam düşürüldü | ✓ |
| `mevzuatPanosu` kapsam argümanı silindi | ✓ |
| `mevzuatPanosu` varsayılanı `UNRESTRICTED` olmaktan çıktı | ✓ |
| lib'den `onlyFleet` süzgeçleri kaldırıldı | ✓ |
| `?durum=` reddi kaldırıldı | ✓ |
| uçta kademe kuralı elle yeniden yazıldı | ✓ |
| `kademeDenetle` saf katmandan kaldırıldı | ✓ |
| uyarı **kapatma ucu eklendi** | ✓ |
| uca `POST` handler eklendi | ✓ |
| `eksikBelgeTespiti: false` kaldırıldı | ✓ |
| `uyariKapatma: false` kaldırıldı | ✓ |
| kural setleri elle yazıldı | ✓ |
| `?sofor=` kapsam kapısı kaldırıldı | ✓ |

🔑 **İki kontrol ilk turda KAÇTI ve ikisi de öğreticiydi:**

1. *"`mevzuatPanosu` çağrısı kapsamı taşıyor"* kontrolü "fonksiyon adından
   sonraki 260 karakterde `fleetScope` geçiyor mu" diye bakıyordu. Enjeksiyon
   argümanı sildi ama **komşu çağrının** (`uyariListesi({… fleetScope …})`)
   argümanı pencereye girip kontrolü tatmin etti. Artık parantez **sayılıyor**:
   yalnız çağrının kendi argüman listesi okunuyor.
2. *"uç `mevzuat_uyarilari`ya dokunmuyor"* kontrolü kelimeyi arıyordu; ucun
   400 açıklama **dizesi** o kelimeyi içerdiği için ilk koşumda yanlış yere
   düştü. Kontrol `.from("mevzuat_uyarilari")` **sorgusunu** arıyor artık.

Ayrıca üç enjeksiyon ilk turda hiç uygulanmamıştı (çapa `\n` yazılıydı, dosyalar
diskte CRLF) — koşum bunu "kaçtı" diye değil **"ENJEKSİYON UYGULANMADI, test
geçersiz"** diye raporladı. 090 turunda öğrenilen tuzağın tam olarak tersi:
bu kez harness kendi hatasını söyledi.

---

## 8 · Standart doğrulama

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| ESLint | **43 problem (28 hata, 15 uyarı)** — `git stash` ile ölçülen tabanla **birebir aynı**, artış yok |
| `lint:test-filters` | tek bulgu `lib/auto-shift.ts:825` — **taban, değişmedi** |
| 23 muhafız (`lint:*`) | **hepsi yeşil**, yeni muhafız dâhil |
| `npm run build` (yerel) | **1 hata — ve taban da aynı hatayı veriyor**: `geist_mono … @vercel/turbopack-next/internal/font/google/font` çözülemiyor. `git stash` ile temiz ağaçta ölçüldü, birebir aynı. Yerelde Google font indirilemiyor; gerçek build kanıtı Vercel dağıtımlarıdır. |

---

## 9 · Canlı kanıt — galzura-demo, gerçek giriş (22.09.2026)

`ENV_FILE=.env.galzura-demo npm run verify:mevzuat-uclari` · **35/35 iddia geçti.**

Gerçek giriş (telefon + PIN), gerçek demo veritabanı, gerçek rota
fonksiyonları. **HAK61 ve Sendigo'ya dokunulmadı** — betik ilk iş olarak proje
referansını doğrulayıp başka kiracıda durur.

| adım | rol | kod | not |
|---|---|---|---|
| `GET` · `PATCH` | jetonsuz | **401** | `missing_token` |
| `POST /auth/login` | yönetici | **200** | `rol=admin` |
| `GET /mevzuat` | yönetici | **200** | **1.378 ms** |
| `GET ?durum=acik` | yönetici | **400** | `kapanis_ekseni_yok` |
| `GET ?sofor=abc` | yönetici | **400** | `alan: sofor` (uuid değil) |
| `GET ?gun=999` | yönetici | **400** | `max: 90` |
| `GET ?sofor=<uuid>` | yönetici | **200** | **iki liste de** süzüldü |
| `GET ?limit=1` | yönetici | **200** | `page.limit=1` |
| `PATCH {kademe:{erken:61}}` | yönetici | **200** | `once 60 → sonra 61` |
| `GET` (doğrulama) | yönetici | **200** | `ayar.kademe.erken = 61` |
| DB okuması | — | — | `tenant_mevzuat.kademe_erken_dk = 61` |
| `PATCH {erken:60}` (geri al) | yönetici | **200** | `61 → 60` |
| `PATCH {erken:10}` / `{son:0}` | yönetici | **400** | `kademe_sirasi` |
| `PATCH {erken:60.5}` | yönetici | **400** | `bicim: tamsayi` |
| `PATCH {ulke:"AT"}` | yönetici | **400** | `ulke_kolonu_yok` |
| `PATCH {kuralSeti:"XX"}` | yönetici | **400** | + geçerli liste |
| `PATCH {}` | yönetici | **400** | `bos_govde` |
| `GET` | **şoför** | **403** | `fleet_view_required` |
| `PATCH` | **şoför** | **403** | `admin_required` |

### Ölçülen gövde (demo)

```
ayar      AT_AZG · kademe 60/30/15 · surusTahmini false
kurallar  3 · gunluk_tavan 720 dk · mola_6sa 360 dk · mola_9sa 540 dk
canli     16 açık vardiya · vardiyasiz 21 · bayatVardiya 0
          örnek satır: enKritik=ihlal · enYakinKalanDk=6
uyarilar  0 satır · total 0 · pencere 7 gün · tabloYok=false
belgeler  turSayisi 0 · dolmus 0 · yaklasan 0
kapsam    filo=null · sef=false · daraltildi=false   (hesap patron)
```

**Uyarı defteri demo'da dürüst boş:** `404` ya da `503` değil, **`200` + 0
satır + sayfa bloğu**. `mevzuat_uyarilari` gerçekten 0 satır (DB'den de
sayıldı) — tarama cron'u bu kiracıda kurulu değil. Uç ile DB sayısı birebir.

**Belgeler de dürüst boş ve sebebi gövdede:** `turSayisi: 0` — demo'da hiç
belge **türü** tanımlı değil, yani eksen kapalı; "temiz" değil.

### 🔑 Yazma kanıtı ölçümle, iddiayla değil

- `tenant_mevzuat` **beş alanının beşi de** tur öncesi hâline döndü:
  `AT_AZG · false · 60 · 30 · 15`.
- `mevzuat_uyarilari`: **0 → 0**. Uçlar deftere tek satır yazmadı.

### ⚠️ `enKritik=ihlal · kalan=6 dk` gerçek bir ihlal DEĞİL

Demo'da 16 açık vardiya var ve bir kısmı 12 saatlik AT tavanını aşmış
görünüyor. Bunlar 12 saattir çalışan insanlar değil, **kapanmamış kayıtlar** —
`VARDIYA_BAYAT_MS` (24 sa) eşiğinin **altında** kaldıkları için değerlendirme
dışı da kalmıyorlar. Uç burada panelle birebir aynı sayıyı gösteriyor; bu
ucun değil verinin özelliği (`bayatVardiya: 0`, yani 24 saati aşan yok).
