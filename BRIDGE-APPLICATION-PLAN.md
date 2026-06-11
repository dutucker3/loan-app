# Bridge / Fix & Flip Application — Design & Implementation Plan

**Status**: FINALIZED FOR IMPLEMENTATION (per user's answers + raw historical session data)  
**Date**: Current session  
**Routes locked**: `/loan-application` (new selector page), `/bridge-application` (bridge/fix-flip form), `/bridge-loans/[id]` (review page), rental form moved down (e.g. `/loan-application/rental` or equivalent). "Apply Now" / "Begin Application" links now point to the selector.  
**Key sources**:
- Raw historical plan section from worktree session `chat_history.jsonl` (session 019e8199-9d1c-70d0-883b-f6d91b3d78e5, line ~449: the full "Plan: Restructured Loan Application Routing + Bridge/Fix & Flip Flow" message that posed the original "Questions / Clarifications Needed Before Starting" list).
- User's exact answers to those questions (provided in the immediate following user messages in the same raw log, and re-confirmed in this conversation — including the 5 answers on white-label platform update, bridge_config column, mortgagee per product + tenant data, selector as brand new route moving rental, and multi-product tabs + signing + docs flow).
- Extracted Axelrad Loan App PDF (04302025) + Term Sheet EZ (1).xlsx (use the files for fields/layout).
- Existing code: rental loan-application flow, `loans/[id]` (with existing `loan_status` + "Clear to Close" progress), term-sheet, permissions (`isBorrower`), `loan_applications` + `loans` tables, submit actions, TermSheetPDF, org apply selector, progress stages.

This plan has been updated and finalized by directly reading the raw preceding turns in the log (the AI's prior plan + questions list) and incorporating the user's provided answers verbatim. All decisions below override or lock in the historical draft where they differ (e.g., no "on behalf" UI tab, combined form, exact 4 product % calcs, signature removal for non-borrower users, etc.). 

**User Answers Summary (Locked In):**
- Routes: /loan-application is now the brand new selector page. Existing rental/loan-application form is moved one step down (direct links for "Apply Now"/"Begin Application" now go to selector). Bridge form at /bridge-application. Review at /bridge-loans/[id].
- Form: One combined form for Fix & Flip + Short Term Bridge (conditional sections). Axelrad PDF as base; add explicit "Rehab Funding Needed? Yes/No — if yes, input Amount".
- Bridge products (per-product, stored for auto-calc on form + term sheet editor): 4 inputs — Initial Loan Amount % , % of Rehab Loan Funded , Total After Repaired LTV (ARV) % , Total Loan to Cost % (LTC = (purchase price + rehab) × % ). Store in dedicated top-level `bridge_config` JSON column on loan_products (not inside pricing_matrix).
- Closing/CTC: Based on existing status field in `loans/[id]` (the "Clear to Close" stage already exists in progressStages and `updateLoanStatus` — use it to trigger docs + title notification).
- Selector: This route/flow (the selector) is for both borrowers and company users (also usable in organization application flow). Brand new route.
- Submitter + Signature (for bridge and rental apps): No UI tab/checkbox for "submitting on behalf of borrower". System automatically logs the logged-in user as the submitter/originator (use `originator_id` / `user_id`). Remove the signature box entirely if the current user is **not** a BORROWER role (use existing `isBorrower` helper; only show for true BORROWER role users).
- White-label / tenant branding: **Yes — update ALL pages** for pure server-side calls for tenant branding (full platform audit + conversion of remaining client-side usages like AppHeader/tenant-context to server-side, in addition to new pages).
- Tenant data on new pages: For most pages pass logo_url, primary_color, and tenant name. On loans/[id] page also need mortgagee_clause from the selected product. Add mortgagee_clause input to product create/edit settings (per-product).
- Review page / multi-product flow: If org has bridge/fix-flip products (e.g. 3), the review application page has tabs (one per product, labeled). Each tab prefilled based on that product's settings (the 4 % + other config). Each has its own term sheet. Once term sheet is approved, it is sent to the borrower for signature. After the term sheet is signed by borrower, the borrower gets document requests based on the document requirements from the products/id/page (for that specific product). Scale to 10+ products with tabs for all.

**All work must stay in main tree `/home/elijah/loan-app` only** (per AGENTS.md). No worktree edits. After schema or client changes: Prisma sequence + schema cache reload + clean `pm2 delete ... && rm -rf .next && pm2 start`.

---

## 1. Goals & Scope

Build a dedicated bridge / short-term fix & flip application flow that:
- Reuses patterns from the existing rental/DSCR `loan-application` but is purpose-built for purchase + renovation bridge loans.
- Supports both **borrowers** and **company users** (loan officers, brokers, AEs) filling the form.
- Uses the Axelrad PDF as the primary field/layout reference.
- Supports **combined** Fix & Flip + Short Term Bridge in **one form** (conditional sections).
- Stores bridge-specific advance rates / LTV/LTC caps **per product** and uses them for auto-calc / validation of max loan on the form and term sheet editor.
- Integrates with existing `loans` + `documents` + term sheet signing + status/progress + Clear to Close.
- Removes signature requirement when a non-borrower (company user) is the logged-in submitter.
- Submitter identity is **automatically derived** from the authenticated user (no "submitting on behalf of" UI tab).

Out of scope for v1 (unless explicitly added later):
- Separate pages for Fix & Flip vs Bridge.
- Full custom PDF generation overhaul (start by extending existing PDF components).
- New database tables beyond targeted extensions.

---

## 2. Routes & Navigation

- **Selector page (brand new)**: `/loan-application` (replaces the current rental form location).
  - Card-based selector for loan types: Long Term Rental (links to moved rental form), Bridge / Fix & Flip (links to `/bridge-application`).
  - "Apply Now" / "Begin Application" links (from marketing/homepage, etc.) now direct to this selector.
  - Server-side tenant branding (full logo_url, primary_color, tenant name).
  - Reachable by borrowers and logged-in company users. Usable in org application flow context if needed.
- **Bridge / Fix & Flip form**: `/bridge-application` (combined form).
  - Public-ish with server-side auth/tenant handling.
  - Linkable from selector, homepage (Fix & Flip / Bridge card), organization application / products flow.
- **Review / loan page for bridge loans**: `/bridge-loans/[id]`
  - (Note plural "loans".) Thin dedicated route or enhancement of `/loans/[id]` with bridge-specific UI.
  - **Multi-product tabs** (per user answer): If the organization has bridge/fix-flip products (e.g. 3 products), show tabs (one per product, clearly labeled by product name). Scale to any number (e.g. 10 products = 10 tabs).
  - Each tab is prefilled based on that product's settings (the 4 % values from `bridge_config`, mortgagee_clause, standard_conditions/document requirements, etc.).
  - Each tab contains its own editable term sheet (prefilled + using the product's bridge_config for Initial Funding / Rehab Funding splits, ARV LTV, LTC calcs, etc.).
  - Term sheet approval (underwriter/processor/etc.) → send the term sheet to the borrower for signature (email link to sign, similar to existing term-sheet page).
  - After borrower signs the term sheet for a product/tab: automatically generate document requests for the borrower based on the document requirements from that specific product's `products/id` page (standard_conditions + any title/insurance/etc. requirements). Reuse/extend existing document/condition flows, emails, and uploads.
  - Link back to the original submitted application PDF. Full server-side tenant branding (logo, colors, name).
- **Rental form (moved down)**: e.g. `/loan-application/rental` (or equivalent internal route). The original long-term rental form is no longer at the root `/loan-application`; selector is now the entry.
- Selector / entry points:
  - The products-offered checkboxes in `/apply/organization` already list "Bridge Loans".
  - Update all "Begin Application" / "Apply Now" call-to-actions across the platform to point to the new `/loan-application` selector.

Entry points to implement or update:
- Homepage / marketing cards and CTAs → `/loan-application` (selector).
- Selector cards → `/bridge-application` (bridge form) and rental moved path.
- Dashboard / broker tools links to selector or specific forms.
- Shared selector component (new, server-rendered for tenant branding).

---

## 3. Data Model

### Existing (no breaking changes)
- `loans` table (use for the resulting loan record):
  - `originator_id` (the logged-in user who submitted/filled the app — company user or borrower)
  - `loan_status` (string, drives progress bar; already includes "Clear to Close")
  - `purpose`, `loan_type`, `property_address`, `loan_amount`, `product_id`, `organization_id`, `borrower_name`, etc.
  - `title_company`, `insurance_company` (JSON)
- `loan_applications` table (good for draft / submitted form data before loan is created):
  - `form_data` (JSON), `borrowers` (JSON), `selected_product_id`, `user_id`, `organization_id`, `status`
- `documents`, `loan_products`, `profiles` (role on profile drives `isBorrower`).
- `organizations` table: full white-label support already present (name, logo_url, primary_color, domain, from_email, mortgagee_clause, raw_attrs, etc.). No changes needed.

### Changes / Extensions Needed
1. **Bridge parameters on `loan_products`** (per-product, for bridge-type products):
   - Store the 4 values the user specified in a **dedicated top-level `bridge_config` JSON column** (user confirmed preference for top-level column over nesting inside pricing_matrix, for easier future querying):
     - `initial_loan_pct`: % used for initial/purchase portion.
     - `rehab_funded_pct`: % of rehab that can be funded.
     - `arv_ltv_pct`: Total After-Repaired Loan to Value cap.
     - `ltc_pct`: Total Loan to Cost % (LTC calculation: (Purchase Price + Rehab Amount) × this %).
   - These feed **auto-calc / max loan** suggestions and caps in the bridge form and in the term-sheet editor. Snapshot values at application time.

2. **Mortgagee clause per product**:
   - Add `mortgagee_clause` (String/Text) column to `loan_products` (user confirmed: add input to create product / edit product settings).
   - On loans/[id] page, surface the mortgagee_clause from the **selected product** (for the chosen bridge/fix-flip product tab).
   - This is in addition to any org-level mortgagee_clause.

3. **Form data capture** (in `loan_applications.form_data` or directly when creating loan):
   - Full Axelrad structure (see Section 4).
   - Explicit `rehabFundingNeeded: boolean`, `rehabFundingAmount: number` (user requirement).
   - Selected product + the 4 % values (from bridge_config) snapshot at time of application (for audit / calc reproducibility).
   - Submitter metadata: `submittedByUserId`, `submittedByRole` (derived, not user-entered).
   - Use existing `loan_type` / `purpose` (set to 'bridge' or 'fix_and_flip').

4. Minor: ensure `loan_status` values used in progressStages are stable (already defined in `/loans/[id]/page.tsx`).

**Schema changes required** (see surfaced SQL):
- Add `bridge_config` JSON column to `loan_products`.
- Add `mortgagee_clause` String column to `loan_products`.
- Update Prisma schema + generate.
- White-label fields on organizations are already present and sufficient (no changes).

**Migration note**: After any Prisma change, follow the project rule (db push / migrate, generate, reload PostgREST schema cache, clean pm2 restart). See the explicit surfaced SQL in `prisma/bridge-white-label-no-schema-changes.sql` (includes the ALTERs for the two new columns on loan_products + verification + comments). Run via the admin run-migrations UI (yellow boxes for audit) or direct.

---

## 4. Form Specification (Axelrad-based + Additions) + Product Settings

**One combined form** for Fix & Flip / Short Term Bridge / Bridge Loan purposes.

**Product settings update (mortgagee per product)**: In `app/products/new/page.tsx` and `app/products/[id]/page.tsx` (or the bridge product section), add an input for `mortgagee_clause` (text) per product. This is used on the loans/[id] / review page for the selected product tab. (In addition to any org-level mortgagee_clause.)

### I. LOAN PROPOSAL AND PROPERTY INFORMATION (core)
- Property Type checkboxes (from PDF): Residential (SF, 2-4, Condo), Raw Land, Commercial (Multi-Family 5+, Mixed-Use, Office, Other).
- No. of Units
- Occupancy Status
- Purpose for the Loan Funds (checkboxes): Purchase, Fix & Flip, GAP, Business, Refinance, Transactional, Line of Credit Cash-Out, New Construction, **Bridge Loan**, Other + explanation.
- Loan Term (12/18/24 mos, etc.)
- Amount of Loan Request (subject to product % caps + calcs)
- Current Market Value (As-Is)
- Purchase Price
- Purchase Date
- **Renovation Costs** (Axelrad field)
- **Anticipated After Repair Value (ARV)**
- Existing Debt (if Refi)
- Monthly Rent / Market Rent
- Annual Property Taxes
- Property in Flood Zone (Y/N)
- Annual Insurance Premium
- HOA Dues (if applicable)
- Project Summary (textarea)
- Exit Strategy (textarea)
- Total Cash Reserves Available
- Title Company Contact Info
- Target Closing Date + Reason for Target Closing Date

**Mandatory addition (user spec)**:
- Rehab Funding Needed? **Yes / No** (radio or toggle)
  - If Yes: input for **Rehab Funding Amount**

Bridge product % display / calc aids (read-only or inputs that feed request amount):
- Initial Loan % (from product)
- % of Rehab Funded (from product)
- ARV LTV % cap (from product)
- LTC % (from product)
- Derived maxes: e.g. max initial = Purchase × initial%, max rehab portion = Rehab × rehab%, overall max = min(ARV × arvLtv, (Purchase + Rehab) × ltc, etc.)
- User enters desired loan amount; UI shows warnings / caps if it exceeds product limits.

### II. GUARANTOR INFORMATION
- Support for multiple guarantors (PDF shows 1-4).
- Per guarantor: Full Legal Name (+ Jr/Sr), DOB, SSN, Credit Score Range (checkbox bands), Home/Cell Phone, Email, Present Address, Mailing Address (if diff), Employer Name & Address (or Self-Employed).

### III. EMPLOYER INFORMATION
- Business phone(s) per guarantor.

### IV. REAL ESTATE OWNED (SREO)
- List all property owned (multiple addresses, up to 4+ shown in PDF).
- Per property: Ownership (Entity + %), Mortgage Amount Owed, Present Market Value, Description.
- Note about attaching SREO separately.

### V. DECLARATIONS
- Standard checkboxes (per guarantor where applicable): judgments, bankruptcy (7yr), foreclosure/deed-in-lieu (7yr), lawsuit, prior loan foreclosure/judgment obligation, delinquent on federal/other debt, US citizen, permanent resident alien, intend to occupy subject property.
- Explanation textarea for any YES answers.

### VI. ACKNOWLEDGEMENT AND AGREEMENT
- Standard legal text (from PDF).

### Signature Rules (critical per user)
- **Only render signature box(es) if the logged-in user has role === 'BORROWER'** (`isBorrower` helper already exists).
- Company users (BROKER_*, AE, processor, admin, etc.) filling the form: **no signature pad**.
- The system records the current auth user as the submitter / originator automatically.
- No UI tab or checkbox "I am a loan officer submitting for the borrower".

### Other Form UX
- Multi-step wizard (like current rental app, ~5 steps) or logical sections with progress.
- Product selector at start (or pre-selected via query param / org context). Only bridge-eligible products shown.
- Real-time or on-blur calc of suggested max loan using the 4 product % + entered purchase/rehab/ARV.
- Support for entity borrower + individual guarantors (matches PDF).

---

## 5. Product Configuration for Bridge Calculations

In the product editor (`/products/...` or new bridge-specific section):
- For products where name/type indicates bridge/fix-flip (or a new `loan_category` / tag), expose inputs for the 4 %:
  - Initial Loan Amount % (purchase / as-is basis)
  - % of Rehab Loan Funded
  - Total After-Repaired LTV %
  - Total Loan to Cost %
- Store in `loan_products.pricing_matrix` under a `bridge` key (or dedicated field) so the pricing engine / form / term sheet editor can read them.
- Default sensible values (e.g. 70% initial, 80-90% of rehab, 70% ARV LTV, 75% LTC) but editable per product/org.
- Use these in:
  - Bridge application form (max loan suggestion + validation).
  - Term sheet editor (auto-calc proposed Initial Funding + Rehab Funding splits, total loan, cash to close, etc.).
  - Possibly the dynamic pricing / loans/new flow if bridge products appear there.

The Term Sheet XLSX already models "Initial Funding" + "Rehab Funding" separately + "Construction or Rehab Budget". The 4 % drive the numbers shown/editable in the editor.

---

## 6. Status, Clear to Close & Closing Flow

- **Use existing mechanism**: `loans.loan_status` (string) + the `progressStages` array already defined in `app/loans/[id]/page.tsx`:
  ```ts
  ["Signed Term Sheet", "Appraisal Ordered", "Appraisal Review", "Final Underwriting", "Clear to Close", "Docs Out", "Closed and Funded"]
  ```
- "Clear to Close" stage already exists in the UI progress bar and `updateLoanStatus`.
- When status is advanced to (or through) "Clear to Close" (or another designated status), trigger:
  - Document generation (term sheet PDF, loan app PDF, any closing docs).
  - Title company notification (existing provider email pattern in the codebase).
- The loan detail page already has status selector (non-borrowers), audit logging on change, and document management.
- Bridge review page (`/bridge-loans/[id]`) should surface the same status / progress + Clear to Close controls (or delegate to shared component).

No brand new "Clear to Close" button required; it is status-driven as specified.

---

## 7. PDF Generation & Term Sheet

- Extend or create bridge-specific variants:
  - `components/BridgeLoanApplicationPDF.tsx` (modeled on `LoanApplicationPDF.tsx` but using Axelrad sections + guarantors + rehab funding + declarations per-guarantor + project summary/exit).
  - Enhance `components/TermSheetPDF.tsx` (or a bridge variant) to include Initial/Rehab Funding split, the 4 % inputs from product, ARV, LTC calc, rehab amount, purchase price, etc. Match layout spirit of the "Term Sheet EZ" XLSX.
- On term-sheet signing page (existing `/loans/[id]/term-sheet` or bridged version): capture signature (borrower only), generate PDFs, save to `documents` with types like `signed_term_sheet`, `bridge_loan_application`.
- Email sending for term sheet (existing stub) should work for bridge loans too.

---

## 8. Submitter Identity & Company User Flow

- On form load in `/bridge-application`:
  - Get current Supabase user + profile role (pattern already in rental client and loans/[id]).
  - `const borrowerUser = isBorrower({ id: sbUser?.id, role: currentUserRole });`
  - If `borrowerUser` → show signature step/pad (like current rental, but only for this role).
  - Else (company user) → hide signature entirely. Still allow full form fill + submit.
- On submit (via existing or new `submitBridgeApplication` action or extension of `submitLoanApplication`):
  - Record `user_id` / `originator_id` = current auth user id.
  - Record role at submit time if useful.
  - No "submitted on behalf of" free-text or dropdown — pure auth-based.
- Same pattern should be applied to the rental flow per the user's note ("if the user is not a borrower type user" remove signature for rental too). This can be a small follow-up or included.

---

## 9. Integration Points & Reuse

- **White Label / Tenant Branding (pure server-side everywhere)**: 
  - **Full platform update required** (per user answer): Audit and convert **ALL pages** across the platform to pure server-side calls for tenant branding (logo_url, primary_color, tenant name). This includes existing client-side usages (AppHeader.tsx, lib/tenant-context.tsx / useTenant, TenantHeader, other client components) in addition to all new bridge-related pages.
  - For the **new pages** specifically (selector at /loan-application, /bridge-application, /bridge-loans/[id], bridge product create/edit, review page tabs, etc.):
    - **Exactly mirror the server-side pattern** in `app/loan-application/page.tsx` (and thank-you, root home, admin settings):
      - Use `import { headers } from 'next/headers';`
      - `const headersList = await headers();`
      - Parse host, lookup `supabaseAdmin.from('organizations').select('name, logo_url, primary_color, domain, ...').eq('domain', hostname).maybeSingle()`
      - Pass tenant data (logo_url, primary_color, tenant name) as prop to the client component. No client-side swapping or flash.
    - On `loans/[id]` (and bridge review): additionally surface `mortgagee_clause` from the selected product.
  - Tenant data to pass (per user):
    - Most pages: logo_url, primary_color, tenant name.
    - loans/[id] and related: + mortgagee_clause from the selected product.
  - Client components receive and render the branding (update/extend shared header components as part of the platform audit).
  - The plan reuses the existing platform white-label support in the organizations table. No DB change needed for these fields.
  - Add explicit task in phases for the full platform audit + conversion (server-side only, matching the locked pattern).
- Product selection: reuse / filter bridge-capable products (org-scoped, visible per permissions).
- After submit: create `loan_applications` record (or directly a `loans` record + initial documents), redirect to `/bridge-loans/[id]` or `/loans/[id]`.
- Loan detail, documents list, conditions, title/insurance requests, credit report ordering, Reggora: all reuse the existing `/loans/[id]` machinery. The bridge route can be a specialized view or link to the canonical loan id page.
- Term sheet signing flow: reuse/enhance existing.
- Audit logging: use existing `logAudit`.
- Emails: extend condition / term sheet / provider request emails as needed.

---

## 10. Phased Implementation Plan (Reviewable)

**Phase 0 — Planning & Review (COMPLETE — FINALIZED)**
- [x] Read raw historical plan section from worktree session chat_history.jsonl (the AI plan + "Questions / Clarifications Needed Before Starting" list at ~line 449).
- [x] Incorporate user's exact answers (routes, combined form + rehab Y/N+amount, 4 product % with LTC calc, CTC on existing status, selector for borrowers+company users, no "on behalf" tab, auto submitter from logged-in user, remove signature for non-BORROWER roles — applied to bridge + rental).
- [x] Extract Axelrad PDF + Term Sheet XLSX content and align form/term-sheet to them.
- [x] Inspect existing rental form, permissions (`isBorrower`), loan status/CTC (existing in `/loans/[id]`), term sheet, org apply selector, schema, submit actions.
- [x] User reviewed + confirmed answers → plan finalized for implementation (this document). No code yet.

**Phase 1 — Foundations (no user-visible routes yet)**
- Prisma schema + migration for new columns on `loan_products`: `bridge_config` (JSON for the 4 % values) + `mortgagee_clause` (text, per-product). Add inputs to product create/edit UI (including mortgagee for bridge products).
- Add explicit full-platform task: Audit all pages/components for client-side tenant branding (AppHeader, tenant-context, etc.) and convert to pure server-side (headers() + supabaseAdmin) using the locked pattern. Update shared components. Include new bridge pages.
- Create or extend server action(s) for submitting bridge app (capture form_data, derive originator, handle role-based sig).
- Add helper for bridge product % lookup (from bridge_config) + max-loan calc functions (pure, testable; used on form and term sheet).
- Update `isBorrower` usage / create `shouldShowSignature(user)` helper usable by both rental and bridge forms (and apply the rental change as companion).
- Update routes: Make `/loan-application` the selector (server component). Move existing rental form to sub-route (e.g. `/loan-application/rental`). Update all "Apply Now"/"Begin Application" CTAs platform-wide to point to selector.

**Phase 2 — Form**
- New page + client component: `app/bridge-application/page.tsx` + `BridgeApplicationClient.tsx`.
- Implement sections per Axelrad + rehab funding conditional + product % calcs + multi-guarantor + REO + declarations.
- Role-based signature (only for BORROWER).
- Product picker (bridge-eligible only).
- Submit → create records → redirect.

**Phase 3 — Review Page + Status/CTC + Multi-Product Flow**
- Route `app/bridge-loans/[id]/page.tsx` (or reuse + deep-link specialization) with full server-side tenant branding.
- **Multi-product tabs + term sheet per product** (as locked): Tabs for each of the org's bridge/fix-flip products. Prefill from product `bridge_config` + mortgagee_clause + other settings. Each tab has editable term sheet.
- Term sheet approval flow → email link to borrower for signature (reuse/extend existing term-sheet signing).
- Post-borrower-signature: Auto-create document/condition requests based on the specific product's requirements (from products/id page, standard_conditions, title/insurance packages, etc.). Hook into existing documents, emails, upload flows.
- Surface bridge-specific summary (purchase/rehab/ARV, funding splits, product % used, selected product mortgagee).
- Ensure status selector + "Clear to Close" works and can trigger doc gen + title notify (hook into existing or add lightweight bridge-specific email/doc step). Status changes drive the signing + docs request flow.

**Phase 4 — PDFs + Term Sheet**
- Bridge application PDF component.
- Update/enhance TermSheetPDF for bridge fields (Initial/Rehab funding, ARV LTV, LTC, etc.).
- Wire signing page for bridge context.
- Documents created on sign / CTC.

**Phase 5 — Wiring, Polish, Selector + Platform White-Label + Multi-Product Flow**
- Links from homepage, dashboard, apply/org flow, products. Update all CTAs to selector.
- Selector as brand new route at `/loan-application` (server component). Implement cards for rental (moved) and bridge.
- Full platform white-label conversion: Audit + convert remaining client-side branding to server-side (see Phase 1).
- Validation, error states, calc edge cases (0 rehab, refi vs purchase).
- Audit events for bridge submit.
- Apply rental signature removal as a small companion change.
- Complete multi-product tabs, term sheet per product, approval → borrower sig → product-specific document requests on review page.
- Testing with real roles (borrower vs broker vs org admin), multiple products per org, white-label tenants.

**Phase 6 — Post-deploy**
- Prisma + generate + schema cache reload + pm2 clean restart.
- Admin / data verification.
- Optional: backfill or seed a sample bridge product with the 4 % values.

---

## 11. Open / Clarification Items — RESOLVED (per user's answers + raw session data)

All items below have been locked based on the user's explicit answers to the questions in the raw historical plan section (worktree chat_history.jsonl ~line 449) and re-confirmation in this session. No further clarification needed for v1 implementation.

- **4 % on products**: Store in `loan_products.pricing_matrix` under a `bridge` object (or equivalent JSON extension) for flexibility. Snapshot the values at application time in `loan_applications.form_data` (or on the created loan). Use `pricing_matrix.bridge` + the 4 keys for live max-loan calcs on the form and in the term-sheet editor. (LTC calc exactly as user defined: (purchase price + rehab) × %.)
- **/bridge-loans/[id] vs /loans/[id]**: Start with a thin dedicated route `app/bridge-loans/[id]/page.tsx` (or enhancement) that reuses shared components from `/loans/[id]` + adds bridge-specific summary (purchase/rehab/ARV splits, the 4 % used, funding calcs). Link back to canonical loan as needed. Keep it lightweight.
- **Snapshot of % values**: Yes — capture selected product's 4 % values at submit time in form_data / loan record for audit + reproducible calcs.
- **Additional mandatory fields from Axelrad PDF**: The listed sections + Rehab Funding Needed (Y/N + amount) cover the core. Use the extracted PDF text for any remaining guarantor/REO/declarations details during form implementation. No others flagged as mandatory in answers.
- **Term sheet editor**: Enhance the existing `/loans/[id]/term-sheet` (and TermSheetPDF) with conditional bridge sections (Initial/Rehab Funding, the 4 % from product, ARV/LTC calcs, rehab amount). No fully separate editor page for v1.
- **After submit**: Immediately create a `loans` record (with appropriate `loan_type`/`purpose` = bridge/fix-flip, `originator_id` = current user, initial `loan_status`, linked `product_id`, and form data snapshot). Also create supporting `documents` entries for the generated application PDF. Use `loan_applications` for any pre-loan drafts if needed.
- **Email notifications on bridge submit**: Extend existing patterns (term sheet email, conditions, provider requests). Send standard submit confirmation + (later) term sheet link. Title/insurance notifications triggered on status advance to "Clear to Close" (existing flow).

**Signature removal for rental apps**: Per answers, apply the same rule (no signature box for non-BORROWER roles) as a companion change in `app/loan-application/LoanApplicationClient.tsx`.

---

## 12. Files Likely to Touch (after approval)

New:
- `app/bridge-application/page.tsx`
- `app/bridge-application/BridgeApplicationClient.tsx` (or similar)
- `app/bridge-loans/[id]/page.tsx` (or updates; multi-product tabs + per-product term sheet + post-sig docs flow)
- `app/loan-application/page.tsx` (now the selector; server component)
- `app/loan-application/rental/page.tsx` (or equivalent; moved rental form)
- `app/actions/submitBridgeApplication.ts` (or extend existing)
- `components/BridgeLoanApplicationPDF.tsx`
- Possibly `docs/` or additional plan notes.
- `prisma/bridge-white-label-no-schema-changes.sql` (updated with ALTERs)

Modify:
- `prisma/schema.prisma` (add `bridge_config` JSON and `mortgagee_clause` to loan_products)
- `app/loan-application/LoanApplicationClient.tsx` (apply signature removal for non-borrowers; rental form updates)
- `app/products/new/page.tsx` + `app/products/[id]/page.tsx` (add mortgagee_clause input; UI for bridge_config 4 %)
- `components/TermSheetPDF.tsx` + term-sheet page (bridge fields + per-product)
- `app/loans/[id]/page.tsx` and term-sheet (product tabs, mortgagee from product, status/CTC flow, tenant data)
- `app/page.tsx`, marketing CTAs, `app/apply/organization/page.tsx` (update links/CTAs to new selector at /loan-application)
- Full platform white-label audit: `components/AppHeader.tsx`, `lib/tenant-context.tsx`, other client components using useTenant (convert to server-side)
- `lib/permissions.ts` (if new helper for signature)
- Existing submit action + server components for selector
- Product pricing / calc utils (use bridge_config)
- Existing rental flow pages for the "move down"

**Surfaced SQL**: See `prisma/bridge-white-label-no-schema-changes.sql` (includes ALTER TABLE for the two new columns on loan_products + verification + comments). Run via admin run-migrations UI for audit.

---

**Next step**: This plan is now finalized. Reply with "approved" (or "approved with these changes") to proceed to implementation. We will then execute the phases strictly in the main `/home/elijah/loan-app` tree, with clean restarts after any changes.

This plan fully captures the raw historical section (AI's prior plan + questions from the worktree log) + your verbatim answers, the Axelrad/Term Sheet files, and existing codebase patterns. All decisions are locked. Ready for implementation.
