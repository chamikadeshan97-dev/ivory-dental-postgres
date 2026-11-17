/*
  Warnings:

  - A unique constraint covering the columns `[appointment_id]` on the table `treatment_payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "treatment_payments" ADD COLUMN     "appointment_id" TEXT,
ALTER COLUMN "treatment_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "treatment_payments_appointment_id_key" ON "treatment_payments"("appointment_id");
