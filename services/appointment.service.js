
import prisma from "../config/prisma.js";
import appError from "../utils/appError.js";
import { readSheet } from "../utils/googleSheets.js";

/* ========================================================
   HELPERS
======================================================== */

const normalizeText = (v) => String(v ?? "").trim();
const normalizeId = normalizeText;
const getNow = () => new Date().toISOString();

const toNumber = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

const getAppointmentId = (a) =>
  normalizeId(a?.id ?? a?.appointment_id);

const getTreatmentId = (t) =>
  normalizeId(t?.id ?? t?.treatment_id);

const getTreatmentAppointmentId = (t) =>
  normalizeId(
    t?.appointment_id ??
    t?.appointmentId ??
    t?.appointmentID
  );

const isCancelledAppointment = (a) =>
  ["cancelled", "canceled"].includes(
    normalizeText(a?.status).toLowerCase()
  );

/* ========================================================
   STATUS CONFIGURATION
======================================================== */

const APPOINTMENT_STATUSES = [
  "Pending",
  "Confirmed",
  "Checked In",
  "Waiting",
  "In Treatment",
  "Treatment Done",
  "Payment Pending",
  "Paid",
  "Completed",
  "Cancelled",
];

const ALLOWED_STATUS_TRANSITIONS = {
  Pending: ["Confirmed", "Checked In", "Cancelled"],
  Confirmed: ["Checked In", "Cancelled"],
  "Checked In": ["Waiting", "In Treatment", "Cancelled"],
  Waiting: ["In Treatment", "Cancelled"],
  "In Treatment": ["Treatment Done"],
  "Treatment Done": ["Payment Pending", "Paid"],
  "Payment Pending": ["Paid", "Completed"],
  Paid: ["Completed"],
  Completed: [],
  Cancelled: [],
};

/* ========================================================
   PRISMA APPOINTMENT MAPPER
======================================================== */

function mapAppointment(a) {
  if (!a) return null;

  const number = a.appointmentNumber;

  return {
    id: a.id,
    patient_id: a.patientId ?? "",
    dentist_id: a.dentistId ?? "",

    appointment_number:
      number === null || number === undefined
        ? ""
        : /^\d+$/.test(number)
          ? Number(number)
          : number,

    appointment_date: a.appointmentDate ?? "",
    appointment_time: a.appointmentTime ?? "",
    reason_for_visit: a.reasonForVisit ?? "",
    status: a.status ?? "",

    checked_in_time: a.checkedInTime ?? "",
    treatment_started_at: a.treatmentStartedAt ?? "",
    treatment_completed_at: a.treatmentCompletedAt ?? "",
    completed_at: a.completedAt ?? "",

    created_at: a.createdAt ?? "",
    updated_at: a.updatedAt ?? "",
  };
}

function compareAppointments(a, b) {
  return (
    normalizeText(
      a?.appointment_date ?? a?.date
    ).localeCompare(
      normalizeText(b?.appointment_date ?? b?.date)
    ) ||
    normalizeText(a?.appointment_time).localeCompare(
      normalizeText(b?.appointment_time)
    )
  );
}

