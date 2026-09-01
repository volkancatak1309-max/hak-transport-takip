# Kiracı sorgu ucu — `POST /api/mobile/kiraci-sorgu`

**Durum:** ✅ **MAIN'DE CANLI** (`8c14ba0`, 01.09.2026).
✅ **Sendigo ve galzura-demo tam çalışıyor** — `var:true` yolu dahil kanıtlandı.
🔴 **HAK61 hâlâ `503 yapilandirilmadi`**: env Production'da VAR ama eklendikten
sonra **redeploy edilmedi** — canlı dağıtım env'den 2 saat eski (§ 15).
**Ölçüm tarihi:** 01.09.2026 · HAK61 ve Sendigo canlı veritabanları, **salt okuma**.
**Kod:** `app/api/mobile/kiraci-sorgu/route.ts` · `lib/auth-core.ts` (ortak çekirdek)
**Muhafız:** `npm run lint:kiraci-sorgu` · **Canlı kanıt:** `npm run verify:kiraci-sorgu`

---

## 0. Bir bakışta

| Soru | Cevap |
|---|---|
| Girdi | yalnız `{"telefon": "+43…"}` — başka hiçbir şey |
| Çıktı | `{"ok":true,"var":true\|false,"kod":"hak61"}` — **tek bit** |
| PIN | **gelmez.** Gövdede `pin`/`sifre`/`password` varsa istek 400 ile reddedilir |
| Kişisel veri | dönmez; sorgu `pin_hash`i **okumaz** bile (yalnız `is_active, is_admin`) |
| Kimlik doğrulama | `KIRACI_SORGU_SECRET` — **sır önerilir**, `acik` sentineliyle kimliksiz de olur |
| Numara eşleştirme | girişin kullandığı fonksiyonun **birebir aynısı** (`findWorkerByPhone`) |
| Taban süre (zamanlama) | **gerekmiyor** — ölçüldü, sinyal gürültü tabanının altında (§ 4) |
| Yeni kiracıda | kod olarak **kendiliğinden var**; env **girilmeli**, girilmezse 503 der (§ 6) |
| Migration | **yok** — kullandığı üç kolon da şema 001'den beri mevcut |

**Dört bulgu, sırayla önem:**

1. 🔴 **İki numara HEM HAK61'de HEM Sendigo'da kayıtlı** (ikisi de aktif yönetici).
   Yayılma modeli bugün **iki "evet"** üretiyor. Yönlendirme servisi ilk evette
   duramaz. → § 7
2. Zamanlama endişesi ölçüldü ve **çürütüldü**; ama gerçek zamanlama sızıntısı
   bir katman yukarıda, **yönlendirme servisinin kendisinde** duruyor. → § 4.3
3. Sendigo'da uç **8 aktif kişiden yalnız 3'üne** "evet" diyecek — şoför paneli
   kapalı olduğu için. Bu bir kusur değil, girişin bugünkü davranışı. → § 5
4. 🔴 Bu uygulama, **olmayan bir yola `200` + HTML** döndürüyor (`X-Matched-Path:
   /_not-found`, ölçüldü). `status === 200` denetimi "cevap geldi" anlamına
   GELMEZ; servis `content-type: application/json` de aramalı. → § 7.5

---

## 1. Akış ve bu ucun yeri

```
  Telefon (APK)                galzura.com                    kiracı panelleri
  ─────────────                ───────────                    ────────────────
  telefon + PIN
      │
      │ 1. telefon  ──────────►  yönlendirme
      │                          servisi
      │                             │  2. YAYILMA (paralel)
      │                             ├──────► hak61.…/api/mobile/kiraci-sorgu ─► {var:false}
      │                             ├──────► sendigo.…/…/kiraci-sorgu ───────► {var:true}
      │                             └──────► demo.galzura.com/…/kiraci-sorgu ─► {var:false}
      │                             │
      │ ◄── 3. adres(ler) ──────────┘
      │
      └─ 4. telefon + PIN ─────────────────► sendigo.…/api/mobile/auth/login
```

**Bu belgenin kapsamı 2. adımdır** — her kiracı panelinde o soruya cevap veren uç.
1., 3. ve 4. adımlar mobil uygulamanın ve yönlendirme servisinin işi; onlara ait
sözleşme maddeleri § 7'de toplandı.

**Neden merkezî tablo yok (ve bu doğru):** numara→kiracı tablosu, kiracı
eklendiğinde ya da personel taşındığında **sessizce bayatlar** ve kullanıcıyı
yanlış kapıya gönderir. Kaynağın kendisine sormak bayatlamaz. Bedeli, her girişte
N istek — HAK61 ölçeğinde (3 kiracı, sabah yoğunluğunda dakikada birkaç giriş)
ihmal edilebilir.

---

## 2. Uç sözleşmesi

### İstek

```http
POST /api/mobile/kiraci-sorgu
Authorization: Bearer <KIRACI_SORGU_SECRET>
Content-Type: application/json

{"telefon": "+436601113783"}
```

`telefon` `phoneSchema`den geçer — **girişin kullandığı şemanın aynısı**
(sanitize sonrası 6–20 karakter). Ayrı bir kural yazılmadı: iki şema ayrışsaydı
5 haneli bir girdi bir tarafta "biçimsiz", diğerinde "bulunamadı" olurdu.

**`GET` bilerek kapalı (405).** Numara sorgu dizesine yazılsaydı Vercel erişim
kayıtlarına, tarayıcı geçmişine ve ara katman önbelleklerine düşerdi. Telefon
numarası kişisel veridir ve URL'de yeri yoktur.

### Cevap

