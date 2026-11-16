import { Router } from "express";
import {
  createPayment,
  listPayments,
  getPayment,
  addInstallment,
  paymentSummary,
} from "../controllers/simplePayment.controller.js";
const router = Router();
router.post("/", createPayment);
router.get("/", listPayments);
router.get("/summary", paymentSummary);
router.get("/:id", getPayment);
router.post("/:id/installment", addInstallment);
export default router;
