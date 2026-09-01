# Yönlendirme servisi — `POST /api/kiraci-bul`

**Durum:** ✅ **DEPO AÇILDI, KOD YAZILDI, VERCEL PROJESİ KURULDU** (§ 10).
Depo: `volkancatak1309-max/galzura-kiraci-bul` (private) · yerelde
`Desktop/business/galzura-kiraci-bul`.
🔴 **PUSH ve DEPLOY YOK** — commit'ler yerelde bekliyor.
⏳ Kalan iki iş Volkan'da: Cloudflare DNS kaydı ve Vercel env'leri (§ 11).
**Ölçüm tarihi:** 01.09.2026 · canlı uçlar + Vercel CLI, **salt okuma**.
**Karşı taraf:** [`KIRACI-SORGU-UCU.md`](KIRACI-SORGU-UCU.md) — kiracı panelindeki
uç, üç kiracıda da canlı ve kabul testi **19/19**.

---

## 0. Bir bakışta

| Soru | Cevap |
|---|---|
| **Hangi depo?** | Bu depo DEĞİL. Ölçüldü: `galzura.com` → `galzura-software`, **Git'e bağlı değil**, CLI ile atılmış statik site (§ 1) |
| **Ne yapıldı** | ✅ Ayrı private depo `galzura-kiraci-bul` + ayrı Vercel projesi + Git bağlantısı kuruldu (§ 10). Push/deploy YOK |
| Girdi | `{"telefon":"+43…"}` — PIN **yok**, gövdede gelirse 400 |
| Çıktı | Yalnız o numaranın **kendi** kiracıları: `kod` + `ad` + `adres`; eşleşme yoksa **boş liste** |
| Sorgu biçimi | Üç kiracıya **paralel**, `Promise.allSettled`, **hepsi beklenir** |
| Zaman aşımı | **2500 ms/kiracı** — ölçülen en kötü toplamın ~3,8 katı (§ 5) |
| Kiracı kayıt defteri | **Dosya** (kod+ad+adres) + **env** (yalnız sır); ikisi muhafızla eşlenir (§ 4) |
| Uygulama kimliği | Anahtar var ama **güvenlik sınırı değil** — dürüst gerekçe § 3'te |
| Sızıntı kapanışı | Kiracı listesi ve sırlar **serviste**; APK'da kalan tek şey servis adresi |

---

## 1. 🔴 Servis nerede yaşayacak — ölçüm

### 1.1 `galzura.com` bugün ne?

| Ölçüm | Sonuç | Nasıl |
|---|---|---|
| Alan adı sahipliği | `galzura.com` + `www.galzura.com` → **Vercel projesi `galzura-software`** | `vercel domains inspect galzura.com` |
| DNS | Cloudflare (`celine/louis.ns.cloudflare.com`), site Cloudflare arkasından servis ediliyor | `curl -D -` → `Server: cloudflare` + `x-vercel-id` |
| Kök | `galzura.com` → `307` → `www.galzura.com` → `200 text/html` | curl |
| Sayfa kimliği | `<title>Galzura Software Company — Vienna, Austria</title>` | curl |
| **Git bağlantısı** | **YOK** | `vercel project inspect galzura-software` → git bölümü boş |
| Dağıtım | Tek üretim dağıtımı, **43 gün önce**, süre **5 sn** | `vercel ls galzura-software` |
| Çatı ayarı | Framework Preset **"Other"**, çıktı dizini `public` | `vercel project inspect` |
| `/api/kiraci-bul` | **405** (JSON değil) — sunucu fonksiyonu yok | curl POST |

**Sonuç: `galzura.com` bugün CLI ile atılmış, Git'e bağlı olmayan statik bir
site.** Sunucu tarafı yok.

### 1.2 Yerelde hangi klasör?

`C:\Users\90553\galzura-com-v4` — `galzura-com-v4.git` uzak deposuna bağlı,
içinde `site/` (Next.js: `app/`, `next.config.ts`, `proxy.ts`, i18n).

⚠️ Ama **bunun canlı sitenin kaynağı olduğu doğrulanamadı**, üç ölçümle:

1. Canlı başlıktaki `Galzura Software Company` dizesi bu depoda **bulunamadı**.
2. Çalışma ağacı **yarım**: `site/app/layout.tsx` ve `site/app/page.tsx`
   **silinmiş** durumda (`git status` → ` D`). Yani depo bir **yeniden tasarımın
   ortasında.**
3. Vercel projesi "Other + `public`" ayarında; bu bir Next.js uygulamasının
   ayarı **değil**.

Yani `galzura-com-v4` muhtemelen galzura.com'un **yeni sürümü**, canlıdaki
sürümün kaynağı değil. Tahmin etmiyorum — **canlı sitenin kaynağı bu makinede
kesin olarak tespit edilemedi.**

### 1.3 Önerim: ayrı depo, ayrı proje, alt alan adı

Servisi `galzura-software` projesine **koymayı önermiyorum.** Beş gerekçe,
hepsi yukarıdaki ölçümden:

1. **Sır yalıtımı.** Servis üç kiracının sırrını taşıyacak. Bunları pazarlama
   sitesinin projesine koymak, o projenin **her preview dağıtımını** sırlara
   erişebilir hâle getirir — ve o depo şu anda aktif yeniden tasarımda.
2. **Patlama yarıçapı.** Pazarlama sitesinin bozuk bir dağıtımı, **üç kiracının
   mobil girişini birden** düşürür. İki iş, iki risk profili.
3. **Ritim uyuşmuyor.** Pazarlama sitesi 43 gündür dağıtılmamış, sonra bir
   redesign inecek. Giriş yolu ise oynamamalı.
4. **Git yok = muhafız yok.** CLI ile atılan statik bir sitede ne inceleme, ne
   CI, ne muhafız betiği olur. Kiracı ucunda işe yarayan tam olarak buydu
   (`check-kiraci-sorgu.mjs`, altı denetim, arıza enjeksiyonuyla sınandı).
5. **Cloudflare yüzeyi.** Gecikme sorunu ÖLÇÜLMEDİ — Cloudflare arkasından
   199–485 ms, doğrudan Vercel 311–974 ms; yani **Cloudflare yavaşlatmıyor.**
   Endişe hız değil **yapılandırma yüzeyi**: pazarlama sitesine konacak bir
   "Cache Everything" kuralı, giriş yönlendirmesini sessizce önbelleğe alır.
   Ayrı bir alt alan adı bu riski ayırır.

**Somut öneri:**

