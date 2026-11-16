
import { Router } from "express";
import {
  readSheet,
  writeSheet,
} from "../utils/googleSheets.js";

const router = Router();

const SHEET = "treatment_payments";

const PAYMENT_METHODS = [
  "Cash",
  "Card",
  "Bank Transfer",
  "Online",
  "Other",
];

const PAYMENT_TYPES = [
  "Advance",
  "Installment",
  "Final",
];

const normalize = (value) =>
  String(value ?? "").trim();

const toAmount = (value) => {
  if (value === "" || value === null || value === undefined) {
    return NaN;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

const money = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const now = () => new Date().toISOString();

const fail = (res, status, message) =>
  res.status(status).json({
    success: false,
    message,
  });

const parseHistory = (value) => {
  if (Array.isArray(value)) return value;

  try {
    const result = JSON.parse(value || "[]");
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
};

const getStatus = (fee, paid) => {
  if (paid <= 0) return "Unpaid";
  if (paid >= fee) return "Paid";
  return "Partial";
};

const calculate = (record) => {
  const fee = money(toAmount(record.treatment_fee) || 0);
  const paid = money(toAmount(record.total_paid) || 0);

  return {
    ...record,
    treatment_fee: fee,
    total_paid: paid,
    remaining_amount: money(Math.max(0, fee - paid)),
    payment_status: getStatus(fee, paid),
  };
};

const loadRecords = async () => {
  const records = await readSheet(SHEET);

  if (!Array.isArray(records)) {
    throw new Error("Unable to load treatment payments");
  }

  return records;
};

const findRecordIndex = (records, id) =>
  records.findIndex(
    (item) =>
      normalize(item.id) === normalize(id) ||
      normalize(item.appointment_id) === normalize(id),
  );

const findRecord = (records, id) => {
  const index = findRecordIndex(records, id);

  return {
    index,
    record: index >= 0 ? records[index] : null,
  };
};

const handleError = (res, error) => {
  console.error("Treatment payments error:", error);

  return fail(
    res,
    500,
    "Unable to complete treatment payment operation",
  );
};

/* ========================================================
   GET ALL PAYMENTS
   GET /api/treatment-payments

   Optional query:
   ?status=Paid
   ?patient_id=PAT_0001
   ?search=root
======================================================== */

router.get("/", async (req, res) => {
  try {
    let records = await loadRecords();

    const status = normalize(req.query.status).toLowerCase();
    const patientId = normalize(req.query.patient_id);
    const search = normalize(req.query.search).toLowerCase();

    records = records.map(calculate);

    if (status) {
      records = records.filter(
        (item) =>
          normalize(item.payment_status).toLowerCase() === status,
      );
    }

    if (patientId) {
      records = records.filter(
        (item) => normalize(item.patient_id) === patientId,
      );
    }

    if (search) {
      records = records.filter((item) =>
        [
          item.id,
          item.appointment_id,
          item.patient_id,
          item.contact_number,
          item.treatment_name,
          item.details,
        ]
          .some((value) =>
            normalize(value).toLowerCase().includes(search),
          ),
      );
    }

    return res.json({
      success: true,
      count: records.length,
      data: records,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   PAYMENT SUMMARY
   GET /api/treatment-payments/summary
======================================================== */

router.get("/summary", async (req, res) => {
  try {
    const records = (await loadRecords()).map(calculate);

    const summary = records.reduce(
      (result, item) => {
        result.total_records += 1;
        result.total_treatment_fees += item.treatment_fee;
        result.total_paid += item.total_paid;
        result.total_remaining += item.remaining_amount;

        const status = item.payment_status.toLowerCase();

        if (status === "paid") result.paid_count += 1;
        if (status === "partial") result.partial_count += 1;
        if (status === "unpaid") result.unpaid_count += 1;

        return result;
      },
      {
        total_records: 0,
        total_treatment_fees: 0,
        total_paid: 0,
        total_remaining: 0,
        paid_count: 0,
        partial_count: 0,
        unpaid_count: 0,
      },
    );

    summary.total_treatment_fees = money(
      summary.total_treatment_fees,
    );
    summary.total_paid = money(summary.total_paid);
    summary.total_remaining = money(
      summary.total_remaining,
    );

    return res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   GET PAYMENT BY ID OR APPOINTMENT ID
   GET /api/treatment-payments/:id
======================================================== */

router.get("/:id", async (req, res) => {
  try {
    const records = await loadRecords();

    const { record } = findRecord(records, req.params.id);

    if (!record) {
      return fail(res, 404, "Payment record not found");
    }

    return res.json({
      success: true,
      data: {
        ...calculate(record),
        payment_history: parseHistory(record.payment_history),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   GET PAYMENT HISTORY
   GET /api/treatment-payments/:id/history
======================================================== */

router.get("/:id/history", async (req, res) => {
  try {
    const records = await loadRecords();

    const { record } = findRecord(records, req.params.id);

    if (!record) {
      return fail(res, 404, "Payment record not found");
    }

    return res.json({
      success: true,
      appointment_id: record.appointment_id,
      data: parseHistory(record.payment_history),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   ADD PAYMENT
   POST /api/treatment-payments/:id/pay

   Body:
   {
     "amount": 5000,
     "payment_method": "Cash",
     "payment_type": "Advance",
     "details": "Advance received"
   }
======================================================== */

router.post("/:id/pay", async (req, res) => {
  try {
    const amount = toAmount(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(res, 400, "Valid payment amount is required");
    }

    const method = normalize(req.body.payment_method);
    const type = normalize(req.body.payment_type);

    if (!PAYMENT_METHODS.includes(method)) {
      return fail(res, 400, "Invalid payment method");
    }

    if (!PAYMENT_TYPES.includes(type)) {
      return fail(res, 400, "Invalid payment type");
    }

    const records = await loadRecords();

    const { index, record } = findRecord(
      records,
      req.params.id,
    );

    if (!record) {
      return fail(res, 404, "Payment record not found");
    }

    const current = calculate(record);

    if (money(amount) > current.remaining_amount) {
      return fail(
        res,
        400,
        "Payment amount cannot exceed remaining balance",
      );
    }

    const history = parseHistory(record.payment_history);

    const timestamp = now();

    const transaction = {
      id: `TXN_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      amount: money(amount),
      payment_method: method,
      payment_type: type,
      details: normalize(req.body.details),
      payment_date: timestamp,
    };

    history.push(transaction);

    const updated = calculate({
      ...record,
      payment_amount: money(amount),
      total_paid: money(current.total_paid + amount),
      payment_method: method,
      payment_type: type,
      payment_history: JSON.stringify(history),
      updated_at: timestamp,
    });

    records[index] = updated;

    await writeSheet(SHEET, records);

    return res.json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        ...updated,
        payment_history: history,
      },
      transaction,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   UPDATE DETAILS / NOTES
   PATCH /api/treatment-payments/:id/details

   Body:
   {
     "details": "Patient will pay next week"
   }
======================================================== */

router.patch("/:id/details", async (req, res) => {
  try {
    if (typeof req.body.details !== "string") {
      return fail(res, 400, "Details must be text");
    }

    const records = await loadRecords();

    const { index, record } = findRecord(
      records,
      req.params.id,
    );

    if (!record) {
      return fail(res, 404, "Payment record not found");
    }

    const updated = {
      ...record,
      details: req.body.details.trim(),
      updated_at: now(),
    };

    records[index] = updated;

    await writeSheet(SHEET, records);

    return res.json({
      success: true,
      message: "Details updated successfully",
      data: updated,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   UPDATE TREATMENT INFORMATION
   PATCH /api/treatment-payments/:id/treatment

   Body:
   {
     "treatment_name": "Root Canal Treatment",
     "treatment_fee": 20000,
     "contact_number": "0771234567"
   }
======================================================== */

router.patch("/:id/treatment", async (req, res) => {
  try {
    const records = await loadRecords();

    const { index, record } = findRecord(
      records,
      req.params.id,
    );

    if (!record) {
      return fail(res, 404, "Payment record not found");
    }

    const updated = { ...record };

    if (req.body.treatment_name !== undefined) {
      const name = normalize(req.body.treatment_name);

      if (!name) {
        return fail(res, 400, "Treatment name is required");
      }

      updated.treatment_name = name;
    }

    if (req.body.contact_number !== undefined) {
      updated.contact_number = normalize(
        req.body.contact_number,
      );
    }

    if (req.body.treatment_fee !== undefined) {
      const fee = toAmount(req.body.treatment_fee);

      if (!Number.isFinite(fee) || fee < 0) {
        return fail(res, 400, "Invalid treatment fee");
      }

      if (money(fee) < money(toAmount(record.total_paid) || 0)) {
        return fail(
          res,
          400,
          "Treatment fee cannot be less than amount already paid",
        );
      }

      updated.treatment_fee = money(fee);
    }

    const result = calculate({
      ...updated,
      updated_at: now(),
    });

    records[index] = result;

    await writeSheet(SHEET, records);

    return res.json({
      success: true,
      message: "Treatment updated successfully",
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

/* ========================================================
   CREATE MANUAL TREATMENT PAYMENT
   POST /api/treatment-payments/manual

   Body:
   {
     "treatment_fee": 10000,
     "payment_amount": 3000,
     "details": "Additional treatment payment"
   }
======================================================== */

router.post("/manual", async (req, res) => {
  try {
    const treatmentFee = toAmount(req.body.treatment_fee);
    const paymentAmount = toAmount(req.body.payment_amount);
    const details = normalize(req.body.details);

    if (!Number.isFinite(treatmentFee) || treatmentFee <= 0) {
      return fail(res, 400, "Valid treatment fee is required");
    }

    if (
      !Number.isFinite(paymentAmount) ||
      paymentAmount < 0
    ) {
      return fail(res, 400, "Valid payment amount is required");
    }

    if (paymentAmount > treatmentFee) {
      return fail(
        res,
        400,
        "Payment amount cannot exceed treatment fee",
      );
    }

    const records = await loadRecords();
    const timestamp = now();

    const id = `TP_MANUAL_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const fee = money(treatmentFee);
    const paid = money(paymentAmount);

    const paymentHistory =
      paid > 0
        ? [
            {
              id: `TXN_${Date.now()}`,
              amount: paid,
              payment_method: "",
              payment_type: "",
              details,
              payment_date: timestamp,
            },
          ]
        : [];

const newRecord = {
  id,

  appointment_id: normalize(req.body.appointment_id),

  patient_id: normalize(req.body.patient_id),

  patient_name: normalize(req.body.patient_name),

  contact_number: normalize(req.body.contact_number),

  treatment_name: normalize(req.body.treatment_name),

  treatment_fee: fee,

  payment_amount: paid,

  total_paid: paid,

  remaining_amount: money(fee - paid),

  payment_method: "",

  payment_type: "",

  payment_status: getStatus(fee, paid),

  payment_history: JSON.stringify(paymentHistory),

  details,

  created_at: timestamp,

  updated_at: timestamp,
};
    records.push(newRecord);

    await writeSheet(SHEET, records);

    return res.status(201).json({
      success: true,
      message: "Manual payment saved successfully",
      data: newRecord,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

export default router;