| Durum | HTTP | Gövde |
|---|---|---|
| Cevap üretildi | 200 | `{"ok":true,"var":true\|false,"kod":"<kiracı>"}` |
| Gövde JSON değil | 400 | `{"ok":false,"hata":"gecersiz_govde"}` |
| PIN gönderildi | 400 | `{"ok":false,"hata":"pin_gonderilmemeli"}` |
| Telefon eksik/biçimsiz | 400 | `{"ok":false,"hata":"telefon_bicimsiz"}` |
| Sır yok/yanlış | 401 | `{"ok":false,"hata":"yetkisiz"}` |
| GET denendi | 405 | `{"ok":false,"hata":"sadece_post"}` |
| Hız sınırı | 429 | `{"ok":false,"hata":"cok_fazla_istek"}` + `Retry-After` |
| **Env girilmemiş** | **503** | `{"ok":false,"hata":"yapilandirilmadi"}` |
| DB erişilemiyor | 503 | `{"ok":false,"hata":"db_hatasi"}` |

Her cevapta `cache-control: no-store, private` ve `x-robots-tag: noindex, nofollow`.

**Gövdedeki üç alanın her biri bir karar** ve `scripts/check-kiraci-sorgu.mjs`
K1'de kayıtlı; dördüncüsünü eklemek muhafızı kırar.

- `ok` — protokol. İstek işlendi mi.
- `var` — **aranan cevap. Tek bit.**
- `kod` — kiracı kodu (`NEXT_PUBLIC_TENANT`). Kişisel veri değil ve yeni bilgi
  de değil: her kiracının açılış sayfasında zaten görünür. Yanlış kiracıya
  bağlanmış bir yönlendirme kaydını teşhis etmek için duruyor — yayılmada bir
  adres karışırsa cevap "doğru" görünür, `kod` olmadan bunu anlamak imkânsızdır.

**🔴 Dönmeyenler:** ad, soyad, rol, yönetici mi, filo şefi mi, plaka, araç, filo,
vardiya durumu, hesabın ne zaman açıldığı, neden "hayır" dendiği. Sorgu
`workers` tablosundan **yalnız `is_active` ve `is_admin`** okur; `pin_hash`
hiç çekilmez. (Çekip atmak yerine hiç çekmemek bilinçli: ileride eklenecek bir
teşhis logu onu basamaz.)

---

## 3. Numara eşleştirme — ayrı bir yol YAZILMADI

Görevin 3. maddesi: *"girişin bugün kullandığı `phoneVariants` mantığının
AYNISINI kullan"*. Bunu **yorumla değil, yapıyla** garantiye aldım.

`lib/auth-core.ts` içine tek bir eşleştirme fonksiyonu kondu ve **giriş de bu ucu
da onu çağırıyor**:

```ts
export async function findWorkerByPhone(rawPhone: string, columns: string)
  → .from("workers").select(columns).in("phone", phoneVariants(rawPhone)).limit(2)
```

Kolon listesi çağırandan gelir (giriş `pin_hash` dahil her şeyi ister, bu uç iki
bayrak), **eşleştirme tek yerdedir**. `verifyCredentials` de artık kendi sorgusunu
kurmuyor, bunu çağırıyor — yani "iki yol ayrışırsa" senaryosunun ortaya çıkacağı
bir ikinci sorgu artık yok.

Muhafız bunu üç yönden kilitliyor (`npm run lint:kiraci-sorgu`):

- **K3** — uç doğrudan `.from("workers")` yazarsa kırılır.
- **K3** — uç `phoneVariants`i kendi kurarsa kırılır (uygulamak eşleştiricinin işi).
- **K4** — kurulum kapısı (`workerCanSignIn`) iki taraftan da çağrılmıyorsa kırılır.

Altı denetimin altısı da **arıza enjeksiyonuyla sınandı**: kasıtlı olarak
bozulan altı sürümde altı denetim de kırıldı, sonra dosya geri yüklendi.

### Ölçüm: eşleştirme canlı veride tutuyor mu

`npm run verify:kiraci-sorgu` her kaydı, kişinin yazabileceği **her makul
biçimle** uca sorar ve cevabı girişin vereceği kararla karşılaştırır:

| Kiracı | Kayıt | Denenen yazım | Ayrışma |
|---|---|---|---|
| HAK61 (panel açık) | 34 | 68 | **0** |
| Sendigo (panel kapalı) | 9 | 18 | **0** |

### Yan bulgu: `canonicalPhone` devirgen (idempotent) DEĞİL

Ölçüm sırasında çıktı ve kayda geçiyor. `canonicalPhone` ulusal trunk sıfırından
**en fazla birini** atar:

```
+4306601113783   → +436601113783    → +436601113783    devirgen
+43006601113783  → +4306601113783   → +436601113783    DEĞİL — bir sıfır kalıyor
```

Sendigo'da böyle bir kayıt **var**: `+43` + dokuz sıfır + bir rakam. Kayıt
`is_test=true`, 31.07.2026'da açılmış **test hesabı** — gerçek bir personel değil,
kimse kilitli kalmıyor. Sonuç: o kayıt yalnız numarası **DB'deki birebir yazımla**
girildiğinde bulunur; kanonik yazımla girilirse bulunmaz. **Bu davranış girişte
bugün de aynı** — uç onu kopyalamıyor, paylaşıyor. Düzeltilecekse `lib/phone.ts`
düzeltilir ve iki taraf birden düzelir; bu ucun kapsamında değil.

---

## 4. Zamanlama sızıntısı — ölçüldü, taban süre GEREKMİYOR

Mobil CC'nin uyarısı yerindeydi ve tahminle geçilmedi.

### 4.1 Neden naif ölçüm yetmez

İlk turda "bulundu − bulunamadı = 6,67 ms, t anlamlı" çıktı. Ağ üzerinden yapılan
ölçümde t-testi yanıltıcıdır: yeterli örnekle **her** fark "anlamlı" görünür.
Doğru soru "fark var mı" değil, **"fark, düzeneğin kendi gürültüsünden büyük mü"**.

Bunu ölçmek için her sınıfa **birden çok kol** kondu ve kollar fizik olarak
birbirinin aynısı yapıldı:

- `BULUNDU` : aktifA · aktifB · pasifA → üçü de **tek satır** döndürüyor
- `BULUNAMADI` : yokA · yokB · yokC → üçü de **sıfır satır** döndürüyor

