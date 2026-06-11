-- SQL to add columns for document uploads and agreement in pending_organizations
-- ALSO creates/fixes support_tickets table with CORRECT column name: organization_id (matches profiles.organization_id etc.)
-- Run this in Supabase SQL Editor (as postgres or service_role if needed for ALTER)

ALTER TABLE public.pending_organizations
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS agreement_accepted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS documents JSONB;

-- Also ensure support_tickets table exists (for the support feature)
-- Use organization_id for the FK-like column (consistent naming across the app)
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

-- Robust migration: if an old table exists with 'org_id' (from earlier script), rename it to organization_id.
-- If neither exists, add the column. Safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'org_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'organization_id'
  ) THEN
    -- Rename the old column to the canonical name
    ALTER TABLE public.support_tickets RENAME COLUMN org_id TO organization_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'organization_id'
  ) THEN
    -- Table exists but column missing entirely (unlikely after CREATE, but for safety)
    ALTER TABLE public.support_tickets ADD COLUMN organization_id TEXT;
  END IF;
END $$;

-- Add indexes (IF NOT EXISTS is safe; old org_id index may linger but won't hurt queries)
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_organization_id ON public.support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);

-- Note: Enable RLS on support_tickets and add policies as per ensure-trigger.sql if not done.
-- IMPORTANT (per project): 
--   The DB parts (tables + columns) are above.
--   Buckets + storage policies are Storage (not regular Postgres tables) and must be created 
--   either via the Supabase Dashboard (Storage section) OR the SQL below.
--   The section below creates the two required buckets + working RLS policies.
--   Run the entire script (or just the bucket section if you already ran the top part).

-- ============================================================
-- STORAGE BUCKETS + POLICIES (required for document uploads)
-- ============================================================

-- Create the buckets (safe to re-run)
insert into storage.buckets (id, name, public, file_size_limit)
values 
  ('organization-documents', 'organization-documents', false, 52428800),   -- 50MB, private (use public URLs + policies)
  ('support-screenshots', 'support-screenshots', true, 10485760)          -- 10MB, public for easy screenshot viewing
on conflict (id) do nothing;

-- === Policies for organization-documents ===
-- Uploads in code go to paths like: org-<user-id>/operating-agreement/..., org-<user-id>/agreement/...
-- This restricts users to their own "org-<uid>/" folder.
-- Using DROP IF EXISTS + CREATE so the block is safe to re-run.

drop policy if exists "Users can upload to their own org folder in organization-documents" on storage.objects;
create policy "Users can upload to their own org folder in organization-documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'organization-documents' 
  and name like 'org-' || auth.uid() || '/%'
);

drop policy if exists "Public read for organization-documents (enables getPublicUrl for review)" on storage.objects;
create policy "Public read for organization-documents (enables getPublicUrl for review)"
on storage.objects for select
to public
using (bucket_id = 'organization-documents');

drop policy if exists "Users can update their own files in organization-documents" on storage.objects;
create policy "Users can update their own files in organization-documents"
on storage.objects for update
to authenticated
using (
  bucket_id = 'organization-documents' 
  and name like 'org-' || auth.uid() || '/%'
);

drop policy if exists "Users can delete their own files in organization-documents" on storage.objects;
create policy "Users can delete their own files in organization-documents"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'organization-documents' 
  and name like 'org-' || auth.uid() || '/%'
);

-- === Policies for support-screenshots ===
-- Uploads use filenames like: ticket-<user-id>-<timestamp>-random.ext
-- Any logged-in user can submit a ticket + screenshot.

drop policy if exists "Authenticated users can upload support screenshots" on storage.objects;
create policy "Authenticated users can upload support screenshots"
on storage.objects for insert
to authenticated
with check (bucket_id = 'support-screenshots');

drop policy if exists "Public can read support-screenshots (for support staff viewing)" on storage.objects;
create policy "Public can read support-screenshots (for support staff viewing)"
on storage.objects for select
to public
using (bucket_id = 'support-screenshots');

-- Optional: users can clean up their own screenshots
drop policy if exists "Users can delete their own support screenshots" on storage.objects;
create policy "Users can delete their own support screenshots"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'support-screenshots' 
  and (name like 'ticket-' || auth.uid() || '-%' or name like '%-' || auth.uid() || '-%')
);

-- After running: 
-- 1. Go to Storage in the dashboard and confirm the two buckets appear.
-- 2. (Optional) Test a small upload from the app.
-- 3. Database > Schema Cache > Reload if you haven't already.
-- Uploads will now succeed (previously they failed gracefully with "bucket does not exist").

-- ALTERNATIVE (recommended for convenience): In the running app, as SUPER_ADMIN go to /admin/applications
-- and click the new "Ensure Storage Buckets (organization-documents + support-screenshots)" button.
-- It uses the service role to create the buckets if missing (no need to run the INSERT manually). 
-- You still need the POLICY statements below for RLS (the CREATE POLICY parts).
