import { randomUUID } from "node:crypto";
import { readSheet, writeSheet } from "../utils/googleSheets.js";
const SHEET = "TreatmentPayments";
const FIELDS = [
  "id",
  "treatment_id",
  "patient_id",
  "treatment_name",
  "total_fee",
  "payment_type",
  "total_paid",
  "balance",
  "payment_history",
  "status",
  "created_at",
  "updated_at",
];
let queue = Promise.resolve();

const httpError = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const money = (value, label) => {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  )
    throw httpError(`${label} must be a valid number`);
  const n = Number(value);
  if (
    n < 0 ||
    (Math.round(n * 100) !== n * 100 &&
      Math.abs(Math.round(n * 100) - n * 100) > 1e-7)
  )
    throw httpError(`${label} must be non-negative with at most 2 decimals`);
  return Math.round(n * 100);
};
const dateOnly = (value) => {
  const date = value ?? new Date().toISOString().slice(0, 10);
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw httpError("date must be a valid YYYY-MM-DD");
  return date;
};
const parseHistory = (raw) => {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) throw Error();
    return parsed;
  } catch {
    throw httpError("Stored payment_history is invalid JSON", 500);
  }
};
const cents = (n) => Number((n / 100).toFixed(2));
const normalize = (row) => ({
  ...row,
  total_fee: Number(row.total_fee || 0),
  total_paid: Number(row.total_paid || 0),
  balance: Number(row.balance || 0),
  payment_history: parseHistory(row.payment_history),
});
const load = async () => readSheet(SHEET, { forceRefresh: true });
const locked = (task) => {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
};
const calculate = (totalCents, history) => {
  const paidCents = history.reduce(
    (sum, p) => sum + money(p.fee, "history fee"),
    0,
  );
  if (paidCents > totalCents)
    throw httpError("Payment exceeds remaining balance");
  return {
    total_paid: String(cents(paidCents)),
    balance: String(cents(totalCents - paidCents)),
    status:
      paidCents === totalCents ? "PAID" : paidCents ? "PARTIAL" : "UNPAID",
  };
};
const save = async (records) => {
  await writeSheet(SHEET, records);
};

export const listPayments = async () => (await load()).map(normalize);
export const getPayment = async (id) => {
  const row = (await load()).find((r) => r.id === id);
  if (!row) throw httpError("Payment not found", 404);
  return normalize(row);
};
export const createPayment = (body) =>
  locked(async () => {
    const treatment_id = String(body.treatment_id ?? "").trim();
    const patient_id = String(body.patient_id ?? "").trim();
    const treatment_name = String(body.treatment_name ?? "").trim();
    if (!treatment_id || !patient_id)
      throw httpError(
        "treatment_id, patient_id and treatment_name are required",
      );
    const totalCents = money(body.total_fee, "total_fee");
    if (!totalCents) throw httpError("total_fee must be greater than zero");
    const payment_type = String(body.payment_type ?? "").toUpperCase();
    if (!["FULL", "INSTALLMENT"].includes(payment_type))
      throw httpError("payment_type must be FULL or INSTALLMENT");
    const records = await load();
    if (records.some((r) => r.treatment_id === treatment_id))
      throw httpError(
        "A payment record already exists for this treatment",
        409,
      );
    const initialCents =
      payment_type === "FULL"
        ? totalCents
        : money(body.initial_payment ?? 0, "initial_payment");
    if (initialCents > totalCents)
      throw httpError("Initial payment exceeds total fee");
    const history = initialCents
      ? [{ date: dateOnly(body.payment_date), fee: cents(initialCents) }]
      : [];
    const now = new Date().toISOString();
    const row = {
      id: `PAY_${randomUUID()}`,
      treatment_id,
      patient_id,
      treatment_name,
      total_fee: String(cents(totalCents)),
      payment_type,
      ...calculate(totalCents, history),
      payment_history: JSON.stringify(history),
      created_at: now,
      updated_at: now,
    };
    await save([...records, row]);
    return normalize(row);
  });
export const addInstallment = (id, body) =>
  locked(async () => {
    const records = await load();
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) throw httpError("Payment not found", 404);
    const row = records[index];
    if (row.payment_type !== "INSTALLMENT")
      throw httpError("Only installment plans accept additional payments");
    const amount = money(body.fee, "fee");
    if (amount <= 0) throw httpError("fee must be greater than zero");
    const history = parseHistory(row.payment_history);
    history.push({ date: dateOnly(body.date), fee: cents(amount) });
    const updated = {
      ...row,
      ...calculate(money(row.total_fee, "total_fee"), history),
      payment_history: JSON.stringify(history),
      updated_at: new Date().toISOString(),
    };
    records[index] = updated;
    await save(records);
    return normalize(updated);
  });
export const paymentSummary = async () => {
  const rows = await listPayments();
  return {
    count: rows.length,
    paid_count: rows.filter((r) => r.status === "PAID").length,
    partial_count: rows.filter((r) => r.status === "PARTIAL").length,
    unpaid_count: rows.filter((r) => r.status === "UNPAID").length,
    total_fee: cents(
      rows.reduce((s, r) => s + money(r.total_fee, "total_fee"), 0),
    ),
    total_paid: cents(
      rows.reduce((s, r) => s + money(r.total_paid, "total_paid"), 0),
    ),
    balance: cents(rows.reduce((s, r) => s + money(r.balance, "balance"), 0)),
  };
};
export { FIELDS as PAYMENT_HEADERS };