Sınıf **içi** fark sıfır olmak zorunda. Ölçülen sıfır olmayan değer, düzeneğin
gürültü tabanıdır.

### 4.2 Sonuç (HAK61 canlı, n=250/kol, `measure-kiraci-sorgu-zamanlama.mjs`)

```
SINIF İÇİ (fark SIFIR olmalı — gürültü tabanı)
  aktifA − aktifB  :  -6,81 ms   t = -3,19      ← aynı kod yolu, yine de ayrışıyor
  aktifA − pasifA  :  -4,50 ms   t = -2,30
  yokA   − yokB    :   4,01 ms   t =  2,43
  yokA   − yokC    :   4,32 ms   t =  1,77

SINIFLAR ARASI (aranan sinyal)
  BULUNDU − BULUNAMADI :  2,78 ms   t = 2,57   (n = 750 vs 750)

GÜRÜLTÜ TABANI : 6,81 ms
ARANAN SİNYAL  : 2,78 ms   → sinyal, kendi gürültü tabanının ALTINDA
```

Yani düzenek, **provably aynı** iki kol arasında 6,81 ms'lik "istatistiksel
olarak anlamlı" bir fark üretiyor. Aranan sinyal bunun yarısından küçük.

### 4.3 Karar: taban süre YOK — üç gerekçe

1. **Ölçülen sinyal gürültünün altında.** Uzaktaki bir gözlemci için bu fark ağ
   dalgalanmasından ayrılamaz; gerçek yolda (saldırgan → Vercel → lambda →
   Supabase) gürültü yalnızca artar.

2. **Gövde cevabı zaten açıkça söylüyor.** "Bulundu / bulunamadı" biti için
   zamanlama kanalı **hiçbir şey eklemez** — sızacak bilgi cevabın kendisi.
   Zamanlama ancak gövdenin GİZLEDİĞİ bir ayrım için önemli olurdu; o da tek bir
   şey: *"kayıt var ama giremez"* (pasif hesap / panel kapalı). Ve o karar sorgu
   **döndükten sonra saf bellekte** veriliyor — veritabanı yolu birebir aynı,
   dönen satır sayısı aynı. **Yapısal olarak sabit süreli**, ölçüme bile gerek yok.

3. **Bedeli gerçek, faydası sıfır.** Yayılmada toplam süreyi **en yavaş kiracı**
   belirler. Her uca 200 ms taban koymak, sistemdeki her girişe 200 ms bindirir
   ve karşılığında hiçbir kanal kapatmaz.

> ⚠️ **Bu kararın koşulu var ve muhafız onu koruyor.** Handler'a *cevabın
> değerine bağlı* bir erken çıkış (`kayıt yoksa hemen dön`) eklenirse, bugün
> olmayan fark yaratılır. `check-kiraci-sorgu.mjs` **K6** sorgudan sonra tek
> dönüş noktası olmasını zorunlu kılıyor.

### 4.4 🔴 Gerçek zamanlama sızıntısı bir katman YUKARIDA

Bu uç temiz, ama **yönlendirme servisi** aynı tuzağa düşebilir ve orası bizim
kodumuz değil. Servis kiracılara **sırayla** sorup ilk "evet"te dururusa, telefon
toplam süreden **kaçıncı kiracının cevapladığını** çıkarır — ve bu, kaldırılmak
istenen müşteri listesinin bir kısmını sıralama bilgisi olarak geri sızdırır.

**Mobil/yönlendirme tarafına geçirilecek madde:** yayılma **paralel** olmalı ve
servis **her zaman hepsini beklemeli** (§ 7'de zaten başka bir sebeple de
zorunlu: iki "evet" mümkün).

---

## 5. Pasif hesap · silinmiş personel · kapalı kiracı

### Kural: uç KİMLİK katmanını yansıtır, OTURUM katmanını değil

Bu ayrım her sınır durumunun cevabını tek başına veriyor:

- **Kimlik** = "bu numaraya karşılık gelen, bu kurulumda giriş yapabilecek bir
  hesap var mı". Kalıcı, o ana bağlı değil. → **uca girer**
- **Oturum** = "bu cihazdan, bu ülkeden, şu saatte, şu anda girebilir mi".
  Geçici. → **uca girmez**, cevabı `/auth/login` verir

Kimlik kapısı `lib/auth-core.ts → workerCanSignIn` içinde, **tek kaynak**, giriş
de bu uç da onu çağırıyor:

```ts
is_active === true && (DRIVER_PANEL_ENABLED || is_admin === true)
```

### Durum tablosu

| Durum | Cevap | Neden — girişin bugünkü davranışı |
|---|---|---|
| Numara hiç kayıtlı değil | `false` | — |
| **Pasif hesap** (`is_active=false`) | `false` | Giriş de reddediyor. Ayrıca sızıntıyı daraltır: "evet" deseydi uç, **işten ayrılmış** kişilerin bir firmada çalışmış olduğunu doğrulardı — çalışma geçmişi, bugünkü kadrodan daha hassas bir veri ve karşılığında hiçbir işlevsel fayda yok (o kişi zaten hiçbir yere giremez) |
| **Silinmiş personel** | `false` | İki silme yolu da aynı sonuca çıkıyor: kayıt gerçekten silinmişse satır yok; FK yüzünden pasifleştirilmişse (`23503` → pasifleştir deseni) `is_active=false` |
| **Kapalı kiracı: şoför** (Sendigo) | `false` | Şoför paneli kapalı; o kişi mobilden **zaten giremiyor**. Uç "evet" deseydi kullanıcı doğru kiracıya yönlenip "telefon veya PIN hatalı" görürdü — hiç yönlenmemekten kötü |
| **Kapalı kiracı: yönetici** | `true` | Yönetici girebiliyor |
| **Test hesabı** (`is_test=true`) | `true` | Giriş yapabiliyor, dolayısıyla "evet". Ayrı bir kural yazmak, uç ile girişin ayrıştığı ilk yer olurdu |
| **PIN değiştirmesi gereken** (`must_change_pin`) | `true` | Giriş yapabiliyor; PIN değişimi giriş **sonrası** akış |
| **Cihaz/ülke onayı bekliyor** (046) | `true` | Oturum katmanı. "Hayır" deseydik o kişi onay akışına **hiç giremezdi** — cihazını onaylatmak için önce doğru kiracıya ulaşması gerekiyor |
| **Saat aralığı dışı** (046) | `true` | Oturum katmanı. Gece 23:00'te "hiçbir kiracıda yoksun" demek yanlış cevap; doğru cevap `/auth/login`'in verdiği `outside_hours` |
| **Ölü adam anahtarı çekili** (kill switch) | `true` | Oturum katmanı. Kullanıcı doğru kiracıya yönlenip `system_locked` görür — dürüst ve eyleme dönüştürülebilir. "Hayır" deseydik kişi kendini yanlış numara yazmış sanar, gerçek sebebi hiç öğrenemezdi. **Kurulumu tamamen kapatmak gerekiyorsa doğru kol yönlendirme servisidir**: o kiracıyı listeden çıkarın ya da sırrını döndürün |

