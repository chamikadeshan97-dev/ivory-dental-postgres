
import prisma from "../config/prisma.js";
import { readSheet } from "../utils/googleSheets.js";
import { createId, now } from "../utils/helpers.js";
import appError from "../utils/appError.js";

/* ========================================================
   HELPERS
======================================================== */

const normalizeValue = (value) => String(value ?? "").trim();

const normalizeLower = (value) =>
  normalizeValue(value).toLowerCase();

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const convertToBoolean = (value) =>
  value === true ||
  value === 1 ||
  ["true", "yes", "1"].includes(normalizeLower(value));

const getPaymentStatus = ({
  savedStatus,
  paymentAmount,
  treatmentCharge,
}) => {
  const status = normalizeLower(savedStatus);

  if (status === "paid" || status === "full") return "Full";
  if (status === "partial") return "Partial";

  if (treatmentCharge > 0 && paymentAmount >= treatmentCharge) {
    return "Full";
  }

  if (paymentAmount > 0) return "Partial";

  return "Pending";
};

/* ========================================================
   PRISMA PATIENT RESPONSE MAPPER
======================================================== */

const mapPatient = (
  patient,
  { booleanAllergies = false } = {},
) => {
  if (!patient) return null;

  return {
    id: patient.id,
    name: patient.name ?? "",
    phone: patient.phone ?? "",
    location: patient.location ?? "",
    distance: patient.distance ?? "",
    age: patient.age ?? "",
    gender: patient.gender ?? "",
    address: patient.address ?? "",
    is_allergies: booleanAllergies
      ? convertToBoolean(patient.isAllergies)
      : patient.isAllergies ?? "",
    allergies: patient.allergies ?? "",
    created_at: patient.createdAt ?? "",
    updated_at: patient.updatedAt ?? "",
  };
};

/* ========================================================
   CREATE PATIENT — POSTGRESQL
======================================================== */

export async function createPatient(data) {
  const {
    name,
    phone,
    age,
    distance,
    location,
    gender,
    address,
    allergy_details,
    has_allergies,
  } = data;

  if (!normalizeValue(name) || !normalizeValue(phone)) {
    throw appError(
      "Patient name and phone number are required",
      400,
    );
  }

  const createdAt = now();
  const hasAllergies = convertToBoolean(has_allergies);

  const patient = await prisma.patient.create({
    data: {
      id: createId("PAT"),
      name: normalizeValue(name),
      phone: normalizeValue(phone),
      location: normalizeValue(location),
      distance: normalizeValue(distance),
      age: normalizeValue(age),
      gender: normalizeValue(gender),
      address: normalizeValue(address),
      isAllergies: String(hasAllergies),
      allergies: hasAllergies
        ? normalizeValue(allergy_details)
        : "",
      createdAt,
      updatedAt: createdAt,
    },
  });

  return mapPatient(patient, {
    booleanAllergies: true,
  });
}

/* ========================================================
   GET ALL PATIENTS — POSTGRESQL
======================================================== */

export async function getAllPatients() {
  const patients = await prisma.patient.findMany();

  return patients.map(mapPatient);
}

/* ========================================================
   SEARCH PATIENTS — POSTGRESQL
======================================================== */

