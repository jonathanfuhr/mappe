-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "mailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyByMail" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Notification_userId_mailedAt_idx" ON "Notification"("userId", "mailedAt");