### Ölçülen sonuç

| Kiracı | Kayıt | Aktif | **Uç "evet" diyecek** |
|---|---|---|---|
| HAK61 (panel **açık**) | 34 | 32 | **32** |
| Sendigo (panel **kapalı**) | 9 | 8 | **3** — yalnız yöneticiler |

Sendigo'daki 5 aktif şoför "hayır" alacak. **Kusur değil:** o beş kişi bugün de
mobilden giremiyor (`DRIVER_PANEL_ENABLED=false`, `lib/auth-core.ts`). Sendigo
mobili şoförlere açarsa tek env değişikliğiyle beşi de "evet" olur — uçta yapılacak
hiçbir şey yok.

---

## 6. Yeni kiracıda kendiliğinden var mı? — üç katman ayrı ayrı

Görevin 6. maddesi. Cevap katmana göre değişiyor:

| Katman | Kendiliğinden var mı | Kanıt |
|---|---|---|
| **Kod** (route handler) | ✅ **Evet** | Her kiracı aynı depodan deploy ediliyor; `app/api/mobile/kiraci-sorgu/route.ts` derlemeye dahil, ek adım yok |
| **Şema** (DB) | ✅ **Evet** | Uç yalnız `workers.phone`, `is_active`, `is_admin` okur. Üçü de **migration 001'de**, `db/install/*-full.sql`in ilk tablosunda (`phone text not null unique`). **Migration YOK, kurulum SQL'i değişmedi** — `lint:install-sql` bu yüzden hiç tetiklenmiyor |
| **Env** | ❌ **Hayır** — girilmeli | `KIRACI_SORGU_SECRET`. Aşağıdaki üç net |

Env'in kurulum adımı olması bilinçli bir bedeldi ve **sessiz kalmaması** için üç
ağ örüldü:

