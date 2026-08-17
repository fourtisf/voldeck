-- CreateTable
CREATE TABLE "VolumeBucket" (
    "id" BIGSERIAL NOT NULL,
    "chain" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "bucketTs" TIMESTAMP(3) NOT NULL,
    "volumeUsd" DECIMAL(20,2) NOT NULL,
    "txns" INTEGER,

    CONSTRAINT "VolumeBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueVolume" (
    "id" BIGSERIAL NOT NULL,
    "chain" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "volumeUsd" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "VenueVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" BIGSERIAL NOT NULL,
    "chain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolumeBucket_chain_tier_bucketTs_idx" ON "VolumeBucket"("chain", "tier", "bucketTs" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VolumeBucket_chain_tier_bucketTs_key" ON "VolumeBucket"("chain", "tier", "bucketTs");

-- CreateIndex
CREATE UNIQUE INDEX "VenueVolume_chain_venue_ts_key" ON "VenueVolume"("chain", "venue", "ts");

-- CreateIndex
CREATE INDEX "Alert_ts_idx" ON "Alert"("ts" DESC);

-- CreateIndex
CREATE INDEX "Alert_chain_ts_idx" ON "Alert"("chain", "ts" DESC);
