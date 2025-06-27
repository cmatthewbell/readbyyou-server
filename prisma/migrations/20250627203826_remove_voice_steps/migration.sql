/*
  Warnings:

  - The values [voice,voice_demo] on the enum `OnboardingStep` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OnboardingStep_new" AS ENUM ('gender', 'age', 'name', 'categories', 'reading_time', 'reading_stat', 'notification_page', 'premium_trial', 'referral', 'completed');
ALTER TABLE "user_profiles" ALTER COLUMN "onboarding_step" DROP DEFAULT;
ALTER TABLE "user_profiles" ALTER COLUMN "onboarding_step" TYPE "OnboardingStep_new" USING ("onboarding_step"::text::"OnboardingStep_new");
ALTER TYPE "OnboardingStep" RENAME TO "OnboardingStep_old";
ALTER TYPE "OnboardingStep_new" RENAME TO "OnboardingStep";
DROP TYPE "OnboardingStep_old";
ALTER TABLE "user_profiles" ALTER COLUMN "onboarding_step" SET DEFAULT 'gender';
COMMIT;