| Ne | Değer |
|---|---|
| Yeni depo | `galzura-kiraci-servisi` (GitHub, `volkancatak1309-max`) |
| Yeni Vercel projesi | `galzura-kiraci-servisi`, Git'e **bağlı** |
| Alan adı | `kiraci.galzura.com` (Cloudflare'da **proxy KAPALI** ya da `/api/*` için cache bypass) |
| Bölge | `fra1` (§ 5.3) |

> Aynı alan adında ısrar edilirse `www.galzura.com/api/kiraci-bul` da olur — ama
> o zaman `galzura-software` önce **Git'e bağlanmalı**, yoksa muhafız ve inceleme
> hiç kurulamaz.

> ✅ **UYGULANDI (01.09.2026).** Depo `galzura-kiraci-bul` adıyla açıldı ve
> Vercel projesi kuruldu — ayrıntı ve kurulum kaydı § 10'da. § 7'deki referans
> uygulama gerçek koda çevrildi; adres olarak `kiraci.galzura.com` hedefleniyor
> ve DNS kaydı § 11.1'de bekliyor.

---

## 2. Uç sözleşmesi

### İstek

```http
POST /api/kiraci-bul
X-Galzura-App: <uygulama anahtarı>
Content-Type: application/json

{"telefon": "+436601113783"}
```

### Cevap

```json
{
  "ok": true,
  "kiracilar": [
    { "kod": "hak61",   "ad": "HAK61 Transport", "adres": "https://hak-transport-takip.vercel.app" },
    { "kod": "sendigo", "ad": "Sendigo GmbH",    "adres": "https://sendigo-delta.vercel.app" }
  ],
  "tam": true
}
```

| Alan | Anlamı |
|---|---|
| `kiracilar` | **Yalnız bu numaranın hesabı olan** kiracılar. Hiç yoksa `[]` |
| `kod` · `ad` · `adres` | Uygulamanın giriş ekranını çizip PIN'i göndereceği adres |
| `tam` | `false` ise **en az bir kiracıya ulaşılamadı** — liste EKSİK olabilir |

**🔴 `tam` alanı neden sayı/isim değil boolean:** "hangi kiracıya ulaşılamadı"
bilgisi kiracı KODU demektir ve onu uygulamaya vermek, kaldırdığımız listeyi
parça parça geri sızdırır. Uygulamanın ihtiyacı yalnız "cevabım eksik olabilir
mi" — o da tek bit.

**`tam:false` + boş liste durumunda uygulama "kayıtlı değilsiniz" DEMEZ**,
"şu an bağlanılamadı, tekrar deneyin" der. Kural 4'ün asıl karşılığı budur.

| Durum | HTTP | Gövde |
|---|---|---|
| Cevap üretildi | 200 | `{"ok":true,"kiracilar":[…],"tam":true\|false}` |
| Gövde JSON değil | 400 | `{"ok":false,"hata":"gecersiz_govde"}` |
| **PIN gönderildi** | 400 | `{"ok":false,"hata":"pin_gonderilmemeli"}` |
| Telefon eksik/biçimsiz | 400 | `{"ok":false,"hata":"telefon_bicimsiz"}` |
| Uygulama anahtarı yok/yanlış | 401 | `{"ok":false,"hata":"yetkisiz"}` |
| Hız sınırı | 429 | `{"ok":false,"hata":"cok_fazla_istek"}` + `Retry-After` |
| GET | 405 | `{"ok":false,"hata":"sadece_post"}` |
| Kayıt defteri bozuk | 503 | `{"ok":false,"hata":"yapilandirilmadi"}` |

`cache-control: no-store, private` + `x-robots-tag: noindex, nofollow` her cevapta.

---

## 3. Uygulama → servis kimliği

### Dürüst tespit önce

Kiracı ucunda sır işe yaradı çünkü **onu istemci çağırmıyor** — sunucu çağırıyor.
Burada durum tersine döner: **bu servisi telefonun kendisi çağıracak.** APK'ya
konan hiçbir şey sır değildir; sökülür.

Yani: **yönlendirme servisi, kiracı uçlarından zorunlu olarak DAHA ZAYIF bir
sınırdır.** Bunu yazıyorum çünkü tersini iddia eden bir tasarım, olmayan bir
güvenliğe yaslanır.

### Peki ne kazanıyoruz — bu gerçek

Kaldırılan sızıntı **müşteri listesiydi**: APK'yı açan herkes Galzura'nın tüm
müşterilerini **döküyordu**. Yeni durumda:

| | Eski (gömülü liste) | Yeni (yönlendirme servisi) |
|---|---|---|
| Listeyi dökme | ✅ tek dosya okumasıyla | ❌ **imkânsız** — liste hiç gönderilmiyor |
| Elindeki numarayı sorgulama | — | ⚠️ mümkün (anahtar sökülürse) |
| Kiracı sırları | — | ❌ hiç istemciye girmiyor |

Kazanç **döküm ile sorgulama arasındaki fark**: rakip artık "Galzura'nın
müşterileri kimler" diye soramaz, yalnız "elimdeki şu numara onlardan birinde mi"
diye sorabilir — ve bunun için önce numarayı bulmuş olması gerekir.

### Öneri: üç katman, ilkine güvenmeden

1. **`X-Galzura-App: <anahtar>`** — APK'da duran, `GALZURA_APP_KEY` env'iyle
   karşılaştırılan bir anahtar. **Güvenlik sınırı DEĞİL**, üç işi var:
   sıradan bir betiği durdurur, hız sınırına kimlik verir, sızarsa
   **döndürülebilir** (uygulama güncellemesiyle).
2. **Hız sınırı** — asıl uygulanabilir engel. Üç eksen: uygulama anahtarı, IP,
   telefon (§ 7'de).
3. **Çıktının azlığı** — listeleme ucu YOK; ancak hesabı olan bir numara kendi
   kiracılarını görür. Rastgele numara → `[]`, kiracı adı bile geçmez.

**Sonraki adım (şimdi değil):** Play Integrity / App Attest. Gerçek çözüm odur —
cihazın gerçekten senin uygulaman olduğunu kanıtlar. Kurulumu Google/Apple
tarafında iş ister; bugünkü kapsamın dışında ama yol haritasına yazılsın.

⚠️ **Anahtar APK'da olduğu için `KIRACI_SIR_*` sırları ONDAN TAMAMEN AYRI durur.**
Uygulama anahtarı sızsa bile kiracı sırları etkilenmez; saldırgan servisi
kullanabilir ama kiracı uçlarına doğrudan soramaz.

---

## 4. Kiracı kayıt defteri — dosya + env, ikisi birden

Soru: *"Yeni kiracı eklenince nereye yazılacak — env mi, dosya mı? Unutulursa o
kiracının personeli giremez, bunu zorlaştır."*

### Neden ikisi birden

| | Yalnız env | Yalnız dosya | **Karma (öneri)** |
|---|---|---|---|
| Sır tutabilir | ✅ | ❌ asla | ✅ (yalnız sır env'de) |
| İncelenebilir/diff'lenebilir | ❌ | ✅ | ✅ |
| Muhafız denetleyebilir | ❌ görünmez | ✅ | ✅ |
| Unutmak sessiz mi | 🔴 **sessiz** | — | ❌ **gürültülü** |

**Karar: kiracının `kod` + `ad` + `adres` bilgisi DEPODA bir dosyada; yalnız
`sir` env'de.**

### Unutmayı zorlaştıran üç kilit

```ts
// kiracilar.ts — kayıt defteri (sır YOK)
export const KIRACILAR = [
  { kod: "hak61",        ad: "HAK61 Transport", adres: "https://hak-transport-takip.vercel.app" },
  { kod: "sendigo",      ad: "Sendigo GmbH",    adres: "https://sendigo-delta.vercel.app" },
  { kod: "galzura-demo", ad: "Galzura Fleet",   adres: "https://demo.galzura.com" },
] as const;

// SIRLAR — her satır DÜZ LİTERAL, dinamik erişim YOK (aşağıdaki uyarı).
export const SIRLAR: Record<string, string | undefined> = {
  "hak61":        process.env.KIRACI_SIR_HAK61,
  "sendigo":      process.env.KIRACI_SIR_SENDIGO,
  "galzura-demo": process.env.KIRACI_SIR_GALZURA_DEMO,
};
```

**Kilit 1 — muhafız (`check-kiracilar.mjs`, `npm run verify` zincirinde):**
`KIRACILAR`ın kodları ile `SIRLAR`ın anahtarları **birebir aynı küme** olmalı.
Kiracıyı deftere yazıp sır satırını unutmak derlemeyi değil **muhafızı** kırar,
yani dağıtımdan önce.

**Kilit 2 — açılışta fail-closed:** sırrı boş olan bir kiracı varsa uç
`503 yapilandirilmadi` döner ve **hangi kiracı** olduğunu **sunucu loguna** yazar
(gövdeye değil — § 2'deki `tam` gerekçesi). Yani env unutulursa servis "o kiracı
yok" demez, "beni kurmadınız" der.

**Kilit 3 — sağlık ucu:** `GET /api/kiraci-bul/saglik` (uygulama anahtarı ister)
her kiracıya kayıtsız bir numarayla sorar ve **kiracı başına** durum döner.
Kabul testine ve haftalık bir kontrole bağlanır; bir kiracının dağıtımı geride
kalırsa burada görünür — kullanıcı şikâyet etmeden.

> ⚠️ **`process.env[degisken]` YASAK.** Bu depoda ölçülmüş bir tuzak
> ([`tenant-env-istemci-tuzagi`], 03.08.2026): Next/Turbopack yalnız DÜZ
> LİTERAL `process.env.X` erişimini derleme anında değiştirir; dinamik erişim
> istemcide `undefined` kalır ve ayar sessizce varsayılana düşer. Burası sunucu
> olduğu için dinamik erişim teknik olarak çalışırdı — ama desen kopyalanır.
> Literal yazmanın ikinci faydası daha büyük: **yeni kiracı eklerken bu dosyaya
> dokunmak ZORUNDA kalırsın.**

### Yeni kiracı ekleme adımları (dokümante edilecek sıra)

1. `kiracilar.ts` → `KIRACILAR`a satır ekle.
2. Aynı dosya → `SIRLAR`a `process.env.KIRACI_SIR_<KOD>` satırı ekle.
3. Kiracı panelinde `KIRACI_SORGU_SECRET` üret + gir + **redeploy**
   (⚠️ redeploy şart — [`KIRACI-SORGU-UCU.md`](KIRACI-SORGU-UCU.md) § 15).
4. Servis projesinde `KIRACI_SIR_<KOD>` gir + **redeploy**.
5. `GET /api/kiraci-bul/saglik` → o kiracı `hazir` görünmeli.

---

## 5. Zaman aşımı — ölçüldü

### 5.1 Ham ölçüm

`scripts/measure-kiraci-sorgu-gecikme.mjs` · n=40/yol/kiracı · **ev
internetinden** (yani gerçek servisin göreceğinden **kötü** bir noktadan):

| Kiracı | Yol | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| HAK61 | 401 (sır kapısı, DB yok) | 98 | 108 | 199 | 301 | 337 |
| HAK61 | 200 (+1 Supabase sorgusu) | 129 | 147 | 168 | 247 | **269** |
| Sendigo | 401 | 71 | 88 | 114 | 207 | 282 |
| Sendigo | 200 | 109 | 205 | 309 | 406 | **656** |
| galzura-demo | 401 | 75 | 101 | 262 | 325 | 349 |
| galzura-demo | 200 | 108 | 154 | 210 | 224 | **254** |

### 5.2 Ayrıştırma — ağ mı, kiracı mı?

401 yolu sır kapısında çıkar (**DB yok**), 200 yolu üstüne bir Supabase sorgusu
bindirir. Fark = kiracının **kendi işi**, ağdan bağımsız:

| Kiracı | p50 farkı | p95 farkı | max farkı |
|---|---|---|---|
| HAK61 | **31 ms** | −31 ms | −68 ms |
| Sendigo | **38 ms** | 195 ms | 374 ms |
| galzura-demo | **33 ms** | 33 ms | −94 ms |

**Supabase sorgusu ~31–38 ms.** Negatif p95/max farkları, kuyruğun DB değil
**ağ ve soğuk başlangıç** kaynaklı olduğunu gösteriyor: iki yolun kuyrukları
bağımsız örnekler ve birbirini geçebiliyor.

### 5.3 Bölge

`x-vercel-id` ile ölçüldü — **kiracıların fonksiyonları aynı bölgede değil:**

| Kiracı | Fonksiyon bölgesi | Supabase |
|---|---|---|
| HAK61 | **`dub1`** (Dublin) | eu-west-1 |
| Sendigo | `fra1` (Frankfurt) | eu-central-1 |
| galzura-demo | `fra1` (Frankfurt) | eu-central-1 |

(Aynı tespit [`VERCEL-BOLGE.md`](VERCEL-BOLGE.md)'de de kayıtlı.) Servis üçüyle
birden aynı bölgede olamaz. **`fra1` seçilsin** — üçte ikisi orada, HAK61'e
Frankfurt↔Dublin ~20–30 ms ek biner ve bu, 2500 ms'lik bütçenin yanında önemsiz.

### 5.4 Karar: **2500 ms / kiracı**

| Gerekçe | Sayı |
|---|---|
| Ölçülen en kötü toplam (ev interneti dahil) | 656 ms |
| Seçilen zaman aşımı | **2500 ms** → ~3,8× marj |
| Sağlıklı üç kiracıyla tipik toplam (paralel) | ~150 ms |
| En kötü kullanıcı beklemesi (bir kiracı ölü) | 2500 ms |

⚠️ **Dürüst sınır: soğuk başlangıç AYRIŞTIRILMADI.** Ölçüm ardışık isteklerle
yapıldı, yani fonksiyonlar büyük ölçüde sıcaktı. 656 ms'lik en kötü değer bir
soğuk başlangıç içeriyor **olabilir** ama bu kanıtlanmadı. 2500 ms'lik marjın
asıl gerekçesi budur; ölçüm ilerledikçe daraltılabilir.

**Yeniden deneme (retry) YOK.** Üç sebep: (a) en kötü süreyi ikiye katlar,
(b) "bilinmiyor" zaten güvenli bir cevap ve uygulama "tekrar dene" diyebilir,
(c) kullanıcı bir kez daha denediğinde zaten yeni bir tur oluyor.

---

## 6. Yedi zorunlu kural → koda nasıl döndü

| # | Kural | Koddaki karşılığı | Muhafız |
|---|---|---|---|
| 1 | Paralel sor, hepsini bekle | `Promise.allSettled(KIRACILAR.map(…))` — `race` yok, döngü içinde `return` yok | K2 |
| 2 | Süre sabit | Hepsi beklendiği için toplam = **en yavaş kiracı**; hangi kiracının "evet" dediğinden **bağımsız**. Yapay taban gerekmiyor (§ 6.1) | K2 |
| 3 | `200`'e güvenme | `content-type` **application/json** + gövde ayrıştırılabiliyor + `typeof var === "boolean"` — üçü birden | K6 |
| 4 | Hata/timeout = bilinmiyor | `allSettled` reddi, zaman aşımı, JSON değil, `401/503` → `bilinmiyor`; **asla `false`** | K6 |
| 5 | Liste ve sırlar serviste | `kiracilar.ts` + `KIRACI_SIR_*` env — istemciye hiç gitmez | K1 |
| 6 | Yalnız kendi kiracıları | Yanıt yalnız `var === true` olanlardan kurulur; hiç yoksa `[]` | K3 |
| 7 | PIN hiç gelmez | `pin`/`sifre`/`password` alanı varsa **400**, gövde daha ileri işlenmez | K4 |

### 6.1 Kural 2 — neden yapay taban gerekmiyor

Sızacak bilgi "kaçıncı kiracı cevapladı"ydı ve kaynağı **erken çıkıştı**.
`allSettled` ile toplam süre `max(kiracılar)` olur; bu değer, cevabın
`true`/`false` dağılımından **bağımsızdır**. Kiracı ucunda ayrıca ölçülmüştü:
"bulundu" ile "bulunamadı" arasındaki fark 2,78 ms, düzeneğin kendi gürültü
tabanı 6,81 ms — yani sinyal tabanın altında
([`KIRACI-SORGU-UCU.md`](KIRACI-SORGU-UCU.md) § 4).

**Kalan tek gözlem:** bir kiracı ölüyse toplam süre 2500 ms'e fırlar ve dışarıdan
"bir kiracı arızalı" anlaşılır. Bu, kiracı **kimliğini** değil **sağlığını**
sızdırır; kabul edilebilir ve `tam:false` zaten aynı şeyi açıkça söylüyor.

---

## 7. Referans uygulama

> 🔴 Aşağıdaki dosyalar **hiçbir depoya yazılmadı.** Hedef depo açılınca
> olduğu gibi taşınacak. Yollar yeni depoya göredir.

### `lib/kiracilar.ts`

```ts
import "server-only";

/**
 * KİRACI KAYIT DEFTERİ — kod + ad + adres. SIR YOK.
 *
 * Bu dosya depoda durur ve incelenebilir: yeni kiracı eklemek bir KOD
 * değişikliğidir, görünür ve geri alınabilir. Sırlar env'dedir ve buraya asla
 * yazılmaz.
 *
 * ⚠️ `adres` sonunda / OLMAZ — istek `${adres}/api/mobile/kiraci-sorgu`.
 */
export type Kiraci = { kod: string; ad: string; adres: string };

export const KIRACILAR: readonly Kiraci[] = [
  { kod: "hak61",        ad: "HAK61 Transport", adres: "https://hak-transport-takip.vercel.app" },
  { kod: "sendigo",      ad: "Sendigo GmbH",    adres: "https://sendigo-delta.vercel.app" },
  { kod: "galzura-demo", ad: "Galzura Fleet",   adres: "https://demo.galzura.com" },
];

/**
 * KİRACI SIRLARI — her satır DÜZ LİTERAL.
 *
 * ⚠️ `process.env[kod]` gibi DİNAMİK erişim YASAK. Teknik sebep: Next yalnız
 * literali derleme anında değiştirir, dinamik erişim istemcide `undefined`
 * kalır (bu desen HAK61'de bir kez sessizce üretime kaçtı). Asıl sebep ise
 * tasarım: literal yazmak, yeni kiracı eklerken bu dosyaya DOKUNMAYI zorunlu
 * kılar — ve muhafız iki listenin eşitliğini denetler.
 */
export const SIRLAR: Record<string, string | undefined> = {
  "hak61":        process.env.KIRACI_SIR_HAK61,
  "sendigo":      process.env.KIRACI_SIR_SENDIGO,
  "galzura-demo": process.env.KIRACI_SIR_GALZURA_DEMO,
};

/** Sırrı girilmemiş kiracılar. Boş değilse uç fail-closed davranır. */
export function eksikSirlar(): string[] {
  return KIRACILAR.filter((k) => !SIRLAR[k.kod]?.trim()).map((k) => k.kod);
}
```

### `app/api/kiraci-bul/route.ts`

```ts
import type { NextRequest } from "next/server";
import { KIRACILAR, SIRLAR, eksikSirlar } from "@/lib/kiracilar";
import { sinirDenetle } from "@/lib/rate-limit";
import { safeEqual } from "@/lib/secure-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "fra1"; // üç kiracının ikisi fra1 (bkz. § 5.3)
export const maxDuration = 10;

/**
 * POST /api/kiraci-bul — "bu numaranın hesabı hangi kiracılarda?"
 *
 * Mobil uygulama telefon+PIN alır, ÖNCE buraya telefonu sorar, dönen adrese
 * PIN'i gönderir. Kiracı listesi ve kiracı sırları BURADA durur; APK'da yalnız
 * bu servisin adresi vardır — kaldırılan sızıntı tam olarak budur.
 *
 * ⚠️ PIN BURAYA GELMEZ. Yayılma modelinde PIN, kişinin üye OLMADIĞI kiracılara
 * da ulaşırdı; ayrıca bu servis PIN'i doğrulamaz, doğrulayan kiracının kendi
 * /api/mobile/auth/login ucudur.
 */

/** Kiracı başına zaman aşımı — ölçüldü, bkz. docs § 5.4. */
const ZAMAN_ASIMI_MS = 2500;

const APP_TAVAN = 1200;   // uygulama anahtarı başına / dk
const IP_TAVAN = 120;     // IP başına / dk
const TEL_TAVAN = 20;     // telefon başına / dk — kiracı ucuyla aynı
const PENCERE_SN = 60;

const BASLIKLAR = {
  "cache-control": "no-store, private",
  "x-robots-tag": "noindex, nofollow",
} as const;

const cevap = (g: Record<string, unknown>, s = 200, ek?: Record<string, string>) =>
  Response.json(g, { status: s, headers: { ...BASLIKLAR, ...ek } });
const hata = (s: number, k: string, ek?: Record<string, string>) =>
  cevap({ ok: false, hata: k }, s, ek);

function istemciIp(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  return xff ? xff.split(",")[0]!.trim() : h.get("x-real-ip")?.trim() || "bilinmiyor";
}

/** Tek kiracıya sorar. ASLA fırlatmaz — üç sonuçtan birini döner. */
type Sonuc = { durum: "evet" } | { durum: "hayir" } | { durum: "bilinmiyor"; sebep: string };

async function kiraciyaSor(k: (typeof KIRACILAR)[number], telefon: string): Promise<Sonuc> {
  const sir = SIRLAR[k.kod];
  if (!sir) return { durum: "bilinmiyor", sebep: "sir_yok" };
  try {
    const res = await fetch(`${k.adres}/api/mobile/kiraci-sorgu`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sir}` },
      body: JSON.stringify({ telefon }),
      signal: AbortSignal.timeout(ZAMAN_ASIMI_MS),
      cache: "no-store",
    });

    // 🔴 status === 200 YETMEZ. Ölçüldü (docs § 7.5): kiracı panelleri OLMAYAN
    // bir yola 200 + HTML döndürüyor (`x-matched-path: /_not-found`). Yani
    // dağıtımı geride kalmış bir kiracı "cevap verdi" gibi görünür. Üç şey
    // birden aranır: JSON içerik tipi, ayrıştırılabilir gövde, boolean `var`.
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return { durum: "bilinmiyor", sebep: `json_degil_${res.status}` };
    }
    let govde: unknown;
    try {
      govde = await res.json();
    } catch {
      return { durum: "bilinmiyor", sebep: "govde_bozuk" };
    }
    const g = govde as { ok?: unknown; var?: unknown; hata?: unknown };
    if (res.status !== 200 || g.ok !== true || typeof g.var !== "boolean") {
      return { durum: "bilinmiyor", sebep: `beklenmedik_${res.status}_${String(g.hata ?? "")}` };
    }
    return g.var ? { durum: "evet" } : { durum: "hayir" };
  } catch (e) {
    // Zaman aşımı, DNS, TLS, bağlantı reddi — hepsi BİLİNMİYOR.
    // "hayır"a çevirmek, arızalı bir kiracının personelini sessizce sistem
    // dışına atardı.
    const ad = e instanceof Error ? e.name : "hata";
    return { durum: "bilinmiyor", sebep: ad === "TimeoutError" ? "zaman_asimi" : `ag_${ad}` };
  }
}

