-- AlterTable
ALTER TABLE "LaunchpadToken" ADD COLUMN     "address" TEXT,
ADD COLUMN     "socialsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "telegramUrl" TEXT,
ADD COLUMN     "twitterUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT;