1. **Uç fail-closed ve gürültülü.** Env yoksa `503 yapilandirilmadi` — **"hayır"
   değil.** Fark hayati: "hayır" deseydi o kiracının personeli hiçbir yere
   yönlenemez ve arıza **aylar sonra** fark edilirdi (bu depoda bir kez yaşandı:
   `ORDER` listesi 043'te bayatladı, 35 migration eksik kalacaktı). 503, yönlendirme
   servisinin loguna "beni kurmadınız" diye düşer.
2. **`docs/YENI-MUSTERI-KURULUM.md` § 4 zorunlu env tablosuna** eklendi, "aynı
   değeri yönlendirme servisine de girin" notuyla.
3. **§ 8 kabul testine 8. satır** eklendi — tek `curl`, 200 bekleniyor; 503 = env
   yok, 401 = sır iki tarafta farklı.

---

## 7. 🔴 Yönlendirme servisine geçecek maddeler

Bunlar bu ucun **dışında** ama sistemin doğru çalışması onlara bağlı.

### 7.1 İki "evet" mümkün — ÖLÇÜLDÜ, teorik değil

`measure-kiraci-sorgu-kapsam.mjs`, HAK61 ve Sendigo kadrolarını sha256 özetiyle
karşılaştırdı (ham numara hiçbir yere yazılmadan):

```
HAK61 ∩ Sendigo : 2 numara
  özet 92ea741eaf5c — HAK61[aktif=true yönetici=true] · Sendigo[aktif=true yönetici=true]
  özet 8c812552476e — HAK61[aktif=true yönetici=true] · Sendigo[aktif=true yönetici=true]
```

İki numara **iki kiracıda birden aktif yönetici**. Bugün, canlıda.

**Sözleşme:** yönlendirme servisi ilk "evet"te **durmaz**; hepsini paralel sorar,
tüm cevapları toplar ve **eşleşen kiracıların listesini** döner. Uygulama birden
fazlaysa kullanıcıya seçtirir.

Bu, müşteri listesi sızıntısı **değildir**: seçim ekranı yalnız o kişinin
**gerçekten hesabı olan** kiracıları gösterir. Kaldırılan firma seçicinin sorunu,
hesabı olmayan herkese **tüm** listeyi göstermesiydi.

PIN'le ayırmak **mümkün değil ve olmamalı** — PIN bu uca gelmiyor. (Zaten aynı
kişinin iki kiracıda farklı PIN'i olabilir; seçim şart.)

### 7.2 Yayılma paralel, hepsi beklenir

İki bağımsız sebep: (a) 7.1 — iki evet toplanmalı; (b) § 4.4 — sıralı sorup ilk
evette durmak, cevap süresinden kiracı sırasını sızdırır.

### 7.3 Hata durumları "hayır" DEĞİLDİR

Bir kiracı `503`, `401`, zaman aşımı ya da bağlantı hatası döndüyse cevap
**"hayır" değil, "bilinmiyor"**. "Hayır"a çevirmek, arızalı bir kiracının
personelini sessizce sistem dışına atardı. Servis bunları **loglamalı** ve
kullanıcıya "şu an bağlanılamadı" demeli.

### 7.4 Sır ISTEMCIYE GİRMEZ

`KIRACI_SORGU_SECRET` yalnız yönlendirme servisinde (sunucu) yaşar. APK'ya
gömülmez — telefon bu ucu hiç çağırmaz, yönlendirme servisini çağırır.
Yönlendirme servisinin **kendi** kapısı (telefon → servis) ayrı bir konu ve bu
belgenin kapsamı dışında.

### 7.5 🔴 `200` "cevap geldi" DEMEK DEĞİLDİR — ölçüldü

Yayın öncesi üç kiracıya da uç henüz yokken sorduk. Beklenen `404`'tü;
**gelen `200` oldu:**

```
$ curl -s -D - -X POST https://hak-transport-takip.vercel.app/api/mobile/kiraci-sorgu \
       -H 'content-type: application/json' -d '{"telefon":"+436600000042"}'
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
X-Matched-Path: /_not-found          ← rota YOK
<!DOCTYPE html><html … data-tenant="hak61" …
```

Bu uygulama, eşleşmeyen yolda kendi "bulunamadı" **sayfasını** `200` ile
döndürüyor. Yani `res.ok` / `status === 200` denetimi **yalanlanabilir**:
dağıtılmamış, yanlış adresli ya da hiç güncellenmemiş bir kiracı "cevap verdi"
gibi görünür.

**Sözleşme:** yönlendirme servisi bir cevabı ancak şu üçü birden sağlıyorsa
kabul etmeli:

1. `content-type` **`application/json`** — HTML gelirse cevap değil, sayfadır
2. Gövde ayrıştırılabiliyor ve **`ok` alanı var**
3. `var` alanı **boolean**

Üçünden biri tutmuyorsa cevap **"hayır" değil, "bilinmiyor"** (§ 7.3) — ve
loglanmalı: bu, o kiracının dağıtımının geride kaldığının tek işareti.

### 7.6 Kiracı adresleri servis tarafında

Uç yalnız `kod` (kiracı kodu) döner, adres dönmez — adresi zaten servis biliyor
(o çağırdı). `kod`, yanlış eşlenmiş bir kayıt olup olmadığını anlamak için.

---

## 8. Kimlik doğrulama kararı ve gerekçesi

Görevin 2. maddesi: *"kimliksiz mi, yoksa yönlendirme servisi bir sır mı taşıyacak?
Öner, gerekçele. Volkan kimliksizi kabul edilebilir buluyor ama sen ölç ve söyle."*

### Ölçüm: kimliksiz uç tam olarak neyi verir

Uç, **"elimdeki numara → bu firmada mı çalışıyor"** sorusunu 1 istekte cevaplayan
bir doğrulayıcıdır. Sayılarla:

- HAK61'de **32**, Sendigo'da **3** numara "evet" alacak (ölçüldü, § 5).
- **Kaba kuvvet tehdit değil.** Avusturya mobil uzayı ~10⁸–10⁹ aday; 50 küsur
  numarayı taramayla bulmak uygulanabilir değil.
- **Asıl risk hedefli doğrulama** ve hiçbir hız sınırı onu durdurmaz: elinde
  numara olan biri **tek istekle** cevabı alır. Sektörden bir rakip şoför
  numaralarına zaten sahip olur.
- Doğrulanan şey **istihdam ilişkisidir** — GDPR anlamında kişisel veri. Kimliksiz
  bir uçtan üçüncü şahsa açılması, Avusturya'da faaliyet gösteren bir şirket için
  Art. 32 ("uygun teknik önlem") ekseninde savunulması gereken bir konu.

### Bedel karşılaştırması

| | Kimliksiz | **Sır (önerilen)** |
|---|---|---|
| Kurulum bedeli | 0 | kiracı başına 1 env + servise 1 kayıt |
| İstemci güvenliğine etkisi | — | **yok** — sır APK'ya girmez, ucu sunucu çağırır |
| Yayılma modeline etkisi | — | **yok** — merkezî tablo hâlâ yok |
| Herkes numara doğrulayabilir | **evet** | hayır |
| Yeni kiracıda unutulma riski | yok | **var** → 503 + doküman + kabul testi (§ 6) |

**Sırrın bedeli tek bir şey: unutulma riski.** Ve o riskin karşılığı sessiz bir
arıza değil, gürültülü bir 503.

### Öneri

**Sır kullanılsın.** Belirleyici gerekçe: *bu uç istemciden çağrılmıyor.* Sırrın
klasik maliyeti (APK'ya gömülür, sökülür, işe yaramaz hâle gelir) burada **hiç
oluşmuyor** — çağıran taraf zaten Volkan'ın sunucusu. Karşılığında istihdam
ilişkisini doğrulayan açık bir uç ortadan kalkıyor.

**Volkan kimliksizi tercih ederse yol açık ve kararın kendisi kayda geçiyor:**
`KIRACI_SORGU_SECRET=acik`. Kod değişmiyor, dağıtım değişmiyor; sentinel değer
bilerek bir env'e yazılıyor ki "kimliksiz" **sessiz varsayılan değil, verilmiş
bir karar** olsun. Sonradan sıkmak da tek env: değeri gerçek bir sırla değiştirip
aynısını yönlendirme servisine girmek.

⚠️ **`CRON_SECRET` yeniden kullanılmadı.** O sır `/api/cron/saklama` gibi **veri
silen** uçları da açıyor; yönlendirme servisine vermek, bir okuma yetkisi
karşılığında silme yetkisi devretmek olurdu.

---

## 9. Hız sınırı — ne korur, ne korumaz

`lib/rate-limit.ts` (takip ucunun kullandığı kayan pencere), iki eksende:

| Eksen | Tavan | Neden bu sayı |
|---|---|---|
| Numara (**kanonik**) | 20 / 60 sn | Bir kişi giriş denerken numara başına birkaç istek üretir; kilit merdiveni zaten 10 denemede kuruluyor. Anahtar kanonik: `+43660…` ve `+430660…` **aynı kovaya** düşer (`lib/login-lock.ts`teki kilit kimliğiyle aynı mantık) |
| IP | 600 / 60 sn | Meşru çağıran **tek bir servis** — tüm sistemin girişleri aynı IP'den gelir. Dar tavan saldırganı değil müşteriyi keserdi. 600, ölçülen ihtiyacın ~20 katı |

**Dürüst sınır:** sayaç **süreç içidir** — her lambda örneği kendi kovasını tutar
ve soğuk başlangıçta sıfırlanır. **Dağıtık bir taramayı durdurmaz** ve bunu iddia
etmiyoruz. Asıl kapı sırdır; sınırın işi, kaçak tek bir istemcinin (ya da döngüye
girmiş bir yönlendirme servisinin) veritabanını meşgul etmesini kesmek.
`lib/rate-limit.ts` başlığında aynı sınır zaten yazılı.

Sınır kapısı **sırdan sonra** uygulanıyor: yetkisiz bir istemci meşru servisin
kovasını tüketemesin.

---

## 10. Doğrulama — ne koştu, ne çıktı

| Adım | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **başarılı** (§ 11 ESLint notu) |
| `npm run lint:kiraci-sorgu` | **6/6 denetim geçti** |
| Muhafız arıza enjeksiyonu | 6 kasıtlı bozma → **6 denetim de kırıldı**, dosya geri yüklendi |
| `npm run verify:kiraci-sorgu` (HAK61) | **20 denetim**, 34 kayıt × 68 yazım, **0 ayrışma** |
| `verify:kiraci-sorgu` (Sendigo, panel kapalı) | **20 denetim**, 9 kayıt × 18 yazım, **0 ayrışma** |
| Zamanlama ölçümü | n=250/kol, sinyal 2,78 ms < gürültü tabanı 6,81 ms |
| Yazma | **hiç** — tüm ölçüm ve kanıt SELECT |

Canlı kanıtın kapsadığı 20 denetim: env yokken 503 · sır yokken 401 · yanlış sır
401 · `acik` sentineli 200 · gövdede PIN 400 · `password` 400 · telefon yok /
kısa / sayı / bozuk JSON 400 · GET 405 · **her kayıt her yazımla giriş kararıyla
parite** · 4 kayıtsız numara `false` · gövde alanları tam olarak `ok/var/kod` ·
`kod` doğru · `no-store` · `noindex` · numara başına 21. istekte 429 · trunk
yazımı aynı kovada · başka numara etkilenmedi.

### `verifyCredentials` refactoru — davranış değişmedi

İki ayrı ret dalı (`!authed` ve panel kapısı) tek dala indi ve kural
`workerCanSignIn`e taşındı. Doğruluk tablosu birebir aynı:

| `is_active` | `pinOk` | panel | `is_admin` | eski | yeni |
|---|---|---|---|---|---|
| false | – | – | – | ret | ret |
| true | false | – | – | ret | ret |
| true | true | açık | – | **kabul** | **kabul** |
| true | true | kapalı | true | **kabul** | **kabul** |
| true | true | kapalı | false | ret | ret |
| kayıt yok | – | – | – | ret | ret |

Her ret yolunda `registerFailure` **tam bir kez** çağrılıyor (eskiden de öyleydi;
her dal `return` ediyordu). `bcrypt.compare` **her yolda tam bir kez** ve kapıdan
**önce** — dummy-hash zamanlama koruması bozulmadı. Adım sırası korundu.

---

## 11. Açık kalanlar ve riskler

| # | Konu | Durum |
|---|---|---|
| 1 | **galzura-demo ölçülemedi** | service_role anahtarı verilmiyor (karar kayıtlı). Kod ve şema özdeş olduğu için uç orada da çalışır; **kadro sayısı ve çakışma ölçülmedi**. `KIRACI_SORGU_SECRET` oraya da girilmeli |
| 2 | **Yönlendirme servisi yazılmadı** | Bu görevin kapsamı 2. adım. § 7'deki beş madde karşı tarafa geçmeli |
| 3 | **Mobil APK'daki firma seçici hâlâ yerinde** | Kaldırma mobil deponun işi. Uç hazır olsa da liste kalkmadan sızıntı sürüyor |
| 4 | **Env üç kiracıda da BEKLİYOR** | Kod canlı, uç `503 yapilandirilmadi` diyor. Sırlar üretildi ve Volkan'a verildi (**repoya yazılmadı**); Vercel'e girilince § 14'teki curl ile doğrulanacak |
| 5 | **`canonicalPhone` devirgen değil** | § 3. Bugün yalnız Sendigo'nun test hesabını etkiliyor, gerçek personeli değil. Düzeltilecekse `lib/phone.ts`te düzeltilir ve **giriş de** düzelir; ayrı bir iş |
| 6 | **`npm run verify` ESLint tarafı hâlâ kırmızı** | Mevcut duruma ait (CLAUDE.md). Bu dal sayıyı **artırmadı**: 43 problem / 28 hata → **43 problem / 28 hata**, `lint:test-filters` tek bulgusu aynı (`lib/auto-shift.ts:825`). Ölçüm `git stash push -u` ile önce/sonra alındı |

---

## 12. Dosyalar

| Dosya | Ne |
|---|---|
| `app/api/mobile/kiraci-sorgu/route.ts` | Uç. `/api/mobile/*` altında olup `verifyMobileRequest` çağırmayan **tek** uç — gerekçe dosya başlığında |
| `lib/auth-core.ts` | `findWorkerByPhone` (ortak eşleştirme) + `workerCanSignIn` (ortak kimlik kapısı); `verifyCredentials` ikisine bağlandı |
| `scripts/check-kiraci-sorgu.mjs` | Muhafız — 6 denetim, `npm run verify` zincirinde |
| `scripts/verify-kiraci-sorgu.mjs` | Canlı kanıt — 20 denetim, salt okuma |
| `scripts/measure-kiraci-sorgu-zamanlama.mjs` | § 4 ölçümü (sınıf içi gürültü tabanı) |
| `scripts/measure-kiraci-sorgu-kapsam.mjs` | § 3, § 5, § 7 ölçümü (maruziyet · biçim · çakışma) |
| `.env.example` · `docs/YENI-MUSTERI-KURULUM.md` | `KIRACI_SORGU_SECRET` + kabul testi 8. satır |

---

## 13. Yayın kaydı — 01.09.2026

`feat/kiraci-sorgu-ucu` → `main`, **ileri sarma** (fast-forward). Gönderilen iki
commit yalnız bu işe ait; daldaki diğer 28 commit (takograf · yakıt · CO₂ · cron ·
odometre) **zaten `origin/main`de vardı**, yerel `main` referansı bayattı çünkü
başka bir worktree'de checkout'lu duruyor.

```
cde9402..8c14ba0  feat/kiraci-sorgu-ucu -> main
  2432f85 feat(kiraci-sorgu): mobil giris yonlendirmesi icin evet/hayir ucu
  8c14ba0 docs(kiraci-sorgu): olmayan rota 200+HTML donuyor
```

### Öncesi / sonrası

| Denetim | ÖNCE (`cde9402`, canlı) | SONRA (`8c14ba0`) |
|---|---|---|
| `npx tsc --noEmit` | 0 hata | 0 hata |
| `npm run build` | ✓ derlendi | ✓ derlendi · `/api/mobile/kiraci-sorgu` manifest'te |
| 13 muhafız | 12 ✓ · `test-filters` ✗ (1 bulgu, bilinen) | 12 ✓ · `test-filters` ✗ (**aynı** 1 bulgu) |
| `lint:kiraci-sorgu` | — betik yok | ✓ 6/6 |
| ESLint | 43 problem (28 hata, 15 uyarı) | **43 problem (28 hata, 15 uyarı)** |

> ⚠️ İlk `tsc` turu **kirli ölçümdü**: `.next/types/validator.ts` bir önceki
> derlemeden kalmış ve olmayan rotayı arıyordu. `.next` silinip yeniden ölçüldü.
> Ders: sürüm karşılaştırırken `.next` temizlenmeden `tsc` çalıştırılmaz.

### Dağıtım sonrası — SALT OKUMA

**Uç canlı, üç kiracıda da fail-closed** (env henüz yok):

| Kiracı | POST | GET | Başlıklar |
|---|---|---|---|
| HAK61 | `503` `{"ok":false,"hata":"yapilandirilmadi"}` · `application/json` | `405 sadece_post` | `no-store, private` · `noindex, nofollow` |
| Sendigo | aynı | aynı | aynı |
| galzura-demo | aynı | aynı | aynı |

**"Hayır" DEĞİL, "beni kurmadınız"** — tasarımın en önemli maddesi canlıda
doğrulandı (§ 6).

> Not: env girilmeden **PIN'li gövde de `503`** dönüyor, `400` değil. Doğru
> sıra bu: sır kapısı gövde ayrıştırmadan ÖNCE. Env girildikten sonra
> `pin_gonderilmemeli` + `400` görülecek.

**flespi akışı kesilmedi:**

| | HAK61 önce | HAK61 sonra | Sendigo önce | Sendigo sonra |
|---|---|---|---|---|
| Son satırın yaşı | 17 sn | **19 sn** | 67 sn | **123 sn** |
| Yutulma gecikmesi | 5 sn | 6 sn | 25 sn | 50 sn |
| Son 15 dk | 873 satır · 15 araç | **812 satır · 13 araç** | 140 satır · 1 araç | **168 satır · 1 araç** |
| Son 60 dk | 3.808 satır | 3.701 satır | 452 satır | 482 satır |

Sayılardaki oynama REST-poll döngüsünün normal dalgalanması; ikisinde de son
satır dakikalar içinde ve akış sürüyor. (`scripts/measure-yayin-sagligi.mjs`)

---

## 14. ⏳ SIRADAKİ ADIM — env girildikten sonra tek curl

Volkan Vercel'e `KIRACI_SORGU_SECRET`i girip **redeploy** ettikten sonra
(env değişikliği tek başına çalışan dağıtıma yansımaz), her kiracı için:

```bash
SIR='<o kiracının sırrı>'
curl -s -w '
→ HTTP %{http_code} · %{content_type}
'   -X POST https://demo.galzura.com/api/mobile/kiraci-sorgu   -H "authorization: Bearer $SIR"   -H 'content-type: application/json'   -d '{"telefon":"+436600000042"}'
```

**Beklenen:**

```
{"ok":true,"var":false,"kod":"galzura-demo"}
→ HTTP 200 · application/json
```

Bu tek istek **beş şeyi birden** kanıtlar: rota dağıtıldı (JSON döndü) · env
girildi (`503` değil) · sır iki tarafta aynı (`401` değil) · veritabanına
ulaşılıyor (`db_hatasi` değil) · doğru kiracıya bağlanıldı (`kod`).

| Gelen | Anlamı |
|---|---|
| `503 yapilandirilmadi` | env girilmemiş **ya da girilip redeploy edilmemiş** |
| `401 yetkisiz` | sır curl'deki ile Vercel'dekinden farklı |
| `503 db_hatasi` | env var, sır doğru, ama Supabase'e ulaşılamıyor |
| `200` + HTML (`kod` yok) | yanlış adres ya da dağıtım geride (§ 7.5) |
| `"kod"` beklenenden başka | yanlış kiracıya bakılıyor |

**Tam kanıt için** `+436600000042` yerine o kiracıda **kayıtlı bir yönetici
numarası** yazın; beklenen `"var":true`. Yalnız `false` yolu, sorgunun doğru
Supabase projesine gittiğini kanıtlamaz — kayıt bulan bir istek kanıtlar.

⚠️ Sır komut satırında geçiyor: `SIR` değişkenini kullanın ve iş bitince kabuk
geçmişini temizleyin (`history -d`).

---

## 15. Kabul testi — 01.09.2026, env girildikten sonra

`npm run verify:kiraci-sorgu-canli` · **salt okuma, hiçbir yazma yok.**
Sırlar depo dışındaki bir dosyadan okunur; betikte ve komut satırında sır yoktur.

### Sonuç tablosu

| # | Durum | HAK61 | Sendigo | galzura-demo |
|---|---|---|---|---|
| 1 | doğru sır · **kayıtsız** numara | 🔴 `503 yapilandirilmadi` | ✅ `200` `{"ok":true,"var":false,"kod":"sendigo"}` | ✅ `200` `{"ok":true,"var":false,"kod":"galzura-demo"}` |
| 2 | doğru sır · **KAYITLI** numara → `var:true` | 🔴 ölçülemedi | ✅ `200` `var:true` · 1. denemede | ✅ `200` `var:true` · 1. denemede |
| 3 | **yanlış** sır | 🔴 ölçülemedi | ✅ `401 yetkisiz` | ✅ `401 yetkisiz` |
| 4 | sır **yok** | 🔴 ölçülemedi | ✅ `401 yetkisiz` | ✅ `401 yetkisiz` |
| 5 | gövdede **PIN** | 🔴 ölçülemedi | ✅ `400 pin_gonderilmemeli` | ✅ `400 pin_gonderilmemeli` |

**Çapraz sır** (bir kiracının sırrı başkasında geçmemeli):

| Kimin sırrı | Nereye | Sonuç |
|---|---|---|
| HAK61 | Sendigo | ✅ `401 yetkisiz` |
| HAK61 | galzura-demo | ✅ `401 yetkisiz` |
| Sendigo | HAK61 | ⏳ **ÖLÇÜLEMEDİ** — hedefte env yok |
| galzura-demo | HAK61 | ⏳ **ÖLÇÜLEMEDİ** — hedefte env yok |

> ⚠️ İlk turda betik bu iki `503`'ü "SIRLAR KARIŞIYOR" diye **bulgu sandı**.
> Yanlış: env'i olmayan kiracı sırra **hiç bakmadan** çıkar, yani çapraz sızıntı
> ne kanıtlanır ne çürütülür — sonuç ÖLÇÜLEMEDİ'dir. Betik düzeltildi; kendi
> ölçemediğini bulgu sanan bir test, bulgusuz bir testten daha zararlıdır.

**Toplam: 12/17 geçti · 2 ölçülemedi · 5 bulgu — hepsi tek bir kök nedenden.**

### 🔴 HAK61: env VAR, redeploy YOK

Dışarıdan `503` üç şeye birden benzer (env yok / yanlış kapsam / redeploy yok).
Vercel CLI ile — **salt okuma** — ayrıştırıldı:

```
$ vercel env ls production          # yalnız ADLAR, değerler "Hidden"
  KIRACI_SORGU_SECRET   Hidden   Sensitive   Production   9m ago     ← VAR

$ vercel ls hak-transport-takip     # en yeni Production dağıtımı
  2h   …-5tsv6uyzw-…   ● Ready   Production                          ← 2 SAAT ÖNCE
```

Env **9 dakika** önce eklendi; canlı dağıtım **2 saat** önce (benim push'umdan).
Yani env eklendikten sonra **hiç dağıtım olmadı**. Kıyas iki kiracıda net:

| Kiracı | En yeni Production dağıtımı | Env eklenmesi | Sonuç |
|---|---|---|---|
| Sendigo | **9 dk** önce | 9 dk | ✅ çalışıyor |
| galzura-demo | **8 dk** önce | ~9 dk | ✅ çalışıyor |
| **HAK61** | **2 saat** önce | 9 dk | 🔴 `503` |

**Çözüm:** HAK61 projesinde Vercel → Deployments → en son üretim dağıtımı →
**Redeploy**. Kod değişikliği gerekmiyor; yeni bir push da gerekmiyor.

> ⚠️ Ben bir ara "HAK61 redeploy edildi, `dpl_` kimliği değişti" demiştim —
> **yanlıştı.** Kimlik benim push'um yüzünden değişmişti; ölçüm push ÖNCESİ bir
> değerle push SONRASI bir değeri karşılaştırıyordu. Dağıtım YAŞI doğru ölçüttü,
> kimlik değişimi değil.

### Redeploy sonrası koşulacak

```bash
npm run verify:kiraci-sorgu-canli     # SIRLAR_ENV ile
```

Beklenen: **17/17**, ölçülemeyen yok.

---

## 16. Çoklu "evet" — canlı uçlarla yeniden ölçüldü

§ 7.1'deki ölçüm iki veritabanını karşılaştırıyordu ve galzura-demo'yu
**kapsayamıyordu** (anahtarı yok). Uç canlıya çıkınca demo da ölçülebilir hâle
geldi: numara **ucun kendisine** sorulur — yönlendirme servisinin göreceğinin
birebir aynısı. (`scripts/measure-kiraci-sorgu-caprazlama.mjs`)

| Numara (maskeli) | Rol | HAK61 | Sendigo | galzura-demo | "evet" |
|---|---|---|---|---|---|
| `+90…` | yönetici | ⏳ 503 | **EVET** | **EVET** | **2+?** |
| `+43…` | yönetici | ⏳ 503 | **EVET** | **EVET** | **2+?** |
| `+43…` ×2 | yönetici | ⏳ 503 | hayır | hayır | 0+? |
| `+43…` ×3 | şoför | ⏳ 503 | hayır | hayır | 0+? |

**İki numara üç kiracıdan ikisinde birden hesaba sahip** — HAK61 düzelince
büyük olasılıkla **üç**. § 7.1'de "iki kiracı" olan bulgu, aslında **üç
kurulumun tamamına** yayılıyor.

Şoförlerin hiçbiri başka kiracıda çıkmıyor: izolasyon doğru çalışıyor, çakışma
yalnız **birden çok kurulumu yöneten kişide**.

► Bu, § 7.1/7.2'deki sözleşmeyi zorunlu kılar: **paralel sor, hepsini bekle,
birden fazla eşleşme varsa kullanıcıya seçtir.** İlk "evet"te durmak, o iki
kişiyi rastgele bir kiracıya gönderirdi.
