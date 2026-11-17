
import { randomUUID } from "node:crypto";

import prisma from "../config/prisma.js";

/* ========================================================
   CONFIGURATION
======================================================== */

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

/* ========================================================
   ERROR HELPER
======================================================== */

const httpError = (message, status = 400) => {
  const error = new Error(message);

  error.status = status;
  error.statusCode = status;

  return error;
};

/* ========================================================
   GENERAL HELPERS
======================================================== */

const normalizeText = (value) =>
  String(value ?? "").trim();

const money = (value, label) => {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    throw httpError(
      `${label} must be a valid number`,
    );
  }

  const n = Number(value);

  if (
    n < 0 ||
    (
      Math.round(n * 100) !== n * 100 &&
      Math.abs(Math.round(n * 100) - n * 100) > 1e-7
    )
  ) {
    throw httpError(
      `${label} must be non-negative with at most 2 decimals`,
    );
  }

  return Math.round(n * 100);
};

const cents = (n) =>
  Number((n / 100).toFixed(2));

const getNow = () =>
  new Date().toISOString();

/* ========================================================
   DATE VALIDATION
======================================================== */

const dateOnly = (value) => {
  const date =
    value ??
    new Date().toISOString().slice(0, 10);

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    throw httpError(
      "date must be a valid YYYY-MM-DD",
    );
  }

  const parsed = new Date(
    `${date}T00:00:00Z`,
  );

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw httpError(
      "date must be a valid YYYY-MM-DD",
    );
  }

  return date;
};

/* ========================================================
   PAYMENT HISTORY
======================================================== */

const parseHistory = (raw) => {
  try {
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw || "[]")
        : raw ?? [];

    if (!Array.isArray(parsed)) {
      throw new Error();
    }

    return parsed;
  } catch {
    throw httpError(
      "Stored payment_history is invalid JSON",
      500,
    );
  }
};

/* ========================================================
   PRISMA RESPONSE MAPPER
======================================================== */

const normalize = (row) => {
  if (!row) return null;

  return {
    id: row.id,

    treatment_id: row.treatmentId ?? "",
    patient_id: row.patientId ?? "",
    treatment_name: row.treatmentName ?? "",

    total_fee: Number(row.totalFee ?? 0),

    payment_type: row.paymentType ?? "",

    total_paid: Number(row.totalPaid ?? 0),
    balance: Number(row.balance ?? 0),

    payment_history: parseHistory(
      row.paymentHistory,
    ),

    status: row.status ?? "",

    created_at: row.createdAt ?? "",
    updated_at: row.updatedAt ?? "",
  };
};

/* ========================================================
   PAYMENT CALCULATION
======================================================== */

const calculate = (totalCents, history) => {
  const paidCents = history.reduce(
    (sum, payment) =>
      sum + money(payment.fee, "history fee"),
    0,
  );

  if (paidCents > totalCents) {
    throw httpError(
      "Payment exceeds remaining balance",
    );
  }

  return {
    totalPaid: cents(paidCents),

    balance: cents(
      totalCents - paidCents,
    ),

    status:
      paidCents === totalCents
        ? "PAID"
        : paidCents > 0
          ? "PARTIAL"
          : "UNPAID",
  };
};

/* ========================================================
   DATABASE HELPERS
======================================================== */

const getPaymentRecord = async (
  id,
  db = prisma,
) => {
  return db.treatmentPayment.findUnique({
    where: {
      id: normalizeText(id),
    },
  });
};

/* ========================================================
   1. LIST PAYMENTS
======================================================== */

export const listPayments = async () => {
  const records =
    await prisma.treatmentPayment.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

  return records.map(normalize);
};

/* ========================================================
   2. GET PAYMENT BY ID
======================================================== */

export const getPayment = async (id) => {
  const record = await getPaymentRecord(id);

  if (!record) {
    throw httpError(
      "Payment not found",
      404,
    );
  }

  return normalize(record);
};

/* ========================================================
   3. CREATE PAYMENT
======================================================== */

