-- AlterTable: add descriptive metadata fields to wallets
ALTER TABLE "wallets"
  ADD COLUMN "twitterHandle" TEXT,
  ADD COLUMN "telegramHandle" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
