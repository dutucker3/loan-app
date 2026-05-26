-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'LOAN_UNDERWRITER', 'LOAN_PROCESSOR', 'SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'LENDING_SUPERVISOR', 'BROKER', 'BROKER_AE', 'BORROWER');

-- CreateTable
CREATE TABLE "documents" (
    "id" BIGSERIAL NOT NULL,
    "loan_id" BIGINT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "file_name" TEXT,
    "file_url" TEXT,
    "status" TEXT DEFAULT 'NEEDED',
    "xai_feedback" TEXT,
    "underwriter_notes" TEXT,
    "ae_comments" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" TEXT NOT NULL,
    "status" TEXT DEFAULT 'draft',
    "form_data" JSONB,
    "borrowers" JSONB,
    "selected_product_id" BIGINT,
    "pricing_result" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_documents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "loan_id" BIGINT,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "document_type" TEXT DEFAULT 'unlabeled',
    "uploaded_via" TEXT DEFAULT 'email',
    "uploaded_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_email_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "loan_id" BIGINT,
    "from_email" TEXT,
    "subject" TEXT,
    "analysis_summary" TEXT,
    "processed_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_products" (
    "id" TEXT NOT NULL DEFAULT ('prod_'::text || substr(md5((random())::text), 1, 8)),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "guidelines_url" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "pricing_matrix" JSONB,
    "active" BOOLEAN DEFAULT true,
    "organization_id" TEXT,
    "default_profit_percent" DECIMAL DEFAULT 1.0,

    CONSTRAINT "loan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" BIGSERIAL NOT NULL,
    "product_id" TEXT,
    "originator_id" TEXT NOT NULL,
    "borrower_name" TEXT,
    "property_address" TEXT NOT NULL,
    "loan_amount" DECIMAL(12,2),
    "loan_type" TEXT DEFAULT 'purchase',
    "status" TEXT DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "loan_status" TEXT DEFAULT 'Processing',
    "notes" TEXT,
    "purpose" TEXT,
    "property_type" TEXT,
    "amortization" TEXT,
    "processor_id" TEXT,
    "underwriter_id" TEXT,
    "organization_id" TEXT,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL DEFAULT ('org_'::text || substr(md5((random())::text), 1, 12)),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT DEFAULT '#000000',
    "domain" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "clerk_org_id" TEXT,
    "wholesale_markup" DECIMAL(5,2) DEFAULT 0,
    "retail_markup" DECIMAL(5,2) DEFAULT 0,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_organizations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "loan_volume_estimate" TEXT,
    "notes" TEXT,
    "status" TEXT DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "role" TEXT DEFAULT 'user',
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "full_name" TEXT,
    "role" TEXT DEFAULT 'BROKER_AE',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "parent_id" TEXT,
    "organization_id" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_markups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "broker_id" TEXT,
    "markup_type" TEXT NOT NULL,
    "value" DECIMAL(5,3) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pricing_markups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_documents_loan" ON "documents"("loan_id");

-- CreateIndex
CREATE INDEX "idx_documents_type" ON "documents"("doc_type");

-- CreateIndex
CREATE INDEX "idx_loan_applications_org" ON "loan_applications"("organization_id");

-- CreateIndex
CREATE INDEX "idx_loan_applications_status" ON "loan_applications"("status");

-- CreateIndex
CREATE INDEX "idx_loan_applications_user_id" ON "loan_applications"("user_id");

-- CreateIndex
CREATE INDEX "idx_loan_products_active" ON "loan_products"("active");

-- CreateIndex
CREATE INDEX "idx_loan_products_org" ON "loan_products"("organization_id");

-- CreateIndex
CREATE INDEX "idx_loans_originator" ON "loans"("originator_id");

-- CreateIndex
CREATE INDEX "idx_loans_product" ON "loans"("product_id");

-- CreateIndex
CREATE INDEX "loans_organization_id_idx" ON "loans"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_domain_key" ON "organizations"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_clerk_org_id_key" ON "organizations"("clerk_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_organizations_email_key" ON "pending_organizations"("email");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role");

-- CreateIndex
CREATE INDEX "pricing_markups_organization_id_broker_id_markup_type_idx" ON "pricing_markups"("organization_id", "broker_id", "markup_type");

-- CreateIndex
CREATE INDEX "pricing_markups_markup_type_idx" ON "pricing_markups"("markup_type");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_email_logs" ADD CONSTRAINT "loan_email_logs_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_products" ADD CONSTRAINT "loan_products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_markups" ADD CONSTRAINT "pricing_markups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_markups" ADD CONSTRAINT "pricing_markups_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
