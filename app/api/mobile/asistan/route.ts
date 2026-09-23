import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mapBounded } from "@/lib/db-fanout";
import { ASISTAN_ENABLED } from "@/lib/tenant";
import { TENANT_TZ } from "@/lib/tz";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/i18n/request";
import { sistemIstemi, VERI_ETIKETI } from "@/lib/asistan-istem";
import {
  aracBul,
  araclarFor,
  aracSemalari,
  type AsistanBaglam,
} from "@/lib/asistan-araclar";
import {
  hizKrediDus,
  ASISTAN_SORU_TAVANI,
  ASISTAN_PENCERE_MS,
} from "@/lib/asistan-hiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🔴 SÜRE TAVANI AÇIKÇA YAZILI. Araç döngüsü tek soruda birkaç model turu +
 * birkaç veritabanı turu demek; en yavaş araç (`filo_analizi`) tek başına on
 * saniyelerce sürebiliyor. Platform varsayılanına güvenmek, o gün sessizce
 * kesilen bir akışa dönüşür ve istemci sebebini bilmez — `/mevzuat` ucunda
 * yazılı olan aynı ders.
 */
export const maxDuration = 300;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/mobile/asistan — AI ASİSTAN (v1, 23.09.2026). SALT OKUMA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gövde: `{ mesajlar: [{ rol: "kullanici"|"asistan", metin }], dil?: tr|de|en }`
 * Yanıt: `text/event-stream` (SSE) — aşağıda "OLAYLAR".
 *
 * ── KAPI SIRASI, VE SIRA KURALIN KENDİSİ ──────────────────────────────────
 *
 *   1. jeton yok / geçersiz        → 401
 *   2. şoför                       → 403 `fleet_view_required`
 *   3. bayrak kapalı               → 503 `asistan_kapali` sebep=bayrak_kapali
 *   4. anahtar yok                 → 503 `asistan_kapali` sebep=anahtar_yok
 *   5. gövde bozuk                 → 400 (alan adıyla)
 *   6. saatlik tavan doldu         → 429 `hiz_siniri`
 *
 * 3 ve 4 KİMLİKTEN SONRA gelir: kurulum bilgisini (bu kiracıda asistan var mı,
 * anahtar girilmiş mi) kimliği doğrulanmamış birine söylemeyiz. `/guvenlik`
 * uçlarındaki "yönetici → katman → patron" sırasının aynı gerekçesi.
 *
 * 3 ve 4 AYRI `sebep` taşır ve bu sessiz eksik yasağının uygulaması: ikisi
 * farklı işler gerektirir — biri bir KARAR (bu kiracıda asistan açılsın mı),
 * öteki bir KURULUM adımı (Vercel env'ine anahtar girilmesi). Tek bir
 * "kapalı" cevabı, anahtarı girmeyi bekleyen birine hiçbir şey söylemezdi.
 *
 * ── KAPI NEDEN `requireMobileFleetView` ───────────────────────────────────
 *
 * Asistan bir YÖNETİM yüzeyidir; şoförün kendi verisini soracağı bir sohbet
 * değil (o ayrı bir karar, ayrı bir araç kümesi ve ayrı bir kapsam demek).
 * Bu kapı ZEMİNDİR, tavan değil: araçların bir kısmı `requireMobileAdmin` ile
 * korunan uçları çağırıyor ve filo şefi onları çağıramaz. Ayrıntı ve gerekçe:
 * `lib/asistan-araclar.ts` §1b / §2.
 *
 * ── SOHBET GEÇMİŞİ SAKLANMIYOR ────────────────────────────────────────────
 *
 * Sunucu hiçbir mesajı yazmıyor: geçmiş her istekte İSTEMCİDEN geliyor
 * (son ≤10 tur). Yeni tablo yok, saklama süresi sorusu yok, silme ucu yok.
 * Bedeli açık ve kabul edildi: önceki turdaki ARAÇ ÇAĞRILARI taşınmıyor
 * (istemci yalnız metin gönderiyor), yani takip sorusunda model aracı yeniden
 * çağırır. Bu, tazelenmiş sayı demektir — v1 için doğru taraf.
 *
 * ── OLAYLAR (SSE) ─────────────────────────────────────────────────────────
 *
 *   event: basladi     { dil, araclar: [ad], kalanSoru }
 *   event: metin       { parca }                     — modelin yazdığı metin
 *   event: arac        { ad, girdi }                 — araç çağrısı başladı
 *   event: arac_sonuc  { ad, sureMs, hata }          — bitti (SONUÇ GÖVDESİ YOK)
 *   event: kullanim    { girdi, cikti, onbellekOkuma, onbellekYazma }
 *   event: bitti       { durdurma, tur }
 *   event: hata        { kod, aciklama? }
 *
 * `arac_sonuc` sonucun KENDİSİNİ taşımaz: gövde modele gider, istemciye değil.
 * Taşısaydı aynı veri iki kez akar ve telefon bağlantısında ağırlığın çoğunu
 * kimsenin okumadığı JSON oluştururdu. İstemci "hangi araçlar çalıştı"yı
 * görür — cevabın nereden geldiğini göstermek için bu yeter.
 *
 * ── ÖN BELLEK (prompt caching) ────────────────────────────────────────────
 *
 * Ön ek sırası: `tools` → `system` → `messages`. İkisine de `cache_control`
 * konuyor (son araç şeması + sistem istemi). Bunun çalışması İSTEMİN DURAĞAN
 * OLMASINA bağlı — `lib/asistan-istem.ts` başlığındaki kural. Değişken bağlam
 * (şu an, rol, filo) `messages` sonuna eklenen `{role:"system"}` mesajında
 * taşınıyor: Claude Opus 5 bunu destekliyor ve o mesaj ön ekin DIŞINDA kalıyor,
 * yani önbelleği bozmuyor.
 *
 * KANIT: `kullanim` olayındaki `onbellekOkuma` (usage.cache_read_input_tokens).
 * Sıfırsa ön ek bir yerde değişiyordur.
 *
 * ── MODELİN REDDİ ─────────────────────────────────────────────────────────
 *
 * `stop_reason: "refusal"` sunucu tarafı yedeklemeyle (server-side fallbacks)
 * kurtarılabilirdi; BİLEREK açılmadı. O özellik bir beta bayrağı gerektiriyor
 * ve hesapta açık değilse İSTEĞİN TAMAMI 400 döner — yani filo sayısı soran bir
 * uç, hiç yaşanmayacak bir red senaryosu için tamamen ölebilirdi. Red hâli
 * bunun yerine `hata` olayıyla dürüstçe bildiriliyor.
 */

/** Model — kararlaştırılmış, env'e bağlı DEĞİL (sayıların kaynağı değişmesin). */
const MODEL = "claude-opus-5";

/** Araç döngüsünde en fazla kaç model turu. Sonsuz döngüye karşı sert tavan. */
const TUR_TAVANI = 6;

/** İstemcinin gönderebileceği en fazla mesaj (10 tur × 2). */
const MESAJ_TAVANI = 20;

/** Tek mesajın karakter tavanı. */
const METIN_TAVANI = 4000;

/**
 * Düşünme payı dâhil çıktı tavanı. Akış kullanıldığı için HTTP zaman aşımı
 * kaygısı yok; cömert tutuldu ki cevap ortasından kesilmesin.
 */
const MAX_TOKENS = 16000;

type IstemciMesaji = { rol: "kullanici" | "asistan"; metin: string };

export async function POST(req: NextRequest) {
  // ── 1-2 · kimlik ve rol ────────────────────────────────────────────────
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { worker, fleet, isChief } = guard.actor;

  // ── 3-4 · kurulum ──────────────────────────────────────────────────────
  if (!ASISTAN_ENABLED) {
    return mobileError(503, "asistan_kapali", { sebep: "bayrak_kapali" });
  }
  const anahtar = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anahtar) {
    // ⚠️ ANAHTARIN KENDİSİ HİÇBİR YERE YAZILMAZ — ne gövdeye, ne loga, ne ize.
    // Burada yalnız VARLIĞI sınanıyor.
    return mobileError(503, "asistan_kapali", { sebep: "anahtar_yok" });
  }

  // ── 5 · gövde ──────────────────────────────────────────────────────────
  let ham: unknown = null;
  try {
    ham = await req.json();
  } catch {
    return mobileError(400, "invalid", { alan: "govde", bicim: "json" });
  }
  const govde = (ham ?? {}) as Record<string, unknown>;

  const dilHam = govde.dil;
  if (dilHam !== undefined && dilHam !== null && dilHam !== "") {
    if (typeof dilHam !== "string" || !(SUPPORTED_LOCALES as readonly string[]).includes(dilHam)) {
      return mobileError(400, "invalid_dil", { alan: "dil", gecerli: SUPPORTED_LOCALES });
    }
  }
  const dil: Locale = (dilHam as Locale) || DEFAULT_LOCALE;

  const mesajSonuc = mesajlariCoz(govde.mesajlar);
  if (!mesajSonuc.ok) return mobileError(400, mesajSonuc.kod, mesajSonuc.ek);
  const mesajlar = mesajSonuc.mesajlar;

  // ── 6 · saatlik tavan ──────────────────────────────────────────────────
  // Kredi model çağrısından ÖNCE düşülür (gerekçe: lib/asistan-hiz.ts).
  const hiz = await hizKrediDus(worker.id);
  if (!hiz.ok) {
    if (hiz.kod === "hiz_sayaci_okunamadi") {
      return mobileError(503, "hiz_sayaci_okunamadi", {
        sebep: "sayac_okunamadi",
        aciklama: "Hız sayacı okunamadığı için istek reddedildi (fail-closed).",
      });
    }
    return mobileError(429, "hiz_siniri", {
      tavan: ASISTAN_SORU_TAVANI,
      pencereDk: ASISTAN_PENCERE_MS / 60_000,
      retryAfter: hiz.retryAfter,
      pencereBitis: hiz.pencereBitis,
    });
  }

  // ── akış ───────────────────────────────────────────────────────────────
  const araclar = araclarFor(worker.is_admin);
  const baglam: AsistanBaglam = {
    yetkiBasligi: req.headers.get("authorization") ?? "",
    taban: new URL(req.url).origin,
  };
  const istemci = new Anthropic({ apiKey: anahtar });

  const encoder = new TextEncoder();
  const akis = new ReadableStream<Uint8Array>({
    async start(kontrol) {
      let kapandi = false;
      /**
       * ⚠️ YAZMA HATASI YUTULUR ve bu bilinçli: istemci bağlantıyı kapattığında
       * (telefon uygulamadan çıktı, ağ düştü) `enqueue` fırlatır. Korumasız
       * bırakılsaydı hata `catch` bloğuna düşer, orada yine `gonder` çağrılır ve
       * kapalı akışa ikinci kez yazmaya çalışırdı — yani tek bir kopan
       * bağlantı, yakalanmamış bir reddedilmiş söz üretirdi.
       */
      const gonder = (olay: string, veri: unknown) => {
        if (kapandi) return;
        try {
          kontrol.enqueue(encoder.encode(`event: ${olay}\ndata: ${JSON.stringify(veri)}\n\n`));
        } catch {
          kapandi = true;
        }
      };

      try {
        gonder("basladi", {
          dil,
          araclar: araclar.map((a) => a.ad),
          kalanSoru: hiz.kalan,
        });
        await turDongusu({ istemci, araclar, baglam, dil, mesajlar, isChief, fleet, gonder });
      } catch (e) {
        gonder("hata", hataGovdesi(e));
      } finally {
        kapandi = true;
        try {
          kontrol.close();
        } catch {
          /* istemci zaten kopmuş */
        }
      }
    },
  });

  return new Response(akis, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      /** Ters vekilin tamponlamasını kapatır; yoksa akış toplu iner. */
      "x-accel-buffering": "no",
    },
  });
}

