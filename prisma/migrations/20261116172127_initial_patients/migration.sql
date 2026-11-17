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
