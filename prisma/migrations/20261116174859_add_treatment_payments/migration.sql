-- CreateTable
CREATE TABLE "queue_order" (
    "date" TEXT NOT NULL,
    "queue_order" JSONB NOT NULL,
    "updated_at" TEXT,

    CONSTRAINT "queue_order_pkey" PRIMARY KEY ("date")
);
