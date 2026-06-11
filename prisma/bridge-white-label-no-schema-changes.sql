-- Bridge / Fix & Flip + White-Label Tenant Implementation + Schema Updates
-- Surfaced SQL (per finalized BRIDGE-APPLICATION-PLAN.md and user's answers)
--
-- Context:
-- - White-label / tenant branding: fully supported by existing `organizations` table columns.
--   No ALTERs needed for name, logo_url, primary_color, domain, from_email, mortgagee_clause (org-level),
--   raw_attrs, etc. Full platform conversion to server-side calls (headers() + supabaseAdmin) is a code task.
-- - Bridge feature: 4 product % values now in dedicated top-level `bridge_config` JSON column on loan_products
--   (user confirmed preference over nesting in pricing_matrix).
-- - Mortgagee per product: Add `mortgagee_clause` column to loan_products (input in product create/edit).
--   Used on loans/[id] for the selected product tab.
-- - New pages follow server-side tenant pattern (logo_url, primary_color, tenant name for most; + product mortgagee on loans/[id]).
-- - Selector at /loan-application (brand new). Rental form moved down. "Apply Now" CTAs updated to selector.
-- - Review page: tabs per bridge/fix-flip product (prefilled from product bridge_config + mortgagee), term sheet per tab,
--   approval → borrower signature → document requests from the specific product's requirements (products/id page).
--
-- Run this via:
-- 1. Admin /admin run-migrations UI (preferred for audit — yellow boxes will show the SQL).
-- 2. Or: npx prisma db push (for dev), then npx prisma generate.
-- 3. Then: In Supabase Dashboard → Database → Schema Cache → Reload Schema Cache
--    (or run: NOTIFY pgrst, 'reload schema'; )
-- 4. Always follow with clean restart from main tree only: pm2 delete loan-app-dev || true; rm -rf .next; pm2 start
--
-- After running: update the plan phases if any follow-up backfills or seeds are needed.

-- ============================================
-- VERIFICATION QUERIES (run these first)
-- ============================================

-- Confirm organizations table already has full white-label support
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'organizations'
  AND column_name IN ('name', 'logo_url', 'primary_color', 'domain', 'from_email', 
                      'mortgagee_clause', 'raw_attrs', 'base_rates', 'appraisal_fee_preset')
ORDER BY column_name;

-- Confirm current loan_products columns (pricing_matrix exists; we will add bridge_config + mortgagee_clause)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'loan_products' 
ORDER BY column_name;

-- Confirm loans has the fields we will reuse
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'loans' 
  AND column_name IN ('loan_type', 'purpose', 'organization_id', 'originator_id', 'loan_status', 'product_id');

-- ============================================
-- SCHEMA CHANGES (ALTERs)
-- ============================================

-- Add dedicated bridge_config JSON column for the 4 % values (initial_loan_pct, rehab_funded_pct, arv_ltv_pct, ltc_pct)
ALTER TABLE public.loan_products 
  ADD COLUMN IF NOT EXISTS bridge_config JSONB;

-- Add mortgagee_clause per product (for product create/edit settings and use on loans/[id] for selected product)
ALTER TABLE public.loan_products 
  ADD COLUMN IF NOT EXISTS mortgagee_clause TEXT;

-- Optional: add comments for documentation
COMMENT ON COLUMN loan_products.bridge_config IS 
'Dedicated JSON for bridge/fix-flip product settings (user-locked 4 % values):
{
  "initialLoanPct": 0.70,
  "rehabFundedPct": 0.90,
  "arvLtvPct": 0.75,
  "ltcPct": 0.80
}
These drive auto max-loan calculations on /bridge-application form and per-product term sheets on the review page.';

COMMENT ON COLUMN loan_products.mortgagee_clause IS 
'Per-product mortgagee clause (text). Added to product create/edit UI. Used on loans/[id] and bridge review for the selected product tab.';

COMMENT ON COLUMN loans.loan_type IS 
'Type of loan. Use values such as "purchase", "refinance", "bridge", "fix_and_flip" for the new combined bridge application flow.';

-- ============================================
-- NO OTHER STRUCTURAL CHANGES
-- ============================================
-- White-label fields on organizations are already present and sufficient.
-- No changes to organizations, loans (beyond reuse), or new tables.
-- Bridge multi-product tabs, signing, and document requests are code + flow changes (no DB schema impact beyond the two columns above).
--
-- If in the future we need indexes on bridge_config or additional fields, they can be added here.

-- End of surfaced SQL. Run, then prisma generate + schema cache reload + clean pm2 restart (main tree only).