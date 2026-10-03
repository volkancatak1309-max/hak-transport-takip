#!/usr/bin/env node
/**
 * SESLİ ASİSTAN — REALTIME AKIŞ SENARYOLARI (Faz 1c, 03.10.2026). Yerel; ağ ve OpenAI YOK.
 *
 * 03.10 Test 2'de Realtime motoru Almanca soru + Türkçe söz kesmede kilitlendi: bir araç
 * çağırdı, cevap vermedi. Kök sebep `lib/asistan-sesli-akis.ts` başlığında. Bu betik:
 *   • zaman benzetimli SAHTE bir Realtime sunucusu kurar (söz kesmede yanıtı iptal eder,
 *     aktif yanıt varken `response.create`'e `conversation_already_has_active_response`
 *     döner, konuşma bitince kendiliğinden yanıt başlatır, öğeleri `previous_item_id` ile
 *     yerleştirir, yanıtın dilini o anki talimattan alır);
 *   • aynı senaryoları Faz 1b istemci mantığıyla (ESKİ — `AsistanSesliClient`'in 6fda1e6
 *     hâlindeki karar kuralları birebir) ve yeni durum makinesiyle (YENİ) koşturur.
 *
 * KANIT ŞARTI: her kusur senaryosunda ESKİ mantık GERÇEKTEN düşmeli (senaryo kusuru
 * üretmiyorsa geçmesinin anlamı yok) ve YENİ mantık her senaryoda doğru dilde, tek
 * cevapla, sahipsiz çağrı bırakmadan bitmeli.
 *
 * Model davranışı (sahte): konuşmada çıktısı olmayan bir araç çağrısı varsa sonucu bekler
 * ve yalnız dolgu cümlesi söyler ("bir saniye") — Test 2'deki "araç çağırdı, cevap vermedi"
 * belirtisi. Son kullanıcı sorusundan sonra araç sonucu yoksa (ve soru veri istiyorsa)
 * aracı çağırır; varsa talimattaki dilde cevap verir.
 *
 * Kullanım: npm run lint:asistan-sesli-akis
 */
import { realtimeAkis } from "../lib/asistan-sesli-akis.ts";

const AG_MS = 15; // istemci ↔ sunucu tek yön
const TIK_MS = 250;
const TALIMAT = "# Language — HIGHEST PRIORITY\n- (test talimatı)";
const DIL_ADI = { Turkish: "tr", German: "de", English: "en" };

// ── benzetim saati ───────────────────────────────────────────────────────────
class Saat {
  constructor() {
    this.t = 0;
    this.kuyruk = [];
    this.sira = 0;
  }
  sonra(ms, fn) {
    this.kuyruk.push({ an: this.t + ms, sira: this.sira++, fn });
  }
  kos(sinir) {
    while (this.kuyruk.length) {
      this.kuyruk.sort((a, b) => a.an - b.an || a.sira - b.sira);
      const s = this.kuyruk.shift();
      if (s.an > sinir) break;
      this.t = s.an;
      s.fn();
    }
  }
}

