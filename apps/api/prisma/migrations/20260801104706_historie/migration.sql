-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ANGELEGT', 'PHASE_GEAENDERT', 'MAIL_EIN', 'MAIL_AUS', 'GESPRAECH_ANGELEGT', 'GESPRAECH_ABGESCHLOSSEN', 'GESPRAECH_WIEDER_GEOEFFNET', 'BEWERTUNG', 'NOTIZ', 'DOKUMENT', 'VORSCHLAG_UEBERNOMMEN', 'ZUGEWIESEN');

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "type" "EventType" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
