-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- AlterEnum
ALTER TYPE "OnboardingStep" ADD VALUE 'gender';

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "gender" "Gender";
