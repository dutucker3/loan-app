'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';

// Support tickets ensure (with robust column migration for org_id -> organization_id)
export async function ensureSupportTicketsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS public.support_tickets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id TEXT NOT NULL,
      organization_id TEXT,
      page_url TEXT,
      description TEXT NOT NULL,
      screenshot_urls JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'open',
      assigned_to TEXT,
      responses JSONB DEFAULT '[]'::jsonb,
      category TEXT,
      summary TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    -- Robust migration for prior 'org_id' column (from earlier versions of this script)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'org_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE public.support_tickets RENAME COLUMN org_id TO organization_id;
      ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE public.support_tickets ADD COLUMN organization_id TEXT;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_organization_id ON public.support_tickets(organization_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
  `;
  try {
    const { error } = await supabaseAdmin.rpc('exec', { query: sql });
    if (error) {
      return { success: false, error: "Run SQL manually: " + sql, sql };
    }
    return { success: true, message: "Support tickets table ensured." };
  } catch (err: any) {
    return { success: false, error: err.message, sql };
  }
}

export async function ensureDocumentColumns() {
  try {
    const docsSql = `
      ALTER TABLE public.pending_organizations
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS city TEXT,
        ADD COLUMN IF NOT EXISTS state TEXT,
        ADD COLUMN IF NOT EXISTS zip TEXT,
        ADD COLUMN IF NOT EXISTS agreement_accepted BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS documents JSONB,
        ADD COLUMN IF NOT EXISTS referred_by UUID;
    `;
    const { error: docsErr } = await supabaseAdmin.rpc('exec', { query: docsSql });
    if (docsErr) {
      return { 
        success: false, 
        error: "Run this SQL manually in Supabase SQL Editor: " + docsSql,
        sql: docsSql 
      };
    }

    // Also ensure support_tickets (re-uses the robust implementation)
    const supportRes = await ensureSupportTicketsTable();
    if (!supportRes.success) {
      return {
        success: false,
        error: "Docs columns ok, but support table: " + (supportRes.error || 'failed'),
        sql: supportRes.sql
      };
    }

    return { success: true, message: "Document columns + support_tickets table ensured." };
  } catch (err: any) {
    return { 
      success: false, 
      error: "Migration error: " + err.message,
      sql: `ALTER TABLE public.pending_organizations ADD COLUMN IF NOT EXISTS address TEXT, ... (see script) plus support_tickets SQL` 
    };
  }
}

/**
 * Ensure the known SUPER_ADMIN (dustin) has a row in profiles with the correct role.
 * This fixes 401/403 on admin pages and the users 404 fallbacks after the pure Supabase-auth migration.
 * Uses the same "return full SQL on rpc failure" pattern as the other ensure helpers.
 */
export async function ensureSuperAdminProfile() {
  const adminId = '8acced8a-970b-4480-be3e-5c18c3e1f95a';
  const adminEmail = 'dustin@247sparkplug.com';
  const adminName = 'Dustin Tucker';

  const profileSql = `
    INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
    VALUES (
      '${adminId}',
      '${adminEmail}',
      '${adminName}',
      'SUPER_ADMIN',
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      role = 'SUPER_ADMIN',
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      updated_at = now();
  `;

  // Also ensure organizations has the white-label columns that create-organization.ts and admin orgs UI rely on.
  // These are often added after initial setup; without them or without cache reload you get "column not in schema cache".
  const orgColumnsSql = `
    ALTER TABLE public.organizations
      ADD COLUMN IF NOT EXISTS domain text,
      ADD COLUMN IF NOT EXISTS from_email text,
      ADD COLUMN IF NOT EXISTS support_email text,
      ADD COLUMN IF NOT EXISTS reply_to_email text,
      ADD COLUMN IF NOT EXISTS custom_domain_verified boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS raw_attrs jsonb DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS approved boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS approved_at timestamptz,
      ADD COLUMN IF NOT EXISTS approved_by text,
      ADD COLUMN IF NOT EXISTS wholesale_markup numeric(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS retail_markup numeric(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS referred_by UUID;

    -- Helpful indexes (safe)
    CREATE INDEX IF NOT EXISTS idx_organizations_domain ON public.organizations(domain);
    CREATE INDEX IF NOT EXISTS idx_organizations_from_email ON public.organizations(from_email);
  `;

  const combinedSql = `-- 1) Fix SUPER_ADMIN profile (the previous error was missing updated_at)\n${profileSql}\n\n-- 2) Ensure organizations white-label columns (from_email etc. for approve + admin/organizations UI)\n${orgColumnsSql}\n\n-- 3) AFTER RUNNING: In Supabase Dashboard go to Database > Schema Cache > click "Reload" (or run: NOTIFY pgrst, 'reload schema';)\n-- 4) Then hard-refresh /admin/applications and try Approve again.`;

  try {
    const { error } = await supabaseAdmin.rpc('exec', { query: combinedSql });
    if (error) {
      return {
        success: false,
        error: 'RPC exec not available or failed. Run the SQL below manually in Supabase SQL Editor, then Reload Schema Cache, then hard refresh the page.',
        sql: combinedSql
      };
    }
    return { success: true, message: 'SUPER_ADMIN profile + organizations columns ensured. Reload schema cache if needed and refresh.' };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to ensure',
      sql: combinedSql
    };
  }
}

/**
 * Ensure Reggora appraisal columns on loans (loan_id, order_id, status, actual fee for presets/refunds).
 * Also org-level preset fee (default $900). Idempotent.
 * This fixes "column does not exist" errors.
 */
export async function ensureReggoraColumns() {
  const reggoraSql = `
    -- Core Reggora columns (loan correlation + order lifecycle)
    ALTER TABLE public.loans
      ADD COLUMN IF NOT EXISTS reggora_loan_id TEXT,
      ADD COLUMN IF NOT EXISTS reggora_order_id TEXT,
      ADD COLUMN IF NOT EXISTS reggora_status TEXT,
      ADD COLUMN IF NOT EXISTS reggora_fee_actual NUMERIC(10,2);

    CREATE INDEX IF NOT EXISTS idx_loans_reggora_loan_id ON public.loans(reggora_loan_id);
    CREATE INDEX IF NOT EXISTS idx_loans_reggora_order_id ON public.loans(reggora_order_id);

    -- Org-level preset for appraisal fees (used for white-label preset + refund logic)
    ALTER TABLE public.organizations
      ADD COLUMN IF NOT EXISTS appraisal_fee_preset NUMERIC(10,2) DEFAULT 900;

    -- Helpful for webhook event logging if you want a dedicated table later (uses audit_logs for now)
  `;

  const combinedSql = `-- Reggora appraisal integration columns\n${reggoraSql}\n\n-- AFTER RUNNING: In Supabase Dashboard go to Database > Schema Cache > click "Reload" (or run: NOTIFY pgrst, 'reload schema';)\n-- Then hard-refresh the appraisals pages and try ordering again.`;

  try {
    const { error } = await supabaseAdmin.rpc('exec', { query: combinedSql });
    if (error) {
      return {
        success: false,
        error: 'RPC exec not available or failed. Run the SQL below manually in Supabase SQL Editor, then Reload Schema Cache, then hard refresh.',
        sql: combinedSql
      };
    }
    return { success: true, message: 'Reggora columns + org preset ensured. Reload schema cache and refresh.' };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to ensure Reggora columns',
      sql: combinedSql
    };
  }
}

/**
 * Ensure the required Storage buckets exist for document uploads (organization-documents)
 * and support screenshots. Uses service role so it works even if RLS or permissions are strict.
 * Safe to call multiple times.
 */
export async function ensureStorageBuckets() {
  if (!supabaseAdmin) {
    return { success: false, error: 'SUPABASE_SECRET_KEY not configured' };
  }

  const buckets = [
    { id: 'organization-documents', public: false, fileSizeLimit: 52428800 }, // 50MB
    { id: 'support-screenshots', public: true, fileSizeLimit: 10485760 },     // 10MB
  ];

  const results: Array<{ id: string; status: string; error?: string }> = [];

  try {
    const { data: existingBuckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
    if (listErr) {
      return { success: false, error: 'Failed to list buckets: ' + listErr.message };
    }

    for (const b of buckets) {
      const exists = existingBuckets?.some((eb: any) => eb.id === b.id || eb.name === b.id);
      if (exists) {
        results.push({ id: b.id, status: 'exists' });
        continue;
      }

      const { data, error } = await supabaseAdmin.storage.createBucket(b.id, {
        public: b.public,
        fileSizeLimit: b.fileSizeLimit,
      });

      if (error) {
        // If it says already exists (race), treat as ok
        if (error.message?.toLowerCase().includes('already exists') || error.message?.includes('duplicate')) {
          results.push({ id: b.id, status: 'exists' });
        } else {
          results.push({ id: b.id, status: 'error', error: error.message });
        }
      } else {
        results.push({ id: b.id, status: 'created' });
      }
    }

    return { success: true, results };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to ensure buckets' };
  }
}

/**
 * COMPREHENSIVE FINAL SCHEMA MIGRATION
 * Aggregates ALL from conversation + prior subagents:
 * - parent_organization_id on organizations + pending_organizations
 * - referred_by on both
 * - retail_borrower_margin + owner_user_id on loan_products
 * - audit_logs table + its indexes
 * - hidden flag on organizations (for root)
 * - ORG_ADMIN (text role, no DB enum constraint needed)
 * - backfills for root org (hidden=true, parent=null, raw_attrs)
 * - existing data migration for parents/levels (set orphaned top orgs to root)
 * - indexes for new cols + all audit
 * - also bundles prior doc columns, support_tickets robust, org white-label cols for single idempotent run
 *
 * This is the final "catch-all" script. Idempotent (IF NOT EXISTS, ON CONFLICT, DO $$).
 * Call from admin UI or run the returned SQL manually.
 *
 * UPDATED POLICY (per request): Direct `npx prisma db push` + `npx prisma migrate deploy`
 * are now allowed and preferred for routine dev on the main code tree.
 * Use this SQL path primarily for RLS, complex data migrations, Supabase-specific
 * objects, or when you want the exact SQL surfaced/audited in the admin UI.
 *
 * Mandatory after schema change (whether via Prisma command or this SQL):
 *   1. npx prisma generate
 *   2. Supabase Dashboard → Database → Schema Cache → Reload (or NOTIFY pgrst, 'reload schema';)
 *   3. Clean pm2 restart (rm -rf .next etc.)
 */
export async function ensureComprehensiveFinalSchema() {
  const sql = `