export const createPayment = async (body = {}) => {
  const treatmentId = normalizeText(
    body.treatment_id,
  );

  const patientId = normalizeText(
    body.patient_id,
  );

  const treatmentName = normalizeText(
    body.treatment_name,
  );

  if (
    !treatmentId ||
    !patientId ||
    !treatmentName
  ) {
    throw httpError(
      "treatment_id, patient_id and treatment_name are required",
    );
  }

  const totalCents = money(
    body.total_fee,
    "total_fee",
  );

  if (!totalCents) {
    throw httpError(
      "total_fee must be greater than zero",
    );
  }

  const paymentType = normalizeText(
    body.payment_type,
  ).toUpperCase();

  if (
    !["FULL", "INSTALLMENT"].includes(
      paymentType,
    )
  ) {
    throw httpError(
      "payment_type must be FULL or INSTALLMENT",
    );
  }

  const initialCents =
    paymentType === "FULL"
      ? totalCents
      : money(
          body.initial_payment ?? 0,
          "initial_payment",
        );

  if (initialCents > totalCents) {
    throw httpError(
      "Initial payment exceeds total fee",
    );
  }

  const history = initialCents
    ? [
        {
          date: dateOnly(
            body.payment_date,
          ),
          fee: cents(initialCents),
        },
      ]
    : [];

  const calculated = calculate(
    totalCents,
    history,
  );

  return prisma.$transaction(
    async (tx) => {
      /*
       * Serialize creation and duplicate checks.
       */
      await tx.$executeRaw`
        LOCK TABLE "treatment_payments"
        IN EXCLUSIVE MODE
      `;

      const existing =
        await tx.treatmentPayment.findFirst({
          where: {
            treatmentId,
          },
        });

      if (existing) {
        throw httpError(
          "A payment record already exists for this treatment",
          409,
        );
      }

      const timestamp = getNow();

      const created =
        await tx.treatmentPayment.create({
          data: {
            id: `PAY_${randomUUID()}`,

            treatmentId,
            patientId,
            treatmentName,

            totalFee: cents(totalCents),

            paymentType,

            totalPaid:
              calculated.totalPaid,

            balance:
              calculated.balance,

            paymentHistory: history,

            status:
              calculated.status,

            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });

      return normalize(created);
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   4. ADD INSTALLMENT
======================================================== */

export const addInstallment = async (
  id,
  body = {},
) => {
  const paymentId = normalizeText(id);

  return prisma.$transaction(
    async (tx) => {
      /*
       * Prevent concurrent installment requests
       * from overwriting payment history.
       */
      await tx.$executeRaw`
        LOCK TABLE "treatment_payments"
        IN EXCLUSIVE MODE
      `;

      const record = await getPaymentRecord(
        paymentId,
        tx,
      );

      if (!record) {
        throw httpError(
          "Payment not found",
          404,
        );
      }

      if (
        record.paymentType !== "INSTALLMENT"
      ) {
        throw httpError(
          "Only installment plans accept additional payments",
        );
      }

      const amount = money(
        body.fee,
        "fee",
      );

      if (amount <= 0) {
        throw httpError(
          "fee must be greater than zero",
        );
      }

      const history = [
        ...parseHistory(
          record.paymentHistory,
        ),
      ];

      history.push({
        date: dateOnly(body.date),
        fee: cents(amount),
      });

      const calculated = calculate(
        money(
          record.totalFee,
          "total_fee",
        ),
        history,
      );

      const updated =
        await tx.treatmentPayment.update({
          where: {
            id: record.id,
          },

          data: {
            totalPaid:
              calculated.totalPaid,

            balance:
              calculated.balance,

            status:
              calculated.status,

            paymentHistory: history,

            updatedAt: getNow(),
          },
        });

      return normalize(updated);
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   5. PAYMENT SUMMARY
======================================================== */

export const paymentSummary = async () => {
  const rows = await listPayments();

  return {
    count: rows.length,

    paid_count: rows.filter(
      (row) =>
        row.status?.toUpperCase() === "PAID",
    ).length,

    partial_count: rows.filter(
      (row) =>
        row.status?.toUpperCase() === "PARTIAL",
    ).length,

    unpaid_count: rows.filter(
      (row) =>
        ["UNPAID", "UNPAID"].includes(
          row.status?.toUpperCase(),
        ) ||
        row.status?.toUpperCase() === "UNPAID",
    ).length,

    total_fee: cents(
      rows.reduce(
        (sum, row) =>
          sum + money(
            row.total_fee,
            "total_fee",
          ),
        0,
      ),
    ),

    total_paid: cents(
      rows.reduce(
        (sum, row) =>
          sum + money(
            row.total_paid,
            "total_paid",
          ),
        0,
      ),
    ),

    balance: cents(
      rows.reduce(
        (sum, row) =>
          sum + money(
            row.balance,
            "balance",
          ),
        0,
      ),
    ),
  };
};

/* ========================================================
   EXPORT HEADERS
======================================================== */

export {
  FIELDS as PAYMENT_HEADERS,
};