// ── gövde çözümü ────────────────────────────────────────────────────────────

type MesajSonucu =
  | { ok: true; mesajlar: IstemciMesaji[] }
  | { ok: false; kod: string; ek: Record<string, unknown> };

/**
 * İstemcinin gönderdiği tur penceresini doğrular.
 *
 * ⚠️ FAZLA MESAJ SESSİZCE KIRPILMAZ → 400. Kırpsaydık istemci gönderdiği
 * bağlamla cevaplandığını sanır, model ise başka bir pencereye bakardı; bu
 * depoda aynı sınıf tuzağın kaydı `lib/mobile-list.ts`te yazılı.
 */
function mesajlariCoz(ham: unknown): MesajSonucu {
  if (!Array.isArray(ham) || ham.length === 0) {
    return { ok: false, kod: "invalid", ek: { alan: "mesajlar", bicim: "dizi", bos: false } };
  }
  if (ham.length > MESAJ_TAVANI) {
    return {
      ok: false,
      kod: "invalid",
      ek: { alan: "mesajlar", tavan: MESAJ_TAVANI, gelen: ham.length, tur: MESAJ_TAVANI / 2 },
    };
  }

  const mesajlar: IstemciMesaji[] = [];
  for (let i = 0; i < ham.length; i++) {
    const m = ham[i] as Record<string, unknown>;
    const rol = m?.rol;
    const metin = m?.metin;
    if (rol !== "kullanici" && rol !== "asistan") {
      return {
        ok: false,
        kod: "invalid",
        ek: { alan: `mesajlar[${i}].rol`, gecerli: ["kullanici", "asistan"] },
      };
    }
    if (typeof metin !== "string" || metin.trim() === "") {
      return { ok: false, kod: "invalid", ek: { alan: `mesajlar[${i}].metin`, bicim: "metin" } };
    }
    if (metin.length > METIN_TAVANI) {
      return {
        ok: false,
        kod: "invalid",
        ek: { alan: `mesajlar[${i}].metin`, tavan: METIN_TAVANI, gelen: metin.length },
      };
    }
    mesajlar.push({ rol, metin });
  }

  // API sözleşmesi: ilk mesaj kullanıcıdan olmak zorunda.
  if (mesajlar[0].rol !== "kullanici") {
    return { ok: false, kod: "invalid", ek: { alan: "mesajlar[0].rol", beklenen: "kullanici" } };
  }
  // Son mesaj da kullanıcıdan: cevaplanacak bir soru olmalı.
  if (mesajlar[mesajlar.length - 1].rol !== "kullanici") {
    return {
      ok: false,
      kod: "invalid",
      ek: { alan: "mesajlar[son].rol", beklenen: "kullanici", sebep: "cevaplanacak_soru_yok" },
    };
  }
  return { ok: true, mesajlar };
}

