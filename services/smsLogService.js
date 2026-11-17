
/* ============================================================
   IVORY DENTAL - DAILY SMS LOG SERVICE
   PostgreSQL + Prisma
============================================================ */

import { randomUUID } from "node:crypto";

import prisma from "../config/prisma.js";

/* ============================================================
   CONFIG
============================================================ */

export const SMS_TYPES = Object.freeze({
  DOCTOR_ARRIVAL: "DOCTOR_ARRIVAL",
  APPOINTMENT: "APPOINTMENT",
});

const VALID_TYPES = Object.values(SMS_TYPES);

const TIME_ZONE = "Asia/Colombo";

/* ============================================================
   HELPERS
============================================================ */

const getToday = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
};

const getTimestamp = () => {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);

  error.statusCode = statusCode;
  error.status = statusCode;

  return error;
};

const validateType = (smsType) => {
  if (!VALID_TYPES.includes(smsType)) {
    throw createError("Invalid SMS type", 400);
  }
};

const toNumber = (value) =>
  Number(value) || 0;

/* ============================================================
   FORMAT RESPONSE
============================================================ */

const formatRecord = (record, smsType, date) => {
  if (!record) {
    return {
      date,
      smsType,
      status: "NOT_SENT",
      alreadySent: false,
      sending: false,
      total: 0,
      successCount: 0,
      failedCount: 0,
      sentBy: null,
      sentAt: null,
    };
  }

  return {
    date: record.date ?? date,

    smsType: record.smsType ?? smsType,

    status: record.status ?? "NOT_SENT",

    alreadySent:
      record.status === "COMPLETED",

    sending:
      record.status === "SENDING",

    total: toNumber(record.total),

    successCount: toNumber(record.sent),

    failedCount: toNumber(record.fail),

    sentBy: record.sentBy || null,

    sentAt: record.sentAt || null,
  };
};

/* ============================================================
   GET ONE SMS STATUS
============================================================ */

export const getSMSStatus = async (smsType) => {
  validateType(smsType);

  const date = getToday();

  const record = await prisma.smsLog.findFirst({
    where: {
      date,
      smsType,
    },
  });

  return formatRecord(record, smsType, date);
};

/* ============================================================
   GET BOTH SMS STATUSES
============================================================ */

export const getTodaySMSStatuses = async () => {
  const date = getToday();

  const records = await prisma.smsLog.findMany({
    where: {
      date,

      smsType: {
        in: VALID_TYPES,
      },
    },
  });

  const doctorArrival = records.find(
    (record) =>
      record.smsType ===
      SMS_TYPES.DOCTOR_ARRIVAL,
  );

  const appointment = records.find(
    (record) =>
      record.smsType ===
      SMS_TYPES.APPOINTMENT,
  );

  return {
    date,

    doctorArrival: formatRecord(
      doctorArrival,
      SMS_TYPES.DOCTOR_ARRIVAL,
      date,
    ),

    appointment: formatRecord(
      appointment,
      SMS_TYPES.APPOINTMENT,
      date,
    ),
  };
};

/* ============================================================
   CLAIM SMS BATCH

   Only one batch per SMS type per day.
============================================================ */

export const claimSMSBatch = async ({
  smsType,
  total,
  sentBy,
}) => {
  validateType(smsType);

  if (
    !Number.isInteger(total) ||
    total < 1
  ) {
    throw createError(
      "Invalid total SMS count",
      400,
    );
  }

  const date = getToday();

  const token = randomUUID();

  try {
    const record = await prisma.smsLog.create({
      data: {
        date,
        smsType,

        status: "SENDING",

        total,
        sent: 0,
        fail: 0,

        sentBy:
          String(sentBy || "Unknown"),

        sentAt: null,

        batchToken: token,
      },
    });

    return {
      success: true,
      date: record.date,
      smsType: record.smsType,
      status: "SENDING",
      token,
    };
  } catch (error) {
    /*
     * Unique constraint violation:
     * Another batch already exists for
     * the same date and SMS type.
     */
    if (error.code === "P2002") {
      const existing =
        await prisma.smsLog.findFirst({
          where: {
            date,
            smsType,
          },
        });

      return {
        success: false,

        alreadySent:
          existing?.status === "COMPLETED",

        status:
          existing?.status || "SENDING",

        message:
          "Today's SMS batch has already been started.",
      };
    }

    throw error;
  }
};

/* ============================================================
   COMPLETE SMS BATCH

   Token-based lookup supports batches
   that cross midnight.
============================================================ */

export const completeSMSBatch = async ({
  smsType,
  token,
  successCount,
  failedCount,
}) => {
  validateType(smsType);

  if (
    !token ||
    typeof token !== "string"
  ) {
    throw createError(
      "Batch token is required",
      400,
    );
  }

  if (
    !Number.isInteger(successCount) ||
    !Number.isInteger(failedCount) ||
    successCount < 0 ||
    failedCount < 0
  ) {
    throw createError(
      "Invalid SMS counts",
      400,
    );
  }

  const record = await prisma.smsLog.findFirst({
    where: {
      smsType,
      batchToken: token,
    },
  });

  if (!record) {
    throw createError(
      "SMS batch not found",
      404,
    );
  }

  if (record.status !== "SENDING") {
    throw createError(
      "SMS batch is not in sending status",
      409,
    );
  }

  const total = toNumber(record.total);

  if (
    successCount + failedCount !== total
  ) {
    throw createError(
      "SMS counts do not match batch total",
      400,
    );
  }

  const status =
    failedCount === 0
      ? "COMPLETED"
      : successCount > 0
        ? "PARTIAL"
        : "FAILED";

  /*
   * Conditional update prevents a second
   * completion from overwriting this batch.
   */
  const updated =
    await prisma.smsLog.updateMany({
      where: {
        id: record.id,
        status: "SENDING",
        batchToken: token,
      },

      data: {
        status,

        sent: successCount,

        fail: failedCount,

        sentAt: getTimestamp(),
      },
    });

  if (updated.count !== 1) {
    throw createError(
      "SMS batch is not in sending status",
      409,
    );
  }

  return {
    success: true,

    date: record.date,

    smsType,

    status,

    total,

    successCount,

    failedCount,
  };
};
