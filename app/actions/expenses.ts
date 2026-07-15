"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { requireWorker, requireAdmin } from "@/lib/session";
import { createExpenseSchema } from "@/lib/validation";
import { uploadReceipt, signedReceiptUrl, signedReceiptUrls } from "@/lib/storage";
import { sendTelegramMessage, type InlineButton } from "@/lib/telegram";
import { formatDate } from "@/lib/format";
import type { ExpenseEntry, ExpenseEntryWithWorker } from "@/lib/types";

const BUCKET = "expense-receipts";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://hak-transport-takip.vercel.app";
const eur = (n: number) => n.toFixed(2).replace(".", ",");

export type ExpenseResult = { ok: boolean; error?: string; id?: string };
export type PayrollCsvResult =
  | { ok: true; csv: string; filename: string }
  | { ok: false; error: string };

function revalidateExpenses() {
  revalidatePath("/panel/masraflar");
  revalidatePath("/admin/masraflar");
}

async function notifyAdminsExpenseSubmitted(p: {
  name: string;
  category: string;
  amount: number;
}): Promise<void> {
  const { data: admins } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);
  for (const a of admins ?? []) {
    const locale = (a.telegram_locale as string) === "de" ? "de" : "tr";
    const t = await getTranslations({ locale, namespace: "expense" });
    const text = [
      `🧾 ${t("tg_new")}`,
      `👤 ${p.name}`,
      `🏷 ${t(`category.${p.category}`)}`,
      `💶 ${eur(p.amount)} €`,
    ].join("\n");
    const kb: InlineButton[][] = [[{ text: t("tg_btn_approvals"), url: `${APP_URL}/admin/masraflar` }]];
    await sendTelegramMessage(a.telegram_chat_id as string, text, null, kb);
  }
}

async function notifyDriverExpenseDecision(entryId: string, approved: boolean): Promise<void> {
  const { data: e } = await supabaseAdmin
    .from("expense_entries")
    .select("worker_id, category, amount, spent_at, rejection_reason")
    .eq("id", entryId)
    .maybeSingle();
  if (!e?.worker_id) return;
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("id", e.worker_id)
    .maybeSingle();
  if (!w?.telegram_chat_id) return;

  const locale = (w.telegram_locale as string) === "de" ? "de" : "tr";
  const t = await getTranslations({ locale, namespace: "expense" });
  const lines = [
    approved ? `✅ ${t("tg_approved")}` : `❌ ${t("tg_rejected")}`,
    `🏷 ${t(`category.${e.category}`)} · ${eur(Number(e.amount))} €`,
    `📅 ${formatDate(e.spent_at as string, locale)}`,
  ];
  if (!approved && e.rejection_reason) lines.push(`${t("tg_reason")}: ${e.rejection_reason}`);
  const kb: InlineButton[][] = [[{ text: t("tg_btn_panel"), url: `${APP_URL}/panel/masraflar` }]];
  await sendTelegramMessage(w.telegram_chat_id as string, lines.join("\n"), null, kb);
}

