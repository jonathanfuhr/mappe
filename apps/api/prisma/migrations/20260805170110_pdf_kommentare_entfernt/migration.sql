/*
  Warnings:

  - You are about to drop the `PdfComment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PdfComment" DROP CONSTRAINT "PdfComment_documentId_fkey";

-- DropForeignKey
ALTER TABLE "PdfComment" DROP CONSTRAINT "PdfComment_userId_fkey";

-- DropTable
DROP TABLE "PdfComment";
