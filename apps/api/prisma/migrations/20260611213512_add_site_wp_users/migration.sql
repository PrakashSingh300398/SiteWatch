-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "wp_users" JSONB NOT NULL DEFAULT '[]';