export async function POST(req: NextRequest) {
  // ── Kayıt defteri sağlam mı (fail-closed, GÜRÜLTÜLÜ) ────────────────────
  const eksik = eksikSirlar();
  if (eksik.length > 0) {
    // Hangi kiracı olduğu LOGA yazılır, gövdeye DEĞİL: kiracı kodu, kaldırdığımız
    // listenin parçasıdır ve istemciye sızmamalı.
    console.error(`[kiraci-bul] sırrı girilmemiş kiracı: ${eksik.join(", ")}`);
    return hata(503, "yapilandirilmadi");
  }

  // ── Uygulama anahtarı ───────────────────────────────────────────────────
  // ⚠️ GÜVENLİK SINIRI DEĞİL (docs § 3): APK sökülürse okunur. İşi, sıradan
  // betiği durdurmak, hız sınırına kimlik vermek ve sızarsa döndürülebilmek.
  const beklenen = process.env.GALZURA_APP_KEY?.trim();
  if (!beklenen) {
    console.error("[kiraci-bul] GALZURA_APP_KEY girilmemiş");
    return hata(503, "yapilandirilmadi");
  }
  const anahtar = req.headers.get("x-galzura-app");
  if (!safeEqual(anahtar, beklenen)) return hata(401, "yetkisiz");

  const ip = istemciIp(req.headers);
  for (const [ad, tavan] of [[`app:${beklenen.slice(0, 8)}`, APP_TAVAN], [`ip:${ip}`, IP_TAVAN]] as const) {
    const s = sinirDenetle(`kbul:${ad}`, tavan, PENCERE_SN);
    if (!s.ok) return hata(429, "cok_fazla_istek", { "retry-after": String(s.tekrarSn) });
  }

  // ── Gövde ───────────────────────────────────────────────────────────────
  let ham: unknown;
  try {
    ham = await req.json();
  } catch {
    return hata(400, "gecersiz_govde");
  }
  const g = (ham ?? {}) as Record<string, unknown>;

  // 🔴 PIN BU SERVİSE GELMEZ. Sessizce yok saymak yerine gürültülü ret.
  if ("pin" in g || "sifre" in g || "password" in g) return hata(400, "pin_gonderilmemeli");

  const telefon = typeof g.telefon === "string" ? g.telefon.trim() : "";
  // Biçim denetimi kiracı ucuyla AYNI aralık (sanitize sonrası 6–20 hane).
  const haneler = telefon.replace(/[^\d]/g, "").length;
  if (haneler < 6 || haneler > 20) return hata(400, "telefon_bicimsiz");

  const telSinir = sinirDenetle(`kbul:tel:${telefon.replace(/[^\d+]/g, "")}`, TEL_TAVAN, PENCERE_SN);
  if (!telSinir.ok) return hata(429, "cok_fazla_istek", { "retry-after": String(telSinir.tekrarSn) });

  // ── YAYILMA: paralel sor, HEPSİNİ bekle ─────────────────────────────────
  // ⚠️ Promise.race / Promise.any KULLANILMAZ ve döngüden erken çıkılmaz.
  // İki sebep: (1) iki numara ÜÇ KİRACIDAN da "evet" alıyor — ölçüldü; ilk
  // evette durmak onları rastgele birine gönderirdi. (2) sıralı sorup erken
  // çıkmak, toplam süreden kaçıncı kiracının cevapladığını sızdırır.
  const sonuclar = await Promise.allSettled(KIRACILAR.map((k) => kiraciyaSor(k, telefon)));

  const kiracilar: { kod: string; ad: string; adres: string }[] = [];
  let tam = true;
  sonuclar.forEach((s, i) => {
    const k = KIRACILAR[i];
    // allSettled reddi teorik (kiraciyaSor fırlatmıyor) ama fail-safe:
    const r: Sonuc = s.status === "fulfilled" ? s.value : { durum: "bilinmiyor", sebep: "beklenmedik" };
    if (r.durum === "evet") kiracilar.push({ kod: k.kod, ad: k.ad, adres: k.adres });
    else if (r.durum === "bilinmiyor") {
      tam = false;
      console.warn(`[kiraci-bul] ${k.kod} bilinmiyor: ${r.sebep}`);
    }
  });

  // `tam:false` → uygulama "kayıtlı değilsiniz" DEMEZ, "şu an bağlanılamadı" der.
  return cevap({ ok: true, kiracilar, tam });
}

