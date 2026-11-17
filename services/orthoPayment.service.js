
import prisma from "../config/prisma.js";

/* ========================================================
   HELPERS
======================================================== */

const clean = (value) =>
  String(value ?? "").trim();

const normalize = (value) =>
  clean(value).toLowerCase();

const nowISO = () =>
  new Date().toISOString();

const todayISO = () =>
  new Date().toISOString().split("T")[0];

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
};

/* ========================================================
   GENERATE NEXT PAYMENT ID
======================================================== */

const generateNextId = (rows) => {
  let max = 0;

  rows.forEach((row) => {
    const id = clean(row.orthoPaymentId);

    const match = id.match(/^ORP_(\d+)$/i);

    if (!match) return;

    const number = Number(match[1]);

    if (Number.isFinite(number) && number > max) {
      max = number;
    }
  });

  return `ORP_${String(max + 1).padStart(4, "0")}`;
};

/* ========================================================
   FORMAT PAYMENT RESPONSE
======================================================== */

const formatOrthoPayment = (record) => {
  if (!record) return null;

  return {
    ortho_payment_id: record.orthoPaymentId,
    ortho_case_id: record.orthoCaseId,
    ortho_visit_id: record.orthoVisitId ?? "",
    patient_id: record.patientId,

    payment_date: record.paymentDate ?? "",
    amount: toNumber(record.amount),

    payment_method: record.paymentMethod ?? "",
    payment_type: record.paymentType ?? "",

    receipt_no: record.receiptNo ?? "",
    notes: record.notes ?? "",
    recorded_by: record.recordedBy ?? "",

    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  };
};

/* ========================================================
   FIND PAYMENT BY ID
======================================================== */

const findPaymentById = async (
  paymentId,
  db = prisma,
) => {
  return db.orthoPayment.findFirst({
    where: {
      orthoPaymentId: {
        equals: clean(paymentId),
        mode: "insensitive",
      },
    },
  });
};

/* ========================================================
   1. CREATE ORTHO PAYMENT
======================================================== */

