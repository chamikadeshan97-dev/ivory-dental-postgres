
import prisma from "../config/prisma.js";

import { createId, now } from "../utils/helpers.js";

import appError from "../utils/appError.js";

/* ========================================================
   HELPERS
======================================================== */

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeTreatmentName(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeTreatmentNameForComparison(value) {
  return normalizeTreatmentName(value).toLowerCase();
}

function validateTreatmentName(value) {
  const treatmentName = normalizeTreatmentName(value);

  if (!treatmentName) {
    throw appError("Treatment name is required", 400);
  }

  if (treatmentName.length > 150) {
    throw appError(
      "Treatment name cannot exceed 150 characters",
      400,
    );
  }

  return treatmentName;
}

function validateFee(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    throw appError("Treatment fee is required", 400);
  }

  const fee = Number(value);

  if (!Number.isFinite(fee)) {
    throw appError(
      "Treatment fee must be a valid number",
      400,
    );
  }

  if (fee < 0) {
    throw appError(
      "Treatment fee cannot be less than zero",
      400,
    );
  }

  return Number(fee.toFixed(2));
}

/* ========================================================
   PRISMA RESPONSE MAPPER
======================================================== */

function normalizeTreatment(record) {
  if (!record) return null;

  return {
    id: normalizeText(record.id),

    treatment_name: normalizeTreatmentName(
      record.treatmentName,
    ),

    fee: Number(record.fee ?? 0),

    created_at: normalizeText(record.createdAt),

    updated_at: normalizeText(record.updatedAt),
  };
}

function sortTreatmentsByName(treatments) {
  return [...treatments].sort((first, second) =>
    first.treatment_name.localeCompare(
      second.treatment_name,
      undefined,
      {
        sensitivity: "base",
      },
    ),
  );
}

/* ========================================================
   DATABASE HELPERS
======================================================== */

async function getAllTreatmentRows(db = prisma) {
  const records = await db.commonTreatment.findMany();

  return records
    .map(normalizeTreatment)
    .filter((treatment) => Boolean(treatment?.id));
}

async function findTreatmentById(id, db = prisma) {
  return db.commonTreatment.findFirst({
    where: {
      id: {
        equals: normalizeText(id),
        mode: "insensitive",
      },
    },
  });
}

function findDuplicateTreatment(
  treatments,
  treatmentName,
  ignoredId = null,
) {
  const normalizedName =
    normalizeTreatmentNameForComparison(treatmentName);

  const normalizedIgnoredId = ignoredId
    ? normalizeText(ignoredId).toLowerCase()
    : null;

  return treatments.find((treatment) => {
    const hasSameName =
      normalizeTreatmentNameForComparison(
        treatment.treatment_name,
      ) === normalizedName;

    const isIgnoredTreatment =
      normalizedIgnoredId &&
      normalizeText(treatment.id).toLowerCase() ===
        normalizedIgnoredId;

    return hasSameName && !isIgnoredTreatment;
  });
}

/* ========================================================
   1. CREATE COMMON TREATMENT
======================================================== */

