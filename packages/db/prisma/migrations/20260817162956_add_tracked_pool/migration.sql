-- CreateTable
CREATE TABLE "TrackedPool" (
    "id" BIGSERIAL NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "dexName" TEXT NOT NULL,
    "baseSymbol" TEXT NOT NULL,
    "baseName" TEXT NOT NULL,
    "baseAddress" TEXT,
    "vol24Usd" DECIMAL(20,2) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedPool_chain_vol24Usd_idx" ON "TrackedPool"("chain", "vol24Usd" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedPool_chain_address_key" ON "TrackedPool"("chain", "address");
