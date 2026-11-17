
import prisma from "../config/prisma.js";

/* ========================================================
   CONFIGURATION
======================================================== */

const VISIT_ID_PREFIX = "ORV";

const PROTECTED_FIELDS = [
  "ortho_visit_id",
  "ortho_case_id",
  "patient_id",
  "visit_number",
  "created_at",
];

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

const createError = (message, status = 400) => {
  const error = new Error(message);

  error.status = status;
  error.statusCode = status;

  return error;
};

/* ========================================================
   GENERATE NEXT VISIT ID
======================================================== */

const generateNextId = (rows) => {
  let max = 0;

  for (const row of rows) {
    const id = clean(row.orthoVisitId);

    const match = id.match(/^ORV_(\d+)$/i);

    if (!match) continue;

    const number = Number(match[1]);

    if (
      Number.isSafeInteger(number) &&
      number > max
    ) {
      max = number;
    }
  }

  return `${VISIT_ID_PREFIX}_${String(
    max + 1,
  ).padStart(4, "0")}`;
};

/* ========================================================
   FORMAT VISIT RESPONSE
======================================================== */

const formatOrthoVisit = (record) => {
  if (!record) return null;

  return {
    ortho_visit_id: record.orthoVisitId,
    ortho_case_id: record.orthoCaseId,
    patient_id: record.patientId,

    appointment_id: record.appointmentId ?? "",
    dentist_id: record.dentistId ?? "",

    visit_number: record.visitNumber ?? 0,

    visit_date: record.visitDate ?? "",
    procedure: record.procedure ?? "",

    clinical_notes:
      record.clinicalNotes ?? "",

    appliance_changes:
      record.applianceChanges ?? "",

    elastics: record.elastics ?? "",

    next_visit_date:
      record.nextVisitDate ?? "",

    next_visit_plan:
      record.nextVisitPlan ?? "",

    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  };
};

/* ========================================================
   FIND VISIT BY ID
======================================================== */

const findVisitById = async (
  visitId,
  db = prisma,
) => {
  if (!clean(visitId)) return null;

  return db.orthoVisit.findFirst({
    where: {
      orthoVisitId: {
        equals: clean(visitId),
        mode: "insensitive",
      },
    },
  });
};

/* ========================================================
   FIND ORTHO CASE
======================================================== */

const findOrthoCase = async (
  caseId,
  db = prisma,
) => {
  if (!clean(caseId)) return null;

  return db.orthoCase.findFirst({
    where: {
      orthoCaseId: {
        equals: clean(caseId),
        mode: "insensitive",
      },
    },
  });
};

/* ========================================================
   1. CREATE ORTHO VISIT
======================================================== */

