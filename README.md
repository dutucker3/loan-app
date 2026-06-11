# Loan Application Platform

A modern white-label mortgage/DSCR loan origination system built with Next.js 16, Supabase, and Clerk.

## Current Status (May 12, 2026)

**Phase 1 (Multi-Tenancy + White-Labeling) - In Progress**

### What has been completed:
- Standardized pricing matrix CSV upload system (Base Rate, DSCR, FICO, Loan Balance, etc.)
- Robust `PricingTableEditor` with proper key mapping (`baseRates`, `dscrLtvGrid`, `ficoLtvGrid`, etc.)
- Dynamic pricing engine on `/loans/new` with debug panel
- Active/Inactive toggle, product management, and save functionality restored
- CSV parser that handles commas in quoted fields and parentheses for negative numbers

### Next Goal - Phase 1:
- Full multi-tenancy using Clerk Organizations
- Custom domain support (CNAME + middleware)
- White-label UI per lender (logo, colors, company name)
- Link existing products and applications to organizations

### Key Files to Focus On:
- `app/products/page.tsx` → Main product & pricing editor
- `app/loans/new/page.tsx` → Dynamic pricing grid + calculations
- `lib/tenant-context.tsx` (new)
- `middleware.ts` (new)

### How to Continue:
When starting a new conversation with Grok, please paste:
> "Continuing our loan app project: https://github.com/dutucker3/loan-app.git  
> Latest commit: [paste latest commit message]  
> We are implementing Phase 1 multi-tenancy and white-labeling."

---

**Current Branch Recommendation**: `feature/white-label-phase1`

Let me know when you've pushed the code, and we'll continue cleanly in the next session.


This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Reggora Appraisals Integration (Sandbox)

An "Appraisals" tab was added to `/app/dashboard` (visible to ADMIN/SUPER_ADMIN/LENDING_SUPERVISOR+ roles, modeled after the Products tab).

