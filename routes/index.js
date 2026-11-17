import express from "express";

import patientRoutes from "./patient.routes.js";
import dentistRoutes from "./dentist.routes.js";
import appointmentRoutes from "./appointment.routes.js";
import treatmentRoutes from "./treatment.routes.js";
import authRoutes from "./auth.routes.js";
import commonTreatmentRouter from "./commonTreatments.routes.js";


import locationRoutes from "./locations.routes.js";
import databaseRoutes from "./database.routes.js";
import queueOrderRoutes from "./queueOrder.routes.js";

import displayMusicRoutes from "./displayMusic.router.js";
import orthoRoutes from "./ortho.router.js";
import smsLogRoutes from "./smsLogRoutes.js";
import treatmentPaymentsRoutes from "./treatmentPaymentsRoutes.js";


import simplePaymentRoutes from "./simplePayment.routes.js";
const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Dental Clinic Backend is running V2",
  });
});


router.use("/patients", patientRoutes);
router.use("/dentists", dentistRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/treatments", treatmentRoutes);
router.use("/auth", authRoutes);
router.use("/common-treatments", commonTreatmentRouter);

router.use("/locations", locationRoutes);

router.use("/database", databaseRoutes);
router.use("/queue-order", queueOrderRoutes);

router.use("/ortho", orthoRoutes);
router.use("/display-music", displayMusicRoutes);
router.use("/sms-logs", smsLogRoutes);

router.use("/treatment-payments", treatmentPaymentsRoutes);
router.use("/simple-payments", simplePaymentRoutes);

export default router;
