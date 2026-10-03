# Hukuki not — rota optimizasyonu (Faz 1)

**03.10.2026 · TASLAK — avukat onayı gerekir.** Teknik ayrıntı:
[`docs/rota-optimizasyonu.md`](../rota-optimizasyonu.md) §10–11.
**sağlayıcı: VROOM+OSRM (18 Tem kurulumu), Google yedek.**

---

## 1 · Ne, nereye gidiyor

| | Birincil: VROOM + OSRM | Yedek: Google Maps Platform |
|---|---|---|
| Ne zaman | Her "Hesapla"da | **Yalnız** `ROTA_YEDEK=google` girilmişse **ve** birincile ulaşılamadığında |
| Gönderilen | Durak koordinatı (6 ondalık), durak süresi, zaman penceresi, sıra numarası | Aynısı + durak kimliği (rastgele UUID) |
| Gönderilmeyen | Ad, adres metni, müşteri / alıcı adı, şoför, plaka | aynı |
| Yer | Kendi rota sunucumuz — Hetzner Online GmbH, Nürnberg (DE) | Google Cloud EMEA Ltd. (IE) / Google LLC (US) |
| Yol | Vercel (fra1 / dub1) → Cloudflare tüneli (TLS Cloudflare ucunda) → Hetzner | Vercel → Google |
| Saklama | Panel `audit_log`: yalnız sayılar ve sonuç. ✅ OSRM istek günlüğü 03.10'da kapatıldı (önce koordinat yazıyordu; sonrası 0 satır, ölçüldü — teknik belge §5.0). VROOM isteği yalnız işlenirken diske yazılıp hemen siliniyor. Vekil günlüğünde koordinat yok | Google koşullarına tabi |

Durakların kendisi (adres, koordinat) panelde zaten 082'den beri tutuluyor; bu
özellik **yeni bir veri toplamıyor**, mevcut durak koordinatını bir hesap için
rota motoruna gönderiyor.

---

## 2 · Sözleşme etkisi (DPA — galzura-brain `Data-Processing-Agreement.md`)

| Konu | Durum | Gereken |
|---|---|---|
| Hetzner (Annex 3) | **Listede** — "Server infrastructure, Nuremberg" | Yok |
| Cloudflare (Annex 3) | Listede — "DNS, security, e-mail routing" | Tünel trafiği (içerik Cloudflare ucunda açılıyor) bu tanıma giriyor mu? Takograf dosyaları zaten aynı yoldan geçiyor — **avukat sorusu 1** |
| Google | **Listede DEĞİL** | Yedek açılmadan önce Annex 3'e "yalnız yedek etkinse" notuyla eklenmeli + müşteriye bildirim / itiraz süresi (§6 genel izin) — **avukat sorusu 2** |
| Annex 1 — ilgili kişiler | "Müşterinin çalışanları" | Durak bir özel kişinin evi olabilir (alıcı). Bu, 082'den beri var olan bir durum; rota özelliği yeni değil ama aynı soruyu taşıyor — **avukat sorusu 3** |
| Annex 1 — işlemenin konusu | Rota optimizasyonu yazmıyor | "Sefer durak sırasının hesaplanması" satırı eklenmeli |

---

## 3 · Google kullanım koşulları — avukata

- **Harita gösterimi:** EEA dışı Service Specific Terms, Routes / Route
  Optimization sonucunun Google dışı haritada gösterilmesini yasaklıyor; EEA
  koşulları izin veriyor. Kod varsayılan olarak **yasak** kabul ediyor
  (geometri sunucuda siliniyor); `GOOGLE_HARITA_KOSULU=eea` yalnız fatura adresi
  EEA'daysa girilmeli — **avukat sorusu 4:** Galzura'nın Google fatura adresi
  hangi koşulları bağlar?
- **Önbellek:** Google sonucundan yalnız **sıra** uygulanıyor; mesafe, süre,
  geometri saklanmıyor. Uygulanan sıranın "Google içeriği" sayılıp sayılmadığı —
  **avukat sorusu 5**.
- **Aktarım dayanağı:** Google LLC'nin DPF sertifikası [VARSAYIM — teyit edilmeli].

---

## 4 · Gizlilik politikasına eklenecek satır

✅ "Saklanmaz" cümlesi 03.10'dan beri **ölçümle doğru**: OSRM istek günlüğü
kapatıldı (0 satır), vroom-express isteği yalnız işlem süresince diske yazıp
siliyor, vekil günlüğünde koordinat yok (teknik belge §5.0). Açık kalan tek konu:
TLS'in Cloudflare ucunda açılması (avukat sorusu 1).

**EN (ana metin):**
> **Route optimisation (optional module).** To calculate the order of a trip's
> stops, the stops' geographic coordinates, planned stop durations and time
> windows — without names or address text — are processed on our own routing
> server, operated at Hetzner Online GmbH in Nuremberg, Germany. These requests
> are not stored beyond technical operation. If the backup service is enabled,
> the same data is sent to Google Maps Platform (Google Cloud EMEA Limited,
> Ireland) only while our routing server is unavailable.

**DE:**
> **Routenoptimierung (optionales Modul).** Zur Berechnung der Reihenfolge der
> Stopps einer Fahrt werden die geografischen Koordinaten der Stopps, geplante
> Aufenthaltsdauern und Zeitfenster – ohne Namen oder Adresstext – auf unserem
> eigenen Routing-Server bei der Hetzner Online GmbH in Nürnberg, Deutschland,
> verarbeitet. Diese Anfragen werden über den technischen Betrieb hinaus nicht
> gespeichert. Ist der Ausweichdienst aktiviert, werden dieselben Daten nur
> dann an Google Maps Platform (Google Cloud EMEA Limited, Irland) übermittelt,
> wenn unser Routing-Server nicht erreichbar ist.

**TR:**
> **Rota optimizasyonu (isteğe bağlı modül).** Bir seferin durak sırasını
> hesaplamak için durakların coğrafi koordinatları, planlanan durak süreleri ve
> zaman pencereleri — ad ya da adres metni olmadan — Hetzner Online GmbH'nin
> Nürnberg'deki (Almanya) altyapısında çalışan kendi rota sunucumuzda işlenir.
> Bu istekler teknik işletimin ötesinde saklanmaz. Yedek servis etkinse aynı
> veriler yalnız rota sunucumuza ulaşılamadığı sürece Google Maps Platform'a
> (Google Cloud EMEA Limited, İrlanda) iletilir.

Google yedeği hiç açılmayacaksa son cümle çıkarılır.

---

## 5 · Avukat soruları — özet

1. Cloudflare tüneli (içerik uçta açılıyor) DPA Annex 3'teki "DNS, security"
   tanımına giriyor mu, yoksa ayrı satır mı gerekir?
2. Google'ı "yalnız yedek etkinse" koşuluyla alt işleyen listesine eklemenin
   biçimi; müşteriye bildirim ve itiraz süresi.
3. Durak = özel kişinin adresi olabilir: DPA Annex 1'deki ilgili kişi
   kategorilerine "alıcılar" eklenmeli mi?
4. Google Maps Platform'da EEA koşulları Galzura'ya uygulanıyor mu (harita gösterimi)?
5. Uygulanan sıra Google koşullarındaki önbellek yasağına girer mi?