export async function GET() {
  return hata(405, "sadece_post", { allow: "POST" });
}
```

`lib/rate-limit.ts` ve `lib/secure-compare.ts` bu depodan **olduğu gibi**
kopyalanır (`hak-transport-takip/lib/`) — ikisi de bağımsız, sınanmış ve
kiracı ucunda kullanılıyor.

### `app/api/kiraci-bul/saglik/route.ts` (kilit 3)

```ts
/**
 * GET /api/kiraci-bul/saglik — kiracı başına kurulum durumu.
 *
 * Kayıtsız bir numarayla her kiracıya sorar. Amacı cevabı değil ULAŞILABİLİRLİĞİ
 * ölçmek: bir kiracının env'i unutulduysa ya da dağıtımı geride kaldıysa
 * kullanıcı şikâyet etmeden burada görünür.
 *
 * Uygulama anahtarı ister — kiracı kodlarını döndürdüğü için herkese açık olamaz.
 */
```

Her kiracı için `{kod, durum: "hazir" | "sir_yok" | "ulasilamadi" | "eski_surum", ms}`.

---

## 8. Muhafız ve kabul testi

`scripts/check-kiracilar.mjs` — `npm run verify` zincirine girer:

| # | Denetim |
|---|---|
| K1 | `KIRACILAR` kodları ile `SIRLAR` anahtarları **birebir aynı küme** |
| K2 | `route.ts` içinde `Promise.race`/`Promise.any` **yok**, `allSettled` **var**, kiracı döngüsünde erken `return` yok |
| K3 | Cevap gövdesi alan listesi: yalnız `ok`, `kiracilar`, `tam`, `hata` |
| K4 | PIN reddi yerinde (`pin`/`sifre`/`password` → 400) |
| K5 | Her `fetch`te `AbortSignal.timeout` **var** |
| K6 | `res.status === 200` **tek başına** kabul ölçütü değil — `content-type` ve `typeof … === "boolean"` denetimleri var |

Altısı da **arıza enjeksiyonuyla** sınanmalı (kiracı ucunda uygulanan yöntem:
kasıtlı olarak boz, muhafızın kırıldığını gör, geri yükle).

**Kabul testi** — `verify-kiraci-bul.mjs`, salt okuma:

1. Bilinen bir kiracı yöneticisinin numarası → o kiracı listede
2. **Ölçülen çoklu eşleşme:** üç kiracıda da hesabı olan numara → **3 satır**
3. Kayıtsız numara → `[]`, `tam:true`
4. PIN'li gövde → 400
5. Anahtarsız / yanlış anahtar → 401
6. Bir kiracının adresi bilerek bozulur → o kiracı `bilinmiyor`, **`tam:false`**,
   diğerleri normal döner ve **liste "hayır" ile kirlenmez**
7. Bir kiracı 200+HTML döndürürse (`/_not-found` deseni) → `bilinmiyor`
8. GET → 405

---

## 9. Açık kalanlar

| # | Konu | Durum |
|---|---|---|
| 1 | **Hedef depo açılmadı** | Kod hiçbir yere yazılmadı. Karar: yeni depo + yeni Vercel projesi + `kiraci.galzura.com` (§ 1.3) |
| 2 | **Canlı galzura.com'un kaynağı belirsiz** | `galzura-software` Git'e bağlı değil; `galzura-com-v4` yarım ve içeriği canlıyla eşleşmiyor. Servis oraya konacaksa önce bu çözülmeli |
| 3 | **`GALZURA_APP_KEY` güvenlik sınırı değil** | APK sökülürse okunur (§ 3). Gerçek çözüm Play Integrity / App Attest — yol haritasına |
| 4 | **Soğuk başlangıç ayrıştırılmadı** | 2500 ms marjın gerekçesi bu belirsizlik. Servis canlıya çıkınca gerçek kuyruk ölçülüp daraltılabilir |
| 5 | **APK'daki firma seçici hâlâ yerinde** | Servis hazır olsa da liste kalkmadan sızıntı sürüyor — mobil deponun işi |
| 6 | **galzura-demo kadrosu ölçülemedi** | service_role anahtarı verilmiyor; uç üzerinden dolaylı ölçüldü (§ 5) |

---

## 10. Kurulum kaydı — 01.09.2026

### Araçlar (önce ölçüldü)

| Araç | Durum |
|---|---|
| `gh` 2.92.0 | ✅ giriş var (`volkancatak1309-max`), scope'lar `repo`, `workflow`, `read:org`, `gist` |
| `vercel` 58.9.0 | ✅ oturum açık (`volkancatak1309-max`) |
| Cloudflare | ❌ **hiçbir şey yok** — `wrangler` yok, `flarectl` yok, `CLOUDFLARE_*`/`CF_*` env yok, `~/.cloudflared` / `~/.wrangler` yok |

Cloudflare kimliği olmadığı için **DNS kaydı yapılamadı** (§ 11.1).

### Yapılanlar

| Adım | Sonuç |
|---|---|
| Depo | `volkancatak1309-max/galzura-kiraci-bul` — **private**, boş başlatıldı (README/gitignore/license yok) |
| Kod | Üç commit, **yalnız yerelde** — `055e120`, `8d6ba32`, `808fd82` |
| Vercel projesi | `galzura-kiraci-bul` (`prj_rmoDWhG5EZ5ONpH3A0azIREZ6K84`) |
| Git bağlantısı | ✅ doğrulandı — `vercel git connect` ikinci çağrıda *"already connected"* dedi |
| Bölge | `fra1` — hem her rotada `preferredRegion` hem `vercel.json` |
| **Push / deploy** | ❌ **YAPILMADI** (görevin kuralı) |

### 🔴 Yakalanan tuzak: çatı ön ayarı "Other"

Proje CLI ile **boş** oluşturulduğu için Vercel çatıyı tespit edemedi ve
`Framework Preset: Other`, `Output Directory: public` yazdı — oysa bu bir
Next.js uygulaması. Ayar böyle kalsaydı dağıtım yanlış şeyi servis ederdi.

Bu, `galzura-software` projesinde **bugün de duran** ayarın aynısı (§ 1.1) —
yani rastlantı değil, CLI ile boş proje açmanın standart sonucu.

Panelden değil **dosyadan** düzeltildi:

```json
{ "framework": "nextjs", "regions": ["fra1"] }
```

`vercel.json` panel ayarını **ezer** ve karar depoda kayıtlı kalır. Yerel
`vercel build` ile doğrulandı: `Detected Next.js version: 16.2.6`, iki uç da
fonksiyon olarak üretildi.

> Yerel `vercel build` sonunda `EPERM: symlink` hatası veriyor. Bu **Windows'un
> symlink izni**, yapılandırma sorunu değil — Vercel'in Linux derleyicisi
> yaşamaz. Derlemenin Next.js'i tanıdığı ve fonksiyonları ürettiği hata
> ÖNCESİNDE görüldü.

### Doğrulama

| Adım | Sonuç |
|---|---|
| `npx tsc --noEmit` | 0 hata |
| `npx eslint` | 0 problem |
| `npm run build` | ✅ iki uç da `ƒ` (dinamik) |
| `npm run lint:kiracilar` | **6/6** |
| Muhafız arıza enjeksiyonu | **7 kasıtlı bozma → 7 yakalama** |
| Canlı kabul · Tur 1 (gerçek üç kiracı) | **12/12** |
| Canlı kabul · Tur 2 (sahte arızalı kiracı) | 5 arıza kipi × 3 denetim = **15/15** |

**Kiracı tarafında hiçbir yazma yok** — sorgu ucu yalnız `SELECT` yapıyor.

#### Tur 1'in en önemli satırı

Gerçek bir yönetici numarası sorulduğunda servis **üç kiracıyı birden** döndürdü:

```
→ eşleşen kiracılar: hak61, sendigo, galzura-demo
sağlık ucu: hak61 hazir 120 ms · sendigo hazir 144 ms · galzura-demo hazir 119 ms
```

§ 7.1'deki çoklu eşleşme, artık **servisin kendisinden** uçtan uca kanıtlı.

#### Tur 2 — kural 4'ün asıl kanıtı

Sahte bir kiracı ölçülen bozuk davranışları taklit etti. Beşinde de `tam:false`
döndü, liste kirlenmedi, gövdeye kiracı kodu sızmadı:

| Arıza | Sonuç |
|---|---|
| `html200` (200 + HTML, `/_not-found` deseni) | `tam:false` · 347 ms |
| `503 yapilandirilmadi` | `tam:false` · 166 ms |
| `kodYanlis` (başka kiracının kodu) | `tam:false` · 151 ms |
| `varYok` (JSON ama `var` alanı yok) | `tam:false` · 162 ms |
| `askida` (hiç cevap vermiyor) | `tam:false` · **2523 ms** ← 2500 ms zaman aşımı çalışıyor |

Ve **gerçek numarayla**, bir kiracı 200+HTML dönerken:

```
eşleşen kiracılar : hak61, sendigo      ← sağlam ikisi NORMAL döndü
tam               : false               ← üçüncüsü "hayır"a ÇEVRİLMEDİ
gövde alanları    : kiracilar,ok,tam    ← kiracı kodu sızmadı
```

Kural 4 tam olarak buydu: arızalı bir kiracının personeli, listeden sessizce
düşmez — cevap "eksik" olarak işaretlenir.

### ⚠️ Muhafızın kendi iki zayıflığı (enjeksiyonda yakalandı)

Muhafız ilk yazımda **geçiyordu ama iki deliği vardı**:

1. **K3** cevap alanlarını regex'le "geziyor"du ve `{ok, kiracilar, tam}`
   gövdesinde **`tam`ı kaçırıyordu** — önceki eşleşme ayırıcı virgülü
   tüketiyordu. Yani gövdeye sızmış bir alan varken yeşil kalabilirdi.
   Virgülle bölmeye çevrildi; `lib/kapi.ts` de taranıyor.
2. **K6** yalnız `"application/json" dizesi geçiyor mu` diye bakıyordu. O dize
   istek **başlıklarında** da geçtiği için, koruma `if (false)` yapılıp devre
   dışı bırakıldığında muhafız **yeşil kaldı**. Üç koşulun tam metnini arayacak
   şekilde sıkılaştırıldı.

Ders: bir muhafızın geçmesi, çalıştığını kanıtlamaz. **Arıza enjeksiyonu
olmadan muhafız yazılmaz.**

---

## 11. ⏳ Volkan'da kalan iki iş

### 11.1 Cloudflare DNS — `kiraci.galzura.com`

Bende Cloudflare kimliği **yok**, bu adım yapılamadı.

Cloudflare panelinde `galzura.com` bölgesi → **DNS** → **Add record**:

| Alan | Değer |
|---|---|
| Type | **CNAME** |
| Name | **`kiraci`** |
| Target | **`cname.vercel-dns.com`** |
| Proxy status | **DNS only** (gri bulut — 🔴 turuncu DEĞİL) |
| TTL | Auto |

> 🔴 **Proxy neden KAPALI:** Cloudflare turuncu buluttayken araya kendi
> önbelleği, WAF'ı ve zaman aşımları giriyor. Bu giriş yolunda bir "Cache
> Everything" kuralı, yönlendirme cevabını önbelleğe alır ve **yanlış kişiyi
> yanlış kiracıya** gönderir. Gecikme gerekçesi değil (ölçüldü: Cloudflare
> yavaşlatmıyor, § 1.3) — **yapılandırma yüzeyini** kesmek için.

Sonra Vercel'de: **galzura-kiraci-bul → Settings → Domains → Add** →
`kiraci.galzura.com`.

### 11.2 Vercel env — proje `galzura-kiraci-bul`

**Environment: Production** (dördü de), tipi **Sensitive**:

| Değişken | Değer |
|---|---|
| `GALZURA_APP_KEY` | yeni üretilecek — mobil uygulamaya da girilecek |
| `KIRACI_SIR_HAK61` | HAK61 panelindeki `KIRACI_SORGU_SECRET` ile **aynı** |
| `KIRACI_SIR_SENDIGO` | Sendigo panelindeki ile **aynı** |
| `KIRACI_SIR_GALZURA_DEMO` | galzura-demo panelindeki ile **aynı** |

> ⚠️ **Env girmek tek başına yetmez: sonra REDEPLOY.** Vercel env'i, eklendikten
> SONRA yapılan bir dağıtımla etkinleşir. 01.09'da HAK61'de tam olarak bu
> atlandı ve panel `503` döndü ([`KIRACI-SORGU-UCU.md`](KIRACI-SORGU-UCU.md) § 15).

Dağıtımdan sonra tek komutla doğrulanır:

```bash
curl -s https://kiraci.galzura.com/api/kiraci-bul/saglik \
  -H "x-galzura-app: $GALZURA_APP_KEY"
