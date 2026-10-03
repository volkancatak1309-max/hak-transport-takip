# Hukuk taslakları — sesli asistan (1.5.0 hukuk paketi)

> ## ⚠️ AVUKAT ONAYI ŞART — YAYINLANMAZ
> Bu klasördeki hiçbir metin avukat onayı olmadan gizlilik politikasına, uygulamaya, mağaza
> metnine ya da müşteri sözleşmesine girmez. Metinler **taslaktır**; **DOĞRULANACAK** işaretli her
> satır resmî kaynaktan doğrulanmadan kullanılamaz. Müşteri kiracılarına (HAK61, Sendigo, yeni
> müşteri) sesli asistan açılmadan önce avukat onayı ayrıca şarttır (karar 6: maskeleme yok,
> izin türleri dahil).

Hazırlandı: 03.10.2026 (Faz 2a hazırlığı). Kararlar: mobil depo `docs/asistan-sesli-tasarim.md`
§10 (karar 5, 6, 9, 10).

| Dosya | Ne için | Nereye girecek (onaydan sonra) |
|---|---|---|
| `gizlilik-politikasi-openai.md` | OpenAI alt işleyen bölümü: amaç, veri kategorileri (izin türleri dahil filo verisi), saklama, ABD'ye aktarım | galzura.com `privacy-policy` §5–§8 (EN/DE/TR) |
| `ai-act-madde-50.md` | AB YZ Yasası md. 50 şeffaflık metni ("yapay zekâ ile konuşuyorsunuz") | Panel `/admin/asistan`, mobil 1.5.0 izin + konuşma ekranı |
| `openai-dpa-adimlari.md` | OpenAI DPA imza adımları + müşterilere alt işleyen bildirimi | Şirket kayıtları, işleme envanteri |
| `expo-satiri.md` | Expo (bildirim + OTA) alt işleyen satırı | galzura.com `privacy-policy` §7–§8 |

## DOĞRULANACAK — tek liste

1. **OpenAI'ın AB-ABD Veri Gizliliği Çerçevesi (DPF) sertifikası.** Kaynaklar ÇELİŞİYOR (03.10.2026):
   bir üçüncü taraf özeti "aktif" diyor, bir başkası "dataprivacyframework.gov listesinde kayıt yok
   (08.09.2026)" diyor. Resmî listede **"OpenAI"** elle aranacak: https://www.dataprivacyframework.gov/list
2. **OpenAI DPA'sında Standart Sözleşme Maddeleri (SCC)** — ikincil kaynaklar SCC'nin DPA'ya dahil
   olduğunu söylüyor; DPA metninden (modül 2/3) doğrulanacak.
3. **AB müşterisi için sözleşme tarafı** (OpenAI OpCo, LLC mi, OpenAI Ireland Ltd mi).
4. **OpenAI API saklama süresi** (kötüye kullanım izleme için varsayılan süre; Realtime ve GPT-Live için
   aynı mı) ve **eğitimde kullanmama** taahhüdü — OpenAI'ın API veri kullanım sayfasından.
5. **AB veri yerleşimi (EU data residency)** proje ayarı Realtime / GPT-Live / Responses için geçerli mi
   (geçerliyse aktarım analizi değişir).
6. **DPA formunun yeri** ve imza akışı (openai.com bu araçla okunamadı — 403).
7. **Expo**: sözleşme tarafı (650 Industries, Inc.), DPA/SCC ve DPF durumu, bildirim verisinin saklama
   süresi.
8. **AI Act md. 50(2)** (sentetik ses çıktısının makine okunur işaretlenmesi) bizim için mi, sağlayıcı
   (OpenAI) için mi yükümlülük — avukat değerlendirecek.
