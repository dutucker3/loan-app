-- ============================================================================
-- Loan-App Full Schema Alignment SQL (CORRECTED)
-- This version FIRST adds all prerequisite columns (including hidden, is_root, parent_organization_id)
-- that the root org INSERT depends on.
--
-- Run this in Supabase SQL Editor (or via the /admin "Run Migrations" UI buttons if available).
--
-- It is safe to run multiple times (all use IF NOT EXISTS / ON CONFLICT).
--
-- The previous run failed because the root INSERT referenced "hidden" and "is_root"
-- before those columns existed in your DB.
-- ============================================================================

-- ============================================================
-- STEP 1: Ensure ALL organizations columns that have ever been added
--         (hierarchy, white-label, FRED, appraisal, mortgagee, etc.)
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id TEXT,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_root BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_rates JSONB,
  ADD COLUMN IF NOT EXISTS benchmark_treasury TEXT,
  ADD COLUMN IF NOT EXISTS appraisal_fee_preset NUMERIC(10,2) DEFAULT 900,
  ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS from_email TEXT,
  ADD COLUMN IF NOT EXISTS support_email TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_email TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_attrs JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_markup NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retail_markup NUMERIC(5,2) DEFAULT 0;

-- Helpful indexes (safe)
CREATE INDEX IF NOT EXISTS idx_organizations_parent ON public.organizations(parent_organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_referred_by ON public.organizations(referred_by);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON public.organizations(domain);
CREATE INDEX IF NOT EXISTS idx_organizations_from_email ON public.organizations(from_email);

-- ============================================================
-- STEP 2: Ensure loan_products columns (insurance_requirements etc.)
-- ============================================================
ALTER TABLE public.loan_products 
  ADD COLUMN IF NOT EXISTS insurance_requirements TEXT,
  ADD COLUMN IF NOT EXISTS retail_borrower_margin NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

-- ============================================================
-- STEP 3: Ensure loans columns (reggora + provider/mortgagee columns)
-- ============================================================
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS reggora_loan_id TEXT,
  ADD COLUMN IF NOT EXISTS reggora_order_id TEXT,
  ADD COLUMN IF NOT EXISTS reggora_status TEXT,
  ADD COLUMN IF NOT EXISTS reggora_fee_actual NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS title_company JSONB,
  ADD COLUMN IF NOT EXISTS insurance_company JSONB,
  ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT;

CREATE INDEX IF NOT EXISTS idx_loans_reggora_loan_id ON public.loans(reggora_loan_id);
CREATE INDEX IF NOT EXISTS idx_loans_reggora_order_id ON public.loans(reggora_order_id);
CREATE INDEX IF NOT EXISTS idx_loans_title_company ON public.loans USING GIN (title_company);
CREATE INDEX IF NOT EXISTS idx_loans_insurance_company ON public.loans USING GIN (insurance_company);

-- Comments for documentation
COMMENT ON COLUMN public.organizations.hidden IS 'Hides the root platform org from normal tenant lists and most UIs.';
COMMENT ON COLUMN public.organizations.is_root IS 'Marks the canonical Level-0 root "Loan-App Platform".';
COMMENT ON COLUMN public.organizations.mortgagee_clause IS 'Level 1 / parent org mortgagee wording. Copied to loans and included in automated title/insurance provider request emails.';
COMMENT ON COLUMN public.loan_products.insurance_requirements IS 'Free text requirements the L1 org wants the insurance carrier to meet.';
COMMENT ON COLUMN public.loans.title_company IS 'Captured at loan create: {name, phone, email, token?}. Used for provider magic links.';
COMMENT ON COLUMN public.loans.insurance_company IS 'Captured at loan create for the 3-file insurance upload portal.';

-- ============================================================
-- STEP 4: Ensure billing table exists (in case it was missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loan_billing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id BIGINT,
  organization_id TEXT,
  tenant_name TEXT,
  closed_at TIMESTAMPTZ DEFAULT now(),
  loan_amount NUMERIC(12,2),
  billed BOOLEAN DEFAULT false,
  bill_run_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_billing_org ON public.loan_billing_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_loan_billing_billed ON public.loan_billing_events(billed);

-- ============================================================
-- STEP 5: Ensure the SUPER_ADMIN profile for dustin@247sparkplug.com
-- ============================================================
INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
VALUES (
  '8acced8a-970b-4480-be3e-5c18c3e1f95a',
  'dustin@247sparkplug.com',
  'Dustin Tucker',
  'SUPER_ADMIN',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  role = 'SUPER_ADMIN',
  email = EXCLUDED.email,
  full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
  updated_at = now();

-- ============================================================
-- STEP 6: Create / repair the root "Loan-App Platform" org (now safe because columns exist)
-- ============================================================
INSERT INTO public.organizations (
  name,
  slug,
  parent_organization_id,
  hidden,
  is_root,
  approved,
  approved_at,
  active,
  primary_color,
  raw_attrs,
  created_at,
  updated_at
) VALUES (
  'Loan-App Platform',
  'loan-app-platform',
  NULL,
  true,   -- hidden
  true,   -- is_root
  true,
  now(),
  true,
  '#111827',
  '{"is_platform_root": true, "hidden_from_normal_lists": true}'::jsonb,
  now(),
  now()
)
ON CONFLICT (slug) DO UPDATE SET
  parent_organization_id = NULL,
  hidden = true,
  is_root = true,
  approved = true,
  approved_at = COALESCE(public.organizations.approved_at, now()),
  active = true,
  raw_attrs = COALESCE(public.organizations.raw_attrs, '{}'::jsonb) 
              || '{"is_platform_root": true, "hidden_from_normal_lists": true}'::jsonb,
  updated_at = now();

-- Backfill in case the org exists under a different slug or by name
UPDATE public.organizations
SET
  parent_organization_id = NULL,
  hidden = true,
  is_root = true,
  approved = true,
  active = true,
  updated_at = now()
WHERE name = 'Loan-App Platform' OR slug = 'loan-app-platform';

-- ============================================================
-- STEP 7: Link the superadmin profile to the root org (best effort)
-- ============================================================
DO $$
DECLARE
  v_root_id TEXT;
BEGIN
  SELECT id INTO v_root_id
  FROM public.organizations
  WHERE slug = 'loan-app-platform' OR name = 'Loan-App Platform'
  LIMIT 1;

  IF v_root_id IS NOT NULL THEN
    UPDATE public.profiles
    SET 
      organization_id = v_root_id,
      role = 'SUPER_ADMIN',
      updated_at = now()
    WHERE id = '8acced8a-970b-4480-be3e-5c18c3e1f95a'
       OR email = 'dustin@247sparkplug.com';
  END IF;
END $$;

-- ============================================================
-- AFTER RUNNING THIS SCRIPT:
--   1. Supabase Dashboard → Database → "Reload Schema Cache" (very important)
--      Alternative in SQL editor: NOTIFY pgrst, 'reload schema';
--   2. In your terminal (main /home/elijah/loan-app tree only):
--        npx prisma db pull
--        npx prisma generate
--   3. Clean restart: pm2 delete loan-app-dev || true; rm -rf .next; pm2 start
--   4. (Optional) Run prisma/cleanup-test-data-keep-superadmin.sql if you want to
--      delete all other test data while keeping only this root + superadmin.
--
-- This should now succeed because we add the columns before using them in the INSERT.
-- ============================================================================