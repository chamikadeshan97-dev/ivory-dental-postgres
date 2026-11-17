-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "location" TEXT,
    "distance_km" TEXT,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "password_hash" TEXT,
    "role" TEXT,
    "status" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,
    "email" TEXT,
    "password" TEXT,
    "phone" TEXT,
    "appointment_history" TEXT,
    "queue_manager" TEXT,
    "doctor_treatment" TEXT,
    "payment_history" TEXT,
    "common_treatments" TEXT,
    "drugs" TEXT,
    "locations" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "common_treatments" (
    "id" TEXT NOT NULL,
    "treatment_name" TEXT,
    "fee" DECIMAL(12,2),
    "created_at" TEXT,
    "updated_at" TEXT,

    CONSTRAINT "common_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "common_treatments_treatment_name_idx" ON "common_treatments"("treatment_name");
