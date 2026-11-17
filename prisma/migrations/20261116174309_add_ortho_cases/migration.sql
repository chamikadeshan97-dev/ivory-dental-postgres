-- CreateTable
CREATE TABLE "ortho_cases" (
    "ortho_case_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "dentist_id" TEXT,
    "start_date" TEXT,
    "treatment_type" TEXT,
    "treatment_area" TEXT,
    "diagnosis" TEXT,
    "estimated_duration" TEXT,
    "total_treatment_fee" DECIMAL(12,2),
    "payment_plan" TEXT,
    "monthly_payment" DECIMAL(12,2),
    "next_visit_date" TEXT,
    "status" TEXT,
    "notes" TEXT,
    "completed_date" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "ortho_cases_pkey" PRIMARY KEY ("ortho_case_id")
);

-- CreateIndex
CREATE INDEX "ortho_cases_patient_id_idx" ON "ortho_cases"("patient_id");

-- CreateIndex
CREATE INDEX "ortho_cases_dentist_id_idx" ON "ortho_cases"("dentist_id");

-- CreateIndex
CREATE INDEX "ortho_cases_status_idx" ON "ortho_cases"("status");

-- CreateIndex
CREATE INDEX "ortho_cases_next_visit_date_idx" ON "ortho_cases"("next_visit_date");