-- ============================================================
-- COMPREHENSIVE FINAL SQL SCRIPT: Loan-App Hierarchy + Audit + Margins + Root + Mortgagee/Billing
-- Generated for worktree; run in Supabase SQL Editor (recommended) or via rpc exec.
-- Aggregates: parent_organization_id (orgs+pending), referred_by, 
-- retail_borrower_margin + owner_user_id (loan_products), audit_logs table,
-- ORG_ADMIN support (text), hidden + is_root flags on orgs, root "Loan-App Platform" INSERT,
-- backfills, existing data parents/levels migration, all indexes + prior schema bits.
-- Includes mortgagee/insurance columns + loan_billing_events table to match current prisma/schema.prisma.
-- Idempotent & safe to re-run.
-- ============================================================

-- 0. (Assume extensions like uuid_generate_v4 exist; they do from prior setup)

-- 1. Organizations: hierarchy parent, referred_by, hidden flag (for root hiding), + all white-label/approval from history
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id TEXT,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_root BOOLEAN DEFAULT false,
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
  ADD COLUMN IF NOT EXISTS retail_markup NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pass_credit_report_costs_to_borrower BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_report_cost_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS benchmark_treasury TEXT;

-- Org indexes (safe)
CREATE INDEX IF NOT EXISTS idx_organizations_parent ON public.organizations(parent_organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_referred_by ON public.organizations(referred_by);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON public.organizations(domain);
CREATE INDEX IF NOT EXISTS idx_organizations_from_email ON public.organizations(from_email);

-- 2. Pending organizations: parent for L2 sponsorship, referred_by (AE), + prior doc/agreement columns
ALTER TABLE public.pending_organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id TEXT,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS agreement_accepted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS documents JSONB,
  ADD COLUMN IF NOT EXISTS owners JSONB,
  ADD COLUMN IF NOT EXISTS managers JSONB,
  ADD COLUMN IF NOT EXISTS additional_users JSONB,
  ADD COLUMN IF NOT EXISTS products_offered JSONB;

CREATE INDEX IF NOT EXISTS idx_pending_organizations_parent ON public.pending_organizations(parent_organization_id);
CREATE INDEX IF NOT EXISTS idx_pending_organizations_referred_by ON public.pending_organizations(referred_by);

-- 3. Loan products: retail borrower margin (for L2 own products) + owner_user_id (for private/hidden L2 products)
ALTER TABLE public.loan_products
  ADD COLUMN IF NOT EXISTS retail_borrower_margin NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_loan_products_owner ON public.loan_products(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_loan_products_retail_borrower_margin ON public.loan_products(retail_borrower_margin);
CREATE INDEX IF NOT EXISTS idx_loan_products_org ON public.loan_products(organization_id);

-- 4. Create audit_logs table (for security/ops traceability, used by lib/audit.ts + /admin/audit UI)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  organization_id TEXT,
  action TEXT NOT NULL,           -- e.g. 'user_deleted', 'loan_status_changed', 'product_base_rates_rebased', 'organization_approved', 'ae_referral_assigned', 'page_visit'
  resource_type TEXT NOT NULL,    -- e.g. 'user', 'loan', 'document', 'product', 'organization', 'page'
  resource_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON public.audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON public.audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at);

-- 5. Support tickets (robust, from prior migration scripts; includes org_id rename safety)
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  organization_id TEXT,
  page_url TEXT,
  description TEXT NOT NULL,
  screenshot_urls JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'open',
  assigned_to TEXT,
  responses JSONB DEFAULT '[]'::jsonb,
  category TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

/* 
  The following large block of raw SQL (hierarchy backfills, comments, ALTERs, etc.) 
  was previously at top-level in this .ts file, which caused the TS/SWC parser to fail 
  ("Expected a semicolon", backticks in comments, etc.) because -- is not a JS comment 
  and bare SQL is not valid TS.

  This block is intended for one-time manual execution in the Supabase SQL Editor 
  (as noted in the "NEXT STEPS" comments). The UI buttons in /admin/applications call 
  the properly encapsulated ensure* functions defined earlier in this file.

  Wrapping the loose block in a TS comment fixes the build error while preserving the content.
*/
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'org_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE public.support_tickets RENAME COLUMN org_id TO organization_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE public.support_tickets ADD COLUMN organization_id TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_organization_id ON public.support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);

-- 6. INSERT root "Loan-App Platform" (Level 0) with hidden flag. Idempotent via ON CONFLICT on unique slug.
-- All L1 orgs will have parent_organization_id = this root's id.
-- L2 point to their L1 sponsor.
-- Root + hidden orgs are filtered from normal lists (see dashboard, admin/orgs, products pages using name + parent null + now hidden).
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
  true,  -- <-- the hidden flag
  true,  -- <-- root platform flag
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
  raw_attrs = COALESCE(public.organizations.raw_attrs, '{}'::jsonb) || '{"is_platform_root": true, "hidden_from_normal_lists": true}'::jsonb,
  updated_at = now();

-- Extra safety backfill for root by name (in case slug unique not hit or manual inserts)
UPDATE public.organizations
SET
  parent_organization_id = NULL,
  hidden = true,
  is_root = true,
  approved = true,
  active = true,
  updated_at = now()
WHERE name = 'Loan-App Platform';

-- 7. Backfills for root + existing data migration for parents/levels
-- If prior orgs existed without parents (pre-hierarchy), promote them under root as L1s.
-- Referred_by backfills from raw_attrs where present (synced on approve).
-- Pending referred/parent already populated by apply form + AE invite.
DO $$
DECLARE
  v_root_id TEXT;
BEGIN
  SELECT id INTO v_root_id 
  FROM public.organizations 
  WHERE name = 'Loan-App Platform' OR slug = 'loan-app-platform' 
  LIMIT 1;

  IF v_root_id IS NOT NULL THEN
    -- Data migration: existing top-level (no parent) approved orgs -> children of root (L1s)
    -- Skip root itself. This makes hierarchy queries (parentMap) work for pre-existing data.
    UPDATE public.organizations
    SET parent_organization_id = v_root_id,
        is_root = false
    WHERE parent_organization_id IS NULL
      AND id <> v_root_id;

    -- Ensure the root has is_root = true
    UPDATE public.organizations
    SET is_root = true
    WHERE id = v_root_id;

    -- Backfill referred_by on orgs from raw_attrs (AE who referred)
    UPDATE public.organizations
    SET referred_by = (raw_attrs ->> 'referred_by')
    WHERE referred_by IS NULL
      AND raw_attrs IS NOT NULL
      AND (raw_attrs ->> 'referred_by') IS NOT NULL;

    -- Backfill for pending if any old data in other json fields (defensive; apply form sets directly)
    UPDATE public.pending_organizations
    SET referred_by = COALESCE(referred_by, (documents ->> 'referred_by')::text)
    WHERE referred_by IS NULL
      AND documents IS NOT NULL
      AND (documents ->> 'referred_by') IS NOT NULL;

    -- Ensure root raw_attrs has the hidden marker for any code that inspects it
    UPDATE public.organizations
    SET raw_attrs = COALESCE(raw_attrs, '{}'::jsonb) || '{"is_platform_root":true,"hidden_from_normal_lists":true}'::jsonb
    WHERE id = v_root_id;
  END IF;
END $$;

-- 8. Product margin backfills for existing rows (default 0)
UPDATE public.loan_products
SET retail_borrower_margin = COALESCE(retail_borrower_margin, 0)
WHERE retail_borrower_margin IS NULL;

-- 9. Documentation comments (visible in Supabase / psql)
COMMENT ON COLUMN public.organizations.parent_organization_id IS 
  'Hierarchy (Level 0/1/2 white-label): NULL for root "Loan-App Platform" (Level 0). Level 1 (sponsors) point to root id. Level 2 (brokers under sponsor) point to their Level 1 parent id. Rules: L2 sees own products + parent''s; parents NEVER see L2 child''s own products (hidden upward). Used in permissions.ts, products visibility, loans/new, dashboard.';
COMMENT ON COLUMN public.organizations.hidden IS 
  'Hidden flag for root platform org (and potentially others). UI lists filter by name=''Loan-App Platform'' OR parent IS NULL OR hidden=true. Root is only visible in special super views.';
COMMENT ON COLUMN public.organizations.is_root IS 
  'Marks the canonical root "Loan-App Platform" (Level 0). Used in white-label logic to special-case root home branding vs full tenant override on child pages. Child pages always use org-specific branding.';
COMMENT ON COLUMN public.organizations.referred_by IS 
  'AE user id (SENIOR_ACCOUNT_EXECUTIVE or ACCOUNT_EXECUTIVE) who referred/ invited this org (synced from pending.referred_by on approve). Powers AE dashboards + referral tracking.';
COMMENT ON COLUMN public.pending_organizations.parent_organization_id IS 
  'For Level 2 applicants: the chosen Level 1 sponsor org id (from listLevelOneSponsors). Level 1 applicants: null (will parent to root on approve).';
COMMENT ON COLUMN public.pending_organizations.referred_by IS 
  'AE user id captured from ?referred_by= query param (AE invite link) or form. Copied to organization on approve.';
COMMENT ON COLUMN public.loan_products.retail_borrower_margin IS 
  'Retail margin (e.g. 0.25 for 0.25%) applied/subtracted ONLY when Level 2 BROKER_AE uses their *own* (owner_user_id set) private product in pricing (loans/new). Inherited parent products use this for display but margin set by L2 affects only when they originate retail.';
COMMENT ON COLUMN public.loan_products.owner_user_id IS 
  'If set (by L2 BROKER_AE on create/copy), this product is private/hidden from upward hierarchy (L1/parent users see only owner=null products). L2 sees own + parent''s. null = org-visible (inherited down). Powers filterVisibleProductsWithOwner + margin bulk UI.';
COMMENT ON TABLE public.audit_logs IS 
  'Audit trail (immutable ops log). Actions include user/org/loan/product mutations, AE invites, assignments, margin changes, status, deletes, and page_visit. Written via service_role in lib/audit.ts (never client). /admin/audit UI for SUPER/ORG_ADMIN (scoped).';

-- ============================================================
-- END OF SCRIPT
-- NEXT STEPS (after running):
--   1. In Supabase Dashboard: Database (left) > Schema Cache > "Reload Schema Cache"
--      Alternative: run   NOTIFY pgrst, 'reload schema';
--   2. Hard-refresh browser on /admin/* pages (or restart Next if local dev).
--   3. Run 'npx prisma generate' (in main tree after cp) to align Prisma client with schema.
--   4. In app admin (/admin/applications), the "Ensure Comprehensive..." button (if wired)
--      or manually test: ensure root exists, L1/L2 hierarchy in org create/apply, products margins,
--      audit logs populate on actions, ORG_ADMIN scoping, DSCR etc.
--   5. Verify with SELECT * FROM organizations WHERE name='Loan-App Platform'; (hidden should be true, is_root true)
--   6. For pre-existing data, the backfill DO block above will have promoted them under root.
-- ============================================================

-- ============================================================
-- MORTGAGEE / TITLE / INSURANCE PROVIDER COLUMNS (for automated document requests)
-- Added when Level-1 orgs specify mortgagee_clause + products carry insurance_requirements
-- Loans capture title_company (jsonb {name,phone,email,token?}), insurance_company, and a snapshot of mortgagee_clause
-- Run this block (or the full script) then Reload Schema Cache.
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT;

ALTER TABLE public.loan_products
  ADD COLUMN IF NOT EXISTS insurance_requirements TEXT;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS title_company JSONB,
  ADD COLUMN IF NOT EXISTS insurance_company JSONB,
  ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT;

CREATE INDEX IF NOT EXISTS idx_loans_title_company ON public.loans USING GIN (title_company);
CREATE INDEX IF NOT EXISTS idx_loans_insurance_company ON public.loans USING GIN (insurance_company);

COMMENT ON COLUMN public.organizations.mortgagee_clause IS 'Level 1 / parent org mortgagee wording. Copied to loans and included in automated title/insurance provider request emails.';
COMMENT ON COLUMN public.loan_products.insurance_requirements IS 'Free text requirements the L1 org wants the insurance carrier to meet. Included verbatim in the insurance provider email.';
COMMENT ON COLUMN public.loans.title_company IS 'Captured at loan create: {name, phone, email, token?}. Token is added server-side when the request email is sent. Used to power /providers/title/[loanId]?token=...';
COMMENT ON COLUMN public.loans.insurance_company IS 'Captured at loan create: {name, phone, email, token?}. Powers the 3-file insurance upload portal.';

-- Billing for root admin: track closed loans per tenant for 1st/15th ACH billing
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
COMMENT ON TABLE public.loan_billing_events IS 'Records closed loans for tenant billing (root admin). Populated when loan marked Closed and Funded. Used for 1st/15th ACH runs + invoice emails.';
`;

  try {
    const { error } = await supabaseAdmin.rpc('exec', { query: sql });
    if (error) {
      return {
        success: false,
        error: 'RPC exec not available or failed. Run the SQL below manually in Supabase SQL Editor, then Reload Schema Cache, then hard refresh pages.',
        sql
      };
    }
    return {
      success: true,
      message: 'Comprehensive final schema (hierarchy, margins, audit, root, mortgagee/insurance columns, loan_billing_events, is_root, backfills, indexes + Prisma model alignment) ensured. IMPORTANT: Reload Schema Cache in Supabase now, then npx prisma generate, then test flows.'
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to run comprehensive schema ensure',
      sql
    };
  }
}

// Focused migration for just the mortgagee/title/insurance provider request feature.
// Call this (or the big comprehensive one) from admin run-migrations UI.
export async function ensureProviderRequestColumns() {
  const sql = `
-- Mortgagee clause (org level) + insurance requirements (per product)
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT;

ALTER TABLE public.loan_products ADD COLUMN IF NOT EXISTS insurance_requirements TEXT;

-- Per-loan capture of the two external contacts + snapshot of the clause
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS title_company JSONB,
  ADD COLUMN IF NOT EXISTS insurance_company JSONB,
  ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT;

CREATE INDEX IF NOT EXISTS idx_loans_title_company ON public.loans USING GIN (title_company);
CREATE INDEX IF NOT EXISTS idx_loans_insurance_company ON public.loans USING GIN (insurance_company);

COMMENT ON COLUMN public.loans.title_company IS 'External title company contact captured on loan create for magic-link automation: {name,phone,email,token?}';
COMMENT ON COLUMN public.loans.insurance_company IS 'External insurance contact + token for the 3 required uploads (Invoice, COI, Declarations).';
  `;

  try {
    const { error } = await supabaseAdmin.rpc('exec', { query: sql });
    if (error) {
      return { success: false, error: 'Run this SQL manually: ' + sql, sql };
    }
    return {
      success: true,
      message: 'Provider request columns (mortgagee_clause, insurance_requirements, title_company/insurance_company/mortgagee on loans) ensured. Reload Schema Cache now.',
      sql,
    };
  } catch (err: any) {
    return { success: false, error: err.message, sql };
  }
}
