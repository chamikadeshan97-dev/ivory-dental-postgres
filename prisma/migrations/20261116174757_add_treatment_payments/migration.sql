-- CreateTable
CREATE TABLE "ortho_visits" (
    "ortho_visit_id" TEXT NOT NULL,
    "ortho_case_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "dentist_id" TEXT,
    "visit_number" INTEGER,
    "visit_date" TEXT,
    "procedure" TEXT,
    "clinical_notes" TEXT,
    "appliance_changes" TEXT,
    "elastics" TEXT,
    "next_visit_date" TEXT,
    "next_visit_plan" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "ortho_visits_pkey" PRIMARY KEY ("ortho_visit_id")
);

-- CreateTable
CREATE TABLE "ortho_payments" (
    "ortho_payment_id" TEXT NOT NULL,
    "ortho_case_id" TEXT NOT NULL,
    "ortho_visit_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "payment_date" TEXT,
    "amount" DECIMAL(12,2),
    "payment_method" TEXT,
    "payment_type" TEXT,
    "receipt_no" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "ortho_payments_pkey" PRIMARY KEY ("ortho_payment_id")
);

-- CreateTable
CREATE TABLE "ortho_media" (
    "ortho_media_id" TEXT NOT NULL,
    "ortho_case_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "ortho_visit_id" TEXT,
    "media_date" TEXT,
    "media_type" TEXT,
    "category" TEXT,
    "stage" TEXT,
    "description" TEXT,
    "drive_file_id" TEXT,
    "drive_folder_id" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TEXT,
    "is_deleted" TEXT,
    "storage_provider" TEXT,
    "s3_bucket" TEXT,
    "s3_key" TEXT,
    "deleted_at" TEXT,

    CONSTRAINT "ortho_media_pkey" PRIMARY KEY ("ortho_media_id")
);

-- CreateIndex
CREATE INDEX "ortho_visits_ortho_case_id_idx" ON "ortho_visits"("ortho_case_id");

-- CreateIndex
CREATE INDEX "ortho_visits_patient_id_idx" ON "ortho_visits"("patient_id");

-- CreateIndex
CREATE INDEX "ortho_visits_appointment_id_idx" ON "ortho_visits"("appointment_id");

-- CreateIndex
CREATE INDEX "ortho_visits_dentist_id_idx" ON "ortho_visits"("dentist_id");

-- CreateIndex
CREATE INDEX "ortho_visits_visit_date_idx" ON "ortho_visits"("visit_date");

-- CreateIndex
CREATE INDEX "ortho_payments_ortho_case_id_idx" ON "ortho_payments"("ortho_case_id");

-- CreateIndex
CREATE INDEX "ortho_payments_ortho_visit_id_idx" ON "ortho_payments"("ortho_visit_id");

-- CreateIndex
CREATE INDEX "ortho_payments_patient_id_idx" ON "ortho_payments"("patient_id");

-- CreateIndex
CREATE INDEX "ortho_payments_payment_date_idx" ON "ortho_payments"("payment_date");

-- CreateIndex
CREATE INDEX "ortho_media_ortho_case_id_idx" ON "ortho_media"("ortho_case_id");

-- CreateIndex
CREATE INDEX "ortho_media_patient_id_idx" ON "ortho_media"("patient_id");

-- CreateIndex
CREATE INDEX "ortho_media_ortho_visit_id_idx" ON "ortho_media"("ortho_visit_id");

-- CreateIndex
CREATE INDEX "ortho_media_storage_provider_idx" ON "ortho_media"("storage_provider");

-- CreateIndex
CREATE INDEX "ortho_media_is_deleted_idx" ON "ortho_media"("is_deleted");