export async function searchPatients(q) {
  const keyword = normalizeValue(q);

  if (!keyword) {
    return getAllPatients();
  }

  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        {
          name: {
            contains: keyword,
            mode: "insensitive",
          },
        },
        {
          phone: {
            contains: keyword,
            mode: "insensitive",
          },
        },
        {
          id: {
            contains: keyword,
            mode: "insensitive",
          },
        },
        {
          location: {
            contains: keyword,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  return patients.map(mapPatient);
}

/* ========================================================
   GET PATIENT BY ID — POSTGRESQL
======================================================== */

export async function getPatientById(id) {
  const requestedPatientId = normalizeValue(id);

  if (!requestedPatientId) {
    throw appError("Patient ID is required", 400);
  }

  const patient = await prisma.patient.findUnique({
    where: {
      id: requestedPatientId,
    },
  });

  if (!patient) {
    throw appError("Patient not found", 404);
  }

  return mapPatient(patient);
}

/* ========================================================
   GET PATIENT HISTORY — GOOGLE SHEETS (TEMPORARY)
======================================================== */

export async function getPatientHistory(patientId) {
  const requestedPatientId = normalizeValue(patientId);

  if (!requestedPatientId) {
    throw appError("Patient ID is required", 400);
  }

  const [patients, appointments, treatments, payments] =
    await Promise.all([
      readSheet("Patients"),
      readSheet("Appointments"),
      readSheet("Treatments"),
      readSheet("Payments"),
    ]);

  const patient = patients.find(
    (item) =>
      normalizeValue(item.id) === requestedPatientId,
  );

  if (!patient) {
    throw appError("Patient not found", 404);
  }

  const patientAppointments = appointments.filter(
    (appointment) =>
      normalizeValue(appointment.patient_id) ===
      requestedPatientId,
  );

  const appointmentIds = new Set(
    patientAppointments.map((appointment) =>
      normalizeValue(appointment.id),
    ),
  );

  const patientTreatments = treatments.filter(
    (treatment) =>
      normalizeValue(treatment.patient_id) ===
        requestedPatientId ||
      appointmentIds.has(
        normalizeValue(treatment.appointment_id),
      ),
  );

  const treatmentIds = new Set(
    patientTreatments.map((treatment) =>
      normalizeValue(treatment.id),
    ),
  );

  const patientPayments = payments.filter(
    (payment) =>
      normalizeValue(payment.patient_id) ===
        requestedPatientId ||
      treatmentIds.has(
        normalizeValue(payment.treatment_id),
      ),
  );

  return {
    personal_information: patient,
    appointment_history: patientAppointments,
    treatment_history: patientTreatments,

    prescription_history: patientTreatments.map(
      (treatment) => ({
        treatment_id: treatment.id,
        prescription: treatment.prescription || "",
        treatment_date: treatment.treatment_date || "",
      }),
    ),

    payment_history: patientPayments,

    doctor_notes: patientTreatments.map(
      (treatment) => ({
        treatment_id: treatment.id,
        doctor_notes: treatment.doctor_notes || "",
        treatment_date: treatment.treatment_date || "",
      }),
    ),
  };
}

/* ========================================================
   UPDATE PATIENT — POSTGRESQL
======================================================== */

export async function updatePatient(id, data) {
  const requestedPatientId = normalizeValue(id);

  if (!requestedPatientId) {
    throw appError("Patient ID is required", 400);
  }

  const existingPatient = await prisma.patient.findUnique({
    where: {
      id: requestedPatientId,
    },
  });

  if (!existingPatient) {
    throw appError("Patient not found", 404);
  }

  const updatedPatient = {
    name:
      data.name !== undefined
        ? normalizeValue(data.name)
        : existingPatient.name,

    phone:
      data.phone !== undefined
        ? normalizeValue(data.phone)
        : existingPatient.phone,

    location:
      data.location !== undefined
        ? normalizeValue(data.location)
        : existingPatient.location,

    distance:
      data.distance !== undefined
        ? normalizeValue(data.distance)
        : existingPatient.distance,

    age:
      data.age !== undefined
        ? normalizeValue(data.age)
        : existingPatient.age,

    gender:
      data.gender !== undefined
        ? normalizeValue(data.gender)
        : existingPatient.gender,

    address:
      data.address !== undefined
        ? normalizeValue(data.address)
        : existingPatient.address,

    isAllergies:
      data.has_allergies !== undefined
        ? String(convertToBoolean(data.has_allergies))
        : data.is_allergies !== undefined
          ? String(convertToBoolean(data.is_allergies))
          : String(
              convertToBoolean(
                existingPatient.isAllergies,
              ),
            ),

    allergies:
      data.allergy_details !== undefined
        ? normalizeValue(data.allergy_details)
        : data.allergies !== undefined
          ? normalizeValue(data.allergies)
          : existingPatient.allergies,

    updatedAt: now(),
  };

  if (
    !normalizeValue(updatedPatient.name) ||
    !normalizeValue(updatedPatient.phone)
  ) {
    throw appError(
      "Patient name and phone number are required",
      400,
    );
  }

  if (!convertToBoolean(updatedPatient.isAllergies)) {
    updatedPatient.allergies = "";
  }

  const patient = await prisma.patient.update({
    where: {
      id: requestedPatientId,
    },
    data: updatedPatient,
  });

  return mapPatient(patient, {
    booleanAllergies: true,
  });
}

/* ========================================================
   DELETE PATIENT — POSTGRESQL
======================================================== */

export async function deletePatient(id) {
  const requestedPatientId = normalizeValue(id);

  if (!requestedPatientId) {
    throw appError("Patient ID is required", 400);
  }

  const existingPatient = await prisma.patient.findUnique({
    where: {
      id: requestedPatientId,
    },
  });

  if (!existingPatient) {
    throw appError("Patient not found", 404);
  }

  // Review related appointment/payment records before
  // enabling patient deletion in the live clinic.

  const deletedPatient = await prisma.patient.delete({
    where: {
      id: requestedPatientId,
    },
  });

  return mapPatient(deletedPatient);
}

/* ========================================================
   PATIENT STATISTICS — POSTGRESQL
======================================================== */

export async function getPatientStatistics() {
  const patients = await prisma.patient.findMany({
    select: {
      gender: true,
      age: true,
    },
  });

  const totalPatients = patients.length;

  const malePatients = patients.filter(
    (patient) =>
      normalizeLower(patient.gender) === "male",
  ).length;

  const femalePatients = patients.filter(
    (patient) =>
      normalizeLower(patient.gender) === "female",
  ).length;

  const totalAge = patients.reduce(
    (sum, patient) => sum + toNumber(patient.age),
    0,
  );

  const averageAge =
    totalPatients > 0
      ? Number((totalAge / totalPatients).toFixed(1))
      : 0;

  return {
    total_patients: totalPatients,
    male_patients: malePatients,
    female_patients: femalePatients,
    average_age: averageAge,
  };
}

/* ========================================================
   RECENT PATIENTS — POSTGRESQL
======================================================== */

export async function getRecentPatients() {
  const patients = await prisma.patient.findMany();

  return patients
    .map(mapPatient)
    .sort((first, second) => {
      const firstDate = new Date(
        first.created_at || 0,
      ).getTime();

      const secondDate = new Date(
        second.created_at || 0,
      ).getTime();

      if (
        Number.isFinite(firstDate) &&
        Number.isFinite(secondDate)
      ) {
        return secondDate - firstDate;
      }

      return normalizeValue(
        second.created_at,
      ).localeCompare(
        normalizeValue(first.created_at),
      );
    })
    .slice(0, 5);
}

/* ========================================================
   GET PATIENT FULL DETAILS — GOOGLE SHEETS (TEMPORARY)
======================================================== */

export async function getPatientFullDetails(patientId) {
  if (!patientId) {
    throw appError("Patient ID is required", 400);
  }

  const requestedPatientId = normalizeValue(patientId);

  const [
    patients,
    appointments,
    dentists,
    treatments,
    payments,
  ] = await Promise.all([
    readSheet("Patients"),
    readSheet("Appointments"),
    readSheet("Dentists"),
    readSheet("Treatments"),
    readSheet("Payments"),
  ]);

  /* --------------------------------------------------------
     Find patient
  -------------------------------------------------------- */

  const patient = patients.find(
    (item) =>
      normalizeValue(item.id) === requestedPatientId,
  );

  if (!patient) {
    throw appError(
      `Patient ${requestedPatientId} was not found`,
      404,
    );
  }

  /* --------------------------------------------------------
     Patient appointments
  -------------------------------------------------------- */

  const patientAppointments = appointments
    .filter(
      (appointment) =>
        normalizeValue(appointment.patient_id) ===
        requestedPatientId,
    )
    .map((appointment) => {
      const dentist = dentists.find(
        (item) =>
          normalizeValue(item.id) ===
          normalizeValue(appointment.dentist_id),
      );

      return {
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        dentist_id: appointment.dentist_id,
        dentist_name:
          dentist?.name || dentist?.dentist_name || "",
        appointment_date:
          appointment.appointment_date || "",
        appointment_time:
          appointment.appointment_time || "",
        reason_for_visit:
          appointment.reason_for_visit || "",
        status: appointment.status || "Pending",
        created_at: appointment.created_at || "",
        updated_at: appointment.updated_at || "",
      };
    })
    .sort((first, second) =>
      `${second.appointment_date} ${second.appointment_time}`
        .localeCompare(
          `${first.appointment_date} ${first.appointment_time}`,
        ),
    );

  const appointmentIds = new Set(
    patientAppointments.map((appointment) =>
      normalizeValue(appointment.appointment_id),
    ),
  );

  /* --------------------------------------------------------
     Patient treatments
  -------------------------------------------------------- */

  const patientTreatments = treatments
    .filter(
      (treatment) =>
        normalizeValue(treatment.patient_id) ===
          requestedPatientId ||
        appointmentIds.has(
          normalizeValue(treatment.appointment_id),
        ),
    )
    .map((treatment) => {
      const appointment = patientAppointments.find(
        (item) =>
          normalizeValue(item.appointment_id) ===
          normalizeValue(treatment.appointment_id),
      );

      return {
        treatment_id: treatment.id,
        patient_id:
          treatment.patient_id || requestedPatientId,
        appointment_id:
          treatment.appointment_id || "",
        diagnosis: treatment.diagnosis || "",
        treatment_performed:
          treatment.treatment_performed ||
          treatment.treatment_name ||
          treatment.procedure_name ||
          "",
        prescription: treatment.prescription || "",
        doctor_notes: treatment.doctor_notes || "",
        treatment_fee: toNumber(
          treatment.treatment_fee ??
            treatment.treatment_charge,
        ),
        treatment_date:
          treatment.treatment_date ||
          appointment?.appointment_date ||
          treatment.created_at ||
          "",
        notes:
          treatment.notes ||
          treatment.treatment_notes ||
          treatment.description ||
          "",
        next_appointment_date:
          treatment.next_appointment_date || "",
        created_at: treatment.created_at || "",
        updated_at: treatment.updated_at || "",
      };
    })
    .sort((first, second) =>
      normalizeValue(
        second.treatment_date,
      ).localeCompare(
        normalizeValue(first.treatment_date),
      ),
    );

  const treatmentIds = new Set(
    patientTreatments.map((treatment) =>
      normalizeValue(treatment.treatment_id),
    ),
  );

  /* --------------------------------------------------------
     Patient payments
  -------------------------------------------------------- */

  const patientPayments = payments
    .filter(
      (payment) =>
        normalizeValue(payment.patient_id) ===
          requestedPatientId ||
        treatmentIds.has(
          normalizeValue(payment.treatment_id),
        ),
    )
    .map((payment) => {
      const treatment = patientTreatments.find(
        (item) =>
          normalizeValue(item.treatment_id) ===
          normalizeValue(payment.treatment_id),
      );

      const treatmentCharge = toNumber(
        payment.treatment_charge ??
          treatment?.treatment_fee,
      );

      const paymentAmount = toNumber(
        payment.payment_amount ?? payment.amount,
      );

      const status = getPaymentStatus({
        savedStatus:
          payment.status ?? payment.payment_status,
        paymentAmount,
        treatmentCharge,
      });

      return {
        payment_id: payment.id,
        patient_id:
          payment.patient_id || requestedPatientId,
        treatment_id: payment.treatment_id || "",
        treatment_name:
          treatment?.treatment_performed || "",
        receipt_number:
          payment.receipt_number || "",
        treatment_charge: treatmentCharge,
        payment_amount: paymentAmount,
        balance: Math.max(
          treatmentCharge - paymentAmount,
          0,
        ),
        payment_method:
          payment.payment_method || "",
        payment_date: payment.payment_date || "",
        status,
        created_at: payment.created_at || "",
        updated_at: payment.updated_at || "",
      };
    })
    .sort((first, second) =>
      normalizeValue(
        second.payment_date,
      ).localeCompare(
        normalizeValue(first.payment_date),
      ),
    );

  /* --------------------------------------------------------
     Financial summary
  -------------------------------------------------------- */

  const totalTreatmentCharges =
    patientTreatments.reduce(
      (total, treatment) =>
        total + toNumber(treatment.treatment_fee),
      0,
    );

  const totalPaid = patientPayments.reduce(
    (total, payment) =>
      total + toNumber(payment.payment_amount),
    0,
  );

  const fullPaymentCount = patientPayments.filter(
    (payment) => payment.status === "Full",
  ).length;

  const partialPaymentCount = patientPayments.filter(
    (payment) => payment.status === "Partial",
  ).length;

  const totalCash = patientPayments
    .filter(
      (payment) =>
        normalizeLower(payment.payment_method) ===
        "cash",
    )
    .reduce(
      (total, payment) =>
        total + toNumber(payment.payment_amount),
      0,
    );

  const totalCard = patientPayments
    .filter(
      (payment) =>
        normalizeLower(payment.payment_method) ===
        "card",
    )
    .reduce(
      (total, payment) =>
        total + toNumber(payment.payment_amount),
      0,
    );

  const totalTransfer = patientPayments
    .filter((payment) =>
      [
        "transfer",
        "bank transfer",
        "bank_transfer",
        "online",
      ].includes(
        normalizeLower(payment.payment_method),
      ),
    )
    .reduce(
      (total, payment) =>
        total + toNumber(payment.payment_amount),
      0,
    );

  /* --------------------------------------------------------
     Appointment summary
  -------------------------------------------------------- */

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const upcomingAppointments = patientAppointments
    .filter(
      (appointment) =>
        normalizeValue(
          appointment.appointment_date,
        ) >= today &&
        ![
          "cancelled",
          "canceled",
          "completed",
        ].includes(
          normalizeLower(appointment.status),
        ),
    )
    .sort((first, second) =>
      `${first.appointment_date} ${first.appointment_time}`
        .localeCompare(
          `${second.appointment_date} ${second.appointment_time}`,
        ),
    );

  const completedAppointments =
    patientAppointments.filter((appointment) =>
      ["completed", "paid"].includes(
        normalizeLower(appointment.status),
      ),
    );

  const cancelledAppointments =
    patientAppointments.filter((appointment) =>
      ["cancelled", "canceled"].includes(
        normalizeLower(appointment.status),
      ),
    );

  /* --------------------------------------------------------
     Final response
  -------------------------------------------------------- */

  return {
    patient: {
      ...patient,
      id: patient.id || requestedPatientId,
      name:
        patient.name ||
        patient.patient_name ||
        "",
      phone:
        patient.phone ||
        patient.phone_number ||
        "",
      location: patient.location || "",
      distance: patient.distance || "",
      has_allergies: convertToBoolean(
        patient.has_allergies ??
          patient.is_allergies,
      ),
      allergy_details:
        patient.allergy_details ??
        patient.allergies ??
        "",
    },

    summary: {
      total_appointments:
        patientAppointments.length,
      completed_appointments:
        completedAppointments.length,
      cancelled_appointments:
        cancelledAppointments.length,
      upcoming_appointments:
        upcomingAppointments.length,
      total_treatments:
        patientTreatments.length,
      total_payments:
        patientPayments.length,
      full_payments: fullPaymentCount,
      partial_payments: partialPaymentCount,
      total_treatment_charges:
        totalTreatmentCharges,
      total_paid: totalPaid,
      outstanding_balance: Math.max(
        totalTreatmentCharges - totalPaid,
        0,
      ),
      total_cash: totalCash,
      total_card: totalCard,
      total_transfer: totalTransfer,
    },

    next_appointment:
      upcomingAppointments[0] || null,

    last_appointment:
      patientAppointments[0] || null,

    appointments: patientAppointments,
    treatments: patientTreatments,
    payments: patientPayments,
  };
}
