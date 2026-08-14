/** ÖLÇÜM (ek) — Can/Kadir vaka analizi + HAK61 04:00 marjı. Salt okuma. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const KOK = "C:/Users/90553/Desktop/business/hak-transport-takip";
function env(f) { const o = {}; for (const l of readFileSync(`${KOK}/${f}`, "utf8").split(/\r?\n/)) { const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ""); } return o; }
const db = (e) => createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TZ = "Europe/Vienna";
const vt = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const key = (iso, off) => new Date(new Date(iso).getTime() - off * 3600_000).toLocaleDateString("en-CA", { timeZone: TZ });
const hm = (iso) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)); return [+p.find(x=>x.type==="hour").value % 24, +p.find(x=>x.type==="minute").value]; };

// ── SENDIGO vaka ─────────────────────────────────────────────────────────
const s = db(env(".env.sendigo"));
const { data: w } = await s.from("workers").select("id, name");
const { data: te } = await s.from("time_entries").select("worker_id, started_at, ended_at, plate").order("started_at");
const nm = (id) => w.find(x => x.id === id)?.name ?? "—";
console.log("══ SENDIGO · VİYANA DUVAR SAATİYLE TÜM VARDİYALAR ══");
for (const e of te) {
  console.log(`  ${String(nm(e.worker_id)).padEnd(16)} ${vt(e.started_at)} → ${e.ended_at ? vt(e.ended_at) : "AÇIK"}  D0=${key(e.started_at,0)}  D4=${key(e.started_at,4)}  ${e.plate ?? "—"}`);
}
console.log("\n══ ÇOK VARDİYALI ŞOFÖR-GÜN — sınır 0/2/4/6/8/10/12 saat ══");
for (const off of [0, 2, 4, 6, 8, 10, 12]) {
  const m = new Map();
  for (const e of te) { const k = `${e.worker_id}|${key(e.started_at, off)}`; m.set(k, (m.get(k) ?? 0) + 1); }
  const cok = [...m.entries()].filter(([, n]) => n > 1);
  console.log(`  sınır ${String(off).padStart(2)}:00 → kova=${m.size}  çakışan şoför-gün=${cok.length}  ${cok.map(([k,n]) => `${nm(k.split("|")[0])} ${k.split("|")[1]}(${n})`).join(", ")}`);
}

// ── HAK61 04:00 marjı ────────────────────────────────────────────────────
const h = db(env(".env.local"));
const { data: hte } = await h.from("time_entries").select("started_at").gte("started_at", new Date(Date.now() - 120*864e5).toISOString());
console.log("\n══ HAK61 · EN ERKEN BAŞLAYAN 25 VARDİYA (Viyana saat:dk) ══");
const sirali = hte.map(e => ({ iso: e.started_at, hm: hm(e.started_at) })).sort((a,b) => (a.hm[0]*60+a.hm[1]) - (b.hm[0]*60+b.hm[1]));
for (const r of sirali.slice(0, 25)) console.log(`   ${String(r.hm[0]).padStart(2,"0")}:${String(r.hm[1]).padStart(2,"0")}   ${vt(r.iso)}`);
const kovalar = { "00:00-01:59": 0, "02:00-02:59": 0, "03:00-03:29": 0, "03:30-03:59": 0, "04:00-04:29": 0, "04:30-04:59": 0, "05:00+": 0 };
for (const r of sirali) { const t = r.hm[0]*60+r.hm[1];
  if (t < 120) kovalar["00:00-01:59"]++; else if (t < 180) kovalar["02:00-02:59"]++;
  else if (t < 210) kovalar["03:00-03:29"]++; else if (t < 240) kovalar["03:30-03:59"]++;
  else if (t < 270) kovalar["04:00-04:29"]++; else if (t < 300) kovalar["04:30-04:59"]++; else kovalar["05:00+"]++; }
console.log("\n  HAK61 sınır marjı:", JSON.stringify(kovalar));
