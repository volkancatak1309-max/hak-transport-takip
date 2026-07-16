# HAK61 — Rakip DNA (FAZ 1)

**Tarih:** 15.07.2026
**Kapsam:** 4 filo-takip rakibi (Samsara, Geotab/MyGeotab, Webfleet, Verizon Connect Reveal) + 1 premium-SaaS referans katmanı (Linear, Stripe Dashboard, Vercel Dashboard + Pencil & Paper kurumsal UX analizleri).
**Metod:** Rakip başına ayrı bir web-research agent çalıştırıldı. En değerli kaynak türü, ekran görüntülü resmî yardım dokümanları oldu (özellikle Verizon Reveal'da 4 gerçek ekran görüntüsü doğrudan incelendi). İddiaların kaynak URL'leri ilgili cümlelerin yanında korunmuştur.
**Bağlam:** HAK61 = 26-28 araçlık, koyu temalı (bordo vurgu, mono plaka fontu), Türkçe filo paneli. Bu rapor FAZ 2 (tasarım sistemi) ve FAZ 3 (DataTable, StatCard, FilterBar, DetailDrawer, EmptyState, ⌘K palet) için doğrudan girdidir.

**İşaret sözlüğü:**

| İşaret | Anlamı |
|---|---|
| `[metinden]` | Ekran görüntüsü görülmeden, metin kaynaktan (doküman/inceleme/arama özeti) çıkarım |
| `[VARSAYIM]` | Doğrulanamadı; belgeleme yokluğundan veya dolaylı işaretlerden çıkarım |
| `[çıkarım]` | Bu raporun yazarının eklediği sentez/yorum (journal'daki ham bulgunun ötesine geçen kısım) |

**FAZ 0 denetiminin ana bulguları (bu raporun çözmeye çalıştığı sorunlar):**
1. Alarm ekranı gruplanmamış log duvarı.
2. Araç listesi veri taşımıyor.
3. Haritada çelişen sayılar + zoom sıfırlama.
4. KPI kartları tıklanamıyor.
5. Filtre-URL tutarsız.

---

## 1. Sektör DNA'sı — dört rakipte ortak desenler

1. **Canlı harita = komuta merkezi, dashboard ayrı bir sayfa.** Verizon'da varsayılan giriş ekranı Live Map (ekran görüntüsünden doğrulandı), Webfleet'te giriş sonrası birincil ekran harita `[metinden]` (help.webfleet.com/en_us/help/getting-started-with-webfleet/), Samsara'da giriş Fleet Overview Map `[metinden]` (kb.samsara.com "Monitor-Your-Fleet"). Geotab'da canlı operasyon Map sayfasında yaşar ama giriş klasik "menü > sayfa" kurgusudur `[metinden]`. **HAK61 için:** operatörün günlük ekranı harita+liste olmalı; KPI dashboard'u onu ikame etmez, tamamlar.

2. **Liste + harita tek durumu paylaşır.** Samsara'da arama/filtre uygulanınca sol liste ve harita eşzamanlı güncellenir `[metinden]` (kb.samsara.com "Monitor-Your-Fleet"); Webfleet'te solda daraltılabilir liste + sağda harita; Verizon'da liste kartında hover → haritada mavi halka vurgusu + görüş alanı dışındaki araç için harita kenarında yön oku. **HAK61 için:** FAZ 0'daki "haritada çelişen sayılar" bulgusunun kök nedeni tam olarak bu tek-durum ilkesinin ihlalidir `[çıkarım]`.

3. **Kümeleme sayaçlı tek ikon, zoom ile dağılır — dördünde de var.** Geotab: araç sayısıyla etiketli cluster ikonu (support.geotab.com/.../the-map); Webfleet: "bayrakla sayı" + ayarlanabilir eşik (help.webfleet.com/en_us/help/map/); Verizon: siyah cluster, tıklayınca içindeki araçların durum listesi (reveal-help.verizonconnect.com/.../360010455600); Samsara: "Fleet Clustering" seçenek olarak geçiyor, davranış detayı yok `[VARSAYIM: standart zoom-dağılan küme]`.

4. **Olay seli mutlaka bir eksende gruplanır — ama hiçbir rakip mükemmel değil.** Geotab: kural→araç→"Incident count" 3 seviyeli hiyerarşi (support.geotab.com/.../exceptions); Samsara: Safety Inbox'ta trip / sürücü-gün bazlı katlama + durum sekmeleri (samsara.com AI Safety Inbox blogu); Verizon: politika bazlı destelenmiş bildirim kartı ("15 more notifications", ekran görüntüsünden doğrulandı); Webfleet: yalnız şiddet tipine göre sekmeleme, araç bazlı gruplama belgelenmemiş `[VARSAYIM: yok]`. **HAK61 için:** FAZ 0 bulgu #1'in (log duvarı) sektör standardı çözümü gruplamadır; araç+olay-tipi ekseni HAK61 için en isabetli birleşim `[çıkarım]`.

5. **Tablo kişiselleştirme = kolon aç/kapa (dişli ikonu) + sürükle-sırala.** Geotab Assets (support.geotab.com/.../assets), Webfleet (cogwheel, help.webfleet.com/en_us/help/getting-started-with-webfleet/), Samsara "Display Options" `[metinden]`. Yoğunluk anahtarı (compact/comfortable) hiçbir rakipte belgelenmemiş — bunu yalnız premium SaaS katmanı sunuyor (bkz. Bölüm 3).

6. **Detay akışı iki kademeli: hafif önizleme → tam derinlik.** Samsara: marker → popup → yeni sekmede tam sayfa; Geotab: haritada panel, listede tam sayfa; Webfleet: her iki bağlamda drawer/panel (8 sekme); Verizon: balon + modal + menü + admin sayfası (parçalanmış). Sayfa geçişini en aza indiren Webfleet, en dağınık olan Verizon'dur `[metinden]`.

7. **Koyu tema sektörde istisna — HAK61'in doğrudan farklılaşma alanı.** Resmî koyu tema yalnız Samsara'da var (kullanıcı bazlı Theme dropdown; Ocak 2026 tarihli KB makalesi — görece yeni) `[metinden]` (kb.samsara.com "Dark-Mode"). Geotab'da yok (resmî foruma Chrome flag hack'i öneriliyor: community.geotab.com/s/question/0D52J00008cO5RNSA0), Webfleet'te yok (yalnız TomTom harita katmanında Night modu) `[metinden]`, Verizon'da yok (4 ekran görüntüsünün tümü beyaz zemin) `[gözlem + VARSAYIM]`.

8. **Mobil = rol bazlı ayrı native uygulamalar; responsive web istisna.** Dört rakip de yönetici/sürücü için ayrı app dağıtıyor (MyGeotab App + Geotab Drive; Webfleet Mobile + Work App; Samsara Fleet App + Driver App; Verizon Spotlight + Reveal Driver). Ancak mobil app'ler en çok şikayet alan yüzey: Verizon Spotlight "sürekli açılıp kapanıyor", mağaza puanları ≤3/5 `[metinden]` (expertmarket.com); Samsara app sık oturum düşürüyor `[metinden]` (G2/Capterra özetleri). Premium SaaS yolu farklı: Vercel responsive web + mobil yüzen alt bar (vercel.com/changelog/dashboard-navigation-redesign-rollout).

---

## 2. Rakip Profilleri

### 2.1 Samsara

*Not: kb.samsara.com doğrudan erişimde SSO login'e yönlendirdi; KB içerikleri arama motoru özetlerinden alındı — bu profildeki KB iddiaları `[metinden]` kabul edilmelidir.*

- **Yerleşim/Nav:** Kalıcı sol dikey nav: Overview (canlı harita), Safety, Compliance, Maintenance, Dispatch, Fuel & Energy, Documents, Reports, Alerts, Settings `[metinden]` (business.com/reviews/samsara/). "Favorites" ile herhangi bir sayfa nav'ın en üstüne sabitlenebiliyor (samsara.com/blog/dashboard-customization). "Clickable elements are well-spaced" övgüsü `[metinden]`.
- **Dashboard-KPI:** Tek KPI ana sayfası yok; alan bazlı overview'lar. Operations Overview Dashboard: tablo formatında metrikler, alarm-durumu renkleri, alarm veren metrikte zil ikonu — hover = hızlı bakış, tıklama = tam bildirim; veri noktası → tarihsel trend; asset adı → asset dashboard'ı linki (samsara.com/blog/introducing-the-operations-overview-dashboard). Reports hub: 80+ veri tipi, 16 kolona kadar sürükle-bırak custom report `[metinden]`.
- **Araç Listesi:** Fleet Overview Map'in sol paneli; varsayılan sıralama "In Motion" (hareket halindekiler üstte). "Display Options" ile satıra opsiyonel alan ekleme (yakıt, HOS, cihaz sağlığı); **verisi olmayan alan satırda hiç render edilmiyor** (adaptif satır). Resmî performans uyarısı: "For faster performance, select fewer data display options" `[metinden]` (kb.samsara.com "Customizable-Fleet-Overview-Data").
- **Canlı Harita:** Sol liste + sağ harita; arama/filtre ikisini birlikte günceller (kb.samsara.com "Monitor-Your-Fleet"). Marker → hafif popup: ad, canlı konum+hız, sürücü, yakıt, son kamera karesi. ~1 sn yenileme = "true real-time"; "helicopter view" ile tek araca kilitlenme; planlanan vs gerçekleşen rota `[metinden]` (businessnewsdaily.com/16254-samsara-review.html). Live Share: panele erişimi olmayanlara gerçek zamanlı konum/ETA linki `[metinden]`.
- **Alarm/Olay Triage:** İki sistem: (1) Alerts > Alert Incidents — tarih/arama/Trigger Type/Resolution Status filtreli liste `[metinden]`. (2) **Safety Inbox — e-posta inbox metaforu:** olaylar inceleme durumuna göre sekmelerde (Needs Review → Needs Coaching / Recognized / Reviewed / Coached / Dismissed); şiddet kırmızı→turkuaz renk noktası; **"Group events by trip or driver"** — tekrarlanan olaylar trip veya "Driver by Day" bazında katlanır, amaç "one-off'ları coaching trendlerinden ayırmak" (samsara.com/blog/ai-powered-insights-intelligent-safety-inbox-built-for-action). Dismiss nedeni org ayarıyla zorunlu kılınabilir; dismiss edilen olay skor/rapor hesabından düşer `[metinden]`.
- **Detay Akışı:** Satır/marker → hafif popup → tam detay **yeni sekmede ayrı sayfa** (drawer değil) `[metinden]`. Safety Event Summary ayrı sayfa: video + trip verisi + AI etiketleri + coaching aksiyonları.
- **Filtre/Arama:** Tek arama kutusu araç + asset + gateway + lokasyon arıyor. Filtre dili tutarlı: Tags / Attributes / tip-durum. Kayıtlı görünüm yok `[VARSAYIM]`; vekilleri: Favorites + kaydedilip zamanlanan custom raporlar. URL-durumu hakkında kaynak bulunamadı `[VARSAYIM]`.
- **Tema/Yoğunluk:** **Resmî Dark Mode var** — profil > Theme dropdown, kullanıcı bazlı `[metinden]` (kb.samsara.com "Dark-Mode"). Yoğunluk modu yok `[VARSAYIM]`; yoğunluk felsefesi "az alan seç, hızlı olsun" — performans pahasına opt-in.
- **Mobil:** Üç katman: Driver app (bilinçli kısıtlı), Fleet App (yönetici; varsayılan ekran canlı harita, alarm push, mesajlaşma), "Full Web Dashboard in Fleet App (Beta)" `[metinden]`. Şikayet: sık oturum düşürme `[metinden]`.
- **Çalınacak desenler:** liste+harita tek tuval (paylaşılan filtre durumu); "In Motion üstte" varsayılan sıralaması; adaptif satır (boş alan render etme); iki kademeli detay (popup → tam detay); inbox metaforlu triage + trip/sürücü-gün gruplama; zorunlu dismiss nedeni; Favorites sayfa sabitleme; alarm-farkındalıklı tablo hücresi (zil + hover özet + tık trend).
- **Kaçınılacaklar:** "clunky, not user friendly" dashboard şikayetleri + yavaş yükleme `[metinden]` (g2.com/products/samsara/reviews); standart görünüm dışına çıkınca rijitlik, veriyi export edip elde işleme zorunluluğu `[metinden]`; aşırı hassas AI tespitleri → alarm yorgunluğu `[metinden]` (capterra.com); çok adımlı erişim ("a few tools require multiple steps"); yoğunluk/performans takasının kullanıcıya yıkılması.

### 2.2 Geotab (MyGeotab)

- **Yerleşim/Nav:** Tek sayfalık web uygulaması, sol kenar menüsü. 2019 yenilemesinde nav ikonlarından renk bilinçli kaldırıldı ("menüye verilen dikkati azaltmak için") (geotab.com/blog/mygeotab-user-interface-update/). Kurgu klasik "menü > sayfa": Dashboard, Map, Activity, Zones, Groups & Rules > Exceptions, Safety `[metinden]`. **Uygulama durumu URL hash'inde:** `#<page>,<param:değer>` — her sayfa yer imlenebilir/paylaşılabilir (geotab.github.io/sdk/software/guides/mygeotab-urls/).
- **Dashboard-KPI:** Sabit KPI kartları değil, **rapor-widget modeli**: "Add Report" ile grafik ekleme, şablonlarda "Add chart to Dashboard: yes/no", özel grafikler Excel şablonuyla yükleniyor `[metinden]` (support.geotab.com/.../custom-reports). Gerçek KPI-kart davranışı Assets sayfasının üstündeki **Asset Summary Cards**'ta: dikkat gerektiren durumların sayacı (Offline, Low Battery, Maintenance...) + **karttaki ikonun aynısı ilgili araç satırının yanında** (support.geotab.com/.../assets). Kart tıklamasının listeyi filtrelediği açık değil `[VARSAYIM: filtre görevi görüyor olabilir]`.
- **Araç Listesi:** Assets sayfası; dişli ikonu ile kolon aç/kapa + sürükle-sırala. Filtre: grup, varlık tipi, durum; Fall 2024'te öncelik-bazlı filtreler (geotab.com/blog/mygeotab-product-update-fall2024/). Satır tıklaması ayrı Asset Details **sayfasına** gider (drawer değil) `[metinden]`.
- **Canlı Harita:** Harita-öncelikli + seçime bağlı yan panel (klasik %50 split değil) `[metinden]`. Kümeleme: sayıyla etiketli cluster ikonu. **Durum ikonografisi grameri:** hareket=ok, duruyor(zone içi)=daire, duruyor(zone dışı)=kare, iletişim yok=üstü çizili bulut, aktif alarm=ünlem, EV şarj=yıldırım+% (support.geotab.com/.../the-map). **Active Tracking:** konum saniyede bir güncellenir (20 hareketli araca kadar), araç haritada animasyonla yürütülüp gerçek veri gelince düzeltilir (support.geotab.com/mygeotab/doc/active-tracking). Katman kombinasyonları "Saved views" olarak kaydedilip varsayılan yapılabilir. Harita durumu URL'de: liveVehicleIds, highlightGroup, planRoutes.
- **Alarm/Olay Triage:** "Rules → Exceptions" modeli; **kural→araç→tekil olay 3 seviyeli hiyerarşi** — aynı araçtan tekrarlanan olaylar araç satırında "Incident count" sayacıyla toplanır (support.geotab.com/.../exceptions). Filtreler: grup, kural, tarih aralığı, "include dismissed" anahtarı; Asset/Driver görünüm değiştirici. Anlık kanalda gruplama YOK: resmî doküman "aynı kural için çok fazla bildirim alma riski"ni kabul ediyor; "On Screen Urgent" popup'ı siz kapatana kadar ekranda `[metinden]` (support.geotab.com/.../rule-notifications). Şiddet seviyesi Exceptions'ta belgelenmemiş `[metinden]`.
- **Detay Akışı:** İkili: haritada drawer benzeri "asset panel" (Trip/Edit/Message/Share/Dispatch aksiyonları); listede tam sayfa Asset Details (3 sekme; Fall 2024'te kart-bazlı yerleşim, "en faydalı detaylar en üstte"). Geotab bile tıklama sayısını azaltmak için iki kez yeniden düzenleme yapmak zorunda kaldı `[metinden]` (geotab.com/blog/mygeotab-updates-2103/).
- **Filtre/Arama:** Fall 2024: **scoped search** (sonucu varlık/sürücü/zone tipine daraltma) + aktif filtrelerin araç çubuğunda belirgin gösterimi (geotab.com/blog/mygeotab-product-update-fall2024/). **URL durumu sektördeki en güçlüsü:** `dateRange:(interval:Today)`, `selectedEntities:!(b1,b7)`, sortMode, groupSelection — hepsi paylaşılabilir derin link (geotab.github.io/sdk/software/guides/mygeotab-urls/).
- **Tema/Yoğunluk:** **Koyu tema yok** — resmî toplulukta Chrome "Force Dark Mode" flag'i öneriliyor (community.geotab.com/s/question/0D52J00008cO5RNSA0). Roboto + responsive type scale; renk disiplini net: kırmızı=dikkat, mavi=yalnız link (geotab.com/blog/mygeotab-user-interface-update/). Yoğunluk modu yok `[metinden]`; 2019'da bilinçli beyaz alan eklendi (yoğunluğu düşürme yönü).
- **Mobil:** Rol bazlı: MyGeotab App (yönetici: canlı harita, Trips, kurallar, raporlar — marketplace.geotab.com/solutions/mygeotab-app/) + Geotab Drive (sürücü: HOS/ELD, DVIR) + optimize responsive web `[metinden]`.
- **Çalınacak desenler:** kural→araç→olay gruplaması + Incident count; Asset Summary Cards ↔ satır ikonu eşleşmesi; hash-URL durum taşıma ("şu aracın bugünü" linkini WhatsApp'a atabilmek); durum ikonografisi grameri (renk+şekil ikilisi); Active Tracking animasyonu (ucuz premium canlılık hissi); kayıtlı harita görünümleri; scoped search + görünür aktif filtreler.
- **Kaçınılacaklar:** "clunky UI" + zaman alan login `[metinden]` (fleetlogging.com/geotab/); bilgi yığılması ("o kadar çok veri var ki kritik noktayı izlemek zor") `[metinden]`; dik öğrenme eğrisi ("Samsara kadar cilalı değil") `[metinden]` (softabase.com/software/fleet/geotab); anlık bildirimde debounce yok + kalıcı popup işgali `[metinden]`; koyu tema yokluğu; rapor-widget dashboard modeli (küçük filo için aşırı dolaylı); liste→detayın hep tam sayfa olması.

### 2.3 Webfleet (Bridgestone; eski TomTom Telematics)

*Bu profilin neredeyse tamamı resmî kullanıcı kılavuzu metinlerinden — ekran görüntüsü doğrulaması yok, genel işaret `[metinden]`.*

- **Yerleşim/Nav:** Kalıcı sol dikey menü ("The main menu is always visible"), ikon-only ↔ ikon+etiket daralt/genişlet. **20+ menü maddesi** (Map, Vehicles, TPMS, Cold Chain, EV Smart Charging, Tachograph...) (help.webfleet.com/en_us/help/getting-started-with-webfleet/). Üst barda: aktif görünüm adı + **Event bar** (video/alarm/bakım ikonları) + kullanıcı menüsü. Giriş sonrası birincil ekran harita; dashboard ayrı menü maddesi.
- **Dashboard-KPI:** "Up to 27 KPIs... in real time" (webfleet.com/en_us/webfleet/products/webfleet/features/). 3 grafik tipi: **Value / Ranking / Trend**; Gün-Hafta-Ay agregasyon; kapsam: tüm filo / grup / tek araç. **Eşikler:** alt-üst limit tanımlanıp istisnalar grafikte görsel vurgulanıyor. Kullanıcı başına 5 özel dashboard. **Tıklama davranışı: tile → drill-down** — üstte detaylı trend, altında ranking; bardaki tek çubuğa tıklayınca o aracın bireysel trendi (help.webfleet.com/en_us/help/dashboard/).
- **Araç Listesi:** Zengin varsayılan kolonlar (araç ikonu+müsaitlik, ad, sürücü, durum, son konum, Event kolonu, son güncelleme, yola elverişlilik). **Kritik kural: Event kolonunda satır başına TEK rozet, "her zaman geçerli en yüksek bildirim seviyesinin rengi"** (help.webfleet.com/en_us/help/vehicles/). Satır tıklanınca "details panel" açılır — sayfa değişmez. Kolon sürükle-sırala + cogwheel + Excel export.
- **Canlı Harita:** Klasik split: solda daraltılabilir liste, sağda harita. Kümeleme: "bayrakla sayı" + ayarlanabilir eşik. **Etiket disiplini: etiket başına en fazla 2 öğe** (ad/plaka/sürücü) + "Points only" modu. Durum: yeşil Available / sarı Busy / gri Not available + yön oku. **Follow çözümü: tek aracı izlemek için ayrı "detail map"** — ana haritadaki filo görünümü bozulmuyor. Performans kalıbı: 500+ araçta etiketler otomatik gizlenip yuvarlak marker'a düşülüyor (help.webfleet.com/en_us/help/map/). Harita: TomTom (Standard + Night) veya Google.
- **Alarm/Olay Triage:** **5 kademeli şiddet:** Alarm 3 > Alarm 2 > Alarm 1 > Warning > Notice. **İki aşamalı akış: alarmlar önce "Acknowledge" sonra "Resolve"**; Warning/Notice doğrudan Resolve; toplu "Acknowledge all / Resolve all" var. Event bar çözülmemiş bildirimleri 7 gün gösterir, en yüksek önemin ikonuyla; tıklayınca Alarms/Warnings/Notices sekmeli popup — **gruplama şiddet tipine göre, araca göre DEĞİL**; araç bazlı tekilleştirme belgelenmemiş `[VARSAYIM: yok]` (help.webfleet.com/en_us/help/notifications/). Çarpışma raporunda kaza öncesi 45 sn / sonrası 15 sn hız-ivme grafiği.
- **Detay Akışı:** **Drawer/panel kalıbı birincil:** hem listede hem haritada tıklama "details panel" açıyor; **8 sekmeli araç detayı** (Vehicle / Driver / Orders / Messages / Notifications / Maintenance / Trips / Videos) (help.webfleet.com/en_us/help/vehicles/). Tam sayfa detay net belgelenmemiş `[VARSAYIM: panel birincil]`.
- **Filtre/Arama:** Önceden tanımlı filtreler (tarih aralığı, grup) + serbest metin; harita filtreleri durum-odaklı (sürüşte/duruşta/inaktif; müsaitlik; Business/Commute/Private). Kayıtlı görünüm ve URL-filtre durumu belgelerde YOK `[VARSAYIM: yok]`. Global arama yok; arama görünüm-bazlı.
- **Tema/Yoğunluk:** Koyu tema kanıtı yok (yalnız TomTom harita Night modu) → açık temalı kurumsal panel `[VARSAYIM]`. Yoğunluk modu yok; kontrol cogwheel + panel daralt/genişlet ile. Renk disiplini işlevsel (müsaitlik yeşil/sarı/gri, şiddet renkleri).
- **Mobil:** Ayrı native companion: Webfleet Mobile (iOS/Android; masaüstünün alt kümesi) (webfleet.com/en_us/webfleet/products/webfleet/features/mobile/) + sürücü tarafında Work App ve Vehicle Check. GetApp mobil puanı 4.7/5 `[metinden]`.
- **Çalınacak desenler:** Event kolonu "tek rozet = en yüksek şiddet rengi" kuralı (HAK61 satırındaki DTC+alarm+bakım rozet kalabalığına birebir çözüm); Acknowledge→Resolve iki aşamalı triage + toplu işlem; kalıcı Event bar (her ekrandan triage'a tek tık); 8 sekmeli detay drawer'ı; follow için ayrı detail map; 2 öğelik etiket disiplini; KPI tile → drill-down + eşik çizgileri.
- **Kaçınılacaklar:** karmaşık raporlama/yapılandırma, "GUI daha dostane olabilir" `[metinden]` (capterra.com/p/134918/WEBFLEET/reviews/); güncelleme sonrası "glitchy" yazılım (fleetlogging.com/webfleet/); harita render gecikmeleri `[metinden]` (getapp.com); araç-bazlı olay gruplaması yokluğu → olay selinde liste şişmesi `[VARSAYIM]`; koyu tema yokluğu; 20+ maddelik şişmiş sol menü (küçük filo için ilgisiz modüller).

### 2.4 Verizon Connect Reveal (Reveal+)

*Bu profil 4 gerçek ekran görüntüsüyle doğrulanmış tek profildir (yardım dokümanı ekleri görsel olarak incelendi).*

- **Yerleşim/Nav:** **Üst yatay nav** (ekran görüntüsünden doğrulandı): Live Map, Scheduler, Reports, Replay, Video, Places, Alerts, Dashboard; aktif sekme kırmızı alt çizgili; sağda kırmızı rozetli bildirim zili. **Sol menü yok.** Varsayılan giriş: Live Map `[metinden]` (expertmarket.com). Live Map'te haritanın üzerine bindirilmiş küçültülebilir sol panel (Fleet selection / Fleet Status sekmeleri). Full Screen modu panel + üst menüyü gizler (reveal-help.verizonconnect.com/.../360010567759).
- **Dashboard-KPI:** 6 hazır dashboard (Management Overview, Safety, Fuel, Payroll, Fleet Management, Operations); maks 12 tile; 3 tile tipi: **Ranking (leaderboard) / Trend / Gauge (benchmark'a karşı renkli ibre)** (reveal-help.verizonconnect.com/.../360010610359). **Tile FLIP düzenlemesi:** dişliye basınca kart ters yüz olup arkasında kriter formu — modal yok, bağlam kaybolmuyor (ekran görüntüsünden doğrulandı). Benchmark'lar "My Benchmarks"tan tüm tile'lara yansıyor; dashboard kaydetme + kişi/grupla paylaşma; sistem son bakılan dashboard'u oturum ötesi hatırlıyor. Tile tıklamasının detaya gittiği belirsiz `[VARSAYIM: sınırlı; esas drill-down Reports üzerinden]`. Custom dashboard her hesapta açık değil (destek çağrısı gerekiyor) `[metinden]`.
- **Araç Listesi:** Üç ayrı kalıp: (1) **Fleet Status kart listesi** (kolonlu tablo değil): araç adı bold + EV rozeti, renkli durum ikonu, "Last Movement" zaman damgası, 2 satır adres, grup, GPS sinyal çubukları, kebab menü. **Canlılık sinyali: araç veri gönderdiği anda kartı kısa süre maviye yanıp sönüyor** `[metinden]` (reveal-help.verizonconnect.com/.../360010567839). (2) Text View: 6+ araçta harita yerine sıralanabilir gerçek zamanlı tablo `[metinden]`. (3) Admin Vehicle List (Account Profile > Admin altında saklı) `[metinden]`.
- **Canlı Harita:** Google Maps tabanlı. Durum ikonları: yeşil ok=Moving, sarı=Idling, kırmızı=Stopped + Charging/No signal/Privacy/Towing/Panic. Kümeleme: siyah cluster + sayı; tıklayınca içindeki araçların durum listesi. **Liste↔harita bağı: kartta hover → haritada mavi halka; görüş alanı dışındaki araç için harita kenarında yön göstergesi.** **Fit to Map:** harita oynatılınca beliren geçici buton + kalıcı ikon — tüm filoyu tek karede toplar (reveal-help.verizonconnect.com/.../360010567759). Map Options: Default / **Low color** (renk azaltılmış okunabilirlik modu) / Satellite; Suggested Geofences (sık ziyaretlerden otomatik öneri). Follow modu yok `[VARSAYIM: Replay ile telafi]`. Veri yenileme ~30 sn — bazı rakiplerin iki katı `[metinden]`.
- **Alarm/Olay Triage:** İki katman: (A) **Bildirim paneli (sağ drawer):** aynı alarm politikasının bildirimleri **tek destelenmiş kartta** — en son olay + bold değer ("100 mph, 25 mph over") + "15 more notifications" sayacı; tek tıkla deste açılıyor; DISMISS ALL; 3 gün saklama (ekran görüntüsünden doğrulandı; reveal-help.verizonconnect.com/.../360060278234). (B) **Alerts sayfası — triage hunisi:** Overview'da politika başına tile (toplam sayı + kırmızı okunmamış rozet + son tetiklenme + "Most triggered" sıralaması) → tile tıkla → Alert Summary: trend bar grafiği + **Rank (bu alarmı en çok tetikleyen araçlar)** + filtrelenebilir Alert log + CSV (reveal-help.verizonconnect.com/.../360010453720). Alert Log satırı → alarm tipine göre değişen modal; okunmamışlar bold; toplu Mark as read/Delete. **Şiddet yalnız 2 seviye (high/regular); araç bazlı gruplama yok, yalnız politika bazlı** `[metinden]` (reveal-help.verizonconnect.com/.../360010565639).
- **Detay Akışı:** **Tek kalıp yok — dört mekanizma karışık:** balon (popup), kebab/sağ-tık Actions menüsü (eylem odaklı: Find Nearest, Replay, geofence, Directions...), modal (Alert Log), ayrı sayfa (Alert Summary, Admin Edit Vehicle). **Web'de tam teşekküllü araç detay sayfası yok** — bilgi balon+kart+admin'e dağılmış `[metinden]`. Mobilde ise modern kalıp: dokun → alttan panel → swipe-up tam detay.
- **Filtre/Arama:** Karışık arama (adres/araç/sürücü, min 3 karakter). Durum dropdown filtresi; **"Order by Status" seçilince acil durumlar (Panic, Towing, Loss of signal, Privacy) her zaman en üstte** — aciliyet öncelikli sıralama (reveal-help.verizonconnect.com/.../360010454900). Kayıtlı görünüm yok; en yakını dashboard paylaşımı + "son kriterleri hatırlama". URL-filtre durumu dokümante edilmemiş `[VARSAYIM: yok]`.
- **Tema/Yoğunluk:** Yalnız açık tema `[gözlem + VARSAYIM]`. Beyaz zemin + siyah metin + kırmızı tek vurgu (aktif sekme, rozetler) + durum renkleri yalnız telemetri için; siyah dolgulu CTA ("CREATE ALERT"). Tek yoğunluk; kartlar ferah, tablolar orta. Haritada "Low color" modu ilginç okunabilirlik detayı.
- **Mobil:** Ayrı native ekosistem: Spotlight (yönetici; 5 ekran: Map/Drivers/Reports/Alerts/Account; sürüklenebilir bottom-sheet liste; durum çipleri; swipe-up detayda VIN, yakın araçlar, son alarmlar) (reveal-help.verizonconnect.com/.../360050987094) + Reveal Driver + ELD Logbook. **Kalite sorunu:** "sürekli açılıp kapanıyor", puanlar çoğunlukla ≤3/5 `[metinden]`.
- **Çalınacak desenler:** bildirim destesi (araç+politika bazlı yığma + son olay + sayaç); alarm triage hunisi (tile → trend + Rank + log); canlılık sinyali (veri gelince kartın maviye yanması — koyu temada subtle glow/pulse olarak, flespi telemetry güncellemelerine bağlanabilir); "Order by Status" aciliyet sıralaması; liste↔harita hover eşleşmesi + ekran-dışı yön oku; harita köşe üçlüsü (Fit to Map / Full Screen / Text View); dashboard tile flip düzenlemesi.
- **Kaçınılacaklar:** dik öğrenme eğrisi `[metinden]` (tech.co); **araç detayının parçalanmışlığı** (dört ayrı mekanizma); ~30 sn yavaş yenileme; zayıf mobil uygulamalar; eskimişlik algısı + glitch şikayetleri `[metinden]` (capterra.com/p/72551/Fleetmatics-Work/reviews/); yalnız 2 şiddet seviyesi + araç bazlı gruplama yokluğu; özelliklerin hesap/eklenti arkasına kilitlenmesi; kayıtlı görünüm/paylaşılabilir filtre yokluğu `[VARSAYIM]`.

---

## 3. Premium SaaS Katmanı (Linear / Stripe / Vercel + Pencil & Paper)

Filo rakiplerinin hiçbirinde olmayan etkileşim kalitesinin kaynağı bu katman. Canlı harita bu üç üründe yok — harita kalıpları buradan alınamaz; alınacak olan liste, detay, filtre, triage ve tema disiplinidir.

### 3.1 Peek / Drawer (satır→detay)
- **Linear peek** (linear.app/docs/peek): Space'e bir kez bas → peek açık kalır; basılı tut → geçici göster; Esc → kapat. **Panel açıkken ↑/↓ ile komşu kayda geçilir ve panel güncellenir.** Komut menüsünde gezinirken öğeler otomatik peek'lenir. Triage için "Split View": liste + odaklanılan kayıt yan yana.
- **Pencil & Paper karşılaştırması** (pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables): genişleyen satır = az detay; **sidebar/drawer = "ölçeklenebilir çok sayıda veri için ideal"**; modal = geliştirmesi kolay ama bağlamdan koparır; tam ekran = yalnız yoğun inceleme.
- **HAK61 çıkarımı** (journal'daki agent çıkarımı): satır→drawer (peek) varsayılan; tam sayfa detay yalnız derin inceleme; drawer açıkken klavyeyle araç değiştirme şart.

### 3.2 ⌘K komut paleti kuralları
- Geist Command Menu (vercel.com/geist/command-menu): ⌘K/Ctrl+K; **eylem-odaklı başlıklar** ("Sayfaya git" değil — "Deploy Project", "Invite Team Member"; HAK61'de "ARC-07'yi haritada izle"); 1-2 kelimelik Title Case grup başlıkları; **boş inputta Backspace ile sayfa yığınından geri dönme**. Sitenin kendi ⌘K'sı varsa Vercel toolbar Cmd+Shift+K'ya kaçar (vercel.com/changelog/command-menu-now-available-in-deployments).
- Linear'da Cmd+K bir navigasyon katmanı gibi çalışır (URL yapıştırınca oraya gider); `G` sonra `I`/`T` "go-to" akorları (linear.app/docs/inbox, linear.app/docs/custom-views).
- Command bar tezi (maggieappleton.com/command-bar): fuzzy search + kısayolların palet içinde gösterimi, kullanıcıyı zamanla klavyeye geçirir.

### 3.3 Filtre çipi + URL durumu
- Linear (linear.app/docs/filters): `F` filtre menüsünü açar; filtreler **çip/formül** olarak görünür, formülün parçasına tıklayıp operatör değiştirilir ("is / is not / is either of / includes any-all-none / before-after"); Advanced ile AND/OR gruplama; **uygulanan filtreler URL'ye yazılır — URL kopyalamak görünümü paylaşmaktır.**
- Kayıtlı görünüm (linear.app/docs/custom-views): filtreli listeden `Alt+V` ile kaydet, yıldızla sidebar favorilerine sabitle, sahibi var, kopyalanabilir.
- Pencil & Paper filtreleme (pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering): küçük veri setinde **live filtering** doğru (26-28 araç bu sınıfta); sonuç sayısı her zaman görünsün; "Clear all" hem tekil hem genel seviyede; tarih için ön ayar ("bu hafta") + özel seçim.

### 3.4 Token arama (Stripe)
- docs.stripe.com/dashboard/search: `last4:4242`, `amount:>149.99`, `date:<2020-07-12`, `amount:50.00..99.99`, `is:refunded`, `-exp:08/22` (negatif), `metadata:order_id=xyn712`; "last week" gibi doğal tarih ifadeleri; **arama URL'si yer imlenebilir/paylaşılabilir**; ilk eşleşmeler anında, Enter ile tam sonuç sayfası.
- HAK61 uyarlaması (journal'daki agent çıkarımı): `plaka:61ABC`, `hiz:>90`, `durum:arizali`, `-durum:cevrimdisi`, "son hafta" — ⌘K içine gömülebilir.

### 3.5 Triage inbox (1/2/3/H)
- Linear Triage (linear.app/docs/triage): takımın alarm gelen kutusu; **tek tuş: `1` kabul, `2` yinelenenle birleştir (ekler taşınır), `3` reddet, `H` ertele (snooze)**; Split View liste+odak; Business planda Triage Rules (koşul→otomatik aksiyon) + AI önerileri.
- Linear Inbox (linear.app/docs/inbox): `U` okundu/okunmadı, `H` snooze — **bildirim gizlenir, seçilen zamanda geri gelir**; `Cmd/Ctrl+F` ile tür/takım/öncelik filtresi; en fazla 2.000 açık bildirim.
- HAK61 çıkarımı (journal): hız ihlali/DTC/rölanti alarmlarına 1-2-3-H tek tuş triage; snooze'un zamanla geri dönmesi tekrar eden DTC'ler için kritik `[çıkarım]`.

### 3.6 Yoğunluk üçlüsü (40/48/56px)
- Pencil & Paper data tables: satır yüksekliği anahtarı **Condensed 40px / Regular 48px / Relaxed 56px**; aksiyonlar (checkbox, düzenle, üç-nokta) yalnız hover'da; yatay kaydırmada ilk sütun + başlık sabit; tüm satırın hover'da tıklanabilir görünmesi "detay var" sinyali.
- Linear'da density ayarı dokümante DEĞİL; onun yerine "display properties" ile satırdaki alan sayısı azaltılıp çoğaltılarak fiilî yoğunluk kontrolü (linear.app/docs/display-options). Ayrıca grouping (swimlane dahil) + ordering ayrı katmanlar.

### 3.7 Geist renk sistemi: iki katmanlı arka plan + hover/active adımları
- vercel.com/geist/colors: **iki arka plan katmanı** (`--ds-background-100` varsayılan sayfa, `--ds-background-200` ikincil/kart); arka plan dışı her skala **100→1000 arası 10 adım**; 10 skala (backgrounds, gray, gray-alpha, blue, red, amber, green, teal, purple, pink); **durum kuralı: Color 1 = hover arka planı, Color 2 = active arka planı** — hover ve active için ayrılmış iki adım. Sistem CSS değişken token'ları üzerine kurulu olduğundan tema değişimi sistematik (journal'da çıkarım olarak işaretlendi).
- HAK61 çıkarımı (journal): koyu temada sayfa vs kart iki katman + 10 adımlı gri + hover/active ayrık adımları birebir uygulanabilir.

### 3.8 Boş durum üçlüsü
- pencilandpaper.io/articles/empty-states: **başlık + motivasyon cümlesi + CTA** ("Henüz alarm kuralın yok" + neden işine yarar + "Kural oluştur").
- Filtre boş sonuç verdiğinde: sonuç sayısı sıfır görünür + "Tümünü temizle" bir tık uzakta (pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering).

### 3.9 Diğer aktarılabilir kalıplar
- **KPI → filtrelenmiş listeye derin bağlantı:** Vercel usage metriklerinden ilgili Observability sekmesine tek tık (vercel.com/changelog/one-click-linking-from-usage-to-vercel-observability-dashboards).
- **Araç kartı = Vercel proje kartı:** kartta en kritik 3 bilgi + son production deployment'ın ekran görüntüsü; deployment durumunun tarayıcı sekme ikonuna (favicon) yansıtılması (vercel.com/blog/dashboard-redesign). HAK61 uyarlaması: son konumun statik mini-harita anlık görüntüsü + durum rozeti (journal'daki agent çıkarımı).
- **Sidebar anatomisi:** Stripe üç bölge — ana menü / Shortcuts (ziyaret edilen + sabitlenen) / ürün bölümleri; `?` tuşu kısayol listesini açar (docs.stripe.com/dashboard/basics). Vercel: yeniden boyutlandırılabilir-gizlenebilir sidebar + mobilde tek elle kullanıma optimize yüzen alt bar (vercel.com/changelog/dashboard-navigation-redesign-rollout).

### 3.10 Anti-desenler (bu katmanın açık uyarıları)
- **Zebra striping:** hover/focus/active/disabled durum ayrımını bozar → ince satır ayraçları (pencilandpaper.io/.../enterprise-data-tables).
- **Detay için modal:** bağlamdan koparır; çok alanlı detayda drawer ölçeklenir (aynı kaynak).
- **⌘K'da navigasyon dili:** "Sayfaya git" yerine eylem cümlesi (vercel.com/geist/command-menu).
- **Uygulanan filtreleri gizlemek** (özellikle mobilde): çipler görünür kalmalı (pencilandpaper.io/.../enterprise-filtering).
- **Boş sonuç durumunu tasarlamamak + sonuç sayısını göstermemek** (aynı kaynak).
- **Küçük listeye aşırı filtre derinliği:** 26-28 araçlık listede filtre sayısı az ve isabetli olmalı (aynı kaynak).

---

## 4. Desen Karşılaştırma Matrisi

| Desen | Samsara | Geotab | Webfleet | Verizon Reveal | Premium SaaS |
|---|---|---|---|---|---|
| **Nav konumu** | Sol dikey + Favorites sabitleme `[metinden]` | Sol dikey, renksiz ikonlar | Sol dikey, daraltılabilir, 20+ madde `[metinden]` | **Üst yatay** (sektörde istisna) | Sol sidebar (Vercel, Stripe) + klavye katmanı (Linear) |
| **Varsayılan giriş ekranı** | Canlı harita (Fleet Overview) `[metinden]` | Menü > sayfa; Dashboard/Map ayrık `[metinden]` | Canlı harita `[metinden]` | Canlı harita (Live Map) | Ürüne göre (Vercel: proje kartları) |
| **Liste+harita split** | ✓ sol liste + harita, senkron filtre `[metinden]` | ✗ harita-öncelikli + seçim paneli `[metinden]` | ✓ daraltılabilir sol liste `[metinden]` | ~ haritaya bindirilmiş sol panel | — (harita yok; eşdeğeri Linear Split View) |
| **Kümeleme** | ✓ "Fleet Clustering" `[VARSAYIM: standart]` | ✓ sayılı cluster ikonu | ✓ bayraklı sayı + eşik ayarı `[metinden]` | ✓ siyah cluster; tıkla → durum listesi | — |
| **Olay gruplama** | ✓✓ trip / sürücü-gün + durum sekmeleri `[metinden]` | ✓✓ kural→araç→Incident count | ✗ yalnız şiddet sekmeleri `[VARSAYIM: araç bazlı yok]` | ✓ politika bazlı deste + Rank; araç bazlı yok | ✓✓ 1/2/3/H + yinelenen birleştirme + snooze |
| **Satır→detay** | popup → yeni sekmede tam sayfa `[metinden]` | haritada panel / listede tam sayfa | ✓✓ drawer, 8 sekme `[metinden]` | ✗ parçalı: balon+modal+menü+admin sayfası | ✓✓ peek/drawer + ↑/↓ gezinme |
| **Filtre-URL / kayıtlı görünüm** | ✗ (Favorites/rapor vekilleri) `[VARSAYIM]` | ✓✓ hash-URL + Saved views | ✗ `[VARSAYIM]` | ✗ (yalnız son kriter hatırlama) `[VARSAYIM]` | ✓✓ URL filtre + Alt+V görünüm + token arama URL'si |
| **Koyu tema** | ✓ resmî, kullanıcı bazlı (yeni) `[metinden]` | ✗ (Chrome flag hack'i) | ✗ (yalnız harita Night) `[metinden]` | ✗ `[gözlem+VARSAYIM]` | ✓ token tabanlı (Geist) `[çıkarım]` |
| **Yoğunluk modu** | ✗ (alan seçimiyle dolaylı) `[VARSAYIM]` | ✗ (beyaz alan yönü) `[metinden]` | ✗ `[VARSAYIM]` | ✗ tek yoğunluk | ✓ 40/48/56px anahtarı (P&P); Linear'da display properties |
| **Mobil yaklaşım** | Ayrı native (Fleet App + Driver) `[metinden]` | Ayrı native (MyGeotab App + Drive) + responsive web | Ayrı native (Webfleet Mobile + Work App) `[metinden]` | Ayrı native (Spotlight + Driver); puanlar ≤3/5 `[metinden]` | Responsive web + yüzen alt bar (Vercel); Stripe'ta native ek |

---

## 5. HAK61 Kararları (FAZ 2/3 girdisi)

Her karar: **desen → kaynak → HAK61'de uygulama → çözdüğü FAZ 0 bulgusu.**

1. **Alarm ekranı = araç+olay-tipi bazlı destelenmiş triage inbox.** Verizon bildirim destesi ("15 more notifications" sayaçlı yığın, reveal-help.verizonconnect.com/.../360060278234) + Geotab Incident count (support.geotab.com/.../exceptions) + Samsara trip/sürücü-gün gruplaması `[metinden]`. HAK61'de: aynı aracın aynı tip olayları tek kartta — son olay + bold değer + toplam sayaç; tık ile deste açılır. → **Bulgu 1 (log duvarı).**

2. **İki aşamalı triage + tek tuş klavye.** Webfleet Acknowledge→Resolve + toplu işlem (help.webfleet.com/en_us/help/notifications/) + Linear 1/2/3/H (linear.app/docs/triage). HAK61'de: kritik alarm önce "Görüldü" sonra "Çözüldü"; `1` kabul, `2` yinelenenle birleştir, `3` reddet, `H` ertele (snooze zamanında geri gelir — tekrar eden DTC için `[çıkarım]`). → **Bulgu 1.**

3. **Alarm triage hunisi: tip kartı → trend + Rank → log.** Verizon Alerts Overview (politika tile'ı: toplam + okunmamış rozet + son tetiklenme → Alert Summary: trend grafiği + "en çok tetikleyen araçlar" Rank listesi, reveal-help.verizonconnect.com/.../360010453720). HAK61'de: alarm tipi kartları üst seviye; "bu alarmı en çok üreten araç" sıralaması 26-28 araçta çok değerli. → **Bulgu 1, Bulgu 4.**

4. **Araç satırında tek rozet = en yüksek şiddetin rengi.** Webfleet Event kolonu kuralı (help.webfleet.com/en_us/help/vehicles/). HAK61'de: DTC + alarm + bakım rozet kalabalığı yerine satır başına tek "en kötü durum" göstergesi; detay drawer'da açılır. → **Bulgu 2.**

5. **DataTable: display properties + adaptif satır + sabit plaka kolonu.** Linear display options (linear.app/docs/display-options) + Samsara Display Options ve "verisi olmayan alan render edilmez" kuralı `[metinden]` (kb.samsara.com "Customizable-Fleet-Overview-Data") + P&P sabit ilk sütun ve hover aksiyonları. HAK61'de: mono plaka sütunu sabit; durum/hız/sürücü/son-görülme aç-kapa alanlar; varsayılan gruplama duruma göre (hareketli/rölanti/çevrimdışı/arızalı) `[çıkarım — journal'daki agent önerisinin FAZ 3 DataTable'a bağlanması]`. → **Bulgu 2.**

6. **Varsayılan sıralama: aciliyet + hareket.** Verizon "Order by Status"ta istisna durumların (sinyal kaybı, panik) hep üstte olması (reveal-help.verizonconnect.com/.../360010454900) + Samsara "In Motion üstte" `[metinden]`. HAK61'de: arızalı/çevrimdışı üstte, sonra hareketli, sonra duran. → **Bulgu 2.**

7. **DetailDrawer: satır→peek, tam sayfa yalnız derin inceleme.** Linear peek (Space, ↑/↓ ile araç değiştirme, Esc; linear.app/docs/peek) + Webfleet 8 sekmeli details panel (help.webfleet.com/en_us/help/vehicles/) + P&P "drawer ölçeklenir, modal koparır". HAK61'de: listede ve haritada aynı drawer bileşeni; sekmeler: Genel / Seferler / Alarmlar / Arızalar (DTC) `[çıkarım]`. → **Bulgu 2, Verizon'daki parçalanmışlık anti-deseninin önlenmesi.**

8. **StatCard: her KPI kartı filtrelenmiş listeye derin bağlantı.** Vercel usage→Observability tek-tık kalıbı (vercel.com/changelog/one-click-linking-from-usage-to-vercel-observability-dashboards) + Webfleet tile→drill-down (help.webfleet.com/en_us/help/dashboard/) + Linear URL-filtre durumu. HAK61'de: "Hareketli: 18" kartı `durum=hareketli` filtreli araç listesini URL'iyle açar; kartta eşik aşımı görsel vurgulanır (Webfleet alt-üst limit kalıbı). → **Bulgu 4.**

9. **FilterBar: filtre çipleri + URL durumu + kayıtlı görünüm.** Linear filters (`F`, çip/operatör formülü, URL'ye yazma; linear.app/docs/filters) + Geotab hash-URL derin linkleri (geotab.github.io/sdk/software/guides/mygeotab-urls/) + Linear custom views (`Alt+V`; linear.app/docs/custom-views). HAK61'de: tüm liste/harita filtreleri URL'de; link paylaşımı = görünüm paylaşımı ("şu aracın bugünü" linki); 2-3 kayıtlı görünüm sidebar'a yıldızlanır. Live filtering (26-28 araç küçük set; P&P kuralı). → **Bulgu 5.**

10. **⌘K palet: eylem dili + token arama + palette peek.** Geist Command Menu kuralları (eylem-odaklı başlık, Backspace yığını; vercel.com/geist/command-menu) + Stripe token sözdizimi (docs.stripe.com/dashboard/search) + Linear otomatik peek (linear.app/docs/peek). HAK61'de: "ARC-07'yi haritada izle" tarzı Türkçe eylem cümleleri; `plaka:61ABC`, `hiz:>90`, `-durum:cevrimdisi` token'ları; palette gezinirken araç drawer'ı peek'lenir. → **Bulgu 2, 4, 5'e çapraz destek.**

11. **Harita: liste+harita tek durum + Fit to Map.** Samsara senkron liste+harita `[metinden]` (kb.samsara.com "Monitor-Your-Fleet") + Verizon Fit to Map (geçici buton + kalıcı ikon) ve hover↔halka eşleşmesi + ekran-dışı yön oku (reveal-help.verizonconnect.com/.../360010567759). HAK61'de: harita ve liste aynı filtre durumunu (URL'den) okur — sayılar asla çelişemez; kullanıcı haritayı oynatınca "Filoyu sığdır" butonu belirir, otomatik zoom sıfırlama kaldırılır. → **Bulgu 3.**

12. **Kümeleme + etiket disiplini + durum ikon grameri.** Sayılı küme (4 rakip ortak); etiket başına maks 2 öğe + "Points only" düşüşü (help.webfleet.com/en_us/help/map/) `[metinden]`; Geotab şekil grameri: hareket=ok, duran=daire/kare, iletişim yok=üstü çizili bulut, alarm=ünlem (support.geotab.com/.../the-map). HAK61'de: koyu temada renk+şekil ikilisi (renk körlüğü güvencesi `[çıkarım]`); kümeye tıklayınca içindeki araçların durum listesi (Verizon kalıbı). → **Bulgu 3.**

13. **Canlılık sinyalleri: taze veri parıltısı + animasyonlu hareket.** Verizon "kart veri gelince maviye yanar" `[metinden]` (reveal-help.verizonconnect.com/.../360010567839) + Geotab Active Tracking animasyonu (support.geotab.com/mygeotab/doc/active-tracking). HAK61'de: flespi telemetry güncellemesi geldiğinde satır/kartta subtle glow (bordo tonunda `[çıkarım]`); haritada marker'lar sıçramak yerine interpolasyonla kayar. → Premium algı; Bulgu 3'e destek.

14. **FAZ 2 tema sistemi: iki katmanlı arka plan + 10 adımlı skala + hover/active adımları.** Geist (vercel.com/geist/colors): sayfa `--background-100`, kart `--background-200`; gri + durum renkleri 10'ar adım; hover=Color 1, active=Color 2. HAK61'de: koyu tema token'ları bu disipline göre; bordo vurgu skalası da 10 adım `[çıkarım]`. Rakip diferansiyeli: 4 rakipten 3'ünde koyu tema hiç yok (Bölüm 1, madde 7). → Tüm bulguların görsel zemini.

15. **Yoğunluk anahtarı + EmptyState üçlüsü.** P&P 40/48/56px üçlüsü + zebra yerine ince ayraç (pencilandpaper.io/.../enterprise-data-tables); boş durum = başlık + motivasyon + CTA, filtre boşunda sonuç sayısı + "Tümünü temizle" (pencilandpaper.io/articles/empty-states, .../enterprise-filtering). HAK61'de: DataTable'a 3 kademeli yoğunluk; her liste/ekran için tasarlanmış boş durum (hiçbir rakipte belgelenmiş boş-durum kalıbı yok — ucuz farklılaşma `[çıkarım]`). → **Bulgu 2, 5.**

### Bilinçli REDDEDİLENLER

- **Üst yatay ana nav (Verizon kalıbı).** 4 üründen yalnız Verizon'da; premium SaaS katmanı da sol sidebar'a taşındı (Vercel redesign, vercel.com/changelog/dashboard-navigation-redesign-rollout). Üst nav modül eklendikçe sıkışıyor (Verizon'da hesaba göre 11+ sekme) ve Verizon'un genel "eskimişlik" algısıyla anılıyor `[metinden]`. HAK61 sol sidebar + Favorites/kayıtlı görünüm bölgesi kullanır.
- **Ayrı native mobil uygulama.** Dört rakibin de yolu, ama en çok şikayet alan yüzeyleri: Verizon Spotlight ≤3/5 puan, "sürekli açılıp kapanıyor" `[metinden]`; Samsara app oturum düşürüyor `[metinden]`. Tek geliştiricili HAK61 için iki kod tabanı sürdürülemez `[çıkarım]`. Karar: responsive web + mobilde yüzen alt bar (harita/liste/alarmlar; Vercel kalıbı).
- **Zebra striping.** Hover/focus/active/disabled durum ayrımını bozuyor; ince satır ayraçları + hover vurgusu kullanılacak (pencilandpaper.io/.../enterprise-data-tables).
- **Rapor-widget dashboard modeli (Geotab kalıbı).** Panoya grafik eklemek rapor şablonu düzenleme, hatta Excel yükleme gerektiriyor — 26-28 araçlık filo için aşırı dolaylı `[metinden]` (support.geotab.com/.../custom-reports). HAK61: az sayıda hazır, tıklanabilir StatCard (Karar 8).
- **Detay için modal.** P&P anti-deseni + Verizon Alert Log modal karmaşası; drawer standart (Karar 7). Modal yalnız yıkıcı onaylar için `[çıkarım]`.
- **Kalıcı/bloke edici alarm popup'ı (Geotab "On Screen Urgent" kalıbı).** Ekranı işgal ediyor ve anlık kanalda debounce yok — resmî doküman bile aşırı bildirim riskini kabul ediyor `[metinden]` (support.geotab.com/.../rule-notifications). HAK61: destelenmiş bildirim paneli (Karar 1) + kalıcı üst durum göstergesi (Webfleet Event bar ruhu), hiçbir zaman bloke edici popup.
- **Aşırı filtre derinliği.** "10 öğeli listeye aşırı filtre" anti-deseni (pencilandpaper.io/.../enterprise-filtering); 26-28 araçta 3-4 isabetli filtre (durum, grup, sürücü, tarih) + token arama yeter `[çıkarım]`.
- **Follow modunun ana haritayı kilitlemesi.** Tek araç takibi gerekirse Webfleet'in "ayrı detail map" çözümü örnek alınır (help.webfleet.com/en_us/help/map/) — genel filo görünümü asla rehin alınmaz.

---

*Rapor sonu. Kaynak: FAZ 1 web-research agent journal'ı (5 agent dönüşü); tüm iddialar journal'daki bulgularla sınırlıdır, işaretsiz iddialar agent'ın doğrudan doküman gözlemidir.*
