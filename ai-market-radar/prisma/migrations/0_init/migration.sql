-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('RSS', 'BLOG', 'SITE', 'PAPER', 'GITHUB', 'PRODUCT_LAUNCH', 'OTHER');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('PENDING_ANALYSIS', 'ANALYZED', 'ERROR', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "Relevance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('NEWS', 'LAUNCH', 'RESEARCH', 'TOOL', 'INVESTMENT', 'REGULATION', 'PRODUCT_UPDATE', 'TREND', 'OPINION');

-- CreateEnum
CREATE TYPE "FetchStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "SourceType" NOT NULL DEFAULT 'RSS',
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fetchIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawExcerpt" TEXT,
    "rawContent" TEXT,
    "contentHash" TEXT NOT NULL,
    "language" TEXT,
    "localScore" INTEGER NOT NULL DEFAULT 0,
    "status" "ArticleStatus" NOT NULL DEFAULT 'PENDING_ANALYSIS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleAnalysis" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "relevance" "Relevance" NOT NULL DEFAULT 'MEDIUM',
    "articleType" "ArticleType" NOT NULL DEFAULT 'NEWS',
    "companies" TEXT[],
    "technologies" TEXT[],
    "keywords" TEXT[],
    "aiModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "keyword" TEXT,
    "company" TEXT,
    "category" TEXT,
    "minRelevance" "Relevance" NOT NULL DEFAULT 'LOW',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDigest" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topArticles" JSONB NOT NULL,
    "trends" JSONB NOT NULL,
    "companies" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "FetchStatus" NOT NULL DEFAULT 'RUNNING',
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "articlesFound" INTEGER NOT NULL DEFAULT 0,
    "articlesCreated" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");

-- CreateIndex
CREATE INDEX "Source_isActive_idx" ON "Source"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Article_canonicalUrl_key" ON "Article"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Article_sourceId_idx" ON "Article"("sourceId");

-- CreateIndex
CREATE INDEX "Article_contentHash_idx" ON "Article"("contentHash");

-- CreateIndex
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");

-- CreateIndex
CREATE INDEX "Article_status_idx" ON "Article"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleAnalysis_articleId_key" ON "ArticleAnalysis"("articleId");

-- CreateIndex
CREATE INDEX "Alert_isActive_idx" ON "Alert"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDigest_date_key" ON "DailyDigest"("date");

-- CreateIndex
CREATE INDEX "FetchLog_sourceId_idx" ON "FetchLog"("sourceId");

-- CreateIndex
CREATE INDEX "FetchLog_startedAt_idx" ON "FetchLog"("startedAt");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAnalysis" ADD CONSTRAINT "ArticleAnalysis_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchLog" ADD CONSTRAINT "FetchLog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