export async function createExpenseEntry(formData: FormData): Promise<ExpenseResult> {
  const session = await requireWorker();

  const parsed = createExpenseSchema.safeParse({
    spent_at: formData.get("spent_at"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    description: formData.get("description") || null,
    vehicle_plate: formData.get("vehicle_plate") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  const file = formData.get("receipt") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "receipt_required" };
  const up = await uploadReceipt(BUCKET, session.worker_id!, file);
  if (!up.ok) return { ok: false, error: up.error };

  const { data: inserted, error } = await supabaseAdmin
    .from("expense_entries")
    .insert({
      worker_id: session.worker_id,
      spent_at: new Date(parsed.data.spent_at).toISOString(),
      category: parsed.data.category,
      amount: parsed.data.amount,
      description: parsed.data.description ?? null,
      vehicle_plate: parsed.data.vehicle_plate
        ? parsed.data.vehicle_plate.toUpperCase()
        : null,
      receipt_path: up.path,
      created_by: session.worker_id,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) return { ok: false, error: error?.message ?? "insert" };

  await notifyAdminsExpenseSubmitted({
    name: session.name ?? "—",
    category: parsed.data.category,
    amount: parsed.data.amount,
  });

  revalidateExpenses();
  return { ok: true, id: inserted.id as string };
}

export async function approveExpenseEntry(id: string): Promise<ExpenseResult> {
  const session = await requireAdmin();
  const { data: rows, error } = await supabaseAdmin
    .from("expense_entries")
    .update({
      status: "approved",
      approved_by: session.worker_id,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!rows || rows.length === 0) return { ok: false, error: "not_pending" };
  await notifyDriverExpenseDecision(id, true);
  revalidateExpenses();
  return { ok: true, id };
}

export async function rejectExpenseEntry(id: string, reason: string): Promise<ExpenseResult> {
  const session = await requireAdmin();
  const { data: rows, error } = await supabaseAdmin
    .from("expense_entries")
    .update({
      status: "rejected",
      approved_by: session.worker_id,
      approved_at: new Date().toISOString(),
      rejection_reason: reason.trim() || null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!rows || rows.length === 0) return { ok: false, error: "not_pending" };
  await notifyDriverExpenseDecision(id, false);
  revalidateExpenses();
  return { ok: true, id };
}

export async function getExpenseReceiptUrl(id: string): Promise<string | null> {
  const session = await requireWorker();
  const { data } = await supabaseAdmin
    .from("expense_entries")
    .select("worker_id, receipt_path")
    .eq("id", id)
    .maybeSingle();
  if (!data?.receipt_path) return null;
  if (!session.is_admin && data.worker_id !== session.worker_id) return null;
  return signedReceiptUrl(BUCKET, data.receipt_path as string);
}

export async function getExpenseEntries(opts?: {
  mine?: boolean;
  /** Attach a short-lived signed receipt URL to each row (for thumbnails). */
  withUrls?: boolean;
}): Promise<ExpenseEntryWithWorker[]> {
  const session = await requireWorker();
  const seeAll = !!session.is_admin && !opts?.mine;

  // Masraf arşivi 1000 satırı aşınca bordro (DATEV/BMD) CSV'si sessizce eksik
  // basılır; sonuna kadar sayfalanır.
  const { data } = await fetchAllRows<ExpenseEntry>((from, to) => {
    let query = supabaseAdmin
      .from("expense_entries")
      .select("*")
      .order("spent_at", { ascending: false })
      .order("id");
    if (!seeAll) query = query.eq("worker_id", session.worker_id!);
    return query.range(from, to);
  });
  const rows = data;
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.worker_id).filter(Boolean))] as string[];
  const { data: ws } = ids.length
    ? await supabaseAdmin.from("workers").select("id, name").in("id", ids)
    : { data: [] };
  const wmap = new Map((ws ?? []).map((w) => [w.id as string, w.name as string]));

  // Batch-sign receipt URLs once so the list can render thumbnails directly.
  const urlMap = opts?.withUrls
    ? await signedReceiptUrls(
        BUCKET,
        rows.map((r) => r.receipt_path).filter(Boolean) as string[]
      )
    : null;

  return rows.map((r) => ({
    ...r,
    worker_name: r.worker_id ? wmap.get(r.worker_id) ?? "—" : "—",
    receipt_url: urlMap ? urlMap.get(r.receipt_path) ?? null : r.receipt_url,
  }));
}

function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

/** Payroll-style CSV of approved expenses for a month (admin). DATEV/BMD-style. */
export async function generatePayrollExpenseCSV(month: string): Promise<PayrollCsvResult> {
  await requireAdmin();
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return { ok: false, error: "bad_month" };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));

  // Bordro CSV'si resmi muhasebeye gider: 1000 satır tavanında sessiz kesinti
  // olmaması için sonuna kadar sayfalanır.
  const { data } = await fetchAllRows<
    Pick<
      ExpenseEntry,
      "worker_id" | "spent_at" | "category" | "amount" | "description"
    >
  >((from, to) =>
    supabaseAdmin
      .from("expense_entries")
      .select("worker_id, spent_at, category, amount, description")
      .eq("status", "approved")
      .gte("spent_at", start.toISOString())
      .lt("spent_at", end.toISOString())
      .order("worker_id", { ascending: true })
      .order("spent_at", { ascending: true })
      .order("id")
      .range(from, to)
  );

  const rows = data;
  if (rows.length === 0) return { ok: false, error: "no_data" };

  const ids = [...new Set(rows.map((r) => r.worker_id).filter(Boolean))] as string[];
  const { data: ws } = await supabaseAdmin
    .from("workers")
    .select("id, name, employee_number")
    .in("id", ids);
  const wmap = new Map(
    (ws ?? []).map((w) => [
      w.id as string,
      { name: w.name as string, num: (w.employee_number as string) ?? "" },
    ])
  );

  const header = "PersNr;Mitarbeiter;Datum;Kategorie;Beschreibung;Betrag";
  const lines = rows.map((r) => {
    const w = r.worker_id ? wmap.get(r.worker_id) : undefined;
    const datum = formatDate(r.spent_at, "de");
    const amount = Number(r.amount).toFixed(2).replace(".", ",");
    return [
      csvField(w?.num ?? ""),
      csvField(w?.name ?? "—"),
      csvField(datum),
      csvField(r.category),
      csvField(r.description ?? ""),
      csvField(amount),
    ].join(";");
  });

  const csv = "﻿" + [header, ...lines].join("\r\n");
  return { ok: true, csv, filename: `HAK_Spesen_${month}.csv` };
}