// ── sahte Realtime sunucusu ─────────────────────────────────────────────────
class SahteSunucu {
  constructor(saat, politika) {
    this.saat = saat;
    this.politika = politika;
    this.ogeler = [];
    this.aktif = null;
    this.dil = null;
    this.no = 0;
    this.hatalar = [];
    this.istemci = null;
    this.ilkSes = new Map(); // mesaj kimliği → ilk döküm parçasının anı
    this.konusmaBitti = null;
  }
  kimlik(on) {
    return `${on}_${++this.no}`;
  }
  yay(olay) {
    this.saat.sonra(AG_MS, () => this.istemci.sunucudan(olay));
  }
  al(olay) {
    switch (olay.type) {
      case "session.update": {
        const m = /Current user language: (\w+)/.exec(olay.session?.instructions ?? "");
        if (m) this.dil = DIL_ADI[m[1]] ?? this.dil;
        this.yay({ type: "session.updated" });
        break;
      }
      case "conversation.item.create": {
        const item = { ...olay.item, id: olay.item.id ?? this.kimlik("oge"), status: "completed" };
        if (olay.previous_item_id) {
          const i = this.ogeler.findIndex((o) => o.id === olay.previous_item_id);
          if (i === -1) {
            this.yay({ type: "error", error: { code: "item_not_found", event_id: olay.event_id } });
            break;
          }
          this.ogeler.splice(i + 1, 0, item);
        } else this.ogeler.push(item);
        this.yay({ type: "conversation.item.added", item: { ...item } });
        break;
      }
      case "conversation.item.delete": {
        this.ogeler = this.ogeler.filter((o) => o.id !== olay.item_id);
        this.yay({ type: "conversation.item.deleted", item_id: olay.item_id });
        break;
      }
      case "response.create":
        if (this.aktif) {
          this.hatalar.push("conversation_already_has_active_response");
          this.yay({ type: "error", error: { code: "conversation_already_has_active_response" } });
        } else this.yanitBaslat();
        break;
      case "response.cancel":
        if (this.aktif) this.yanitBitir("cancelled");
        else this.yay({ type: "error", error: { code: "response_cancel_not_active" } });
        break;
      default:
        break;
    }
  }
  planla(y, ms, fn) {
    const h = { iptal: false };
    y.zamanlayicilar.push(h);
    this.saat.sonra(ms, () => {
      if (!h.iptal) fn();
    });
  }
  yanitBaslat() {
    const id = this.kimlik("yanit");
    const plan = this.politika(this.ogeler, this.dil);
    const y = { id, ogeler: [], zamanlayicilar: [] };
    this.aktif = y;
    this.yay({ type: "response.created", response: { id, status: "in_progress" } });
    if (plan.tur === "arac") {
      const item = {
        id: this.kimlik("oge"),
        type: "function_call",
        call_id: this.kimlik("call"),
        name: plan.ad,
        arguments: "{}",
        status: "in_progress",
      };
      this.planla(y, 150, () => {
        this.ogeler.push(item);
        y.ogeler.push(item);
        this.yay({ type: "response.output_item.added", response_id: id, item: { ...item } });
      });
      this.planla(y, 450, () => {
        item.status = "completed";
        this.yay({ type: "response.output_item.done", response_id: id, item: { ...item } });
      });
      this.planla(y, 700, () => this.yanitBitir("completed"));
      return;
    }
    const msg = { id: this.kimlik("oge"), type: "message", role: "assistant", status: "in_progress", dolgu: plan.tur === "dolgu", dil: plan.dil };
    const kelimeler = plan.metin.split(" ");
    this.planla(y, 200, () => {
      this.ogeler.push(msg);
      y.ogeler.push(msg);
      this.yay({ type: "response.output_item.added", response_id: id, item: { id: msg.id, type: "message" } });
    });
    kelimeler.forEach((k, i) =>
      this.planla(y, 300 + i * 120, () => {
        if (!this.ilkSes.has(msg.id)) this.ilkSes.set(msg.id, this.saat.t);
        this.yay({ type: "response.output_audio_transcript.delta", response_id: id, item_id: msg.id, delta: (i ? " " : "") + k });
      })
    );
    this.planla(y, 300 + kelimeler.length * 120 + 50, () => {
      msg.status = "completed";
      this.yay({ type: "response.output_item.done", response_id: id, item: { id: msg.id, type: "message", status: "completed" } });
      this.yanitBitir("completed");
    });
  }
  yanitBitir(durum) {
    const y = this.aktif;
    if (!y) return;
    y.zamanlayicilar.forEach((h) => (h.iptal = true));
    for (const o of y.ogeler) if (o.status === "in_progress") o.status = "incomplete";
    this.aktif = null;
    this.yay({ type: "response.done", response: { id: y.id, status: durum, output: y.ogeler.map((o) => ({ ...o })) } });
  }
  /** Kullanıcı konuşur: söz kesme → konuşma sonu → onay → döküm akışı → kendiliğinden yanıt. */
  konus(metin, dil, sureMs, { yanitsiz = false } = {}) {
    this.yay({ type: "input_audio_buffer.speech_started" });
    this.saat.sonra(50, () => {
      if (this.aktif) this.yanitBitir("cancelled"); // interrupt_response: true
    });
    this.saat.sonra(sureMs, () => {
      this.yay({ type: "input_audio_buffer.speech_stopped" });
      this.konusmaBitti = this.saat.t;
      if (yanitsiz) return; // gürültü: sunucu tamponu boşaltır, yanıt yok
      const id = this.kimlik("oge");
      this.ogeler.push({ id, type: "message", role: "user", status: "completed", metin, dil });
      this.yay({ type: "input_audio_buffer.committed", item_id: id });
      this.yay({ type: "conversation.item.added", item: { id, type: "message", role: "user" } });
      const kelimeler = metin.split(" ");
      kelimeler.forEach((k, i) =>
        this.saat.sonra(150 + i * 60, () =>
          this.yay({ type: "conversation.item.input_audio_transcription.delta", item_id: id, delta: (i ? " " : "") + k })
        )
      );
      this.saat.sonra(150 + kelimeler.length * 60 + 100, () =>
        this.yay({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: metin })
      );
      this.saat.sonra(80, () => {
        if (!this.aktif) this.yanitBaslat(); // create_response: true
      });
    });
  }
}

