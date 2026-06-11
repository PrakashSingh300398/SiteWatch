-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "digest_hour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "last_digest_at" TIMESTAMP(3);
