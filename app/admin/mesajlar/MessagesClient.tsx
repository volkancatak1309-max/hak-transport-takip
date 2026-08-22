"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Archive, ArchiveRestore, Check, CheckCheck, Lock, Megaphone, Phone,
  Search, Send, ArrowLeft, Users, UserPlus, X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  gecmisAction,
  gonderAction,
  okunduAction,
  duyuruAction,
  grupKurAction,
  grupDetayAction,
  grupAdiAction,
  uyeEkleAction,
  uyeCikarAction,
  grupArsivAction,
  okuyanlarAction,
  type MesajRol,
  type GrupDetayi,
} from "@/app/actions/messages";
import { Checkbox } from "@/components/ui/checkbox";
import type { KonusmaSatiri, MesajSatiri } from "@/lib/messaging";
import { TENANT_TZ } from "@/lib/tz";
import { viennaDayKey } from "@/lib/format";

/**
 * MESAJLAR — iki bölmeli WhatsApp deseni.
 *
 * Solda konuşma listesi (şoför + son mesaj + tarih + okunmamış rozeti), sağda
 * seçili konuşmanın geçmişi. Mobilde tek bölme: liste → sohbet, geri tuşuyla
 * dönülür (`secili` durumu iki ekranı da sürüyor, ayrı rota yok — geri tuşunun
 * sohbetten listeye dönmesi bir gezinme değil, aynı ekranın iki hâli).
 *
 * ── ✓✓ ──────────────────────────────────────────────────────────────────────
 * `okunduBilgisi` false ise tik HİÇ ÇİZİLMEZ ve okunmamış rozeti de çıkmaz.
 * Boş tik göstermek "okunmadı" demek olurdu; oysa doğru cevap "bilinmiyor"
 * (sunucu makbuz yazmıyor). Aynı ayrım lib/km-quality.ts'te: ölçülemedi ≠ 0.
 */

type Props = {
  rol: MesajRol;
  okunduBilgisi: boolean;
  satirlar: KonusmaSatiri[];
};

/**
 * Bir satırın ADRESİ — sunucunun `[id]` olarak kabul ettiği değer.
 *
 * Grupta konuşma kimliği; birebirde konuşma varsa onun kimliği, yoksa şoförün
 * kimliği (konuşma satırı ilk mesaja kadar yok). Sunucu ikisini de tek
 * sorguyla çözüyor — bkz. lib/messaging.ts hedefCoz.
 */
function adres(s: KonusmaSatiri): string {
  return s.konusmaId ?? (s.soforId as string);
}