export async function createCommonTreatment(data) {
  const treatmentName = validateTreatmentName(
    data?.treatment_name,
  );

  const fee = validateFee(data?.fee);

  return prisma.$transaction(
    async (tx) => {
      // Serialize treatment creation and duplicate checks.
      await tx.$executeRaw`
        LOCK TABLE "common_treatments" IN EXCLUSIVE MODE
      `;

      const treatments = await getAllTreatmentRows(tx);

      const duplicateTreatment = findDuplicateTreatment(
        treatments,
        treatmentName,
      );

      if (duplicateTreatment) {
        throw appError(
          "A common treatment with this name already exists",
          409,
        );
      }

      const timestamp = now();

      const created = await tx.commonTreatment.create({
        data: {
          id: createId("CT"),
          treatmentName,
          fee,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      return normalizeTreatment(created);
    },
    {
      timeout: 15000,
    },
  );
}

/* ========================================================
   2. GET ALL COMMON TREATMENTS
======================================================== */

export async function getAllCommonTreatments() {
  const treatments = await getAllTreatmentRows();

  return sortTreatmentsByName(treatments);
}

/* ========================================================
   3. SEARCH COMMON TREATMENTS
======================================================== */

export async function searchCommonTreatments(q) {
  const treatments = await getAllTreatmentRows();

  const searchValue = normalizeText(q).toLowerCase();

  if (!searchValue) {
    return sortTreatmentsByName(treatments);
  }

  const filteredTreatments = treatments.filter(
    (treatment) => {
      const treatmentId = normalizeText(
        treatment.id,
      ).toLowerCase();

      const treatmentName = normalizeText(
        treatment.treatment_name,
      ).toLowerCase();

      const treatmentFee = String(
        treatment.fee,
      ).toLowerCase();

      return (
        treatmentId.includes(searchValue) ||
        treatmentName.includes(searchValue) ||
        treatmentFee.includes(searchValue)
      );
    },
  );

  return sortTreatmentsByName(filteredTreatments);
}

/* ========================================================
   4. GET COMMON TREATMENT BY ID
======================================================== */

export async function getCommonTreatmentById(id) {
  const normalizedId = normalizeText(id);

  if (!normalizedId) {
    throw appError(
      "Common treatment ID is required",
      400,
    );
  }

  const treatment = await findTreatmentById(normalizedId);

  if (!treatment) {
    throw appError(
      "Common treatment not found",
      404,
    );
  }

  return normalizeTreatment(treatment);
}

/* ========================================================
   5. UPDATE COMMON TREATMENT
======================================================== */

export async function updateCommonTreatment(id, data) {
  const normalizedId = normalizeText(id);

  if (!normalizedId) {
    throw appError(
      "Common treatment ID is required",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "common_treatments" IN EXCLUSIVE MODE
      `;

      const existing = await findTreatmentById(
        normalizedId,
        tx,
      );

      if (!existing) {
        throw appError(
          "Common treatment not found",
          404,
        );
      }

      let treatmentName = normalizeTreatmentName(
        existing.treatmentName,
      );

      let fee = Number(existing.fee ?? 0);

      if (
        Object.prototype.hasOwnProperty.call(
          data || {},
          "treatment_name",
        )
      ) {
        treatmentName = validateTreatmentName(
          data.treatment_name,
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          data || {},
          "fee",
        )
      ) {
        fee = validateFee(data.fee);
      }

      const treatments = await getAllTreatmentRows(tx);

      const duplicateTreatment = findDuplicateTreatment(
        treatments,
        treatmentName,
        existing.id,
      );

      if (duplicateTreatment) {
        throw appError(
          "A common treatment with this name already exists",
          409,
        );
      }

      const updated = await tx.commonTreatment.update({
        where: {
          id: existing.id,
        },
        data: {
          treatmentName,
          fee,
          updatedAt: now(),
        },
      });

      return normalizeTreatment(updated);
    },
    {
      timeout: 15000,
    },
  );
}

/* ========================================================
   6. DELETE COMMON TREATMENT
======================================================== */

export async function deleteCommonTreatment(id) {
  const normalizedId = normalizeText(id);

  if (!normalizedId) {
    throw appError(
      "Common treatment ID is required",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "common_treatments" IN EXCLUSIVE MODE
      `;

      const existing = await findTreatmentById(
        normalizedId,
        tx,
      );

      if (!existing) {
        throw appError(
          "Common treatment not found",
          404,
        );
      }

      const deleted = await tx.commonTreatment.delete({
        where: {
          id: existing.id,
        },
      });

      return normalizeTreatment(deleted);
    },
    {
      timeout: 15000,
    },
  );
}

/* ========================================================
   7. COMMON TREATMENT STATISTICS
======================================================== */

export async function getCommonTreatmentStatistics() {
  const treatments = await getAllTreatmentRows();

  const fees = treatments
    .map((treatment) => Number(treatment.fee))
    .filter((fee) => Number.isFinite(fee));

  const totalFeeValue = fees.reduce(
    (total, fee) => total + fee,
    0,
  );

  const averageFee =
    fees.length > 0
      ? totalFeeValue / fees.length
      : 0;

  const lowestFee =
    fees.length > 0 ? Math.min(...fees) : 0;

  const highestFee =
    fees.length > 0 ? Math.max(...fees) : 0;

  const lowestFeeTreatment =
    treatments.length > 0
      ? treatments.reduce((lowest, treatment) => {
          if (
            Number(treatment.fee) <
            Number(lowest.fee)
          ) {
            return treatment;
          }

          return lowest;
        })
      : null;

  const highestFeeTreatment =
    treatments.length > 0
      ? treatments.reduce((highest, treatment) => {
          if (
            Number(treatment.fee) >
            Number(highest.fee)
          ) {
            return treatment;
          }

          return highest;
        })
      : null;

  return {
    total_treatments: treatments.length,

    total_fee_value: Number(
      totalFeeValue.toFixed(2),
    ),

    average_fee: Number(
      averageFee.toFixed(2),
    ),

    lowest_fee: Number(
      lowestFee.toFixed(2),
    ),

    highest_fee: Number(
      highestFee.toFixed(2),
    ),

    lowest_fee_treatment: lowestFeeTreatment,

    highest_fee_treatment: highestFeeTreatment,
  };
}