// ── model turu ──────────────────────────────────────────────────────────────

type DonguArgs = {
  istemci: Anthropic;
  araclar: ReturnType<typeof araclarFor>;
  baglam: AsistanBaglam;
  dil: Locale;
  mesajlar: IstemciMesaji[];
  isChief: boolean;
  fleet: string | null;
  gonder: (olay: string, veri: unknown) => void;
};

async function turDongusu(a: DonguArgs): Promise<void> {
  const { istemci, araclar, baglam, dil, gonder } = a;

  const semalar = aracSemalari(araclar);
  /**
   * ÖN EKİN SON NOKTASI — araç şemalarının sonuna bir kesme noktası. İkinci
   * kesme noktası sistem isteminde; ikisi birlikte `tools`+`system`in tamamını
   * önbelleğe alır (en fazla 4 nokta kullanılabilir, biz 2 kullanıyoruz).
   */
  const tools: Anthropic.Tool[] = semalar.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as unknown as Anthropic.Tool.InputSchema,
    ...(i === semalar.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: sistemIstemi(dil), cache_control: { type: "ephemeral" } },
  ];

  const messages: Anthropic.MessageParam[] = a.mesajlar.map((m) => ({
    role: m.rol === "kullanici" ? ("user" as const) : ("assistant" as const),
    content: m.metin,
  }));
  /**
   * DEĞİŞKEN BAĞLAM — ön ekin DIŞINDA. `{role:"system"}` mesajı Claude Opus 5'te
   * destekleniyor ve `messages` sonunda durduğu için önbelleği bozmaz (üstteki
   * "ÖN BELLEK" notu). Yerleşim kuralı: bir kullanıcı mesajından SONRA gelmeli
   * ve ya son eleman olmalı ya da ardından bir asistan turu gelmeli — burada
   * ikisi de sağlanıyor (ilk turda son eleman, araç turlarında ardından asistan).
   */
  messages.push({ role: "system", content: baglamMetni(dil, a.isChief, a.fleet) });

  let girdiT = 0;
  let ciktiT = 0;
  let onbellekOkuma = 0;
  let onbellekYazma = 0;

  for (let tur = 1; tur <= TUR_TAVANI; tur++) {
    const akis = istemci.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium" },
      system,
      tools,
      messages,
    });
    akis.on("text", (parca) => gonder("metin", { parca }));

    const cevap = await akis.finalMessage();

    girdiT += cevap.usage.input_tokens;
    ciktiT += cevap.usage.output_tokens;
    onbellekOkuma += cevap.usage.cache_read_input_tokens ?? 0;
    onbellekYazma += cevap.usage.cache_creation_input_tokens ?? 0;
    gonder("kullanim", {
      girdi: girdiT,
      cikti: ciktiT,
      /** 🔑 ÖN BELLEK KANITI — sıfırsa ön ek bir yerde değişiyor demektir. */
      onbellekOkuma,
      onbellekYazma,
      tur,
    });

    if (cevap.stop_reason === "refusal") {
      gonder("hata", {
        kod: "model_reddetti",
        kategori: cevap.stop_details?.type === "refusal" ? cevap.stop_details.category : null,
      });
      return;
    }

    if (cevap.stop_reason !== "tool_use") {
      gonder("bitti", { durdurma: cevap.stop_reason, tur });
      return;
    }

    // Düşünme blokları DÂHİL tüm içerik geri yazılır — aynı modelde devam
    // ederken bloklar OLDUĞU GİBİ geri gönderilmek zorunda.
    messages.push({ role: "assistant", content: cevap.content });

    const cagrilar = cevap.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    for (const c of cagrilar) gonder("arac", { ad: c.name, girdi: c.input });

    /**
     * PARALEL — ama TAVANLI. Her araç ucun kapısını + birkaç Supabase sorgusunu
     * koşturuyor; sınırsız `Promise.all` aynı anda onlarca sorgu açardı.
     * `mapBounded` bu depodaki ortak çözüm ve tavanı ölçümle konmuş
     * (lib/db-fanout.ts DB_FANOUT_LIMIT = 6).
     */
    const sonuclar = await mapBounded(cagrilar, async (c) => {
      const bas = Date.now();
      const arac = aracBul(c.name);
      let govde: unknown;
      let hata: string | null = null;
      if (!arac) {
        hata = "bilinmeyen_arac";
        govde = { hata };
      } else {
        try {
          govde = await arac.calistir((c.input ?? {}) as Record<string, unknown>, baglam);
          const h = (govde as Record<string, unknown>)?.hata;
          if (typeof h === "string") hata = h;
        } catch (e) {
          hata = "arac_hatasi";
          govde = { hata, aciklama: e instanceof Error ? e.message : String(e) };
        }
      }
      gonder("arac_sonuc", { ad: c.name, sureMs: Date.now() - bas, hata });
      return {
        type: "tool_result" as const,
        tool_use_id: c.id,
        is_error: hata !== null,
        /**
         * Sonuç `<arac_sonucu>` etiketiyle sarılıyor: sistem istemi bu etiketi
         * adıyla anıyor ve içindekinin VERİ olduğunu, talimat olmadığını
         * söylüyor. Müşteri verisi (arıza notu, belge etiketi) serbest metindir.
         */
        content: `<${VERI_ETIKETI} arac="${c.name}">\n${JSON.stringify(govde)}\n</${VERI_ETIKETI}>`,
      };
    }, 4);

    messages.push({ role: "user", content: sonuclar });
  }

  gonder("hata", { kod: "arac_dongusu_asildi", tavan: TUR_TAVANI });
}

