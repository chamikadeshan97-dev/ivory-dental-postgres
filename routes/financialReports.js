
import { Router } from "express";
import { readSheet } from "../utils/googleSheets.js";

const router = Router();
const SHEET = "treatment_payments";
const ZONE = "Asia/Colombo";
const DAY_MS = 86400000;

const normalize = (v) => String(v ?? "").trim();

const number = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const cents = (v) =>
  Math.round((number(v) + Number.EPSILON) * 100);

const amount = (c) => Math.round(c) / 100;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const validDay = (s) =>
  datePattern.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`)
    .toISOString()
    .slice(0, 10) === s;

const localDay = (v) => {
  if (!v) return null;

  const d = new Date(v);

  if (Number.isNaN(d.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

const dayOffset = (day, offset) =>
  new Date(
    Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);

const today = () => localDay(new Date());

const startOfWeek = (day) => {
  const dow = new Date(
    `${day}T00:00:00Z`,
  ).getUTCDay();

  return dayOffset(day, -((dow + 6) % 7));
};

const periodKey = (day, group) => {
  if (group === "year") return day.slice(0, 4);
  if (group === "month") return day.slice(0, 7);
  if (group === "week") return startOfWeek(day);
  return day;
};

const parseHistory = (v) => {
  if (Array.isArray(v)) return v;

  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
};

const parseRange = (req, res, defaults = {}) => {
  const start =
    normalize(req.query.start_date) || defaults.start;

  const end =
    normalize(req.query.end_date) || defaults.end;

  if (
    !validDay(start) ||
    !validDay(end) ||
    start > end
  ) {
    res.status(400).json({
      success: false,
      message:
        "Use valid start_date and end_date (YYYY-MM-DD), with start_date <= end_date",
    });

    return null;
  }

  return { start, end };
};

const getRecords = async () => {
  const rows = await readSheet(SHEET);

  if (!Array.isArray(rows)) {
    throw new Error(
      "Unable to load treatment payments",
    );
  }

  return rows;
};

const getTransactions = (records) => {
  const txns = [];
  const warnings = [];

  for (const row of records) {
    const history = parseHistory(row.payment_history);

    if (history.length) {
      for (const tx of history) {
        const paid = cents(
          tx.amount ?? tx.payment_amount,
        );

        if (paid <= 0) continue;

        const date = localDay(
          tx.payment_date ||
            tx.created_at ||
            tx.date,
        );

        if (!date) {
          warnings.push(
            `Transaction without valid date in ${
              normalize(row.id) || "unknown record"
            }`,
          );
          continue;
        }

        txns.push({
          id: normalize(tx.id),
          record_id: normalize(row.id),
          appointment_id: normalize(
            row.appointment_id,
          ),
          patient_id: normalize(row.patient_id),
          patient_name: normalize(
            row.patient_name,
          ),
          treatment_name: normalize(
            row.treatment_name,
          ),
          payment_method: normalize(
            tx.payment_method ||
              tx.method ||
              row.payment_method,
          ),
          payment_type: normalize(
            tx.payment_type || row.payment_type,
          ),
          details: normalize(tx.details),
          payment_date:
            tx.payment_date ||
            tx.created_at ||
            tx.date,
          date,
          amount_cents: paid,
        });
      }
    } else {
      // Legacy records may have a total_paid
      // but no transaction history.
      const paid = cents(row.total_paid);

      if (paid <= 0) continue;

      const rawDate =
        row.updated_at || row.created_at;

      const date = localDay(rawDate);

      if (!date) {
        warnings.push(
          `Legacy payment without valid date in ${
            normalize(row.id) || "unknown record"
          }`,
        );
        continue;
      }

      txns.push({
        id: "",
        record_id: normalize(row.id),
        appointment_id: normalize(
          row.appointment_id,
        ),
        patient_id: normalize(row.patient_id),
        patient_name: normalize(
          row.patient_name,
        ),
        treatment_name: normalize(
          row.treatment_name,
        ),
        payment_method: normalize(
          row.payment_method,
        ),
        payment_type: normalize(
          row.payment_type,
        ),
        details: normalize(row.details),
        payment_date: rawDate,
        date,
        amount_cents: paid,
        legacy_estimated_date: true,
      });

      warnings.push(
        `Legacy payment date estimated from record timestamp: ${
          normalize(row.id) || "unknown record"
        }`,
      );
    }
  }

  return { txns, warnings };
};

const inRange = (day, range) =>
  day >= range.start && day <= range.end;

const groupTransactions = (txns, group) => {
  const grouped = new Map();

  for (const tx of txns) {
    const key = periodKey(tx.date, group);

    const item = grouped.get(key) || {
      period: key,
      income_cents: 0,
      transaction_count: 0,
    };

    item.income_cents += tx.amount_cents;
    item.transaction_count++;

    grouped.set(key, item);
  }

  return [...grouped.values()]
    .sort((a, b) =>
      a.period.localeCompare(b.period),
    )
    .map(
      ({
        period,
        income_cents,
        transaction_count,
      }) => ({
        period,
        total_income: amount(income_cents),
        transaction_count,
      }),
    );
};

const respondError = (res, error) => {
  console.error(
    "Financial reports error:",
    error,
  );

  return res.status(500).json({
    success: false,
    message:
      "Unable to generate financial report",
  });
};

const sumCents = (items, field) =>
  items.reduce((s, x) => s + x[field], 0);

/* ========================================================
   1. DAILY INCOME REPORT

   GET /api/treatment-payments/reports/daily
   ?date=2026-11-12
======================================================== */

router.get("/daily", async (req, res) => {
  try {
    const date =
      normalize(req.query.date) || today();

    if (!validDay(date)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date (YYYY-MM-DD)",
      });
    }

    const { txns, warnings } =
      getTransactions(await getRecords());

    const selected = txns.filter(
      (t) => t.date === date,
    );

    return res.json({
      success: true,
      data: {
        date,
        total_income: amount(
          sumCents(selected, "amount_cents"),
        ),
        transaction_count: selected.length,
        transactions: selected.map(
          ({ amount_cents, ...t }) => ({
            ...t,
            amount: amount(amount_cents),
          }),
        ),
      },
      warnings,
    });
  } catch (e) {
    return respondError(res, e);
  }
});

/* ========================================================
   2. WEEKLY INCOME REPORT

   GET /api/treatment-payments/reports/weekly
   ?date=2026-11-12

   Week starts Monday and ends Sunday.
======================================================== */

router.get("/weekly", async (req, res) => {
  try {
    const date =
      normalize(req.query.date) || today();

    if (!validDay(date)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date (YYYY-MM-DD)",
      });
    }

    const start = startOfWeek(date);
    const end = dayOffset(start, 6);

    const { txns, warnings } =
      getTransactions(await getRecords());

    const selected = txns.filter(
      (t) =>
        t.date >= start && t.date <= end,
    );

    return res.json({
      success: true,
      data: {
        start_date: start,
        end_date: end,
        total_income: amount(
          sumCents(selected, "amount_cents"),
        ),
        transaction_count: selected.length,
        daily: groupTransactions(
          selected,
          "day",
        ),
      },
      warnings,
    });
  } catch (e) {
    return respondError(res, e);
  }
});

/* ========================================================
   3. MONTHLY INCOME REPORT

   GET /api/treatment-payments/reports/monthly
   ?month=2026-11
======================================================== */

router.get("/monthly", async (req, res) => {
  try {
    const month =
      normalize(req.query.month) ||
      today().slice(0, 7);

    if (
      !/^\d{4}-\d{2}$/.test(month) ||
      !validDay(`${month}-01`)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid month (YYYY-MM)",
      });
    }

    const { txns, warnings } =
      getTransactions(await getRecords());

    const selected = txns.filter(
      (t) => t.date.slice(0, 7) === month,
    );

    return res.json({
      success: true,
      data: {
        month,
        total_income: amount(
          sumCents(selected, "amount_cents"),
        ),
        transaction_count: selected.length,
        daily: groupTransactions(
          selected,
          "day",
        ),
      },
      warnings,
    });
  } catch (e) {
    return respondError(res, e);
  }
});

/* ========================================================
   4. YEARLY INCOME REPORT

   GET /api/treatment-payments/reports/yearly
   ?year=2026
======================================================== */

router.get("/yearly", async (req, res) => {
  try {
    const year =
      normalize(req.query.year) ||
      today().slice(0, 4);

    if (
      !/^\d{4}$/.test(year) ||
      !validDay(`${year}-01-01`)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid year (YYYY)",
      });
    }

    const { txns, warnings } =
      getTransactions(await getRecords());

    const selected = txns.filter(
      (t) => t.date.slice(0, 4) === year,
    );

    return res.json({
      success: true,
      data: {
        year,
        total_income: amount(
          sumCents(selected, "amount_cents"),
        ),
        transaction_count: selected.length,
        monthly: groupTransactions(
          selected,
          "month",
        ),
      },
      warnings,
    });
  } catch (e) {
    return respondError(res, e);
  }
});

/* ========================================================
   5. REVENUE TREND CHART

   GET /api/treatment-payments/reports/revenue-trend

   Query:
   ?start_date=2026-01-01
   &end_date=2026-12-31
   &group_by=month

   group_by:
   day | week | month | year
======================================================== */

router.get(
  "/revenue-trend",
  async (req, res) => {
    try {
      const current = today();

      const range = parseRange(
        req,
        res,
        {
          start: `${current.slice(0, 4)}-01-01`,
          end: current,
        },
      );

      if (!range) return;

      const group =
        normalize(req.query.group_by) ||
        "month";

      if (
        ![
          "day",
          "week",
          "month",
          "year",
        ].includes(group)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "group_by must be day, week, month, or year",
        });
      }

      const { txns, warnings } =
        getTransactions(await getRecords());

      const selected = txns.filter(
        (t) => inRange(t.date, range),
      );

      return res.json({
        success: true,
        data: {
          start_date: range.start,
          end_date: range.end,
          group_by: group,
          total_income: amount(
            sumCents(
              selected,
              "amount_cents",
            ),
          ),
          points: groupTransactions(
            selected,
            group,
          ),
        },
        warnings,
      });
    } catch (e) {
      return respondError(res, e);
    }
  },
);

/* ========================================================
   6. TREATMENT FEES VS COLLECTED PAYMENTS

   GET /api/treatment-payments/reports/fees-vs-collected

   Query:
   ?start_date=2026-01-01
   &end_date=2026-12-31
   &group_by=month

   Treatment fees: record creation date
   Collections: actual transaction date
======================================================== */

router.get(
  "/fees-vs-collected",
  async (req, res) => {
    try {
      const current = today();

      const range = parseRange(
        req,
        res,
        {
          start: `${current.slice(0, 4)}-01-01`,
          end: current,
        },
      );

      if (!range) return;

      const group =
        normalize(req.query.group_by) ||
        "month";

      if (
        ![
          "day",
          "week",
          "month",
          "year",
        ].includes(group)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "group_by must be day, week, month, or year",
        });
      }

      const records = await getRecords();

      const { txns, warnings } =
        getTransactions(records);

      const buckets = new Map();

      const ensure = (key) => {
        if (!buckets.has(key)) {
          buckets.set(key, {
            period: key,
            fees_cents: 0,
            collected_cents: 0,
            treatment_count: 0,
            transaction_count: 0,
          });
        }

        return buckets.get(key);
      };

      // Group treatment fees by creation date.
      for (const record of records) {
        const date = localDay(
          record.created_at,
        );

        if (!date) {
          warnings.push(
            `Treatment fee without valid created_at: ${
              normalize(record.id) ||
              "unknown record"
            }`,
          );
          continue;
        }

        if (!inRange(date, range)) {
          continue;
        }

        const bucket = ensure(
          periodKey(date, group),
        );

        bucket.fees_cents += cents(
          record.treatment_fee,
        );

        bucket.treatment_count++;
      }

      // Group collections by payment date.
      for (const tx of txns) {
        if (!inRange(tx.date, range)) {
          continue;
        }

        const bucket = ensure(
          periodKey(tx.date, group),
        );

        bucket.collected_cents +=
          tx.amount_cents;

        bucket.transaction_count++;
      }

      const points = [
        ...buckets.values(),
      ]
        .sort((a, b) =>
          a.period.localeCompare(b.period),
        )
        .map(
          ({
            period,
            fees_cents,
            collected_cents,
            treatment_count,
            transaction_count,
          }) => ({
            period,
            treatment_fees:
              amount(fees_cents),
            collected_payments:
              amount(collected_cents),
            treatment_count,
            transaction_count,
          }),
        );

      return res.json({
        success: true,
        data: {
          start_date: range.start,
          end_date: range.end,
          group_by: group,

          total_treatment_fees:
            amount(
              points.reduce(
                (s, p) =>
                  s +
                  cents(
                    p.treatment_fees,
                  ),
                0,
              ),
            ),

          total_collected:
            amount(
              points.reduce(
                (s, p) =>
                  s +
                  cents(
                    p.collected_payments,
                  ),
                0,
              ),
            ),

          points,
        },

        warnings,

        notes: [
          "Treatment fees are grouped by record creation date; collections by actual transaction date.",
          "Payments for older treatments may exceed newly recorded fees within the selected period.",
        ],
      });
    } catch (e) {
      return respondError(res, e);
    }
  },
);

export default router;
