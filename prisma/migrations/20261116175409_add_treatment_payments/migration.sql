-- CreateTable
CREATE TABLE "sms_logs" (
    "id" SERIAL NOT NULL,
    "Date" TEXT,
    "SMS Type" TEXT,
    "Status" TEXT,
    "Total" INTEGER,
    "Sent" INTEGER,
    "Fail" INTEGER,
    "Sent By" TEXT,
    "Sent At" TEXT,
    "Failed" TEXT,
    "Batch Token" TEXT,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_logs_Date_idx" ON "sms_logs"("Date");

-- CreateIndex
CREATE INDEX "sms_logs_Status_idx" ON "sms_logs"("Status");

-- CreateIndex
CREATE INDEX "sms_logs_Batch Token_idx" ON "sms_logs"("Batch Token");