export const createOrthoVisitService = async (
  caseId,
  payload = {},
) => {
  if (!clean(caseId)) {
    throw createError(
      "Ortho case ID is required",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      /*
       * Serialize visit creation to prevent:
       * - Duplicate ORV IDs
       * - Duplicate visit numbers
       */
      await tx.$executeRaw`
        LOCK TABLE "ortho_visits"
        IN EXCLUSIVE MODE
      `;

      const orthoCase =
        await findOrthoCase(caseId, tx);

      if (!orthoCase) {
        throw createError(
          "Ortho case not found",
          404,
        );
      }

      const existingVisits =
        await tx.orthoVisit.findMany({
          select: {
            orthoVisitId: true,
            orthoCaseId: true,
            visitNumber: true,
          },
        });

      const visitId =
        generateNextId(existingVisits);

      /*
       * Use maximum visit number rather
       * than number of records.
       */
      const caseVisits =
        existingVisits.filter(
          (visit) =>
            normalize(visit.orthoCaseId) ===
            normalize(
              orthoCase.orthoCaseId,
            ),
        );

      const maxVisitNumber =
        caseVisits.reduce(
          (max, visit) =>
            Math.max(
              max,
              Number(
                visit.visitNumber || 0,
              ),
            ),
          0,
        );

      const visitNumber =
        maxVisitNumber + 1;

      const timestamp = nowISO();

      const nextVisitDate = clean(
        payload.next_visit_date,
      );

      const record =
        await tx.orthoVisit.create({
          data: {
            orthoVisitId: visitId,

            orthoCaseId:
              orthoCase.orthoCaseId,

            patientId:
              orthoCase.patientId,

            appointmentId: clean(
              payload.appointment_id,
            ),

            dentistId:
              clean(payload.dentist_id) ||
              clean(orthoCase.dentistId),

            visitNumber,

            visitDate:
              clean(payload.visit_date) ||
              todayISO(),

            procedure: clean(
              payload.procedure,
            ),

            clinicalNotes: clean(
              payload.clinical_notes,
            ),

            applianceChanges: clean(
              payload.appliance_changes,
            ),

            elastics: clean(
              payload.elastics,
            ),

            nextVisitDate,

            nextVisitPlan: clean(
              payload.next_visit_plan,
            ),

            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });

      /*
       * Update the parent OrthoCase
       * in the same transaction.
       */
      if (nextVisitDate) {
        await tx.orthoCase.update({
          where: {
            orthoCaseId:
              orthoCase.orthoCaseId,
          },

          data: {
            nextVisitDate,
            updatedAt: timestamp,
          },
        });
      }

      return formatOrthoVisit(
        record,
      );
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   2. GET VISITS BY ORTHO CASE
======================================================== */

export const getOrthoVisitsByCaseService =
  async (caseId) => {
    if (!clean(caseId)) {
      return [];
    }

    const visits =
      await prisma.orthoVisit.findMany({
        where: {
          orthoCaseId: {
            equals: clean(caseId),
            mode: "insensitive",
          },
        },

        orderBy: {
          visitNumber: "asc",
        },
      });

    return visits.map(
      formatOrthoVisit,
    );
  };

/* ========================================================
   3. GET ORTHO VISIT BY ID
======================================================== */

export const getOrthoVisitByIdService =
  async (visitId) => {
    const record = await findVisitById(
      visitId,
    );

    return formatOrthoVisit(
      record,
    );
  };

/* ========================================================
   4. UPDATE ORTHO VISIT
======================================================== */

export const updateOrthoVisitService = async (
  visitId,
  payload = {},
) => {
  const existing =
    await findVisitById(visitId);

  if (!existing) {
    return null;
  }

  /*
   * Only allow fields supported
   * by the Prisma model.
   */
  const fieldMap = {
    appointment_id: "appointmentId",
    dentist_id: "dentistId",
    visit_date: "visitDate",
    procedure: "procedure",
    clinical_notes: "clinicalNotes",
    appliance_changes: "applianceChanges",
    elastics: "elastics",
    next_visit_date: "nextVisitDate",
    next_visit_plan: "nextVisitPlan",
  };

  const updateData = {};

  Object.entries(payload).forEach(
    ([key, value]) => {
      if (
        PROTECTED_FIELDS.includes(key)
      ) {
        return;
      }

      const prismaField =
        fieldMap[key];

      if (!prismaField) return;

      updateData[prismaField] =
        clean(value);
    },
  );

  updateData.updatedAt = nowISO();

  const updated =
    await prisma.orthoVisit.update({
      where: {
        orthoVisitId:
          existing.orthoVisitId,
      },

      data: updateData,
    });

  return formatOrthoVisit(
    updated,
  );
};

/* ========================================================
   5. DELETE ORTHO VISIT
======================================================== */

export const deleteOrthoVisitService = async (
  visitId,
) => {
  return prisma.$transaction(
    async (tx) => {
      const existing =
        await findVisitById(
          visitId,
          tx,
        );

      if (!existing) {
        return null;
      }

      /*
       * Prevent deleting visits that
       * have linked payments.
       */
      const paymentCount =
        await tx.orthoPayment.count({
          where: {
            orthoVisitId:
              existing.orthoVisitId,
          },
        });

      if (paymentCount > 0) {
        throw createError(
          "Cannot delete this visit because linked payments exist.",
          409,
        );
      }

      /*
       * Prevent deleting visits with
       * linked clinical media.
       */
      const mediaCount =
        await tx.orthoMedia.count({
          where: {
            orthoVisitId:
              existing.orthoVisitId,
          },
        });

      if (mediaCount > 0) {
        throw createError(
          "Cannot delete this visit because linked media records exist.",
          409,
        );
      }

      const deleted =
        await tx.orthoVisit.delete({
          where: {
            orthoVisitId:
              existing.orthoVisitId,
          },
        });

      return formatOrthoVisit(
        deleted,
      );
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   6. DELETE ALL VISITS BY ORTHO CASE
======================================================== */

export const deleteOrthoVisitsByCaseService =
  async (caseId) => {
    if (!clean(caseId)) {
      throw createError(
        "Ortho case ID is required",
        400,
      );
    }

    return prisma.$transaction(
      async (tx) => {
        /*
         * Lock visit table to prevent
         * concurrent visit creation.
         */
        await tx.$executeRaw`
          LOCK TABLE "ortho_visits"
          IN EXCLUSIVE MODE
        `;

        const visits =
          await tx.orthoVisit.findMany({
            where: {
              orthoCaseId: {
                equals: clean(caseId),
                mode: "insensitive",
              },
            },
          });

        if (!visits.length) {
          return {
            case_id: caseId,
            deleted_count: 0,
            deleted_visit_ids: [],
          };
        }

        const visitIds = visits.map(
          (visit) =>
            visit.orthoVisitId,
        );

        /*
         * Protect payment records.
         */
        const paymentCount =
          await tx.orthoPayment.count({
            where: {
              orthoVisitId: {
                in: visitIds,
              },
            },
          });

        if (paymentCount > 0) {
          throw createError(
            "Cannot delete visits because linked payment records exist.",
            409,
          );
        }

        /*
         * Protect clinical media.
         */
        const mediaCount =
          await tx.orthoMedia.count({
            where: {
              orthoVisitId: {
                in: visitIds,
              },
            },
          });

        if (mediaCount > 0) {
          throw createError(
            "Cannot delete visits because linked media records exist.",
            409,
          );
        }

        await tx.orthoVisit.deleteMany({
          where: {
            orthoVisitId: {
              in: visitIds,
            },
          },
        });

        return {
          case_id: caseId,

          deleted_count:
            visits.length,

          deleted_visit_ids:
            visitIds,
        };
      },
      {
        timeout: 15000,
      },
    );
  };
