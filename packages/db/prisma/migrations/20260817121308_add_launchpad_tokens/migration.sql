-- CreateTable
CREATE TABLE "LaunchpadToken" (
    "id" BIGSERIAL NOT NULL,
    "chain" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "mcUsd" DECIMAL(20,2),
    "athMcUsd" DECIMAL(20,2),
    "startMcUsd" DECIMAL(20,2),
    "vol24Usd" DECIMAL(20,2) NOT NULL,
    "change24" DOUBLE PRECISION,
    "launchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchpadToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaunchpadToken_chain_venue_vol24Usd_idx" ON "LaunchpadToken"("chain", "venue", "vol24Usd" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LaunchpadToken_chain_venue_symbol_key" ON "LaunchpadToken"("chain", "venue", "symbol");
