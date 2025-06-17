/*
  Warnings:

  - The values [gender,preferences] on the enum `OnboardingStep` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `gender` on the `user_profiles` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OnboardingStep_new" AS ENUM ('age', 'name', 'categories', 'reading_time', 'voice', 'voice_demo', 'premium_trial', 'referral', 'completed');
ALTER TABLE "user_profiles" ALTER COLUMN "onboarding_step" DROP DEFAULT;
ALTER TABLE "user_profiles" ALTER COLUMN "onboarding_step" TYPE "OnboardingStep_new" USING ("onboarding_step"::text::"OnboardingStep_new");
ALTER TYPE "OnboardingStep" RENAME TO "OnboardingStep_old";
ALTER TYPE "OnboardingStep_new" RENAME TO "OnboardingStep";
DROP TYPE "OnboardingStep_old";
ALTER TABLE "user_profiles" ALTER COLUMN "onboarding_step" SET DEFAULT 'age';
COMMIT;

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "gender",
ALTER COLUMN "onboarding_step" SET DEFAULT 'age';

-- CreateTable
CREATE TABLE "user_voices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "voice_name" TEXT NOT NULL,
    "elevenlabs_voice_id" TEXT NOT NULL,
    "audio_file_url" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_voices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_voices_elevenlabs_voice_id_key" ON "user_voices"("elevenlabs_voice_id");

-- AddForeignKey
ALTER TABLE "user_voices" ADD CONSTRAINT "user_voices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