// ── model politikası ─────────────────────────────────────────────────────────
const CEVAP = {
  tr: "Şu an beş araç duruyor ve hepsi depoda bekliyor",
  de: "Gerade sind fünf Fahrzeuge unterwegs und das ist alles",
};
const DOLGU = { tr: "Bir saniye bakıyorum", de: "Einen Moment bitte" };

function politika({ veriIster = () => true } = {}) {
  return (ogeler, oturumDili) => {
    const sonSoruI = ogeler.findLastIndex((o) => o.type === "message" && o.role === "user");
    const soru = ogeler[sonSoruI];
    const dil = oturumDili ?? soru?.dil ?? "tr";
    const cikti = new Set(ogeler.filter((o) => o.type === "function_call_output").map((o) => o.call_id));
    if (ogeler.some((o) => o.type === "function_call" && !cikti.has(o.call_id))) {
      return { tur: "dolgu", metin: DOLGU[dil], dil }; // sonucu bekliyor
    }
    const sonrakiCikti = ogeler.slice(sonSoruI + 1).some((o) => o.type === "function_call_output");
    const herhangiCikti = ogeler.some((o) => o.type === "function_call_output");
    if (soru && veriIster(soru, herhangiCikti) && !sonrakiCikti) return { tur: "arac", ad: "arac_listesi" };
    return { tur: "cevap", metin: CEVAP[dil], dil };
  };
}

// ── istemciler ──────────────────────────────────────────────────────────────
/** Faz 1b kuralları (6fda1e6): araç yalnız `response.done` completed'da; hemen response.create. */
class EskiIstemci {
  constructor(saat, sunucu, aracMs) {
    Object.assign(this, { saat, sunucu, aracMs, dil: null });
  }
  yolla(olay) {
    this.saat.sonra(AG_MS, () => this.sunucu.al(olay));
  }
  sunucudan(o) {
    if (o.type === "conversation.item.input_audio_transcription.completed") {
      const d = dilBul(o.transcript);
      if (d && d !== this.dil) {
        this.dil = d;
        this.yolla({ type: "session.update", session: { instructions: `${TALIMAT}\n- Current user language: ${ADI[d]}.` } });
      }
    }
    if (o.type === "response.done") {
      if (o.response.status !== "completed") return;
      const cagrilar = o.response.output.filter((x) => x.type === "function_call");
      if (cagrilar.length === 0) return;
      let gecikme = 0;
      for (const c of cagrilar) {
        gecikme += this.aracMs;
        this.saat.sonra(gecikme, () =>
          this.yolla({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: "{}" } })
        );
      }
      this.saat.sonra(gecikme, () => this.yolla({ type: "response.create" }));
    }
  }
  yaz(metin) {
    this.yolla({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: metin }] } });
    this.yolla({ type: "response.create" });
  }
}

