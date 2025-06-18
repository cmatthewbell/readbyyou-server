/*
  Warnings:

  - You are about to drop the column `audio_url` on the `books` table. All the data in the column will be lost.
  - You are about to drop the column `progress` on the `books` table. All the data in the column will be lost.
  - You are about to drop the column `total_duration` on the `books` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "books" DROP COLUMN "audio_url",
DROP COLUMN "progress",
DROP COLUMN "total_duration",
ADD COLUMN     "current_voice_id" TEXT,
ADD COLUMN     "text_content" TEXT[],
ADD COLUMN     "voice_progress" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "voice_versions" JSONB NOT NULL DEFAULT '[]';
