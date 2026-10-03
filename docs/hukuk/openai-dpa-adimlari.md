# OpenAI veri işleme sözleşmesi (DPA) — imza adımları (TASLAK)

> ## ⚠️ AVUKAT ONAYI ŞART — YAYINLANMAZ
> Adımlar resmî OpenAI sayfalarından doğrulanmadı (openai.com bu araçla okunamadı — 403).
> **DOĞRULANACAK** satırları imzadan önce Volkan/avukat kontrol eder.

## Bilinenler

- OpenAI, API (ve ChatGPT Business/Enterprise) müşterileriyle GDPR için **DPA imzalayabildiğini**
  söylüyor; DPA, OpenAI'ın iş koşulları kapsamında **API'ye gönderilen müşteri verisini** kapsıyor.
  İmza için OpenAI'ın **DPA formunun doldurulması** gerekiyor (ikincil kaynak: OpenAI Enterprise
  Privacy sayfasının özeti). DPA sayfası: https://openai.com/policies/data-processing-addendum/
- DPA'nın uluslararası aktarım için **SCC** içerdiği ikincil kaynaklarda geçiyor — **DOĞRULANACAK**.

## Adımlar (sıra önemli)

1. **Hesabın sahibi şirket mi?** OpenAI Platform › Organization settings'te organizasyon adı ve
   adresi Galzura'nın tüzel kişiliği olmalı (kişisel hesap değil). **[menü adı DOĞRULANACAK]**
2. **Proje ayarları** (imzadan önce, değişirse aktarım metni değişir):
   - Eğitim için veri paylaşımı KAPALI (API'de varsayılan kapalı — **DOĞRULANACAK**).
   - AB veri yerleşimi (EU data residency) Realtime / GPT-Live / Responses için kullanılabilir mi?
     Kullanılabiliyorsa yeni bir AB projesi açılıp `OPENAI_API_KEY` oradan alınır — **DOĞRULANACAK**.
   - Sıfır veri saklama (ZDR) onayı istenebilir mi (Realtime için) — **DOĞRULANACAK**.
3. **DPA formunu doldur**: DPA sayfasındaki/Enterprise Privacy sayfasındaki form bağlantısı →
   tüzel kişi adı, adres, yetkili kişi, iletişim e-postası, organizasyon kimliği (`org-…`) →
   elektronik imza. **[formun yeri DOĞRULANACAK]**
4. **İmzalı kopyayı sakla**: PDF şirket kayıtlarına; imza tarihi + DPA sürümü (tarih) not edilir.
5. **İşleme envanterine ekle** (Verarbeitungsverzeichnis / VERBİS kaydı gerekiyorsa): OpenAI = alt
   işleyen; amaç sesli asistan; veri kategorileri (`gizlilik-politikasi-openai.md` §0); aktarım
   dayanağı (DPF/SCC — **DOĞRULANACAK**); saklama.
6. **Müşterilere alt işleyen bildirimi (GDPR md. 28(2)/(4))**: Galzura müşterinin veri işleyenidir;
   yeni bir alt işleyen (OpenAI) eklemeden önce müşteri sözleşmesindeki bildirim/itiraz süresine uyulur
   — sesli asistan bir kiracıda AÇILMADAN önce o müşteriye yazılı bildirim. **[sözleşmedeki süre
   avukatla]**
7. **Gizlilik politikası** güncellemesi (`gizlilik-politikasi-openai.md`) — DPA imzalanıp aktarım
   dayanağı doğrulandıktan SONRA yayına.

## İlgili

- Expo satırı: `expo-satiri.md` · AI Act md. 50: `ai-act-madde-50.md`
- Karar 10 (tasarım §10.2): DPA, ABD aktarımı, md. 50 ve politika satırları **1.5.0 öncesi**.