- Lists live orders from Reggora Lender API.
- Form to select local loan + Reggora products + due/priority/allocation/vendors/fees.
- On submit: calls server action to `createReggoraLoan` (maps address/borrower/loan# etc, using basic /lender/loan), persists `reggora_loan_id` (or notes fallback), then `createReggoraOrder` using the returned ID.
- Uses exact headers: `Authorization: Bearer $REGGORA_AUTH_TOKEN` + `integration: $REGGORA_INTEGRATION_KEY`.
- Server actions live in `app/actions/reggora.ts` (all 'use server').
- Prisma: added optional `reggora_loan_id String?` to `loans` model.

**To enable:**
1. Get sandbox credentials from Reggora (auth token + integration key for your lender integration).
2. Set in your environment (`.env.local` or equivalent):
   ```
   REGGORA_AUTH_TOKEN=your_sandbox_bearer_token_here
   REGGORA_INTEGRATION_KEY=your_integration_key_here
   ```
3. **Restart the dev server using pm2 discipline** (do not use `npm run dev` directly if the team uses pm2):
   - `pm2 list` to see your app process name (e.g. `loan-app` or from ecosystem.config).
   - `pm2 delete <name>` (or `pm2 stop <name>`)
   - `pm2 start "npm run dev" --name loan-app`  (or your usual `pm2 start ecosystem.config.js --env local`)
   - Or if using a named script/ecosystem: edit the env section of ecosystem file, then `pm2 restart loan-app --update-env`
   - Confirm with `pm2 logs loan-app --lines 20` that the new envs are loaded (no "Reggora not configured" in UI).
4. In dashboard, switch to Appraisals tab (admins only). It auto-loads on tab activation and shows the "not configured" message until envs + restart succeed.
5. DB: run this SQL in Supabase SQL editor (or via migration) so the ID can be stored on loans:
   ```sql
   ALTER TABLE loans ADD COLUMN IF NOT EXISTS reggora_loan_id TEXT;
   -- Optional index if querying by it often:
   -- CREATE INDEX IF NOT EXISTS idx_loans_reggora_loan_id ON loans (reggora_loan_id);
   ```
   (Prisma schema was updated; after column add, you may `npx prisma generate` locally.)

Focus was on making the tab appear + basic list/create work for sandbox testing. Extend as needed (e.g. more fee rows, full loan schema extended_loan, webhooks, etc).

See Reggora Lender docs: https://developer.reggora.io/docs/lender/ (use sandbox base URL).

## Credit Report + Appraisal Buttons Auto-Use Loan Product Pricing Matrix (2026 update)

Credit report (loans/[id] page, visible to !borrower) and Reggora appraisal order buttons/flows (both in loans/[id] Reggora box + dashboard Appraisals tab "Order New Appraisal" form) now **auto-use the loan's linked product (via product_id -> loan_products.pricing_matrix JSONB)**.

### Key behavior
- Display context (when loan has product): "Auto-using pricing matrix from this loan's product: standard-dscr (baseRates: 12 entries, benchmark: DGS5 anchored @ 4.125%)".
- On order (credit or appraisal):
  - Snapshot the *current full* pricing_matrix (plus org benchmark_treasury / anchor / live FRED treasury rate if org has benchmark set) into the **loan's `notes` field** using marker:
    ```
    [PRICING-MATRIX-SNAPSHOT:credit 2026-06-04T...Z]
    {"snapshotType":"credit","productId":"...","productName":"standard-dscr","matrix":{...full baseRates + ficoLtvGrid + dscrLtvGrid + ... + "Other Adjustments" + markup + benchmark + benchmark_anchor_rate},"orgBenchmark":"DGS5","anchor":4.125,"liveRate":{"rate":4.08,"date":"2026-..."},"at":"..."}
    ```
    (Same for :appraisal). This "locks" the rates/adjustments context for the file at service order time (analogous to anchor snapshot on CSV upload in adjustments).
  - Local loan state refreshed after; UI confirms "Matrix snapshot saved (see loan notes for full pricing context at order time)".
- Credit specifically:
  - Loads loan's org (pass_credit_report_costs_to_borrower, credit_report_cost_amount, benchmark_treasury).
  - Shows org settings + product matrix summary.
  - Effective cost = org amount (or 29.99). Light matrix auto-use: if pricing_matrix['Other Adjustments'] (or variant) has key matching /credit|report|bureau/i, parse numeric (or from its LTV sub-object) and use as/adjust the cost (graceful fallback).
  - Button now calls real server action `orderCreditReportForLoan` (no more alert). Action (in organization-actions.ts): loads fresh via supabaseAdmin + product/org, FRED if benchmarked (reuses fetchTreasuryRate), builds snapshot, appends to notes, inserts optional `documents` row for "Credit Report" (NEEDED status), returns {success, cost, passedToBorrower, matrixUsed, summary}.
  - On success: green confirmation with cost, "Passed to borrower? Yes/No per org", matrix info. (Still placeholder re: no real bureau API.)
- Appraisals (Reggora) in BOTH places:
  - When loan context available: show "Pricing Matrix Context from loan: ..." box/summary (baseRates count, which grids present, benchmark/anchor).
  - Compute suggested additional fee: start ~575-800 or from chosen Reggora amount; light matrix: scan 'Other Adjustments' for /apprais|valuation|inspection/ keys (numeric or 0=no-adj), or derive from avg baseRate price (100-avg as points proxy, scaled). Included as additional_fees e.g. `[{description: "Appraisal fee (auto from loan product standard-dscr matrix context)", amount: "725.00"}]` (+ any manual user ones).
  - Snapshot always called in success path (reuses snapshotPricingMatrixForLoan).
  - Labels/help updated with "(auto-using this loan's product pricing matrix for fee suggestion + snapshot...)".
  - Reggora product selects + manual additional fee inputs in dashboard preserved.
- Graceful: if no product_id or no pricing_matrix, still allow orders (amber note: "No product matrix on this loan — order will proceed without matrix snapshot"), use org/defaults. Non-borrower !borrowerUser guards unchanged. All via existing supabase client reads + supabaseAdmin in actions. Uses `notes` (no schema change needed).

### New/updated server actions (in app/actions/organization-actions.ts)
- `snapshotPricingMatrixForLoan(loanId: number, type: 'credit'|'appraisal')`: loads loan/product/org, FRED if needed, appends marker+full JSON to notes.
- `orderCreditReportForLoan(loanId: number)`: full credit flow + snapshot + doc row.
- Internal pure helpers (in organization-actions.ts, not exported as Server Actions): `deriveCreditCostFromMatrix`, `deriveAppraisalFeeFromMatrix` (used by server actions; pages use light client inlines for fee preview in dashboard/loans flows to avoid 'use server' module constraints). Removed top-level `export` from the sync helpers to satisfy Next.js "Server Actions must be async functions" rule when the module is imported from client pages like org users.

No prisma schema change (notes + documents table reused). Ties directly to standard-dscr product (populated from Rate Sheet.csv with the grids/Other Adjustments etc) + FRED rebase flows.

### How to test the matrix auto-use (with standard-dscr)
1. Ensure a loan exists with `product_id` set to your standard-dscr (or similar with pricing_matrix.baseRates etc) and preferably `organization_id` that has benchmark_treasury or credit settings. (Use Supabase SQL or admin UI / products to link.)
2. As non-borrower (e.g. BROKER_AE or ADMIN; use permissions), visit /loans/[that-id].
3. See credit box: shows org settings + "Auto-using pricing matrix from this loan's product: standard-dscr (...)".
4. Click "Order Credit Report": calls action, on success green box with cost/passed/matrixUsed, a "Credit Report" NEEDED doc appears in conditions, loan.notes has the [PRICING-MATRIX-SNAPSHOT:credit ...] marker (query DB or add notes display to inspect).
5. In same page Reggora section (if reggora env configured): matrix context shown, suggested fee derived in additional_fees to createReggoraOrder, snapshot appended on success.
6. Go to /dashboard, switch to Appraisals tab (needs appropriate role), in "Order New Appraisal" pick the loan: see "Pricing Matrix Context from loan's product: ..." box below selector.
7. Fill Reggora prods + due etc (+ optional manual fee), submit: order includes auto fee entry, success notes matrix used, and snapshot written to that loan's notes.
8. Verify in DB: `select id, notes from loans where id=...;` look for the marker JSON (full matrix at that instant).
9. If no product on loan: orders still work, amber warnings, no snapshot marker.
10. After changes: always followed dual-worktree (edits in /home/elijah/.grok/worktrees/.../loan-app , cp to /home/elijah/loan-app , then disciplined pm2 restart).

Run the disciplined restart after sync (see below). Use `npx tsc --noEmit app/actions/organization-actions.ts app/loans/\[id\]/page.tsx app/dashboard/page.tsx` etc for type check. Since no real FRED/REGGORA keys in all envs, paths are graceful.

(Prisma still has the fields; organizations pass_credit... + benchmark_treasury; loans notes + product_id + organization_id + reggora_loan_id.)

### Fix: Main contact / submitter not linked to org + wrong role (BROKER_AE vs ADMIN) when user created before org approval
Root cause: apply/OTP signup sets `submitted_by` on pending_organizations but may not guarantee a `profiles` row at that moment (or role defaults to BROKER_AE in states); `approveAndCreateOrganization` only did UPDATE (no insert-if-missing); contact email link used brittle `.single()` + no role promotion; `addUserToOrganization` always tried `createUser` (fails with "email already registered" for pre-existing auth users from signup); no easy repair for already-approved orgs like CTF Funding.

Changes:
- New helpers in `lib/create-organization.ts` (exported, reusable):
  - `findUserIdByEmail(email)`: profiles -> users -> auth.admin.listUsers() -> null
  - `ensureUserInOrganization(userId, orgId, role='ADMIN', fullName?, email?)`: safe update-or-insert for profiles (preserves created_at) + users table + auth metadata update.
  - `ensureMainContactForOrganization(orgId, email?)`: uses above + raw_attrs/from_email to locate, promote to ADMIN role, link org. Returns tempPw only in the rare create case.
- Refactored `approveAndCreateOrganization`: after org create, always `ensureUserInOrganization(submitted_by, ..., 'ADMIN')` and `ensureMainContactForOrganization(...)` (for the contact email case and pre-created users). Additional users creation also uses the helpers + maybeSingle fix.
- Made `addUserToOrganization` (in app/actions/organization-actions.ts) lookup-first: if email already has auth/profile/users row, just call ensure (set desired role + org_id) and return no tempPw. Only createUser for brand new. This lets you "re-add" a pre-created user (e.g. with role=ADMIN) safely after org exists.
- UI: in `app/admin/organizations/[id]/page.tsx` (Full Organization Details), added amber "Main Contact / Submitter Repair" box + button that calls `ensureMainContactForOrganization(org.id)` (uses contact email from raw_attrs etc). After, reloads data. Also links to the /users subpage.
- All paths now promote the main contact/submitter to 'ADMIN' (so they can manage org users/products etc); additional team members stay BROKER_AE (or chosen).

To repair CTF Funding (or similar):
1. As SUPER_ADMIN or ADMIN, go to /admin/organizations/[the-org-id]
2. Scroll to "Main Contact / Submitter Repair" box (shows explanation).
3. Click "🔧 Ensure Main Contact Linked + Role=ADMIN"
4. Confirm; it will find by email (e.g. dustin@ctffunding.com), ensure profile, set role=ADMIN + organization_id on both profiles+users, sync metadata.
5. Then visit the full users subpage (/admin/organizations/[id]/users) to see it listed with ADMIN; use the add form if you want to tweak role (now safe for existing).
6. The affected user should log out/in (or hard refresh) to pick up new role/org in session loads.

Future applies will auto-do the right thing (main contact = ADMIN of their new org).

No new DB columns (uses existing profiles/users + auth). Followed all dual-worktree/cp/pm2/SQL-surface rules (none needed here). 

If you manually created profiles without going through add/approve, the repair or "add user" (picking ADMIN) will now associate them correctly.