function generateAppointmentId(appointments, date) {
  const prefix = `APP_${date.replaceAll("-", "")}_`;

  let max = 0;

  for (const appointment of appointments) {
    const id = getAppointmentId(appointment);

    if (!id.startsWith(prefix)) continue;

    const number = Number(id.slice(prefix.length));

    if (Number.isInteger(number) && number > max) {
      max = number;
    }
  }

  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function parseFee(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const fee = Number(value);

  if (!Number.isFinite(fee) || fee < 0) {
    throw appError(
      "Treatment fee must be a valid non-negative number",
      400
    );
  }

  return Math.round((fee + Number.EPSILON) * 100) / 100;
}

/* ========================================================
   DATABASE HELPERS
======================================================== */

async function getAppointmentsRows(db = prisma) {
  const records = await db.appointment.findMany();

  return records.map(mapAppointment);
}

async function getPeopleMaps() {
  const [patients, dentists] = await Promise.all([
    prisma.patient.findMany(),
    prisma.dentist.findMany(),
  ]);

  return [
    new Map(patients.map((patient) => [patient.id, patient])),
    new Map(dentists.map((dentist) => [dentist.id, dentist])),
  ];
}

async function resolveAppointmentPaymentData(
  data,
  db = prisma
) {
  const patient = await db.patient.findUnique({
    where: {
      id: normalizeId(data.patient_id),
    },
  });

  if (!patient) {
    throw appError("Patient not found", 404);
  }

  const treatmentName = normalizeText(
    data.reason_for_visit
  );

  if (!treatmentName) {
    throw appError("Reason for visit is required", 400);
  }

  const matchingTreatment =
    await db.commonTreatment.findFirst({
      where: {
        treatmentName: {
          equals: treatmentName,
          mode: "insensitive",
        },
      },
    });

  const treatmentFee =
    parseFee(data.treatment_fee) ??
    parseFee(matchingTreatment?.fee) ??
    0;

  return {
    treatmentName,
    treatmentFee,
  };
}

/* ========================================================
   LEGACY TREATMENT AND PAYMENT HELPERS
======================================================== */

function createTreatmentPaymentData({
  treatment,
  payments,
}) {
  if (!treatment) {
    return {
      treatmentId: "",
      treatmentFee: 0,
      treatmentPayments: [],
      totalPaid: 0,
      remainingAmount: 0,
      paymentStatus: "Not Paid",
    };
  }

  const treatmentId = getTreatmentId(treatment);

  const treatmentFee = toNumber(
    treatment?.treatment_fee ??
    treatment?.treatment_charge
  );

  const treatmentPayments = treatmentId
    ? payments.filter(
        (payment) =>
          normalizeId(payment?.treatment_id) ===
          treatmentId
      )
    : [];

  const totalPaid = treatmentPayments.reduce(
    (sum, payment) =>
      sum +
      toNumber(
        payment?.payment_amount ?? payment?.amount
      ),
    0
  );

  const remainingAmount = Math.max(
    treatmentFee - totalPaid,
    0
  );

  const paymentStatus =
    treatmentFee > 0 && totalPaid >= treatmentFee
      ? "Paid"
      : totalPaid > 0
        ? "Partial"
        : "Not Paid";

  return {
    treatmentId,
    treatmentFee,
    treatmentPayments,
    totalPaid,
    remainingAmount,
    paymentStatus,
  };
}

function generateQueue(appointments) {
  const counters = {};

  return appointments.map((appointment) => {
    if (isCancelledAppointment(appointment)) {
      return null;
    }

    const date = normalizeText(
      appointment.appointment_date
    );

    counters[date] = (counters[date] ?? 0) + 1;

    return counters[date];
  });
}

async function getLegacyTreatmentData() {
  const [treatments, payments] = await Promise.all([
    readSheet("Treatments"),
    readSheet("Payments"),
  ]);

  return {
    treatments,
    payments,
  };
}

function treatmentMapFor(treatments) {
  const map = new Map();

  for (const treatment of treatments) {
    const appointmentId =
      getTreatmentAppointmentId(treatment);

    if (appointmentId && !map.has(appointmentId)) {
      map.set(appointmentId, treatment);
    }
  }

  return map;
}

/* ========================================================
   ENRICHED APPOINTMENT RESPONSE
======================================================== */

function enrichedAppointment(
  appointment,
  queueNo,
  patient,
  dentist,
  treatment,
  payments,
  includePayments = false
) {
  const {
    treatmentId,
    treatmentFee,
    treatmentPayments,
    totalPaid,
    remainingAmount,
    paymentStatus,
  } = createTreatmentPaymentData({
    treatment,
    payments,
  });

  const result = {
    queue_no: queueNo,

    appointment_id: appointment.id,
    id: appointment.id,

    patient_id: appointment.patient_id,
    patient_name: patient?.name ?? "",
    phone: patient?.phone ?? "",
    age: patient?.age ?? "",
    gender: patient?.gender ?? "",
    address: patient?.address ?? "",

    dentist_id: appointment.dentist_id,
    dentist_name: dentist?.name ?? "",

    appointment_date: appointment.appointment_date,
    appointment_time: appointment.appointment_time,
    appointment_number: appointment.appointment_number,

    checked_in_time: appointment.checked_in_time,
    treatment_started_at:
      appointment.treatment_started_at,
    treatment_completed_at:
      appointment.treatment_completed_at,

    reason_for_visit: appointment.reason_for_visit,
    status: appointment.status,

    treatment_id: treatmentId,
    treatment_date: treatment?.treatment_date ?? "",
    next_appointment_date:
      treatment?.next_appointment_date ?? "",

    diagnosis: treatment?.diagnosis ?? "",
    tooth_number: treatment?.tooth_number ?? "",

    treatment_details:
      treatment?.treatment_details ??
      treatment?.treatment_performed ??
      "",

    doctor_notes: treatment?.doctor_notes ?? "",
    prescription: treatment?.prescription ?? "",

    treatment_fee: treatmentFee,
    treatment_charge: treatmentFee,
    total_paid: totalPaid,
    remaining_amount: remainingAmount,
    payment_status: paymentStatus,
    payment_count: treatmentPayments.length,

    created_at: appointment.created_at,
    updated_at: appointment.updated_at,
  };

  if (includePayments) {
    result.completed_at = appointment.completed_at;
    result.payments = treatmentPayments;
  }

  return result;
}

/* ========================================================
   1. REASSIGN APPOINTMENT NUMBER
======================================================== */

export async function reassignAppointmentNumberService(
  sourceAppointmentId,
  targetAppointmentId
) {
  const sourceId = normalizeId(sourceAppointmentId);
  const targetId = normalizeId(targetAppointmentId);

  if (!sourceId) {
    throw appError(
      "Source appointment ID is required",
      400
    );
  }

  if (!targetId) {
    throw appError(
      "Target appointment ID is required",
      400
    );
  }

  if (sourceId === targetId) {
    throw appError(
      "Source and target appointments cannot be the same",
      400
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "appointments" IN EXCLUSIVE MODE
      `;

      const [source, target] = await Promise.all([
        tx.appointment.findUnique({
          where: { id: sourceId },
        }),
        tx.appointment.findUnique({
          where: { id: targetId },
        }),
      ]);

      if (!source) {
        throw appError(
          "Source appointment not found",
          404
        );
      }

      if (!target) {
        throw appError(
          "Target appointment not found",
          404
        );
      }

      if (!isCancelledAppointment(source)) {
        throw appError(
          "Only a cancelled appointment number can be reassigned",
          400
        );
      }

      const targetStatus = normalizeText(
        target.status
      ).toLowerCase();

      if (
        !["pending", "confirmed", "checked in"].includes(
          targetStatus
        )
      ) {
        throw appError(
          "The selected appointment cannot receive this appointment number",
          400
        );
      }

      if (
        !source.appointmentDate ||
        !target.appointmentDate
      ) {
        throw appError(
          "Both appointments must have an appointment date",
          400
        );
      }

      if (
        source.appointmentDate !==
        target.appointmentDate
      ) {
        throw appError(
          "Appointment numbers can only be reassigned on the same date",
          400
        );
      }

      const number = source.appointmentNumber;

      if (number === null || number === "") {
        throw appError(
          "Cancelled appointment does not have an appointment number",
          400
        );
      }

      const others = await tx.appointment.findMany({
        where: {
          appointmentDate: source.appointmentDate,
          appointmentNumber: number,
          id: {
            notIn: [sourceId, targetId],
          },
        },
      });

      if (
        others.some(
          (appointment) =>
            !isCancelledAppointment(appointment)
        )
      ) {
        throw appError(
          `Appointment number ${number} is already being used`,
          409
        );
      }

      const timestamp = getNow();

      const released = await tx.appointment.update({
        where: { id: sourceId },
        data: {
          appointmentNumber: "",
          updatedAt: timestamp,
        },
      });

      const reassigned = await tx.appointment.update({
        where: { id: targetId },
        data: {
          appointmentNumber: number,
          updatedAt: timestamp,
        },
      });

      const displayNumber = /^\d+$/.test(number)
        ? Number(number)
        : number;

      return {
        message:
          `Appointment number ${number} reassigned successfully`,

        releasedAppointment: mapAppointment(released),

        reassignedAppointment:
          mapAppointment(reassigned),

        reassignment: {
          appointmentNumber: displayNumber,
          sourceAppointmentId: sourceId,
          targetAppointmentId: targetId,
          targetOldAppointmentNumber:
            mapAppointment(target).appointment_number,
          targetNewAppointmentNumber: displayNumber,
        },
      };
    },
    {
      timeout: 15000,
    }
  );
}

/* ========================================================
   2. CREATE APPOINTMENT + INITIAL PAYMENT
======================================================== */

export async function createAppointment(data) {
  if (!data?.patient_id) {
    throw appError("Patient is required", 400);
  }

  if (!data?.dentist_id) {
    throw appError("Dentist is required", 400);
  }

  if (!data?.appointment_date) {
    throw appError("Appointment date is required", 400);
  }

  if (!data?.appointment_time) {
    throw appError("Appointment time is required", 400);
  }

  const status =
    normalizeText(data.status) || "Pending";

  if (!APPOINTMENT_STATUSES.includes(status)) {
    throw appError(
      `Invalid appointment status: ${status}`,
      400
    );
  }

  const date = normalizeText(data.appointment_date);
  const time = normalizeText(data.appointment_time);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "appointments" IN EXCLUSIVE MODE
      `;

      const appointments = (
        await tx.appointment.findMany()
      ).map(mapAppointment);

      const duplicate = appointments.some(
        (appointment) =>
          appointment.patient_id ===
            normalizeId(data.patient_id) &&
          appointment.appointment_date === date &&
          appointment.appointment_time === time &&
          !isCancelledAppointment(appointment)
      );

      if (duplicate && !data.is_skipped) {
        throw appError(
          "This patient already has an appointment at the selected date and time",
          409
        );
      }

      const paymentData =
        await resolveAppointmentPaymentData(
          data,
          tx
        );

      const dentist =
        await tx.dentist.findUnique({
          where: {
            id: normalizeId(data.dentist_id),
          },
        });

      if (!dentist) {
        throw appError("Dentist not found", 404);
      }

      const count = appointments.filter(
        (appointment) =>
          appointment.appointment_date === date &&
          !isCancelledAppointment(appointment)
      ).length;

      const timestamp = getNow();

      const id = generateAppointmentId(
        appointments,
        date
      );

      const appointment =
        await tx.appointment.create({
          data: {
            id,

            patientId: normalizeId(data.patient_id),
            dentistId: normalizeId(data.dentist_id),

            appointmentNumber: String(
              data.appointment_number ?? count + 1
            ),

            appointmentDate: date,
            appointmentTime: time,

            reasonForVisit: paymentData.treatmentName,

            status,

            checkedInTime: "",
            treatmentStartedAt: "",
            treatmentCompletedAt: "",
            completedAt: "",

            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });

      await tx.treatmentPayment.create({
        data: {
          id: `TP_${id}`,

          appointmentId: id,
          treatmentId: null,

          patientId: normalizeId(data.patient_id),
          treatmentName: paymentData.treatmentName,

          totalFee: paymentData.treatmentFee,
          paymentType: "",
          totalPaid: 0,
          balance: paymentData.treatmentFee,

          paymentHistory: [],
          status: "Unpaid",

          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      return mapAppointment(appointment);
    },
    {
      timeout: 15000,
    }
  );
}

/* ========================================================
   3. GET ALL APPOINTMENTS
======================================================== */

export async function getAllAppointments() {
  const [
    appointments,
    [patientMap, dentistMap],
  ] = await Promise.all([
    getAppointmentsRows(),
    getPeopleMaps(),
  ]);

  appointments.sort(compareAppointments);

  const queue = generateQueue(appointments);

  return appointments.map((appointment, index) => ({
    ...appointment,

    queue_number: queue[index],

    patient_name:
      patientMap.get(appointment.patient_id)?.name ?? "",

    phone:
      patientMap.get(appointment.patient_id)?.phone ?? "",

    dentist_name:
      dentistMap.get(appointment.dentist_id)?.name ?? "",
  }));
}

/* ========================================================
   4. UPDATE APPOINTMENT STATUS
======================================================== */

export async function updateAppointmentStatus(
  id,
  status
) {
  const appointmentId = normalizeId(id);
  const normalizedStatus = normalizeText(status);

  if (!appointmentId) {
    throw appError(
      "Appointment ID is required",
      400
    );
  }

  if (!normalizedStatus) {
    throw appError("Status is required", 400);
  }

  if (
    !APPOINTMENT_STATUSES.includes(normalizedStatus)
  ) {
    throw appError(
      `Invalid status. Use ${APPOINTMENT_STATUSES.join(", ")}`,
      400
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "appointments" IN EXCLUSIVE MODE
      `;

      const current =
        await tx.appointment.findUnique({
          where: {
            id: appointmentId,
          },
        });

      if (!current) {
        throw appError(
          "Appointment not found",
          404
        );
      }

      if (!current.appointmentDate) {
        throw appError(
          "Appointment date is required",
          400
        );
      }

      // Preserve original status behavior.
      // Transition rules were declared but not enforced.
      const allowed =
        ALLOWED_STATUS_TRANSITIONS[
          normalizeText(current.status) || "Pending"
        ];

      void allowed;

      if (normalizedStatus === "In Treatment") {
        const conflict =
          await tx.appointment.findFirst({
            where: {
              appointmentDate: current.appointmentDate,
              status: "In Treatment",
              id: {
                not: appointmentId,
              },
            },
          });

        if (conflict) {
          throw appError(
            `Another appointment is already in treatment for ${current.appointmentDate}`,
            400
          );
        }
      }

      const timestamp = getNow();

      const updates = {
        status: normalizedStatus,
        updatedAt: timestamp,
      };

      if (
        normalizedStatus === "Checked In" &&
        !current.checkedInTime
      ) {
        updates.checkedInTime = timestamp;
      }

      if (
        normalizedStatus === "In Treatment" &&
        !current.treatmentStartedAt
      ) {
        updates.treatmentStartedAt = timestamp;
      }

      if (
        normalizedStatus === "Treatment Done" &&
        !current.treatmentCompletedAt
      ) {
        updates.treatmentCompletedAt = timestamp;
      }

      if (
        normalizedStatus === "Completed" &&
        !current.completedAt
      ) {
        updates.completedAt = timestamp;
      }

      const updated =
        await tx.appointment.update({
          where: {
            id: appointmentId,
          },
          data: updates,
        });

      const waitingRecords =
        await tx.appointment.findMany({
          where: {
            appointmentDate: current.appointmentDate,
            status: "Checked In",
            checkedInTime: {
              not: null,
            },
          },
        });

      const waiting = waitingRecords
        .filter(
          (appointment) =>
            Boolean(appointment.checkedInTime)
        )
        .sort(
          (first, second) =>
            new Date(
              first.checkedInTime
            ).getTime() -
            new Date(
              second.checkedInTime
            ).getTime()
        )
        .map((appointment, index) => ({
          ...mapAppointment(appointment),
          current_queue_no: index + 1,
        }));

      return {
        appointment: mapAppointment(updated),

        queue_position:
          waiting.find(
            (appointment) =>
              appointment.id === appointmentId
          )?.current_queue_no ?? null,

        waiting_queue: waiting,
      };
    },
    {
      timeout: 15000,
    }
  );
}

/* ========================================================
   5. UPDATE APPOINTMENT
======================================================== */

export async function updateAppointment(id, data) {
  const appointmentId = normalizeId(id);

  if (!appointmentId) {
    throw appError(
      "Appointment ID is required",
      400
    );
  }

  if (
    data?.status &&
    !APPOINTMENT_STATUSES.includes(
      normalizeText(data.status)
    )
  ) {
    throw appError(
      `Invalid status. Use ${APPOINTMENT_STATUSES.join(", ")}`,
      400
    );
  }

  const current =
    await prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
    });

  if (!current) {
    throw appError(
      "Appointment not found",
      404
    );
  }

  const updated =
    await prisma.appointment.update({
      where: {
        id: appointmentId,
      },

      data: {
        patientId:
          data?.patient_id == null
            ? current.patientId
            : normalizeId(data.patient_id),

        dentistId:
          data?.dentist_id == null
            ? current.dentistId
            : normalizeId(data.dentist_id),

        appointmentNumber:
          data?.appointment_number == null
            ? current.appointmentNumber
            : String(data.appointment_number),

        appointmentDate:
          data?.appointment_date == null
            ? current.appointmentDate
            : normalizeText(data.appointment_date),

        appointmentTime:
          data?.appointment_time == null
            ? current.appointmentTime
            : normalizeText(data.appointment_time),

        reasonForVisit:
          data?.reason_for_visit == null
            ? current.reasonForVisit
            : normalizeText(data.reason_for_visit),

        status:
          data?.status == null
            ? current.status
            : normalizeText(data.status),

        updatedAt: getNow(),
      },
    });

  return mapAppointment(updated);
}

/* ========================================================
   6. GET APPOINTMENTS
======================================================== */

export async function getAppointments(date) {
  const [
    all,
    [patientMap, dentistMap],
    { treatments, payments },
  ] = await Promise.all([
    getAppointmentsRows(),
    getPeopleMaps(),
    getLegacyTreatmentData(),
  ]);

  const filtered = all
    .filter(
      (appointment) =>
        !normalizeText(date) ||
        appointment.appointment_date ===
          normalizeText(date)
    )
    .sort(compareAppointments);

  const queue = generateQueue(filtered);

  const treatmentMap = treatmentMapFor(treatments);

  return filtered.map((appointment, index) =>
    enrichedAppointment(
      appointment,
      queue[index],
      patientMap.get(appointment.patient_id),
      dentistMap.get(appointment.dentist_id),
      treatmentMap.get(appointment.id),
      payments
    )
  );
}

/* ========================================================
   7. GET APPOINTMENT BY ID
======================================================== */

export async function getAppointmentById(id) {
  const appointmentId = normalizeId(id);

  if (!appointmentId) {
    throw appError(
      "Appointment ID is required",
      400
    );
  }

  const [
    record,
    [patientMap, dentistMap],
    { treatments, payments },
  ] = await Promise.all([
    prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
    }),
    getPeopleMaps(),
    getLegacyTreatmentData(),
  ]);

  if (!record) {
    throw appError(
      "Appointment not found",
      404
    );
  }

  const appointment = mapAppointment(record);

  const sameDayRecords =
    await prisma.appointment.findMany({
      where: {
        appointmentDate:
          appointment.appointment_date,
      },
    });

  const sameDay = sameDayRecords
    .map(mapAppointment)
    .filter(
      (item) =>
        !isCancelledAppointment(item)
    )
    .sort(compareAppointments);

  const queueIndex = sameDay.findIndex(
    (item) => item.id === appointment.id
  );

  const treatment = treatments.find(
    (item) =>
      getTreatmentAppointmentId(item) ===
      appointment.id
  );

  return enrichedAppointment(
    appointment,

    isCancelledAppointment(appointment)
      ? null
      : queueIndex >= 0
        ? queueIndex + 1
        : null,

    patientMap.get(appointment.patient_id),
    dentistMap.get(appointment.dentist_id),
    treatment,
    payments,
    true
  );
}

/* ========================================================
   8. GET APPOINTMENTS BY DATE RANGE
======================================================== */

export async function getAppointmentsByDateRange(
  startDate,
  endDate
) {
  if (!startDate || !endDate) {
    throw appError(
      "Start date and end date are required",
      400
    );
  }

  const records =
    await prisma.appointment.findMany({
      where: {
        appointmentDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

  return records
    .map(mapAppointment)
    .sort(compareAppointments);
}

/* ========================================================
   9. GET FULL APPOINTMENT DETAILS
======================================================== */

export async function getAppointmentFullDetailsService(
  appointmentId
) {
  const id = normalizeId(appointmentId);

  if (!id) {
    throw appError(
      "Appointment ID is required",
      400
    );
  }

  const [
    record,
    { treatments, payments },
  ] = await Promise.all([
    prisma.appointment.findUnique({
      where: { id },
    }),
    getLegacyTreatmentData(),
  ]);

  if (!record) {
    throw appError(
      "Appointment not found",
      404
    );
  }

  const appointment = mapAppointment(record);

  const [patient, dentist] = await Promise.all([
    appointment.patient_id
      ? prisma.patient.findUnique({
          where: {
            id: appointment.patient_id,
          },
        })
      : null,

    appointment.dentist_id
      ? prisma.dentist.findUnique({
          where: {
            id: appointment.dentist_id,
          },
        })
      : null,
  ]);

  const appointmentTreatments =
    treatments.filter(
      (treatment) =>
        getTreatmentAppointmentId(treatment) === id
    );

  const treatmentIds = appointmentTreatments
    .map(getTreatmentId)
    .filter(Boolean);

  const appointmentPayments = payments.filter(
    (payment) =>
      normalizeId(payment?.appointment_id) === id ||
      treatmentIds.includes(
        normalizeId(payment?.treatment_id)
      )
  );

  const totalTreatmentCharge =
    appointmentTreatments.reduce(
      (sum, treatment) =>
        sum +
        toNumber(
          treatment?.treatment_fee ??
          treatment?.treatment_charge
        ),
      0
    );

  const totalPaid = appointmentPayments.reduce(
    (sum, payment) =>
      sum +
      toNumber(
        payment?.payment_amount ??
        payment?.amount
      ),
    0
  );

  const paymentStatus =
    totalTreatmentCharge > 0 &&
    totalPaid >= totalTreatmentCharge
      ? "Paid"
      : totalPaid > 0
        ? "Partial"
        : "Unpaid";

  return {
    appointment,

    patient: patient
      ? {
          id: patient.id,
          name: patient.name ?? "",
          phone: patient.phone ?? "",
          age: patient.age ?? "",
          gender: patient.gender ?? "",
          address: patient.address ?? "",
          is_allergies: patient.isAllergies ?? "",
          allergies: patient.allergies ?? "",
          location: patient.location ?? "",
          distance: patient.distance ?? "",
          created_at: patient.createdAt ?? "",
          updated_at: patient.updatedAt ?? "",
        }
      : null,

    dentist: dentist
      ? {
          id: dentist.id,
          name: dentist.name ?? "",
          phone: dentist.phone ?? "",
          specialization:
            dentist.specialization ?? "",
          created_at: dentist.createdAt ?? "",
          updated_at: dentist.updatedAt ?? "",
        }
      : null,

    treatments: appointmentTreatments,
    payments: appointmentPayments,

    payment_summary: {
      total_treatment_charge:
        totalTreatmentCharge,
      total_paid: totalPaid,

      balance: Math.max(
        totalTreatmentCharge - totalPaid,
        0
      ),

      payment_status: paymentStatus,
    },
  };
}

/* ========================================================
   10. GET APPOINTMENT BY TREATMENT ID
======================================================== */

export async function getAppointmentByTreatmentId({
  treatmentId,
}) {
  const id = normalizeId(treatmentId);

  if (id) {
    const treatments =
      await readSheet("Treatments");

    const treatment = treatments.find(
      (item) =>
        getTreatmentId(item) === id
    );

    if (!treatment) {
      throw appError(
        "Treatment not found",
        404
      );
    }

    const appointmentId =
      getTreatmentAppointmentId(treatment);

    if (!appointmentId) {
      throw appError(
        "Appointment ID is not available for this treatment",
        404
      );
    }

    const appointment =
      await prisma.appointment.findUnique({
        where: {
          id: appointmentId,
        },
      });

    if (!appointment) {
      throw appError(
        "Appointment not found for this treatment",
        404
      );
    }

    return {
      type: "single",
      data: mapAppointment(appointment),
    };
  }

  const appointments = (
    await prisma.appointment.findMany()
  )
    .map(mapAppointment)
    .sort(compareAppointments);

  return {
    type: "list",
    data: appointments,
    total: appointments.length,
  };
}
