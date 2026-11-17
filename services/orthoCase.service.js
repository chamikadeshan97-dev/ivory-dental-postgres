
import prisma from "../config/prisma.js";

/* ========================================================
   CONFIGURATION
======================================================== */

const PROTECTED_FIELDS = [
  "ortho_case_id",
  "patient_id",
  "created_at",
];

const ALLOWED_STATUSES = [
  "Active",
  "On Hold",
  "Completed",
  "Cancelled",
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
   ID GENERATION
======================================================== */

const generateNextId = (rows) => {
  let max = 0;

  rows.forEach((row) => {
    const id = clean(row.orthoCaseId);

    const match = id.match(/^ORT_(\d+)$/i);

    if (!match) return;

    const number = Number(match[1]);

    if (Number.isFinite(number) && number > max) {
      max = number;
    }
  });

  return `ORT_${String(max + 1).padStart(4, "0")}`;
};

/* ========================================================
   RESPONSE FORMATTER
======================================================== */

const formatOrthoCase = (record) => {
  if (!record) return null;

  return {
    ortho_case_id: record.orthoCaseId,
    patient_id: record.patientId,
    dentist_id: record.dentistId ?? "",

    start_date: record.startDate ?? "",
    treatment_type: record.treatmentType ?? "",
    treatment_area: record.treatmentArea ?? "",
    diagnosis: record.diagnosis ?? "",
    estimated_duration: record.estimatedDuration ?? "",

    total_treatment_fee: toNumber(
      record.totalTreatmentFee,
    ),

    payment_plan: record.paymentPlan ?? "",

    monthly_payment: toNumber(
      record.monthlyPayment,
    ),

    next_visit_date: record.nextVisitDate ?? "",
    status: record.status ?? "",
    notes: record.notes ?? "",
    completed_date: record.completedDate ?? "",

    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  };
};

/* ========================================================
   DATABASE HELPERS
======================================================== */

const findCaseById = async (
  caseId,
  db = prisma,
) => {
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
   1. CREATE ORTHO CASE
======================================================== */

export const createOrthoCaseService = async (
  payload = {},
) => {
  return prisma.$transaction(
    async (tx) => {
      /*
       * Serialize ID generation to avoid
       * duplicate ORT numbers.
       */
      await tx.$executeRaw`
        LOCK TABLE "ortho_cases"
        IN EXCLUSIVE MODE
      `;

      const existingCases =
        await tx.orthoCase.findMany({
          select: {
            orthoCaseId: true,
          },
        });

      const timestamp = nowISO();

      const record = await tx.orthoCase.create({
        data: {
          orthoCaseId: generateNextId(
            existingCases,
          ),

          patientId: clean(
            payload.patient_id,
          ),

          dentistId: clean(
            payload.dentist_id,
          ),

          startDate:
            clean(payload.start_date) ||
            todayISO(),

          treatmentType: clean(
            payload.treatment_type,
          ),

          treatmentArea: clean(
            payload.treatment_area,
          ),

          diagnosis: clean(
            payload.diagnosis,
          ),

          estimatedDuration: clean(
            payload.estimated_duration,
          ),

          totalTreatmentFee: toNumber(
            payload.total_treatment_fee,
          ),

          paymentPlan: clean(
            payload.payment_plan,
          ),

          monthlyPayment: toNumber(
            payload.monthly_payment,
          ),

          nextVisitDate: clean(
            payload.next_visit_date,
          ),

          status: "Active",

          notes: clean(
            payload.notes,
          ),

          completedDate: "",

          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      return formatOrthoCase(record);
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   2. GET ALL ORTHO CASES WITH PATIENTS AND PAYMENTS
======================================================== */

export const getAllOrthoCasesService = async (
  filters = {},
) => {
  const [
    caseData,
    patientData,
    paymentData,
  ] = await Promise.all([
    prisma.orthoCase.findMany(),
    prisma.patient.findMany(),
    prisma.orthoPayment.findMany(),
  ]);

  /* ----------------------------------------------------
     PATIENT LOOKUP
  ---------------------------------------------------- */

  const patientMap = new Map();

  patientData.forEach((patient) => {
    const patientId = normalize(patient.id);

    if (patientId) {
      patientMap.set(patientId, patient);
    }
  });

  /* ----------------------------------------------------
     PAYMENT TOTALS
  ---------------------------------------------------- */

  const paymentsMap = new Map();

  paymentData.forEach((payment) => {
    const caseId = normalize(
      payment.orthoCaseId,
    );

    if (!caseId) return;

    const amount = toNumber(
      payment.amount,
    );

    const previousTotal =
      paymentsMap.get(caseId) || 0;

    paymentsMap.set(
      caseId,
      previousTotal + amount,
    );
  });

  /* ----------------------------------------------------
     COMBINE RECORDS
  ---------------------------------------------------- */

  let cases = caseData.map((item) => {
    const record = formatOrthoCase(item);

    const patient = patientMap.get(
      normalize(record.patient_id),
    );

    const totalFee =
      record.total_treatment_fee;

    const totalPaid =
      paymentsMap.get(
        normalize(record.ortho_case_id),
      ) || 0;

    const balance = Math.max(
      totalFee - totalPaid,
      0,
    );

    return {
      ...record,

      patient_name: patient
        ? clean(patient.name)
        : "",

      patient_mobile: patient
        ? clean(patient.phone)
        : "",

      total_treatment_fee: totalFee,

      total_paid: totalPaid,

      balance,
    };
  });

  /* ----------------------------------------------------
     STATUS FILTER
  ---------------------------------------------------- */

  if (clean(filters.status)) {
    cases = cases.filter(
      (item) =>
        normalize(item.status) ===
        normalize(filters.status),
    );
  }

  /* ----------------------------------------------------
     DENTIST FILTER
  ---------------------------------------------------- */

  if (clean(filters.dentist_id)) {
    cases = cases.filter(
      (item) =>
        normalize(item.dentist_id) ===
        normalize(filters.dentist_id),
    );
  }

  /* ----------------------------------------------------
     SEARCH FILTER
  ---------------------------------------------------- */

  if (clean(filters.search)) {
    const keyword = normalize(
      filters.search,
    );

    cases = cases.filter((item) =>
      Object.values(item).some(
        (value) =>
          normalize(value).includes(
            keyword,
          ),
      ),
    );
  }

  /* ----------------------------------------------------
     SORT BY LATEST UPDATE
  ---------------------------------------------------- */

  cases.sort((a, b) => {
    const dateA = Date.parse(
      a.updated_at,
    );

    const dateB = Date.parse(
      b.updated_at,
    );

    const timeA = Number.isFinite(dateA)
      ? dateA
      : 0;

    const timeB = Number.isFinite(dateB)
      ? dateB
      : 0;

    return timeB - timeA;
  });

  return cases;
};

/* ========================================================
   3. GET ORTHO CASE BY ID
======================================================== */

export const getOrthoCaseByIdService = async (
  caseId,
) => {
  const record = await findCaseById(
    caseId,
  );

  return formatOrthoCase(record);
};

/* ========================================================
   4. GET ORTHO CASES BY PATIENT
======================================================== */

export const getOrthoCasesByPatientService = async (
  patientId,
) => {
  const records =
    await prisma.orthoCase.findMany({
      where: {
        patientId: {
          equals: clean(patientId),
          mode: "insensitive",
        },
      },
    });

  return records.map(
    formatOrthoCase,
  );
};

/* ========================================================
   5. UPDATE ORTHO CASE
======================================================== */

export const updateOrthoCaseService = async (
  caseId,
  payload = {},
) => {
  const existing = await findCaseById(
    caseId,
  );

  if (!existing) {
    return null;
  }

  /*
   * Only allow fields supported by
   * the Prisma model.
   *
   * Protected fields cannot be updated.
   */
  const fieldMap = {
    dentist_id: "dentistId",
    start_date: "startDate",
    treatment_type: "treatmentType",
    treatment_area: "treatmentArea",
    diagnosis: "diagnosis",
    estimated_duration: "estimatedDuration",
    total_treatment_fee: "totalTreatmentFee",
    payment_plan: "paymentPlan",
    monthly_payment: "monthlyPayment",
    next_visit_date: "nextVisitDate",
    status: "status",
    notes: "notes",
    completed_date: "completedDate",
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

      if (
        prismaField ===
          "totalTreatmentFee" ||
        prismaField ===
          "monthlyPayment"
      ) {
        updateData[prismaField] =
          toNumber(value);
      } else {
        updateData[prismaField] =
          clean(value);
      }
    },
  );

  updateData.updatedAt = nowISO();

  const updated =
    await prisma.orthoCase.update({
      where: {
        orthoCaseId:
          existing.orthoCaseId,
      },

      data: updateData,
    });

  return formatOrthoCase(
    updated,
  );
};

/* ========================================================
   6. UPDATE ORTHO CASE STATUS
======================================================== */

export const updateOrthoCaseStatusService = async (
  caseId,
  status,
) => {
  const matched = ALLOWED_STATUSES.find(
    (item) =>
      normalize(item) ===
      normalize(status),
  );

  if (!matched) {
    throw new Error(
      "Invalid Ortho status",
    );
  }

  const existing = await findCaseById(
    caseId,
  );

  if (!existing) {
    return null;
  }

  const updated =
    await prisma.orthoCase.update({
      where: {
        orthoCaseId:
          existing.orthoCaseId,
      },

      data: {
        status: matched,

        completedDate:
          matched === "Completed"
            ? todayISO()
            : "",

        updatedAt: nowISO(),
      },
    });

  return formatOrthoCase(
    updated,
  );
};

/* ========================================================
   7. PERMANENTLY DELETE ORTHO CASE
======================================================== */

export const deleteOrthoCaseRecordService = async (
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
       * Lock the case table while checking
       * and deleting the record.
       */
      await tx.$executeRaw`
        LOCK TABLE "ortho_cases"
        IN EXCLUSIVE MODE
      `;

      const existing = await findCaseById(
        caseId,
        tx,
      );

      if (!existing) {
        return null;
      }

      /*
       * Do not delete cases that have
       * linked financial records.
       */
      const paymentCount =
        await tx.orthoPayment.count({
          where: {
            orthoCaseId:
              existing.orthoCaseId,
          },
        });

      if (paymentCount > 0) {
        throw createError(
          "Cannot delete this orthodontic case because payment records exist.",
          409,
        );
      }

      /*
       * Also protect existing visit records.
       */
      const visitCount =
        await tx.orthoVisit.count({
          where: {
            orthoCaseId:
              existing.orthoCaseId,
          },
        });

      if (visitCount > 0) {
        throw createError(
          "Cannot delete this orthodontic case because visit records exist.",
          409,
        );
      }

      await tx.orthoCase.delete({
        where: {
          orthoCaseId:
            existing.orthoCaseId,
        },
      });

      return {
        case_id:
          existing.orthoCaseId,

        patient_id:
          existing.patientId,

        dentist_id:
          existing.dentistId ?? "",

        deleted: true,

        deleted_at: nowISO(),
      };
    },
    {
      timeout: 15000,
    },
  );
};