/** Faz 1c: `lib/asistan-sesli-akis.ts` — gerçek modül. */
class YeniIstemci {
  constructor(saat, sunucu, aracMs) {
    Object.assign(this, { saat, sunucu, aracMs, akis: realtimeAkis(TALIMAT), olcumler: [], notlar: [] });
    const tik = () => {
      this.uygula(this.akis.tik(this.saat.t));
      this.saat.sonra(TIK_MS, tik);
    };
    this.saat.sonra(TIK_MS, tik);
  }
  uygula(eylemler) {
    for (const e of eylemler) {
      if (e.tur === "gonder") this.saat.sonra(AG_MS, () => this.sunucu.al(e.olay));
      else if (e.tur === "arac") this.saat.sonra(this.aracMs, () => this.uygula(this.akis.aracBitti(e.cagri, { ok: true }, this.saat.t)));
      else if (e.tur === "olcum") this.olcumler.push(e);
      else if (e.tur === "not") this.notlar.push(e.kod);
    }
  }
  sunucudan(o) {
    this.uygula(this.akis.olay(o, this.saat.t));
  }
  yaz(metin) {
    this.uygula(this.akis.metinGonder(metin, this.saat.t));
  }
}

const ADI = { tr: "Turkish", de: "German", en: "English" };
function dilBul(metin) {
  if (/[ğşıİĞŞ]/.test(metin) || /\b(dur|sadece|söyle|araç|hepsini|kaç)\b/i.test(metin)) return "tr";
  if (/\b(wie|viele|sind|fahrzeuge|unterwegs)\b/i.test(metin)) return "de";
  return null;
}

// ── senaryolar ──────────────────────────────────────────────────────────────
const S = [
  {
    ad: "S1 normal araç akışı (TR)",
    kusur: false,
    aracMs: 800,
    beklenenDil: "tr",
    politika: politika(),
    akis: (s) => s.konus("Bugün kaç araç yolda?", "tr", 1200),
  },
  {
    ad: "S2 araç çağrısında söz kesme — Test 2 (DE → TR)",
    kusur: true,
    aracMs: 800,
    beklenenDil: "tr",
    politika: politika(),
    akis: (s, saat) => {
      s.konus("Wie viele Fahrzeuge sind unterwegs?", "de", 1200);
      // çağrı tamamlandı (yanıt +450), yanıt bitmeden (+700) kullanıcı Türkçe keser
      saat.sonra(1200 + 80 + 15 + 520, () => s.konus("Dur, sadece duran araçları söyle", "tr", 1500));
    },
  },
  {
    ad: "S3 araç sürerken yeni cümle → response.create çakışması",
    kusur: true,
    aracMs: 1900,
    beklenenDil: "tr",
    politika: politika({ veriIster: (_soru, herhangiCikti) => !herhangiCikti }),
    akis: (s, saat) => {
      s.konus("Bugün kaç araç duruyor?", "tr", 1200);
      saat.sonra(1200 + 1100, () => s.konus("Hepsini söyle lütfen", "tr", 900));
    },
  },
  {
    ad: "S4 sesli cevap sürerken yazılı soru",
    kusur: true,
    aracMs: 600,
    beklenenDil: "tr",
    politika: politika({ veriIster: () => false }),
    akis: (s, saat, istemci) => {
      s.konus("Bugün kaç araç yolda?", "tr", 1200);
      // ilk cevap konuşulurken (yanıt aktif) yazılı ikinci soru
      saat.sonra(1200 + 80 + 15 + 500, () => istemci.yaz("Şu an kaç araç duruyor?"));
    },
  },
  {
    ad: "S5 Almanca cevap sürerken Türkçe soru (araçsız) — dil kilidi",
    kusur: true,
    aracMs: 600,
    beklenenDil: "tr",
    politika: politika({ veriIster: (_soru, herhangiCikti) => !herhangiCikti }),
    akis: (s, saat) => {
      s.konus("Wie viele Fahrzeuge sind unterwegs?", "de", 1200);
      saat.sonra(6000, () => s.konus("Peki şu an kaç araç duruyor?", "tr", 1400));
    },
  },
  {
    ad: "S6 gürültü: konuşma başladı, sunucu yanıt üretmedi",
    kusur: false,
    aracMs: 1500,
    beklenenDil: "tr",
    politika: politika(),
    akis: (s, saat) => {
      s.konus("Bugün kaç araç yolda?", "tr", 1200);
      saat.sonra(1200 + 900, () => s.konus("", "tr", 700, { yanitsiz: true }));
    },
  },
  {
    ad: "S7 argümanı yarım çağrıda söz kesme",
    kusur: true,
    aracMs: 700,
    beklenenDil: "tr",
    politika: politika(),
    akis: (s, saat) => {
      s.konus("Bugün kaç araç yolda?", "tr", 1200);
      // çağrı öğesi +150'de eklendi, tamamlanmadan (+450) kesilir
      saat.sonra(1200 + 80 + 15 + 230, () => s.konus("Yok, sadece duranları söyle", "tr", 1300));
    },
  },
];

