-- ============================================================================
-- SAFE TEST DATA CLEANUP — Keep ONLY the root org + dustin@247sparkplug.com SUPER_ADMIN
--
-- !!! RUN THIS ONLY AFTER:
--   1. You have run prisma/apply-full-schema-updates.sql (or the equivalent ensure buttons)
--   2. You have done "Reload Schema Cache" in Supabase
--   3. You have done npx prisma db pull + npx prisma generate
--   4. You have a recent Supabase backup / export if you want to be extra safe
--
-- This script:
--   - Protects the "Loan-App Platform" root org (by slug)
--   - Protects the exact SUPER_ADMIN profile (by email + known id)
--   - Deletes in safe dependency order (children first)
--   - Does NOT touch auth.users (you cannot easily delete them without side effects;
--     the other test users will simply have no profile rows or will be ignored)
--
-- After this you can recreate L1 orgs, products, users, loans, etc. from scratch
-- while the superadmin + root remain as the stable anchor.
-- ============================================================================

-- 0) Show what we are about to protect (for your review)
SELECT '=== PROTECTED ROOT ORG ===' AS note;
SELECT id, name, slug, is_root, hidden, parent_organization_id
FROM public.organizations
WHERE slug = 'loan-app-platform' OR name = 'Loan-App Platform';

SELECT '=== PROTECTED SUPERADMIN PROFILE ===' AS note;
SELECT id, email, full_name, role, organization_id
FROM public.profiles
WHERE email = 'dustin@247sparkplug.com'
   OR id = '8acced8a-970b-4480-be3e-5c18c3e1f95a';

-- 1) Delete leaf tables first (documents, logs, billing events, loans)
DELETE FROM public.documents
WHERE loan_id IN (
  SELECT l.id FROM public.loans l
  WHERE l.organization_id NOT IN (
    SELECT o.id FROM public.organizations o WHERE o.slug = 'loan-app-platform' OR o.name = 'Loan-App Platform'
  )
);

DELETE FROM public.loan_documents
WHERE loan_id IN (
  SELECT l.id FROM public.loans l
  JOIN public.organizations o ON l.organization_id = o.id
  WHERE o.slug <> 'loan-app-platform' AND o.name <> 'Loan-App Platform'
);

DELETE FROM public.loan_email_logs
WHERE loan_id IN (
  SELECT l.id FROM public.loans l
  JOIN public.organizations o ON l.organization_id = o.id
  WHERE o.slug <> 'loan-app-platform' AND o.name <> 'Loan-App Platform'
);

DELETE FROM public.loan_billing_events
WHERE organization_id NOT IN (
  SELECT id FROM public.organizations WHERE slug = 'loan-app-platform' OR name = 'Loan-App Platform'
);

DELETE FROM public.loans
WHERE organization_id NOT IN (
  SELECT id FROM public.organizations WHERE slug = 'loan-app-platform' OR name = 'Loan-App Platform'
);

-- 2) Delete products that are not owned by the protected root (or any you want to keep)
--    If you created products under the root, they will be kept.
DELETE FROM public.loan_products
WHERE organization_id NOT IN (
  SELECT id FROM public.organizations WHERE slug = 'loan-app-platform' OR name = 'Loan-App Platform'
);

-- 3) Delete other organizations (children first — this will cascade or be blocked by FKs depending on your setup)
--    We delete non-root orgs.
DELETE FROM public.organizations
WHERE slug <> 'loan-app-platform'
  AND name <> 'Loan-App Platform';

-- 4) Delete profiles except the protected superadmin
DELETE FROM public.profiles
WHERE email <> 'dustin@247sparkplug.com'
  AND id <> '8acced8a-970b-4480-be3e-5c18c3e1f95a';

-- 5) Clean up pending stuff and other test tables (safe to truncate most of these)
DELETE FROM public.pending_organizations;
DELETE FROM public.pending_brokers;
DELETE FROM public.support_tickets;   -- or keep if you want test tickets
DELETE FROM public.audit_logs;        -- audit is historical; delete if you want a fresh start

-- 6) Optional: also clear application drafts etc.
DELETE FROM public.loan_applications;

-- Final verification
SELECT '=== AFTER CLEANUP - SHOULD ONLY SEE ROOT + DUSTIN ===' AS note;
SELECT id, name, slug, is_root, hidden FROM public.organizations ORDER BY created_at;
SELECT id, email, full_name, role, organization_id FROM public.profiles ORDER BY created_at;

-- After this, log in as dustin@247sparkplug.com (SUPER_ADMIN).
-- You can now recreate organizations, products, users, etc. through the normal flows.
-- The root org + this superadmin will be the stable foundation.