/** E.164 → wa.me biçimi: yalnız rakamlar, baştaki + düşer. */
function waNumarasi(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function MessagesClient({ rol, okunduBilgisi, satirlar }: Props) {
  const t = useTranslations("messages");
  const locale = useLocale();

  const [liste, setListe] = useState<KonusmaSatiri[]>(satirlar);
  const [secili, setSecili] = useState<string | null>(null);
  const [mesajlar, setMesajlar] = useState<MesajSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [taslak, setTaslak] = useState("");
  const [aramaMetni, setAramaMetni] = useState("");
  const [duyuruAcik, setDuyuruAcik] = useState(false);
  const [duyuruMetni, setDuyuruMetni] = useState("");
  const [aramaSecimi, setAramaSecimi] = useState<KonusmaSatiri | null>(null);

  // ── GRUP DURUMLARI ──
  const [detay, setDetay] = useState<GrupDetayi | null>(null);
  const [kurAcik, setKurAcik] = useState(false);
  const [yeniAd, setYeniAd] = useState("");
  const [secilenUyeler, setSecilenUyeler] = useState<Set<string>>(new Set());
  const [uyeArama, setUyeArama] = useState("");
  const [yonetAcik, setYonetAcik] = useState(false);
  const [adTaslak, setAdTaslak] = useState("");
  const [okuyanlar, setOkuyanlar] = useState<{ adSoyad: string; an: string }[] | null>(null);
  const [gonderiliyor, baslat] = useTransition();
  const kaydirmaRef = useRef<HTMLDivElement>(null);

  const seciliSatir = liste.find((s) => adres(s) === secili) ?? null;

  const suzulmus = useMemo(() => {
    const q = aramaMetni.trim().toLocaleLowerCase(locale);
    if (!q) return liste;
    return liste.filter((s) => s.baslik.toLocaleLowerCase(locale).includes(q));
  }, [liste, aramaMetni, locale]);

  /**
   * ⚠️ SAAT KİRACININ DİLİMİNDE — tarayıcınınkinde DEĞİL.
   *
   * İlk sürümde `timeZone` verilmemişti ve tarayıcı dilimi kullanılıyordu:
   * İstanbul'daki (UTC+3) bir tarayıcıda mesaj 18:47, üst çubuktaki Viyana
   * saati 17:47 görünüyordu — aynı ekranda iki farklı saat. Bu depoda dilimin
   * TEK kaynağı lib/tz.ts (bkz. mobil `tenant.saatDilimi` kararı, 09.08.2026).
   *
   * "Bugün mü" karşılaştırması da aynı dilimde yapılmak zorunda: tarayıcı
   * dilimiyle karşılaştırmak, gece yarısı çevresinde dünkü mesajı bugün
   * gösterirdi.
   */
  /**
   * Üye adayları LİSTEDEN türetiliyor — ayrı bir sorgu YOK.
   *
   * Liste zaten kapsam süzülmüş geliyor (şefe yalnız kendi filosu, 4a
   * `konusmaListesi`). Adayları ikinci bir uçtan çekseydik o kapsamı ikinci
   * kez uygulamak gerekirdi ve biri unutulduğunda şef kapsam dışı birini
   * seçici listesinde GÖRÜRDÜ. Kaynak tek olsun.
   */
  const uyeAdaylari = useMemo(
    () => liste.filter((s) => s.tur === "birebir" && s.soforId),
    [liste]
  );

  const zaman = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: TENANT_TZ,
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale]
  );
  const tarih = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: TENANT_TZ,
        day: "2-digit",
        month: "2-digit",
      }),
    [locale]
  );

  function damga(iso: string): string {
    const d = new Date(iso);
    const ayniGun = viennaDayKey(d) === viennaDayKey(new Date());
    return ayniGun ? zaman.format(d) : tarih.format(d);
  }

  // Sohbet açıldığında en alta (en yeni mesaja) kay.
  useEffect(() => {
    const el = kaydirmaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mesajlar]);

  function hataMetni(kod: string): string {
    if (kod === "body_empty") return t("errEmpty");
    if (kod === "body_too_long") return t("errTooLong");
    if (kod === "scope") return t("errScope");
    if (kod === "forbidden" || kod === "not_a_driver") return t("errForbidden");
    if (kod === "conversation_archived") return t("errArchived");
    if (kod === "read_only") return t("errReadOnly");
    if (kod === "title_empty" || kod === "title_required") return t("errTitleEmpty");
    if (kod === "title_too_long") return t("errTitleLong");
    if (kod === "members_required") return t("errMembersRequired");
    if (kod === "not_a_member") return t("errNotMember");
    if (kod === "already_removed") return t("errAlreadyRemoved");
    if (kod === "worker_inactive") return t("errWorkerInactive");
    return t("errGeneric");
  }

  async function konusmaAc(hedefAdres: string) {
    setSecili(hedefAdres);
    setMesajlar([]);
    setYukleniyor(true);
    const r = await gecmisAction(hedefAdres);
    setYukleniyor(false);
    if (!r.ok) {
      toast.error(hataMetni(r.error));
      return;
    }
    // Sunucu en yeni ÜSTTE döndürüyor (sayfalama için doğru olan bu);
    // ekranda en yeni ALTTA olmalı, sohbet aşağı akar.
    setMesajlar([...r.data.mesajlar].reverse());

    // Grupta üye listesi + yetki bayrakları ayrı bir çağrıyla gelir. Birebirde
    // hiç çağrılmaz — grubu olmayan konuşmaya boşuna sorgu atmayız.
    setDetay(null);
    if (r.data.tur === "grup" && r.data.konusmaId) {
      const d = await grupDetayAction(r.data.konusmaId);
      if (d.ok) setDetay(d.data);
    }

    // Okundu işaretle + rozeti düşür. Bayrak kapalıysa sunucu zaten yazmaz;
    // burada ayrıca çağırmamak da olurdu ama o zaman kapının hangi katmanda
    // olduğu belirsizleşirdi — kapı TEK yerde (sunucuda) kalsın.
    if (okunduBilgisi) {
      const o = await okunduAction(hedefAdres);
      if (o.ok && o.data.yeniOkundu > 0) {
        setListe((l) => l.map((s) => (adres(s) === hedefAdres ? { ...s, okunmamis: 0 } : s)));
      }
    }
  }

  function gonder() {
    const govde = taslak.trim();
    if (!govde || !secili) return;
    baslat(async () => {
      const r = await gonderAction(secili, govde);
      if (!r.ok) {
        toast.error(hataMetni(r.error));
        return;
      }
      setTaslak("");
      setMesajlar((m) => [...m, r.data.mesaj]);
      setListe((l) =>
        l.map((s) =>
          adres(s) === secili
            ? {
                ...s,
                sonMesajAn: r.data.mesaj.an,
                sonMesajOnizleme: govde.slice(0, 140),
                sonGonderenRol: r.data.mesaj.gonderenRol,
              }
            : s
        )
      );
    });
  }

  function grupKurGonder() {
    const ad = yeniAd.trim();
    if (!ad || secilenUyeler.size === 0) return;
    baslat(async () => {
      const r = await grupKurAction(ad, [...secilenUyeler]);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      toast.success(t("groupCreated", { ad: r.data.baslik }));
      setKurAcik(false); setYeniAd(""); setSecilenUyeler(new Set()); setUyeArama("");
      // Yeni grubu listeye ekle ve aç — sunucu tazelemesini beklemeden.
      const satir: KonusmaSatiri = {
        tur: "grup", konusmaId: r.data.konusmaId, baslik: r.data.baslik,
        soforId: null, telefon: null, filo: null, uyeSayisi: r.data.uyeSayisi,
        arsivlendiMi: false, cikarildiMi: false, sonMesajAn: null,
        sonMesajOnizleme: null, sonGonderenRol: null, okunmamis: 0,
      };
      setListe((l) => [satir, ...l]);
      konusmaAc(r.data.konusmaId);
    });
  }

  async function detayTazele(konusmaId: string) {
    const d = await grupDetayAction(konusmaId);
    if (d.ok) {
      setDetay(d.data);
      setListe((l) =>
        l.map((s) =>
          s.konusmaId === konusmaId
            ? { ...s, baslik: d.data.baslik, arsivlendiMi: d.data.arsivlendiMi,
                uyeSayisi: d.data.uyeler.filter((u) => !u.cikarildiMi).length }
            : s
        )
      );
    }
  }

  function uyeEkleGonder() {
    if (!detay || secilenUyeler.size === 0) return;
    baslat(async () => {
      const r = await uyeEkleAction(detay.konusmaId, [...secilenUyeler]);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      setSecilenUyeler(new Set()); setUyeArama("");
      await detayTazele(detay.konusmaId);
    });
  }

  function uyeCikarGonder(workerId: string) {
    if (!detay) return;
    baslat(async () => {
      const r = await uyeCikarAction(detay.konusmaId, workerId);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      await detayTazele(detay.konusmaId);
    });
  }

  function adKaydet() {
    if (!detay) return;
    const ad = adTaslak.trim();
    if (!ad || ad === detay.baslik) return;
    baslat(async () => {
      const r = await grupAdiAction(detay.konusmaId, ad);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      await detayTazele(detay.konusmaId);
    });
  }

  function arsivDegistir(arsivle: boolean) {
    if (!detay) return;
    baslat(async () => {
      const r = await grupArsivAction(detay.konusmaId, arsivle);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      await detayTazele(detay.konusmaId);
    });
  }

  async function okuyanlariAc(mesajId: string) {
    const r = await okuyanlarAction(mesajId);
    if (!r.ok) { toast.error(hataMetni(r.error)); return; }
    setOkuyanlar(r.data.okuyanlar);
  }

  function duyuruGonder() {
    const govde = duyuruMetni.trim();
    if (!govde) return;
    baslat(async () => {
      const r = await duyuruAction(govde);
      if (!r.ok) {
        toast.error(hataMetni(r.error));
        return;
      }
      toast.success(t("broadcastSent", { n: r.data.alici }));
      setDuyuruAcik(false);
      setDuyuruMetni("");
    });
  }

  // ── Liste bölmesi ─────────────────────────────────────────────────────────
  const listeBolmesi = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 p-3">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={aramaMetni}
            onChange={(e) => setAramaMetni(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        {/* Grup kurma ŞEFE DE açık (kendi kapsamıyla); duyuru YALNIZ patrona.
            İki düğmenin yetkisi bilerek FARKLI — sunucu da öyle uyguluyor. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { setKurAcik(true); setSecilenUyeler(new Set()); setYeniAd(""); }}
          className="shrink-0 gap-1.5"
        >
          <Users className="size-4" aria-hidden />
          <span className="hidden lg:inline">{t("groupNew")}</span>
        </Button>
        {rol === "admin" && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDuyuruAcik(true)}
            className="shrink-0 gap-1.5"
          >
            <Megaphone className="size-4" aria-hidden />
            <span className="hidden lg:inline">{t("broadcast")}</span>
          </Button>
        )}
      </div>

      {rol === "fleet_chief" && (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {t("scopeChief")}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {suzulmus.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul>
            {suzulmus.map((s) => {
              const aktif = adres(s) === secili;
              return (
                <li key={s.soforId}>
                  <button
                    type="button"
                    onClick={() => konusmaAc(adres(s))}
                    aria-current={aktif ? "true" : undefined}
                    className={`flex w-full items-start gap-3 border-b border-border/40 px-3 py-3 text-left transition-colors ${
                      aktif ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {s.tur === "grup" && (
                            <Users className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("groupBadge")} />
                          )}
                          <span className="truncate text-sm font-medium">{s.baslik}</span>
                          {s.tur === "grup" && s.uyeSayisi !== null && (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              · {t("memberCount", { n: s.uyeSayisi })}
                            </span>
                          )}
                          {s.arsivlendiMi && (
                            <Archive className="size-3 shrink-0 text-muted-foreground" aria-label={t("archive")} />
                          )}
                        </span>
                        {s.sonMesajAn && (
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {damga(s.sonMesajAn)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {s.sonMesajOnizleme ?? "—"}
                        </span>
                        {/* Rozet YALNIZ okundu bilgisi açıkken. Kapalıyken sayaç
                            null gelir ve "0 okunmamış" göstermek uydurma olurdu. */}
                        {okunduBilgisi && (s.okunmamis ?? 0) > 0 && (
                          <span
                            className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground"
                            aria-label={
                              s.okunmamis === 1
                                ? t("unreadOne")
                                : t("unread", { n: s.okunmamis ?? 0 })
                            }
                          >
                            {s.okunmamis}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  // ── Sohbet bölmesi ────────────────────────────────────────────────────────
  const sohbetBolmesi = seciliSatir ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 p-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setSecili(null)}
          aria-label={t("selectPrompt")}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            {seciliSatir.tur === "grup" && <Users className="size-4 shrink-0" aria-hidden />}
            <span className="truncate text-sm font-semibold">{seciliSatir.baslik}</span>
          </span>
          {seciliSatir.tur === "grup" && detay && (
            <button
              type="button"
              onClick={() => { setYonetAcik(true); setAdTaslak(detay.baslik); setSecilenUyeler(new Set()); }}
              className="truncate text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("memberCount", { n: detay.uyeler.filter((u) => !u.cikarildiMi).length })}
              {" · "}
              {detay.uyeler.filter((u) => !u.cikarildiMi).map((u) => u.adSoyad).join(", ")}
            </button>
          )}
        </span>
        {seciliSatir.tur === "grup" && detay?.yonetebilir && (
          <>
            <Button variant="ghost" size="sm" className="gap-1.5"
              onClick={() => { setYonetAcik(true); setAdTaslak(detay.baslik); setSecilenUyeler(new Set()); }}>
              <Users className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t("manage")}</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5"
              onClick={() => arsivDegistir(!detay.arsivlendiMi)} disabled={gonderiliyor}>
              {detay.arsivlendiMi
                ? <ArchiveRestore className="size-4" aria-hidden />
                : <Archive className="size-4" aria-hidden />}
              <span className="hidden sm:inline">
                {detay.arsivlendiMi ? t("unarchive") : t("archive")}
              </span>
            </Button>
          </>
        )}
        {/* Arama YALNIZ birebirde: grubun telefonu yok, "grubu ara" diye bir
            şey de yok. Grup satırında düğme hiç çizilmez. */}
        {seciliSatir.tur === "birebir" && (
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              seciliSatir.telefon
                ? setAramaSecimi(seciliSatir)
                : toast.error(t("callNoPhone"))
            }
          >
            <Phone className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t("call")}</span>
          </Button>
        )}
      </div>

      {/* ── DURUM ŞERİTLERİ ──
          Gizlemek yerine AÇIKÇA söylüyoruz: kullanıcı neden yazamadığını
          bilmeli. Sessizce devre dışı bir kutu "bozuk" gibi görünür. */}
      {seciliSatir.tur === "grup" && detay?.arsivlendiMi && (
        <p className="flex items-center gap-2 border-b border-border/60 bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Archive className="size-3.5 shrink-0" aria-hidden />
          {t("archivedBanner")}
        </p>
      )}
      {seciliSatir.cikarildiMi && (
        <p className="flex items-center gap-2 border-b border-border/60 bg-muted px-3 py-2 text-xs text-muted-foreground">
          <X className="size-3.5 shrink-0" aria-hidden />
          {t("removedBanner")}
        </p>
      )}

      <div ref={kaydirmaRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {yukleniyor ? (
          <p className="p-6 text-center text-sm text-muted-foreground">…</p>
        ) : mesajlar.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {/* Grupta "bu ŞOFÖRLE yazışma yok" cümlesi yanlış — muhatap kişi
                değil oda. Canlı turda görüldü ve ayrı anahtara alındı. */}
            {seciliSatir.tur === "grup" ? t("emptyGroupThread") : t("emptyThread")}
          </p>
        ) : (
          mesajlar.map((m) => {
            // "Benim" = YÖNETİM TARAFI, kişi değil. İki yönetici aynı şoförle
            // yazışırsa ikisinin de mesajı sağda görünür — model bu: şoförün
            // muhatabı "Yönetim", hangi yöneticinin yazdığı onun sorunu değil
            // (bkz. lib/messaging.ts, şoför başına tek konuşma).
            const benim = m.gonderenRol === "admin";
            return (
              <div key={m.id} className={`flex ${benim ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[min(38rem,85%)] rounded-lg px-3 py-2 ${
                    benim ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {m.duyuruMu && (
                    <span className="mb-1 block text-[10px] font-semibold tracking-wide opacity-80">
                      {t("broadcastBadge")}
                    </span>
                  )}
                  {/* Grupta GÖNDEREN ADI şart: "bu mesajı hangi şoför yazdı"
                      görünmezse ortak akış okunamaz. Birebirde gereksiz. */}
                  {seciliSatir.tur === "grup" && !benim && m.gonderenAd && (
                    <span className="mb-0.5 block text-[11px] font-medium opacity-80">
                      {m.gonderenAd}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm">{m.govde}</p>
                  <span className="mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums opacity-70">
                    {damga(m.an)}
                    {/* Tik YALNIZ kendi mesajımızda ve YALNIZ bayrak açıkken.
                        `okuyanlar` null gelirse (bayrak kapalı) hiç çizilmez. */}
                    {/* GRUPTA sayı, BİREBİRDE tik.
                        Grupta ✓✓ "herkes okudu" demek olurdu ve tek kapalı
                        telefon yüzünden gün boyu gri kalırdı (WhatsApp'ın
                        davranışı); bir sevkiyatçı için "3/5" ham sayısı
                        işe yarar. Dokununca kim okudu listesi açılır. */}
                    {benim && m.okuyanlar !== null && (
                      seciliSatir.tur === "grup" && detay ? (
                        <button
                          type="button"
                          onClick={() => okuyanlariAc(m.id)}
                          className="tabular-nums underline-offset-2 hover:underline"
                        >
                          {t("readCount", {
                            n: m.okuyanlar.length,
                            m: Math.max(0, detay.uyeler.filter((u) => !u.cikarildiMi).length - 1),
                          })}
                        </button>
                      ) : m.okuyanlar.length > 0 ? (
                        <CheckCheck className="size-3.5" aria-label={t("read")} />
                      ) : (
                        <Check className="size-3.5" aria-label={t("delivered")} />
                      )
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── YAZMA ALANI: kilitliyse GİZLENMEZ, KİLİTLİ GÖSTERİLİR ──
          Alanı yok etmek "burada bir şey yoktu" izlenimi verir; kilitli
          göstermek "vardı, kapandı, sebebi şu" der. Sunucu son sözü zaten
          söylüyor (409) — bu yalnız dürüst bir arayüz. */}
      {seciliSatir.tur === "grup" && detay && !detay.yazabilir ? (
        <div className="flex items-center gap-2 border-t border-border/60 bg-muted/50 p-3">
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">
            {t("lockedComposer")} — {detay.arsivlendiMi ? t("archivedBanner") : t("removedBanner")}
          </span>
        </div>
      ) : (
      <div className="flex items-end gap-2 border-t border-border/60 p-3">
        <Textarea
          value={taslak}
          onChange={(e) => setTaslak(e.target.value)}
          onKeyDown={(e) => {
            // Enter gönderir, Shift+Enter satır atlar — sohbet arayüzünün
            // yerleşik beklentisi. Mobilde klavye kendi Enter'ını basar.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              gonder();
            }
          }}
          placeholder={t("inputPlaceholder")}
          rows={1}
          maxLength={4000}
          className="max-h-32 min-h-10 resize-none"
          aria-label={t("inputPlaceholder")}
        />
        <Button
          onClick={gonder}
          disabled={gonderiliyor || taslak.trim().length === 0}
          className="shrink-0 gap-1.5"
        >
          <Send className="size-4" aria-hidden />
          <span className="hidden sm:inline">
            {gonderiliyor ? t("sending") : t("send")}
          </span>
        </Button>
      </div>
      )}
    </div>
  ) : (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">{t("selectPrompt")}</p>
    </div>
  );

  return (
    <>
      {/* İki bölme masaüstünde yan yana; mobilde seçim varsa YALNIZ sohbet.
          Yükseklik viewport'a sabitlenmiş: sohbet kendi içinde kayar, sayfa
          gövdesi kaymaz — WhatsApp'ın ve Linear'ın davranışı. */}
      <div className="grid h-[calc(100dvh-11rem)] min-h-[24rem] grid-cols-1 overflow-hidden rounded-lg border border-border/60 bg-card md:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div
          className={`min-h-0 md:border-r md:border-border/60 ${secili ? "hidden md:block" : "block"}`}
        >
          {listeBolmesi}
        </div>
        <div className={`min-h-0 ${secili ? "block" : "hidden md:block"}`}>{sohbetBolmesi}</div>
      </div>

      {/* ── Filo duyurusu ── */}
      <Dialog open={duyuruAcik} onOpenChange={setDuyuruAcik}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("broadcastTitle")}</DialogTitle>
            <DialogDescription>{t("broadcastDesc")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={duyuruMetni}
            onChange={(e) => setDuyuruMetni(e.target.value)}
            placeholder={t("broadcastPlaceholder")}
            rows={4}
            maxLength={4000}
            aria-label={t("broadcastPlaceholder")}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDuyuruAcik(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={duyuruGonder}
              disabled={gonderiliyor || duyuruMetni.trim().length === 0}
            >
              {t("broadcastSend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ── GRUP KUR ──
          ⚠️ UYARI METNİ ZORUNLU: yönetici duyuru demek isterken grup kurup
          28 şoförü birbirine bağlayabilir. Duyuru diyaloğu tam tersini
          söylüyor; iki kutunun ayrımı bu iki cümlede yaşıyor. */}
      <Dialog open={kurAcik} onOpenChange={setKurAcik}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("groupNew")}</DialogTitle>
            <DialogDescription>{t("groupMembersWarning")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="grup-adi">{t("groupNameLabel")}</Label>
              <Input
                id="grup-adi"
                value={yeniAd}
                onChange={(e) => setYeniAd(e.target.value)}
                placeholder={t("groupNamePlaceholder")}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {t("groupMembers")} — {t("selectedCount", { n: secilenUyeler.size })}
              </Label>
              <Input
                value={uyeArama}
                onChange={(e) => setUyeArama(e.target.value)}
                placeholder={t("memberSearch")}
                aria-label={t("memberSearch")}
              />
              <UyeSecici
                adaylar={uyeAdaylari}
                arama={uyeArama}
                locale={locale}
                secili={secilenUyeler}
                degistir={setSecilenUyeler}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKurAcik(false)}>{t("cancel")}</Button>
            <Button
              onClick={grupKurGonder}
              disabled={gonderiliyor || yeniAd.trim().length === 0 || secilenUyeler.size === 0}
            >
              {t("groupCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── GRUBU YÖNET: ad + üye ekle/çıkar ── */}
      <Dialog open={yonetAcik} onOpenChange={setYonetAcik}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("groupManage")}</DialogTitle>
            <DialogDescription>{detay?.baslik}</DialogDescription>
          </DialogHeader>
          {detay && (
            <div className="space-y-4">
              {detay.yonetebilir && !detay.arsivlendiMi && (
                <div className="space-y-1.5">
                  <Label htmlFor="grup-ad-duzenle">{t("rename")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="grup-ad-duzenle"
                      value={adTaslak}
                      onChange={(e) => setAdTaslak(e.target.value)}
                      maxLength={120}
                    />
                    <Button onClick={adKaydet} disabled={gonderiliyor || adTaslak.trim() === detay.baslik}>
                      {t("saveName")}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>{t("groupMembers")}</Label>
                <ul className="max-h-48 overflow-y-auto rounded-md border border-border/60">
                  {detay.uyeler.map((u) => (
                    <li
                      key={u.workerId}
                      className="flex items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0"
                    >
                      <span className={`min-w-0 flex-1 truncate text-sm ${u.cikarildiMi ? "text-muted-foreground line-through" : ""}`}>
                        {u.adSoyad}
                      </span>
                      {u.cikarildiMi ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">{t("removed")}</span>
                      ) : (
                        detay.yonetebilir && !detay.arsivlendiMi && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => uyeCikarGonder(u.workerId)}
                            disabled={gonderiliyor}
                          >
                            {t("remove")}
                          </Button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {detay.yonetebilir && !detay.arsivlendiMi && (
                <div className="space-y-1.5">
                  <Label>
                    {t("addMembers")} — {t("selectedCount", { n: secilenUyeler.size })}
                  </Label>
                  <Input
                    value={uyeArama}
                    onChange={(e) => setUyeArama(e.target.value)}
                    placeholder={t("memberSearch")}
                    aria-label={t("memberSearch")}
                  />
                  <UyeSecici
                    adaylar={uyeAdaylari.filter(
                      (a) => !detay.uyeler.some((u) => u.workerId === a.soforId && !u.cikarildiMi)
                    )}
                    arama={uyeArama}
                    locale={locale}
                    secili={secilenUyeler}
                    degistir={setSecilenUyeler}
                  />
                  <Button
                    onClick={uyeEkleGonder}
                    disabled={gonderiliyor || secilenUyeler.size === 0}
                    className="w-full gap-1.5"
                  >
                    <UserPlus className="size-4" aria-hidden />
                    {t("addMembers")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setYonetAcik(false)}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── KİM OKUDU ── */}
      <Dialog open={okuyanlar !== null} onOpenChange={(a) => !a && setOkuyanlar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("readByTitle")}</DialogTitle>
          </DialogHeader>
          {okuyanlar && okuyanlar.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("readByNobody")}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {okuyanlar?.map((o) => (
                <li
                  key={o.adSoyad + o.an}
                  className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 last:border-b-0"
                >
                  <span className="truncate text-sm">{o.adSoyad}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{damga(o.an)}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Arama yönlendirme ──
          Kendi arama altyapımız YOK ve olmayacak: iki dış uygulamaya
          yönlendiriyoruz. wa.me rakam ister (baştaki + düşer), tel: E.164'ü
          olduğu gibi kabul eder. */}
      <Dialog open={aramaSecimi !== null} onOpenChange={(a) => !a && setAramaSecimi(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("callTitle")}</DialogTitle>
            <DialogDescription>{aramaSecimi?.baslik}</DialogDescription>
          </DialogHeader>
          {/* Button `asChild` desteklemiyor (components/ui/button.tsx), bu yüzden
              bağlantılar buttonVariants ile giydirildi. <a> olmaları ZORUNLU:
              wa.me ve tel: şemalarını tarayıcının/OS'un devralması gerekiyor,
              programatik yönlendirme mobilde engellenebiliyor. */}
          <div className="flex flex-col gap-2">
            <a
              href={`https://wa.me/${waNumarasi(aramaSecimi?.telefon ?? "")}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAramaSecimi(null)}
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("callWhatsapp")}
            </a>
            <a
              href={`tel:${aramaSecimi?.telefon ?? ""}`}
              onClick={() => setAramaSecimi(null)}
              className={buttonVariants()}
            >
              {t("callPhone")}
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


/**
 * ÜYE SEÇİCİ — kapsam süzgeci YOK ve olmamalı.
 *
 * `adaylar` çağırandan geliyor ve o zaten kapsam süzülmüş listeden türüyor
 * (bkz. `uyeAdaylari`). Burada ikinci bir süzgeç kurmak kapsam kuralının
 * ikinci kopyası olurdu; sunucu da ayrıca reddediyor (403 scope).
 */
function UyeSecici({
  adaylar,
  arama,
  locale,
  secili,
  degistir,
}: {
  adaylar: KonusmaSatiri[];
  arama: string;
  locale: string;
  secili: Set<string>;
  degistir: (s: Set<string>) => void;
}) {
  const q = arama.trim().toLocaleLowerCase(locale);
  const gorunen = q
    ? adaylar.filter((a) => a.baslik.toLocaleLowerCase(locale).includes(q))
    : adaylar;

  return (
    <ul className="max-h-48 overflow-y-auto rounded-md border border-border/60">
      {gorunen.length === 0 ? (
        <li className="px-2 py-3 text-center text-xs text-muted-foreground">—</li>
      ) : (
        gorunen.map((a) => {
          const id = a.soforId as string;
          return (
            <li key={id} className="border-b border-border/40 last:border-b-0">
              <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-accent/50">
                <Checkbox
                  checked={secili.has(id)}
                  onCheckedChange={(v) => {
                    const yeni = new Set(secili);
                    if (v === true) yeni.add(id);
                    else yeni.delete(id);
                    degistir(yeni);
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{a.baslik}</span>
                {a.filo && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{a.filo}</span>
                )}
              </label>
            </li>
          );
        })
      )}
    </ul>
  );
}