# {"ok":true,"hazir":3,"toplam":3,…}
```

`hazir < toplam` ise hangi kiracının `sir_yok` / `eski_surum` / `ulasilamadi`
olduğunu aynı cevap söyler.

### 11.3 Push ve ilk dağıtım — **senin iznin bekleniyor**

Kod yerelde üç commit hâlinde hazır. "Push et" dediğinde:
`git push -u origin main` → Vercel Git bağlantısı ilk üretim dağıtımını
tetikler.

---

## 12. Dağıtım öncesi son durum — 01.09.2026

### Ölçülen (salt okuma)

| Kontrol | Sonuç | Nasıl |
|---|---|---|
| **DNS** `kiraci.galzura.com` | ✅ **yayılmış** — CNAME → `cname.vercel-dns.com` | üç ayrı çözücüde tutarlı: yerel, `1.1.1.1`, `8.8.8.8` |
| Dönen IP'ler | `76.76.21.x` / `66.33.60.x` = **Vercel** | Cloudflare IP'si (`104.x`/`172.67.x`) **değil** → proxy gerçekten KAPALI ✓ |
| **TLS** | ✅ geçerli (`ssl_verify_result 0`) | `curl -w '%{ssl_verify_result}'` |
| Alan adı → proje | ✅ bağlı | `X-Vercel-Error: DEPLOYMENT_NOT_FOUND` — alan adı projeye gidiyor, sadece dağıtım yok |
| Vercel env (Production) | `KIRACI_SIR_HAK61` · `KIRACI_SIR_SENDIGO` · `KIRACI_SIR_GALZURA_DEMO` ✓ · `GALZURA_APP_KEY` ⏳ | `vercel env ls production` (yalnız ADLAR) |
| Dağıtım | **yok** — `Latest Production URL: --` | `vercel project ls` |

**DNS bekleme süresi: YOK.** Sorulan "ne kadar sürer" sorusunun cevabı ölçümle
verildi — zaten yayılmış. Cloudflare kendi otoriter sunucusunda değişikliği
anında uygular; proxy kapalı olduğu için araya CDN önbelleği de girmiyor. TLS
sertifikası da çıkmış durumda.

### 🔴 Sıra: "redeploy" DEĞİL, TEK dağıtım

Bu projenin **hiç dağıtımı yok**, dolayısıyla "yeniden dağıtma" diye bir adım
yok. Doğru sıra:

1. `GALZURA_APP_KEY` Vercel'e girilir (Production, Sensitive).
2. **Sonra** push edilir → Git bağlantısı **ilk** dağıtımı tetikler.
3. O dağıtım dört env'i de **hazır bulur**. İkinci bir dağıtıma gerek YOK.

Bu, HAK61'de yaşanan tuzağın tersi: orada dağıtım env'den ÖNCEYDİ, o yüzden
redeploy gerekti. Burada env'i önce girmek o adımı tamamen ortadan kaldırıyor.

### Push sonrası doğrulama

```bash
# 1) Sağlık — tek komut, üç kiracıyı birden ölçer
curl -s https://kiraci.galzura.com/api/kiraci-bul/saglik \
  -H "x-galzura-app: $GALZURA_APP_KEY"
