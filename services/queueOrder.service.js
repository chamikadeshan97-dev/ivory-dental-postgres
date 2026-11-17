
import prisma from "../config/prisma.js";

/* ========================================================
   HELPERS
======================================================== */

const normalize = (value) =>
  String(value ?? "").trim();

const nowIso = () =>
  new Date().toISOString();

/* ========================================================
   PARSE QUEUE ORDER SAFELY
======================================================== */

const parseQueueOrder = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed =
      typeof value === "string"
        ? JSON.parse(value)
        : value;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalize(item))
      .filter(Boolean);
  } catch (error) {
    console.error(
      "Failed to parse queue_order:",
      error,
    );

    return [];
  }
};

/* ========================================================
   FORMAT QUEUE RESPONSE
======================================================== */

const formatQueue = (record) => {
  if (!record) {
    return null;
  }

  return {
    date: normalize(record.date),

    queue_order: parseQueueOrder(
      record.queueOrder,
    ),

    updated_at: record.updatedAt || null,
  };
};

/* ========================================================
   1. GET QUEUE BY DATE
======================================================== */

export const getQueueByDate = async (date) => {
  if (!date) {
    throw new Error("Date is required");
  }

  const normalizedDate = normalize(date);

  const record = await prisma.queueOrder.findUnique({
    where: {
      date: normalizedDate,
    },
  });

  if (!record) {
    return {
      date: normalizedDate,
      queue_order: [],
      updated_at: null,
    };
  }

  return formatQueue(record);
};

/* ========================================================
   2. SAVE DAILY QUEUE
======================================================== */

export const saveQueue = async ({
  date,
  queue_order,
}) => {
  if (!date) {
    throw new Error("Date is required");
  }

  if (!Array.isArray(queue_order)) {
    throw new Error(
      "queue_order must be an array",
    );
  }

  const normalizedDate = normalize(date);

  /*
   * Clean appointment IDs.
   */
  const cleanedQueue = queue_order
    .map((item) => normalize(item))
    .filter(Boolean);

  /*
   * Prevent duplicate appointment IDs.
   */
  const uniqueQueue = [
    ...new Set(cleanedQueue),
  ];

  if (
    uniqueQueue.length !==
    cleanedQueue.length
  ) {
    throw new Error(
      "Duplicate appointments are not allowed in the queue",
    );
  }

  const timestamp = nowIso();

  /*
   * Create a new daily queue or replace
   * the existing queue for that date.
   *
   * Prisma upsert is atomic.
   */
  const savedQueue = await prisma.queueOrder.upsert({
    where: {
      date: normalizedDate,
    },

    create: {
      date: normalizedDate,

      queueOrder: uniqueQueue,

      updatedAt: timestamp,
    },

    update: {
      queueOrder: uniqueQueue,

      updatedAt: timestamp,
    },
  });

  return formatQueue(savedQueue);
};

/* ========================================================
   3. CLEAR DAILY QUEUE
======================================================== */

export const clearQueue = async (date) => {
  return saveQueue({
    date,
    queue_order: [],
  });
};
