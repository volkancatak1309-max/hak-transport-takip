# Rakipler GDPR yükümlülüklerini gerçekte nasıl karşılıyor

**SALT ARAŞTIRMA · 26.08.2026 · kod yazılmadı**

Hukuk raporumuzun çıkardığı 6 yükümlülük, 10 firmada tek tek arandı.
Kaynak: firmaların **kendi** gizlilik politikaları, DPA'ları, yardım
merkezleri ve ürün dokümanları.

---

## 0 · Doğrulama işaretleri

| İşaret | Anlamı |
|---|---|
| **[DOĞRULANDI]** | Firmanın kendi sayfası doğrudan okundu |
| **[KISMEN]** | Resmî sayfa 403/404 verdi; arama sonucunda alıntılanan resmî metin, link verildi |
| **[AÇIK]** | Bulunamadı — uydurulmadı, boş bırakıldı |

---

## 1 · TEK CÜMLELİK CEVAP

> **Hiçbiri bu yükümlülükleri "çözmüyor". Üçü de aynı hamleyi yapıyor:
> yükümlülüğü MÜŞTERİYE devrediyorlar.**

Ve bu hukuken **savunulabilir** — çünkü GDPR'de sorumluluk **veri
sorumlusunda** (controller), yani filoyu işleten şirkette. Sağlayıcı
**işleyen** (processor, Art. 28). Ceza da oraya kesiliyor.

**Kanıt:** aradım — Samsara, Geotab, Webfleet, Verizon Connect veya Motive'e
kesilmiş **tek bir GDPR cezası bulamadım** [AÇIK — yokluk kanıtı değil, ama
Enforcement Tracker taramasında çıkmadı]. Buna karşılık **filo işletmecisi**
cezalandı: İtalya'da Garante, **Autotrasporti Cuccu Riccardo S.r.l.**'ye
Ocak 2025'te **50.000 €** kesti — 50 çekicide GPS **mola sırasında açık
kalmış** ve konum verisi **180 gün** saklanmış; Madde 5, 13 ve 88 ihlali
[KISMEN, [Bristows analizi](https://inquisitiveminds.bristows.com/post/102igrg/eu-regulators-taking-action-on-vehicle-tracking)].

Yani: **cihazı satan değil, cihazı kullanan ödüyor.** Rakiplerin mimarisi
tam olarak bunun üzerine kurulu.

---

## 2 · BÜYÜK TABLO

| Firma | 1) Ham GPS saklama | 2) DPIA | 3) Şoför kapatabiliyor mu | 4) Veri sahibi hakları | 5) Betriebsrat | 6) İzleme kapatılabilir mi |
|---|---|---|---|---|---|---|
| **Samsara** | varsayılan **"müşteri olduğun sürece"**; AB'de kamera 6 ay; özel süre **yazılı talep** ile [KISMEN] | ✅ **DPIA ŞABLONU var**; DPA'da destek "ücret talep edilebilir" [DOĞRULANDI] | ✅ **Privacy Button** (donanım); 5 dk sonra segment biter [KISMEN] | DPA: "teknik ve organizasyonel önlemler" [DOĞRULANDI] | ✅ **Almanca Betriebsrat kılavuzu + politika şablonu** [DOĞRULANDI] | ✅ skor gösterimi aç/kapa · **liderlik anonimleştirilebilir** [KISMEN] |
| **Geotab** | **varsayılan 2 YIL**, tavan 8 yıl; kişisel yolculuk 1 güne inebilir; **yalnız admin** [DOĞRULANDI] | [AÇIK] | ✅ **Privacy Mode**; kural ile otomatik ("mesai sonrası") [DOĞRULANDI] | [AÇIK] — pazarlama sayfasında yok | [AÇIK] | ⚠️ **motor + ivmeölçer Privacy Mode'da bile akıyor** [DOĞRULANDI] |
| **Webfleet** (Bridgestone) | 🔑 **"Sözleşme sahibi karar verir… ne kadar saklanacağına"** [DOĞRULANDI] | [AÇIK] | ✅ **Privacy Switch donanımı** — "özel modda yolculuk kaydedilmez, araç konumlandırılamaz" [KISMEN] | ✅ 8 hak tek tek sayılı [DOĞRULANDI] | [AÇIK] | [AÇIK] |
| **Verizon Connect** | **13 ay** konum, açıkça "GDPR uyumu için"; müşteri planı daha kısaysa o geçerli [KISMEN] | [AÇIK] | [AÇIK] | BCR (Art. 47) hem sorumlu hem işleyen olarak [KISMEN] | [AÇIK] | [AÇIK] |
| **Motive** | [AÇIK] | [AÇIK] | [AÇIK] konum için | silme: `privacy@gomotive.com`, **30 gün** [KISMEN] | [AÇIK] | ✅ *"Show Drivers their Safety Score in Driver App"* kutusu [KISMEN] |
| **Onfleet** | [AÇIK] | [AÇIK] | ✅ **mimari olarak**: *"off-duty veya çevrimdışıyken şoförün telefonundan hiçbir bilgiye erişmez, toplamaz, saklamaz"* [KISMEN] | GDPR + CCPA taahhüdü [KISMEN] | [AÇIK] | [AÇIK] |
| **Fleetio** | [AÇIK] | [AÇIK] | — (GPS kendi ürünü değil, 12+ telematik entegrasyonu) | EU-U.S. DPF sertifikalı, DPA var [KISMEN] | [AÇIK] | — |
| **TomTom Telematics** | = Webfleet (2019'da Webfleet Solutions, sonra Bridgestone) | " | " | " | " | " |
| **Arvento** (TR) | ⚠️ yayımlanan KVKK metni **yalnız ticari elektronik ileti** hakkında; imha "6 aylık periyotlarla" [KISMEN] | KVKK'da DPIA muadili yok | [AÇIK] | KVKK m.11 hakları | — (TR'de Betriebsrat yok) | [AÇIK] |
| **Mobiliz** (TR) | [AÇIK] — bulunan metin **tedarikçi** aydınlatma metni [KISMEN] | — | [AÇIK] | KVKK m.11 | — | [AÇIK] |