export const createOrthoPaymentService = async (
  caseId,
  payload = {},
) => {
  const amount = toNumber(payload.amount);

  if (amount <= 0) {
    throw new Error(
      "Payment amount must be greater than 0",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      /*
       * Serialize payment ID generation.
       */
      await tx.$executeRaw`
        LOCK TABLE "ortho_payments"
        IN EXCLUSIVE MODE
      `;

      const orthoCase =
        await tx.orthoCase.findFirst({
          where: {
            orthoCaseId: {
              equals: clean(caseId),
              mode: "insensitive",
            },
          },
        });

      if (!orthoCase) {
        throw new Error("Ortho case not found");
      }

      const existingPayments =
        await tx.orthoPayment.findMany({
          select: {
            orthoPaymentId: true,
          },
        });

      const paymentId =
        generateNextId(existingPayments);

      const timestamp = nowISO();

      const record =
        await tx.orthoPayment.create({
          data: {
            orthoPaymentId: paymentId,

            orthoCaseId:
              orthoCase.orthoCaseId,

            orthoVisitId: clean(
              payload.ortho_visit_id,
            ),

            patientId:
              orthoCase.patientId,

            paymentDate:
              clean(payload.payment_date) ||
              todayISO(),

            amount,

            paymentMethod: clean(
              payload.payment_method,
            ),

            paymentType: clean(
              payload.payment_type,
            ),

            receiptNo:
              clean(payload.receipt_no) ||
              `ORT-RCP-${paymentId.replace(
                "ORP_",
                "",
              )}`,

            notes: clean(
              payload.notes,
            ),

            recordedBy: clean(
              payload.recorded_by,
            ),

            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });

      return formatOrthoPayment(record);
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   2. GET PAYMENTS BY ORTHO CASE
======================================================== */

export const getOrthoPaymentsByCaseService = async (
  caseId,
) => {
  const payments =
    await prisma.orthoPayment.findMany({
      where: {
        orthoCaseId: {
          equals: clean(caseId),
          mode: "insensitive",
        },
      },
    });

  const results = payments.map(
    formatOrthoPayment,
  );

  const totalPaid = results.reduce(
    (sum, row) =>
      sum + toNumber(row.amount),
    0,
  );

  return {
    payments: results,
    totalPaid,
  };
};

/* ========================================================
   3. GET ORTHO PAYMENT BY ID
======================================================== */

export const getOrthoPaymentByIdService = async (
  paymentId,
) => {
  const record = await findPaymentById(
    paymentId,
  );

  return formatOrthoPayment(record);
};

/* ========================================================
   4. UPDATE ORTHO PAYMENT
======================================================== */

export const updateOrthoPaymentService = async (
  paymentId,
  payload = {},
) => {
  const existing = await findPaymentById(
    paymentId,
  );

  if (!existing) {
    return null;
  }

  /*
   * Protected fields:
   * - ortho_payment_id
   * - ortho_case_id
   * - patient_id
   * - created_at
   */
  const fieldMap = {
    ortho_visit_id: "orthoVisitId",
    payment_date: "paymentDate",
    amount: "amount",
    payment_method: "paymentMethod",
    payment_type: "paymentType",
    receipt_no: "receiptNo",
    notes: "notes",
    recorded_by: "recordedBy",
  };

  const updateData = {};

  Object.entries(payload).forEach(
    ([key, value]) => {
      const prismaField =
        fieldMap[key];

      if (!prismaField) return;

      updateData[prismaField] =
        prismaField === "amount"
          ? toNumber(value)
          : clean(value);
    },
  );

  const finalAmount =
    updateData.amount !== undefined
      ? updateData.amount
      : toNumber(existing.amount);

  if (finalAmount <= 0) {
    throw new Error(
      "Payment amount must be greater than 0",
    );
  }

  updateData.updatedAt = nowISO();

  const updated =
    await prisma.orthoPayment.update({
      where: {
        orthoPaymentId:
          existing.orthoPaymentId,
      },

      data: updateData,
    });

  return formatOrthoPayment(updated);
};

/* ========================================================
   5. DELETE ORTHO PAYMENT
======================================================== */

export const deleteOrthoPaymentService = async (
  paymentId,
) => {
  const existing = await findPaymentById(
    paymentId,
  );

  if (!existing) {
    return null;
  }

  const deleted =
    await prisma.orthoPayment.delete({
      where: {
        orthoPaymentId:
          existing.orthoPaymentId,
      },
    });

  return formatOrthoPayment(deleted);
};

/* ========================================================
   6. DELETE ALL PAYMENTS BY ORTHO CASE
======================================================== */

export const deleteOrthoPaymentsByCaseService = async (
  caseId,
) => {
  const normalizedCaseId = normalize(
    caseId,
  );

  if (!normalizedCaseId) {
    throw new Error(
      "Ortho case ID is required",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      /*
       * Prevent concurrent payment writes
       * during bulk deletion.
       */
      await tx.$executeRaw`
        LOCK TABLE "ortho_payments"
        IN EXCLUSIVE MODE
      `;

      const relatedPayments =
        await tx.orthoPayment.findMany({
          where: {
            orthoCaseId: {
              equals: clean(caseId),
              mode: "insensitive",
            },
          },
        });

      if (!relatedPayments.length) {
        return {
          case_id: caseId,
          deleted_count: 0,
          deleted_payment_ids: [],
          deleted_total_amount: 0,
        };
      }

      const deletedTotalAmount =
        relatedPayments.reduce(
          (sum, payment) =>
            sum + toNumber(
              payment.amount,
            ),
          0,
        );

      await tx.orthoPayment.deleteMany({
        where: {
          orthoPaymentId: {
            in: relatedPayments.map(
              (payment) =>
                payment.orthoPaymentId,
            ),
          },
        },
      });

      return {
        case_id: caseId,

        deleted_count:
          relatedPayments.length,

        deleted_payment_ids:
          relatedPayments.map(
            (payment) =>
              payment.orthoPaymentId,
          ),

        deleted_total_amount:
          deletedTotalAmount,
      };
    },
    {
      timeout: 15000,
    },
  );
};
