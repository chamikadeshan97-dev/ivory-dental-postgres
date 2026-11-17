
import prisma from "../config/prisma.js";

import {
  readSheet,
  writeSheet,
} from "../utils/googleSheets.js";

import {
  createId,
  now,
} from "../utils/helpers.js";

import appError from "../utils/appError.js";

/* ========================================================
   CONFIGURATION
======================================================== */

const DOCTOR_ARRIVAL_SHEET = "Doctor_Arrival";

/* ========================================================
   HELPERS
======================================================== */

const normalizeDate = (value) => {
  if (!value) {
    return "";
  }

  return String(value).trim();
};

const normalizeBoolean = (value) => {
  if (value === true || value === 1) {
    return true;
  }

  return ["true", "1", "yes"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
};

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeId(value) {
  return normalizeText(value).toLowerCase();
}

/* ========================================================
   PRISMA RESPONSE MAPPER
======================================================== */

function normalizeDentist(dentist) {
  return {
    id: normalizeText(dentist?.id),

    name: normalizeText(dentist?.name),

    phone: normalizeText(dentist?.phone),

    specialization: normalizeText(
      dentist?.specialization,
    ),

    created_at: normalizeText(
      dentist?.createdAt,
    ),

    updated_at: normalizeText(
      dentist?.updatedAt,
    ),
  };
}

/* ========================================================
   DATABASE HELPERS — POSTGRESQL
======================================================== */

async function getDentistRows() {
  const rows = await prisma.dentist.findMany();

  return rows
    .filter(
      (row) =>
        row &&
        typeof row === "object",
    )
    .map(normalizeDentist)
    .filter(
      (dentist) =>
        Boolean(dentist.id),
    );
}

function findDentistIndexById(dentists, id) {
  const normalizedDentistId = normalizeId(id);

  return dentists.findIndex(
    (dentist) =>
      normalizeId(dentist.id) ===
      normalizedDentistId,
  );
}

function sortDentistsByName(dentists) {
  return dentists.sort(
    (first, second) =>
      first.name.localeCompare(
        second.name,
        undefined,
        {
          sensitivity: "base",
        },
      ),
  );
}

/* ========================================================
   CREATE DENTIST — POSTGRESQL
======================================================== */

export async function createDentist(data = {}) {
  const name = normalizeText(data.name);

  const phone = normalizeText(data.phone);

  const specialization = normalizeText(
    data.specialization,
  );

  if (!name) {
    throw appError(
      "Dentist name is required",
      400,
    );
  }

  const dentists = await getDentistRows();

  const duplicateDentist = dentists.find(
    (dentist) => {
      return (
        normalizeText(dentist.name).toLowerCase() ===
          name.toLowerCase() &&
        normalizeText(dentist.phone) === phone
      );
    },
  );

  if (duplicateDentist) {
    throw appError(
      "A dentist with this name and phone number already exists",
      409,
    );
  }

  const timestamp = now();

  const newDentist = await prisma.dentist.create({
    data: {
      id: createId("DEN"),

      name,

      phone,

      specialization,

      createdAt: timestamp,

      updatedAt: timestamp,
    },
  });

  return normalizeDentist(newDentist);
}

/* ========================================================
   GET ALL DENTISTS — POSTGRESQL
======================================================== */

export async function getAllDentists() {
  const dentists = await getDentistRows();

  return sortDentistsByName(dentists);
}

/* ========================================================
   SEARCH DENTISTS — POSTGRESQL
======================================================== */

export async function searchDentists(q) {
  const keyword = normalizeText(q).toLowerCase();

  if (!keyword) {
    return getAllDentists();
  }

  const dentists = await prisma.dentist.findMany({
    where: {
      OR: [
        {
          id: {
            contains: keyword,
            mode: "insensitive",
          },
        },
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
          specialization: {
            contains: keyword,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  return sortDentistsByName(
    dentists.map(normalizeDentist),
  );
}

/* ========================================================
   GET DENTIST BY ID — POSTGRESQL
======================================================== */

export async function getDentistById(id) {
  const normalizedDentistId = normalizeText(id);

  if (!normalizedDentistId) {
    throw appError(
      "Dentist ID is required",
      400,
    );
  }

  const dentist = await prisma.dentist.findFirst({
    where: {
      id: {
        equals: normalizedDentistId,
        mode: "insensitive",
      },
    },
  });

  if (!dentist) {
    throw appError(
      "Dentist not found",
      404,
    );
  }

  return normalizeDentist(dentist);
}

/* ========================================================
   UPDATE DENTIST — POSTGRESQL
======================================================== */

export async function updateDentist(id, data = {}) {
  const normalizedDentistId = normalizeText(id);

  if (!normalizedDentistId) {
    throw appError(
      "Dentist ID is required",
      400,
    );
  }

  const dentists = await getDentistRows();

  const index = findDentistIndexById(
    dentists,
    normalizedDentistId,
  );

  if (index === -1) {
    throw appError(
      "Dentist not found",
      404,
    );
  }

  const existing = dentists[index];

  const updatedName =
    Object.prototype.hasOwnProperty.call(
      data,
      "name",
    )
      ? normalizeText(data.name)
      : existing.name;

  const updatedPhone =
    Object.prototype.hasOwnProperty.call(
      data,
      "phone",
    )
      ? normalizeText(data.phone)
      : existing.phone;

  const updatedSpecialization =
    Object.prototype.hasOwnProperty.call(
      data,
      "specialization",
    )
      ? normalizeText(data.specialization)
      : existing.specialization;

  if (!updatedName) {
    throw appError(
      "Dentist name is required",
      400,
    );
  }

  const duplicateDentist = dentists.find(
    (dentist) => {
      const isCurrentDentist =
        normalizeId(dentist.id) ===
        normalizeId(existing.id);

      const hasSameName =
        normalizeText(dentist.name).toLowerCase() ===
        updatedName.toLowerCase();

      const hasSamePhone =
        normalizeText(dentist.phone) ===
        updatedPhone;

      return (
        !isCurrentDentist &&
        hasSameName &&
        hasSamePhone
      );
    },
  );

  if (duplicateDentist) {
    throw appError(
      "A dentist with this name and phone number already exists",
      409,
    );
  }

  const updatedDentist = await prisma.dentist.update({
    where: {
      id: existing.id,
    },

    data: {
      name: updatedName,

      phone: updatedPhone,

      specialization: updatedSpecialization,

      updatedAt: now(),
    },
  });

  return normalizeDentist(updatedDentist);
}

/* ========================================================
   DELETE DENTIST — POSTGRESQL
======================================================== */

export async function deleteDentist(id) {
  const normalizedDentistId = normalizeText(id);

  if (!normalizedDentistId) {
    throw appError(
      "Dentist ID is required",
      400,
    );
  }

  const dentists = await getDentistRows();

  const index = findDentistIndexById(
    dentists,
    normalizedDentistId,
  );

  if (index === -1) {
    throw appError(
      "Dentist not found",
      404,
    );
  }

  const existing = dentists[index];

  const deletedDentist = await prisma.dentist.delete({
    where: {
      id: existing.id,
    },
  });

  return normalizeDentist(deletedDentist);
}

/* ========================================================
   DENTIST STATISTICS — POSTGRESQL
======================================================== */

export async function getDentistStatistics() {
  const dentists = await getDentistRows();

  const specializationCounts = {};

  dentists.forEach((dentist) => {
    const specialization =
      normalizeText(dentist.specialization) ||
      "General";

    specializationCounts[specialization] =
      (specializationCounts[specialization] || 0) + 1;
  });

  return {
    total_dentists: dentists.length,

    specialization_breakdown:
      specializationCounts,
  };
}

/* ========================================================
   GET DOCTOR ARRIVAL STATUS
   DATABASE: GOOGLE SHEETS (TEMPORARY)
======================================================== */

export async function getDoctorArrivalStatus(date) {
  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) {
    throw new Error("Date is required");
  }

  const records = await readSheet(
    DOCTOR_ARRIVAL_SHEET,
  );

  const arrivalRecord = records.find(
    (record) =>
      normalizeDate(record.date) ===
      normalizedDate,
  );

  if (!arrivalRecord) {
    return {
      date: normalizedDate,
      arrived: false,
      arrived_at: null,
      sms_sent: false,
      sms_count: 0,
    };
  }

  return {
    id: arrivalRecord.id || "",

    date: arrivalRecord.date || normalizedDate,

    arrived: normalizeBoolean(
      arrivalRecord.arrived,
    ),

    arrived_at:
      arrivalRecord.arrived_at ||
      arrivalRecord.arrival_time ||
      null,

    sms_sent: normalizeBoolean(
      arrivalRecord.sms_sent,
    ),

    sms_count: Number(
      arrivalRecord.sms_count || 0,
    ),
  };
}

/* ========================================================
   MARK DOCTOR ARRIVED
   DATABASE: GOOGLE SHEETS (TEMPORARY)
======================================================== */

export async function markDoctorArrived({
  date,
  sendSms = true,
}) {
  const normalizedDate = normalizeDate(date);

  if (!normalizedDate) {
    throw new Error("Date is required");
  }

  const records = await readSheet(
    DOCTOR_ARRIVAL_SHEET,
  );

  const existingRecordIndex = records.findIndex(
    (record) =>
      normalizeDate(record.date) ===
      normalizedDate,
  );

  /*
   * Prevent duplicate doctor-arrival records
   * and duplicate SMS sending.
   */

  if (existingRecordIndex !== -1) {
    const existingRecord =
      records[existingRecordIndex];

    if (normalizeBoolean(existingRecord.arrived)) {
      return {
        id: existingRecord.id || "",

        date:
          existingRecord.date ||
          normalizedDate,

        arrived: true,

        arrived_at:
          existingRecord.arrived_at ||
          existingRecord.arrival_time ||
          null,

        sms_sent: normalizeBoolean(
          existingRecord.sms_sent,
        ),

        sms_count: Number(
          existingRecord.sms_count || 0,
        ),

        already_arrived: true,
      };
    }
  }

  const timestamp = new Date().toISOString();

  const id = `DAR_${normalizedDate.replaceAll("-", "")}`;

  /*
   * SMS integration placeholder.
   * Preserve existing behavior.
   */

  let smsCount = 0;
  let smsSent = false;

  if (sendSms) {
    try {
      /*
       * Future implementation:
       *
       * const smsResult =
       *   await sendDoctorArrivalSms(normalizedDate);
       *
       * smsCount = smsResult.sentCount;
       * smsSent = smsCount > 0;
       */

      smsCount = 0;
      smsSent = false;
    } catch (error) {
      console.error(
        "Failed to send doctor arrival SMS:",
        error,
      );

      smsCount = 0;
      smsSent = false;
    }
  }

  const newRecord = {
    id,

    date: normalizedDate,

    arrived: true,

    arrived_at: timestamp,

    sms_sent: smsSent,

    sms_count: smsCount,

    created_at: timestamp,

    updated_at: timestamp,
  };

  if (existingRecordIndex !== -1) {
    records[existingRecordIndex] = {
      ...records[existingRecordIndex],

      ...newRecord,

      created_at:
        records[existingRecordIndex].created_at ||
        timestamp,
    };
  } else {
    records.push(newRecord);
  }

  await writeSheet(
    DOCTOR_ARRIVAL_SHEET,
    records,
  );

  return {
    ...newRecord,
    already_arrived: false,
  };
}