---

## 3 · Madde madde — gerçekte ne yapıyorlar

### 1) Ham GPS saklama süresi

Hukuk raporumuzun çıtası: **CNIL 2 ay · İtalya 180 günü cezalandırdı ·
Almanya 400/150 günü orantısız buldu.**

**Rakiplerin gerçek varsayılanları bu çıtanın çok üstünde:**

| Firma | Varsayılan | Çıtaya göre |
|---|---|---|
| Geotab | **2 yıl** (730 gün) | 🔴 CNIL'in **12 katı**, Almanya'nın reddettiği 400 günün **1,8 katı** |
| Verizon Connect | **13 ay** (395 gün) | 🔴 Almanya'nın orantısız bulduğu 400 güne **neredeyse birebir eşit** |
| Samsara | **"müşteri olduğun sürece"** | 🔴 üst sınır yok |
| Webfleet | **karar müşterinin** | ⚠️ varsayılan yayımlanmamış |

🔑 **Bu nasıl savunulabiliyor?** Üç ayak üzerinde:

1. **Rol ayrımı.** Sağlayıcı işleyen; süreyi belirlemek sorumlunun görevi.
   Geotab bunu **ürünleştirmiş**: 5 kategori, her biri ayrı ayarlanabiliyor.
   Sürücü/olay verisi **2 aya**, kişisel yolculuk verisi **1 güne** kadar
   indirilebiliyor — yani CNIL çıtası **ürün içinde ulaşılabilir**, sadece
   varsayılan değil.
2. **Amaç çeşitliliği.** Ham iz kısa saklanabilir ama türetilmiş kayıt
   (vardiya, ihlal, bakım) başka bir hukuki dayanakla (ticari defter, iş
   hukuku) daha uzun tutulabilir. Bizim 054'teki ayrımın aynısı.
3. **Görünürlük.** Geotab ayarı **yalnız şirket geneli Administrator**
   değiştirebiliyor — hesap verebilirlik izi bırakıyor.

⚠️ **Ama savunma tam değil.** GDPR Art. 5(1)(e) "gerektiğinden uzun
tutulamaz" diyor ve bunu **sorumluya** yüklüyor. Sağlayıcının 2 yıllık
varsayılanı, hiçbir şey yapmayan müşteriyi **doğrudan ihlale sokuyor**.
İtalyan davasında ceza yiyen taraf tam olarak buydu.

> 📌 **Geotab Mayıs 2025'te iki yıllık otomatik silmeyi devreye aldı** ve
> yöneticilere silmeden önce "birkaç haftalık" değiştirme süresi tanıdı
> [DOĞRULANDI]. Yani **eskiden sınırsızdı.** Sektör bu yönde hareket ediyor,
> ama yavaş.

---

### 2) DPIA zorunluluğu

Almanya DSK'ya göre çalışan GPS takibi için **şart**.

