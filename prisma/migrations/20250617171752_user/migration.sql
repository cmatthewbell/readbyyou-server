-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('under_20', '20s', '30s', '40s', '50s', '60s', '70_and_above');

-- CreateEnum
CREATE TYPE "ReadingTime" AS ENUM ('less_than_15', '15_to_30', '30_to_60', '1_to_2_hours', '2_hours_plus');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('google_search', 'youtube', 'tiktok', 'facebook', 'instagram', 'other');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('gender', 'age', 'name', 'categories', 'preferences', 'completed');

-- CreateEnum
CREATE TYPE "BookCategory" AS ENUM ('romantasy', 'dark_romance', 'contemporary_romance', 'ya_fantasy', 'thriller_mystery', 'sad_girl_fiction', 'lgbtq_romance', 'classic_lit', 'cozy_mystery', 'sci_fi_dystopian', 'historical_romance', 'smut_spice', 'enemies_to_lovers', 'coming_of_age', 'fantasy_non_romantic');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gender" TEXT,
    "age_group" "AgeGroup",
    "first_name" TEXT,
    "book_categories" "BookCategory"[],
    "daily_reading_time" "ReadingTime",
    "referral_source" "ReferralSource",
    "onboarding_step" "OnboardingStep" NOT NULL DEFAULT 'gender',
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_id_key" ON "users"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
