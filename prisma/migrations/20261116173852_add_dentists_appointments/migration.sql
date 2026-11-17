/*
  Warnings:

  - You are about to drop the `treatment_payments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "treatment_payments";

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "age" TEXT,
    "gender" TEXT,
    "address" TEXT,
    "is_allergies" TEXT,
    "allergies" TEXT,
    "location" TEXT,
    "distance" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dentists" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "specialization" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "dentists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT,
    "dentist_id" TEXT,
    "appointment_number" TEXT,
    "appointment_date" TEXT,
    "appointment_time" TEXT,
    "reason_for_visit" TEXT,
    "status" TEXT,
    "checked_in_time" TEXT,
    "treatment_started_at" TEXT,
    "treatment_completed_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_patient_id_idx" ON "appointments"("patient_id");

-- CreateIndex
CREATE INDEX "appointments_dentist_id_idx" ON "appointments"("dentist_id");

-- CreateIndex
CREATE INDEX "appointments_appointment_date_idx" ON "appointments"("appointment_date");