**Tek somut cevap Samsara'dan geldi** ve güçlü:

> *"Samsara hat Vorlagen für Datenschutz-Folgenabschätzungen entwickelt"*
> — Samsara **DPIA şablonları geliştirdi** [DOĞRULANDI]

Ayrıca: dashcam kullanımı için **politika ve muhtıra şablonları**, ve
*"Samsara kann Kunden bei der Kommunikation mit dem Betriebsrat
unterstützen"* — Betriebsrat iletişiminde destek.

⚠️ **Ama DPA'da işin ticari yüzü var:**

> *"At Customer's request, Samsara will provide reasonable assistance to
> Customer with any data protection impact assessments… **Samsara reserves
> the right to charge a reasonable fee for such requested assistance**"*
> [DOĞRULANDI]

Yani: **şablon bedava, gerçek yardım ücretli.** Art. 28(3)(f) zaten yardımı
zorunlu kılıyor; "makul ücret" kaydı sözleşmesel bir tampon.

Diğer 9 firmada DPIA şablonu **bulamadım** [AÇIK].

---

### 3) Şoför çalışma dışı saatte takibi kapatabiliyor mu

**En olgun madde bu — üç farklı mimari çözüm var:**

#### a) Donanım anahtarı — **en güçlü**

**Webfleet Privacy Switch**: araca takılan fiziksel buton, LED'i şoföre hangi
modda olduğunu gösteriyor. *"Özel modda yolculuk kaydedilmez ve araç
konumlandırılamaz."* LINK 410/510/530/710/740 ile uyumlu [KISMEN].

**Samsara Privacy Button**: aksesuar; konum takibini tamamen kapatıyor.
Kural: buton basılıp **5 dakika** içinde yeniden açılmazsa mevcut yolculuk
segmenti biter; yolculuk başlamadan kapatılmışsa **raporlarda hiç
görünmez** [KISMEN].

> 🔑 **Donanım anahtarının hukuki üstünlüğü:** verinin **yokluğunu
> ispatlanabilir** kılıyor. Yazılım ayarı "kapattım" der; fiziksel anahtar
> LED'iyle şoföre de gösterir. DSK/CNIL'in istediği tam olarak bu.

#### b) Yazılım modu — **orta**

**Geotab Privacy Mode**. İki kaynağı karşılaştırınca **çelişki çıkıyor** ve
bu çelişki önemli:

| Kaynak | Ne diyor |
|---|---|
| Geotab blog | *"GPS positions are **immediately separated from the regular data flow and inaccessible** in the user's MyGeotab database, the SDK, and not available to any Geotab Reseller"* [DOĞRULANDI] |
| Geotab UK pazarlama | *"location features that use GPS such as position, trips and speed profiles are **not displayed** in the application"* [DOĞRULANDI] |

**"Ayrıştırılıyor/erişilemez" ile "gösterilmiyor" aynı şey değil.** İkincisi
**görüntü bastırma**; GDPR açısından saklama da bir işleme faaliyetidir ve
Art. 5(1)(c) veri minimizasyonu bunu kapsar. Hangisinin doğru olduğu
dokümandan **kesin olarak çıkmıyor** [AÇIK].

🔴 **Ve kesin olan bir şey var:**

> *"Other features not using GPS, such as **engine and accelerometer data are
> still displayed** in Privacy Mode"* [DOĞRULANDI]

Yani **özel yolculukta bile ivmeölçer akıyor** → sert fren/hızlanma olayları
kaydediliyor → **sürücü skoru özel yolculuktan besleniyor.** Bu bizim için
doğrudan uyarı: bizim skorumuz da olaylardan besleniyor.