/**
 * Değişken bağlam. ⚠️ Kişi ADI GÖNDERİLMEZ: cevabın kalitesine katkısı yok ve
 * dış sağlayıcıya gereksiz kişisel veri taşımanın gerekçesi yok. Rol ve filo
 * yeterli — model "senin filon" sorusunu bunlarla cevaplayabiliyor.
 */
function baglamMetni(dil: Locale, isChief: boolean, fleet: string | null): string {
  const an = new Date().toISOString();
  const rol = isChief ? `fleet chief (fleet: ${fleet ?? "—"})` : "administrator";
  const kapsam = isChief
    ? "Tool results are ALREADY narrowed to this person's own fleet by the server. Some tools are not available at this role and will return 403 — say so plainly."
    : "Tool results cover the whole tenant.";
  const diller: Record<Locale, string> = {
    tr: "Answer in Turkish.",
    de: "Answer in German.",
    en: "Answer in English.",
  };
  return [
    `Current time: ${an} (tenant time zone: ${TENANT_TZ}).`,
    `Caller role: ${rol}. ${kapsam}`,
    diller[dil],
  ].join("\n");
}

/** Hatanın istemciye dönen hâli — anahtar ya da yığın izi ASLA taşınmaz. */
function hataGovdesi(e: unknown): Record<string, unknown> {
  if (e instanceof Anthropic.APIError) {
    return { kod: "saglayici_hatasi", durum: e.status ?? null };
  }
  return { kod: "beklenmeyen_hata" };
}
