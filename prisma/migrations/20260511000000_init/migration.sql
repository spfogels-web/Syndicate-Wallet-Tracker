-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('SOLANA', 'ETHEREUM', 'BASE');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('BUY', 'SELL', 'TRANSFER', 'LINKED_WALLET');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "totalSupply" DECIMAL(78,0),
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "telegramChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isLinked" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linked_wallets" (
    "id" TEXT NOT NULL,
    "parentWalletId" TEXT NOT NULL,
    "childWalletId" TEXT NOT NULL,
    "transferTxHash" TEXT,
    "amountTransferred" DECIMAL(78,0),
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linked_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_stats" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "firstBuyAt" TIMESTAMP(3),
    "lastBuyAt" TIMESTAMP(3),
    "lastSellAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "currentBalance" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "totalBought" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "totalSold" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "nativeSpent" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "nativeReceived" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "avgEntryPrice" DECIMAL(38,18),
    "ownershipPct" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "nativeAmount" DECIMAL(38,18),
    "pricePerToken" DECIMAL(38,18),
    "counterparty" TEXT,
    "blockNumber" BIGINT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "telegramMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "addedById" BIGINT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "projects_chain_idx" ON "projects"("chain");

-- CreateIndex
CREATE UNIQUE INDEX "projects_chain_contractAddress_key" ON "projects"("chain", "contractAddress");

-- CreateIndex
CREATE INDEX "wallets_address_idx" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "wallets_projectId_idx" ON "wallets"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_projectId_address_key" ON "wallets"("projectId", "address");

-- CreateIndex
CREATE INDEX "linked_wallets_childWalletId_idx" ON "linked_wallets"("childWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "linked_wallets_parentWalletId_childWalletId_key" ON "linked_wallets"("parentWalletId", "childWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_stats_walletId_key" ON "wallet_stats"("walletId");

-- CreateIndex
CREATE INDEX "transactions_walletId_timestamp_idx" ON "transactions"("walletId", "timestamp");

-- CreateIndex
CREATE INDEX "transactions_projectId_timestamp_idx" ON "transactions"("projectId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_txHash_walletId_type_key" ON "transactions"("txHash", "walletId", "type");

-- CreateIndex
CREATE INDEX "alerts_projectId_idx" ON "alerts"("projectId");

-- CreateIndex
CREATE INDEX "alerts_walletId_idx" ON "alerts"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_telegramId_key" ON "admins"("telegramId");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_wallets" ADD CONSTRAINT "linked_wallets_parentWalletId_fkey" FOREIGN KEY ("parentWalletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_wallets" ADD CONSTRAINT "linked_wallets_childWalletId_fkey" FOREIGN KEY ("childWalletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_stats" ADD CONSTRAINT "wallet_stats_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

