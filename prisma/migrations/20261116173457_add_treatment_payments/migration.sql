/*
  Warnings:

  - You are about to drop the `appointments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `dentists` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `patients` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "appointments";

-- DropTable
DROP TABLE "dentists";

-- DropTable
DROP TABLE "patients";

-- CreateTable
CREATE TABLE "treatment_payments" (
    "id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "treatment_name" TEXT NOT NULL,
    "total_fee" DECIMAL(12,2) NOT NULL,
    "payment_type" TEXT NOT NULL,
    "total_paid" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "payment_history" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "treatment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "treatment_payments_patient_id_idx" ON "treatment_payments"("patient_id");

-- CreateIndex
CREATE INDEX "treatment_payments_treatment_id_idx" ON "treatment_payments"("treatment_id");

-- CreateIndex
CREATE INDEX "treatment_payments_status_idx" ON "treatment_payments"("status");