function kos(senaryo, Istemci) {
  const saat = new Saat();
  const sunucu = new SahteSunucu(saat, senaryo.politika);
  const istemci = new Istemci(saat, sunucu, senaryo.aracMs);
  sunucu.istemci = istemci;
  senaryo.akis(sunucu, saat, istemci);
  saat.kos(40_000);
  const ogeler = sunucu.ogeler;
  const sonSoruI = ogeler.findLastIndex((o) => o.type === "message" && o.role === "user");
  const sonrasi = ogeler.slice(sonSoruI + 1).filter((o) => o.type === "message" && o.role === "assistant" && o.status === "completed" && !o.dolgu);
  const cikti = new Set(ogeler.filter((o) => o.type === "function_call_output").map((o) => o.call_id));
  const sahipsiz = ogeler.filter((o) => o.type === "function_call" && !cikti.has(o.call_id)).length;
  const cevap = sonrasi.at(-1);
  const t0 = sunucu.konusmaBitti ?? 0;
  return {
    cevap: !!cevap,
    dil: cevap?.dil ?? null,
    cevapSayisi: sonrasi.length,
    sahipsiz,
    hata: sunucu.hatalar.length,
    sureMs: cevap ? sunucu.ilkSes.get(cevap.id) - t0 : null,
    olcum: istemci.olcumler?.[0]?.ms ?? null,
    notlar: istemci.notlar ?? [],
  };
}

function ozetle(r, beklenenDil) {
  if (!r.cevap) return `CEVAP YOK${r.sahipsiz ? ` · ${r.sahipsiz} sahipsiz çağrı` : ""}${r.hata ? ` · ${r.hata} hata` : ""}`;
  const dilNot = r.dil === beklenenDil ? r.dil : `YANLIŞ DİL (${r.dil})`;
  return `cevap ✓ ${dilNot} · ilk ses ${(r.sureMs / 1000).toFixed(1)} sn${r.cevapSayisi > 1 ? ` · ${r.cevapSayisi} cevap` : ""}${
    r.hata ? ` · ${r.hata} hata` : ""
  }${r.olcum !== null ? ` · dil düzeltme ${r.olcum} ms` : ""}`;
}

const dogru = (r, beklenenDil) => r.cevap && r.dil === beklenenDil && r.cevapSayisi === 1 && r.sahipsiz === 0 && r.hata === 0;

let kusurlu = 0;
console.log("Senaryo".padEnd(62), "| ESKİ (Faz 1b)".padEnd(46), "| YENİ (Faz 1c)");
for (const s of S) {
  const eski = kos(s, EskiIstemci);
  const yeni = kos(s, YeniIstemci);
  console.log(s.ad.padEnd(62), `| ${ozetle(eski, s.beklenenDil)}`.padEnd(46), `| ${ozetle(yeni, s.beklenenDil)}`);
  if (!dogru(yeni, s.beklenenDil)) {
    kusurlu++;
    console.log(`  ✗ YENİ mantık bu senaryoda doğru bitmedi: ${JSON.stringify(yeni)}`);
  }
  if (s.kusur && dogru(eski, s.beklenenDil)) {
    kusurlu++;
    console.log("  ✗ senaryo kusuru üretmiyor: ESKİ mantık da doğru bitti (kanıt değeri yok)");
  }
}

if (kusurlu > 0) {
  console.log(`\n✗ SESLİ ASİSTAN AKIŞI — ${kusurlu} senaryo düştü.\n`);
  process.exit(1);
}
console.log(`\n✓ sesli asistan akışı: ${S.length} senaryo; kusur senaryolarında eski mantık düştü, yeni mantık hepsinde doğru bitti.`);
