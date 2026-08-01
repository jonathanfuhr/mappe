-- CreateEnum
CREATE TYPE "InterviewKind" AS ENUM ('PERSOENLICH', 'TELEFON', 'VIDEO');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "InterviewKind" NOT NULL DEFAULT 'PERSOENLICH';