Artısı: Geotab kural motoruyla **otomatikleştirilebiliyor** ("mesai sonrası
otomatik aç") — şoförün her gün hatırlamasına gerek kalmıyor. Bu iyi tasarım.

#### c) Mimari — **en temiz ama dar**

**Onfleet**: telefon uygulaması olduğu için *"off-duty veya çevrimdışıyken
şoförün cihazından hiçbir bilgiye erişmez, toplamaz, saklamaz"* [KISMEN].
Sorun kökten yok — ama yalnız telefon-GPS'li ürünlerde işe yarıyor. **Araç
cihazı takılıysa bu yol kapalı** (bizim durumumuz: FMC003).

---

### 4) Veri sahibi hakları

**En zayıf işlenen madde. Kimse "şoför butona basar, verisini indirir"
demiyor.** Hepsi e-posta/DPA yolunu gösteriyor:

| Firma | Yol |
|---|---|
| Webfleet | 8 hakkı tek tek sayıyor (erişim, düzeltme, silme, kısıtlama, **taşınabilirlik**, itiraz, şikâyet, rızayı geri çekme) [DOĞRULANDI] |
| Samsara | DPA: ürünler *"teknik ve organizasyonel önlemler"* içeriyor, müşteriye "mümkün olduğu ölçüde" yardım [DOĞRULANDI] |
| Motive | `privacy@gomotive.com`, en geç **30 gün** [KISMEN] |
| Geotab | pazarlama sayfasında hiç geçmiyor [AÇIK] |

🔑 **Mantık şu:** şoförün muhatabı **işvereni**, sağlayıcı değil. Sağlayıcı
"talebi karşılamanı sağlayacak aracı veriyorum" diyor. Art. 28(3)(e) ile
uyumlu — ama şoför açısından **kullanışsız**: talep e-posta zincirine
dönüyor, 30 güne yayılıyor.

> **Burada boşluk var.** Self-servis veri indirme sunan bir filo ürünü
> bulamadım.

---

### 5) İşyeri konseyi / Betriebsrat

**Tek ciddi cevap yine Samsara.** Almanca blog + **`Betriebsrat-Leitfaden-Extern.pdf`**
adlı harici kılavuz yayımlıyorlar [DOĞRULANDI]:

> *"Gemäß dem Betriebsverfassungsgesetz (BetrVG) hat der Betriebsrat ein
> Mitbestimmungsrecht bei der Einführung neuer Technologien"*
>
> Tavsiye: *"den Betriebsrat von Anfang an einzubeziehen"* ve
> *"mit dem Betriebsrat verhandeln"*

Şablonların hepsi *"Ausgangspunkt"* (başlangıç noktası) olarak sunuluyor —
hukuki sorumluluk üstlenilmiyor.

Diğer 9 firmada Betriebsvereinbarung şablonu ya da DACH'a özel konsey
materyali **bulamadım** [AÇIK]. Webfleet'in Almanca varlığı güçlü olmasına
rağmen gizlilik politikasında ve araç-takip gizlilik sayfasında Betriebsrat
**hiç geçmiyor** [DOĞRULANDI].

> 📌 **Bu bir pazar boşluğu.** DACH'ta telematik satışının önündeki asıl
> engel teknik değil, **Betriebsrat müzakeresi**. Samsara bunu anlamış ve
> tek başına duruyor.

---

### 6) İzleme özelliklerinin kapatılabilirliği

| Firma | Ne kapatılabiliyor |
|---|---|
| **Samsara** | Driver App → Features → **Driver Scores aç/kapa**; liderlik tablosu **anonimleştirilebilir** (isimler gizli, sıralama görünür); Recognition/streak bildirimleri ayrı ayrı [KISMEN] |
| **Motive** | Coaching ayarlarında *"Show Drivers their Safety Score in Driver App"* kutusu [KISMEN] |
| **Geotab** | ⚠️ tersi: Privacy Mode'da bile ivmeölçer akıyor [DOĞRULANDI] |

🔴 **Kritik nüans: bunların hepsi GÖRÜNÜRLÜK anahtarı, HESAPLAMA anahtarı
değil.** Skor arka planda hesaplanmaya devam ediyor; sadece şoför görmüyor.
Yönetici görmeye devam ediyor.

GDPR açısından bu **yanlış yerde duran bir anahtar**: veri işleniyor, profil
çıkarılıyor (Art. 22 profilleme tartışması), sadece **veri sahibinden
gizleniyor**. Şeffaflık ilkesine (Art. 5(1)(a)) ters bile denebilir.

> 🔑 **Samsara'nın anonim liderlik tablosu bunun tek istisnası** ve akıllıca:
> kıyaslamanın motive edici etkisi kalıyor, bireysel teşhir kalkıyor.
> **Bizim 088'de varsayılan olarak yaptığımızın aynısı.**

---

## 4 · Buldukları dört savunulabilir yol — özet

| # | Yol | Kim | Hukuki gücü |
|---|---|---|---|
| **1** | **Rol kaydırma** — "işleyeniz, süreyi siz belirlersiniz" | hepsi | ✅ Art. 28 ile uyumlu · ⚠️ uzun varsayılan müşteriyi ihlale sokuyor |
| **2** | **Ayarı ürünleştirme** — kategori kategori saklama süresi | Geotab | ✅ en olgunu; CNIL çıtası ürün içinde ulaşılabilir |
| **3** | **Donanım anahtarı** — fiziksel özel-mod butonu | Webfleet, Samsara | ✅ **en güçlüsü** — verinin yokluğu ispatlanabilir |
| **4** | **Belge paketi** — DPIA + Betriebsrat şablonları | Samsara | ✅ riski azaltmıyor ama **müşterinin uyum maliyetini** azaltıyor → DACH'ta satış argümanı |

**Kimsenin yapmadığı:** kısa varsayılan saklama · şoföre self-servis veri
erişimi · skorun **hesaplanmasını** durduran anahtar.

---

## 5 · Bizim bugünkü durumumuz (CANLI ÖLÇÜM, 26.08.2026)

Kıyasın dürüst olması için kendi tarafımızı da ölçtüm:

| Madde | HAK61 bugün |
|---|---|
| **Ham GPS saklama** | 🔴 **POLİTİKA YOK.** `device_telemetry` **1.611.074 satır**, en eski kayıt **13.07.2026 = 44 gün**. Bugün CNIL çıtasının altındayız ama **tesadüfen** — entegrasyon o tarihte başladı. Hiçbir şey 400 güne gitmesini engellemiyor. |
| **Var olan mekanizma** | ✅ `purge_old_telemetry` (migration 054) + `/api/cron/demo-retention` **yazılmış ve çalışıyor** — ama **yalnız galzura-demo'da** (14 gün). 054'ün kendi yorumu: *"HAK61/Sendigo GERÇEK müşteri — orada saklama süresi hukuki bir konu (§ 132 BAO) ve bu fonksiyon oralarda ASLA çalıştırılmamalıdır."* |
| **Ham/türetilmiş ayrımı** | ✅ **zaten doğru kurulmuş.** 054 yalnız `device_telemetry`'ye dokunuyor; `time_entries` (603), `vehicle_events` (5.770), `idle_episodes` (1.185) bağımsız kayıtlar. Rakiplerin "amaç çeşitliliği" savunmasının altyapısı bizde **hazır**. |
| **Şoför özel modu** | 🔴 yok |
| **DPIA / Betriebsrat belgesi** | 🔴 yok |
| **Veri sahibi self-servis** | 🔴 yok |
| **İsim gizleme** | ✅ **var ve VARSAYILAN** — 088 `tenant_odul.isim_gorunur` varsayılan `false`. Samsara'nın anonim liderliğiyle aynı yerde. |

> **En önemli tek satır:** teknik mekanizma **zaten yazılmış ve üretimde
> çalışıyor**; eksik olan yalnızca onu gerçek kiracılara **hangi süreyle**
> uygulayacağımız kararı. Bu bir kod işi değil, bir **politika** işi.

---

## 6 · Bu araştırmanın çıkardığı üç ders

**1 · Uzun varsayılan, müşteriyi ihlale sokar.**
Geotab 2 yıl, Verizon 13 ay, Samsara sınırsız. Hiçbiri ceza yemedi; **müşterileri
yedi.** Kısa varsayılan + isteyene uzatma seçeneği, hem hukuken hem satışta
üstün.

**2 · "Gizlemek" ile "toplamamak" aynı şey değil — ve rakipler birinciyi
yapıyor.**
Geotab'ın Privacy Mode'unda ivmeölçer akmaya devam ediyor; skor gizleme
anahtarları hesaplamayı durdurmuyor. Bu, denetimde savunması zor bir yer.
🔴 **Bizim skorumuz da olaylardan besleniyor** — özel mod eklenirse bu soru
bize de sorulur.

**3 · DACH'ta asıl darboğaz Betriebsrat ve tek Samsara oraya bakıyor.**
DPIA + Betriebsrat şablonu, teknik bir özellik değil ama **satın alma
kararını açan** şey. Küçük filo bu belgeleri kendi hazırlayamıyor.

---

## 7 · Açık kalanlar (dürüst liste)

| Konu | Neden açık |
|---|---|
| Samsara ham GPS saklama süresi (kamera dışı) | KB sayfası 403; yalnız DVIR/HOS/kamera bilgisi bulunabildi |
| Motive'in AB'deki konum saklama süresi | yardım merkezi 403, politikada rakam yok |
| Geotab DPIA / veri sahibi hakları süreci | pazarlama sayfasında yok; EU/UK DPA PDF'i okunmadı |
| Fleetio · Onfleet saklama süreleri | yayımlanmamış |
| Webfleet varsayılan saklama süresi | "müşteri karar verir" deniyor, varsayılan yazmıyor |
| Verizon Connect 13 ay teyidi | resmî yardım sayfası 403 verdi; arama alıntısına dayanıyor |
| Mobiliz araç-takip KVKK metni | bulunan belge **tedarikçi** aydınlatma metniydi |
| Rakiplere kesilmiş GDPR cezası | taramada çıkmadı — **yokluk kanıtı değil** |
| Samsara Privacy Button ayrıntıları | KB 403; arama alıntısına dayanıyor |

---

## 8 · Kaynaklar

**Saklama süresi**
[Geotab — Data purge (kategoriler, varsayılan 2 yıl, tavan 8 yıl)](https://support.geotab.com/help/mygeotab/access-and-administration/database-administration/data-purge) ·
[Geotab — Verilerim ne kadar saklanıyor](https://community.geotab.com/s/article/How-long-does-Geotab-keep-my-data?language=en_US) ·
[Verizon Connect Reveal — saklama kuralları](https://reveal-help.verizonconnect.com/hc/en-us/articles/360010712639-Verizon-Connect-Reveal-data-retention-rules) ·
[Samsara — Customizable Data Retention Settings](https://kb.samsara.com/hc/en-us/articles/360043777351-Customizable-Data-Retention-Settings) ·
[Webfleet gizlilik politikası](https://www.webfleet.com/en_gb/webfleet/legal/privacy/)

**DPIA · Betriebsrat**
[Samsara DE — Datenschutz und Betriebsräte](https://www.samsara.com/de/blog/de-blog-data-protection-and-employee-representative-bodies-works-councils) ·
[Samsara — Betriebsrat-Leitfaden (PDF)](https://www.samsara.com/de/pdf/docs/Betriebsrat-Leitfaden-Extern.pdf) ·
[Samsara DPA](https://www.samsara.com/legal/data-protection-addendum)

**Özel mod**
[Geotab — Privacy Mode](https://www.geotab.com/blog/telematics-privacy-feature/) ·
[Geotab UK — Personal Mode ve GDPR](https://www.geotab.com/uk/fleet-management-solutions/privacy-gdpr/) ·
[Webfleet — Privacy Switch aksesuarı](https://portals.webfleet.com/articles/de/Knowledge/Privacy-Switch-Accessory) ·
[Webfleet — araç takibinde gizlilik](https://www.webfleet.com/en_us/webfleet/fleet-management/vehicle-tracking/privacy/) ·
[Samsara — Privacy Button](https://kb.samsara.com/hc/en-us/articles/360047230551-Privacy-Button-Overview) ·
[Onfleet — Data and Privacy](https://support.onfleet.com/hc/en-us/articles/360027886071-Data-and-Privacy)

**İzleme anahtarları**
[Samsara — Driver Score görünürlüğü](https://kb.samsara.com/hc/en-us/articles/360059667592-Driver-Scores-Dashboard) ·
[Motive — Safety Score'u kapatma](https://helpcenter.gomotive.com/hc/en-us/articles/14101036913693-How-to-Disable-the-Safety-Score-on-the-Motive-Driver-App)

**Ceza**
[EU düzenleyicileri araç takibine el atıyor (Bristows)](https://inquisitiveminds.bristows.com/post/102igrg/eu-regulators-taking-action-on-vehicle-tracking) ·
[GDPR Enforcement Tracker](https://www.enforcementtracker.com/)

**Türkiye**
[Arvento KVKK](https://arvento.com/kvkk/) ·
[Mobiliz KVKK](https://mobiliz.com.tr/tedarikci-aydinlatma-metni) ·
[KVKK Kurul kararı 2020/404 — işverenin çalışan verisi](https://www.kvkk.gov.tr/Icerik/6913/2020-404)

**Diğer**
[Motive gizlilik politikası](https://gomotive.com/legal/privacy/) ·
[Fleetio gizlilik politikası](https://www.fleetio.com/terms/privacy) ·
[Verizon Connect — kişisel veri işleme tanımı](https://www.verizon.com/about/privacy/description-processing-personal-data-verizon-connect)

---

## 9 · Sonraki adım

**Kod yazılmadı. Karar bekliyor.**

Karar verilecek tek soru: **HAK61 ve Sendigo'da ham telemetri kaç gün
saklansın?** Mekanizma hazır (054 + cron), eksik olan sayı.

Referans için: CNIL 2 ay · İtalya 180 günü cezalandırdı · Geotab varsayılanı
2 yıl · bizim demo 14 gün · bizim gerçek kiracı **sınırsız (bugün 44 gün)**.