# beklenen: {"ok":true,"hazir":3,"toplam":3,"zamanAsimiMs":2500,"kiracilar":[…]}

# 2) Tam kabul testi — sağlık + kayıtsız numara + gerçek numara + tam akış
cd galzura-kiraci-bul
BASE=https://kiraci.galzura.com APP_KEY=… GERCEK_NUMARA=… \
  node scripts/verify-kiraci-bul.mjs
```

`hazir < toplam` ise aynı cevap **hangi kiracının** ve **neden** olduğunu söyler:

| `durum` | Anlamı |
|---|---|
| `hazir` | Kiracı düzgün cevap veriyor |
| `sir_yok` | Bu projede o kiracının `KIRACI_SIR_*` env'i yok |
| `eski_surum` | Kiracı `200+HTML` ya da `503` dönüyor → o kiracının paneli env'siz ya da dağıtımı geride |
| `ulasilamadi` | Ağ / zaman aşımı |

### Tam akış — son adım neden yazma İÇERMİYOR

Kabul testi, servisin döndürdüğü **her adres için** `/api/mobile/auth/login`
ucuna boş gövde (`{}`) gönderir ve `400 missing_fields` bekler. Böylece
"yönlendirme doğru adresi verdi ve o adres gerçekten çalışan bir giriş ucu"
zinciri kapanır.

> ⚠️ **Yanlış PIN ile denenmez.** Başarısız bir giriş `login_attempts`e satır
> YAZAR ve kilit merdivenini ilerletir — canlı müşteride gerçek bir kişinin
> kilitlenmesine katkı yapardı. Boş gövde ise `verifyCredentials`a **hiç
> girmeden** döner (kaynakta doğrulandı: alan denetimi route'un ilk adımı;
> galzura-demo'da canlı olarak da ölçüldü). **Sıfır yazma.**

Zincirin gerçek son halkası — doğru PIN ile giriş — **telefondan, Volkan
tarafından** yapılır. Onu bir betikle taklit etmek, canlı müşteri verisine
yazmak demektir.
