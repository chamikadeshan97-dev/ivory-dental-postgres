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
