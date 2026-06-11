# Rate Sheet Separated CSVs — Upload Instructions for products/[id]/adjustments

Source: "Rate Sheet.csv" (Easy Street Capital DSCR STANDARD Series, ~280 rows, 11 adjustment grids in right columns). Enhanced to also parse Base Rates + DSCR/Max LTV Master Matrices (FICO/LoanSize/Purpose → max LTV% per DSCR band) into full pricing_matrix.

These files were auto-extracted so each "Adjustments: XXX" LTV grid can be uploaded independently.

## Upload steps
1. Open a loan product’s adjustments page: `/products/[id]/adjustments`
2. For each tab (FICO Adjustment, DSCR Adjustment, …), click the purple **📤 Upload CSV** button and pick the matching file.
3. The importer (handleCsvUpload + Papa) expects:
   - Column "Standard Key" (or first column) → becomes the row key / factor name
   - Exact LTV columns: `<=50,50.01-55,55.01-60,60.01-65,65.01-70,70.01-75,75.01-80`
4. After the preview table appears, you can edit the **Standard Key (Primary)** cells.
5. Click **💾 Save This Table** (saves that section into the product’s pricing_matrix JSON).
6. Repeat for all sections you want. Then test in a loan quote /loans/new.

## NEW: DSCR Master / Max LTV import (for eligibility)
- Use the new "Import DSCR Master / Rate Sheet" section on the adjustments page (or load the pricing-matrix.full.json into product).
- Upload "dscr greater than 1.25x ratio.csv" (or equiv per tab, or the full Rate Sheet.csv).
- This populates `dscrMaxLtv` in pricing_matrix: { band: { fico: { sizeKey: { "Acquisition": "80.0%"| "NA", "Rate-Term Refinance":.., "Cash-Out Refinance":.. } } } }
- In /loans/new: computed dscr + fico + loanSize + purpose (from loanType) → lookup maxLTV; if selected LTV > max or NA → Ineligible.
- Grids (FICO/DSCR/LoanBalance/etc): if cell for LTV is "NA"/blank/non-numeric → Ineligible (0 or negative numeric = eligible 0-adj).

## File → Tab mapping (use this order)

- **00-fico.csv** (9 rows)  →  **FICO Adjustment**  
  (source: Adjustments: FICO)

- **01-dscr.csv** (5 rows)  →  **DSCR Adjustment**  
  (source: Adjustments: DSCR)

- **02-loan-size.csv** (13 rows)  →  **Loan Balance Adjustment**  
  (source: Adjustments: Loan Size)

- **03-loan-purpose-cash-out-refinance.csv** (9 rows)  →  **Other Adjustments (Loan Purpose grids not wired into pricing yet)**  
  (source: Adjustments: Loan Purpose Cash-Out Refinance)

- **04-property-type.csv** (5 rows)  →  **Property Type Adjustment**  
  (source: Adjustments: Property Type)

- **05-loan-structure.csv** (2 rows)  →  **Loan Structure Adjustment**  
  (source: Adjustments: Loan Structure)

- **06-amortization-or-io.csv** (2 rows)  →  **Amortization Adjustment**  
  (source: Adjustments: Amortization or IO)

- **07-prepayment-penalty.csv** (11 rows)  →  **Prepayment Adjustment**  
  (source: Adjustments: Prepayment Penalty)

- **08-rent-qualification.csv** (6 rows)  →  **Rent Adjustments**  
  (source: Adjustments: Rent Qualification)

- **09-30-day-mortgage-lates-last-12-months.csv** (3 rows)  →  **Other Adjustments**  
  (source: Adjustments: 30 Day Mortgage Lates Last 12 Months?)

- **10-loan-purpose.csv** (4 rows)  →  **Other Adjustments (Loan Purpose grids not wired into pricing yet)**  
  (source: Adjustments: Loan Purpose)

- **11-other-adjustments.csv** (3 rows)  →  **Other Adjustments**  
  (source: Other Adjustments)

## Post-import cleanup & key canonicalization (IMPORTANT)

- **FICO Adjustment**: Keys (780+, 760-779 … 620-639) match getFicoBucket() in loans/new/page.tsx. Import should "just work".
- **Loan Balance Adjustment**: Keys come in as "$100,001 - $125,000". The page’s normalizeLoanSizeKey() strips $ and commas and normalizes spaces around -, producing "100001-125000" which matches getLoanSizeBucket(). Good.
- **DSCR Adjustment**: CSV has 5 coarse rows. Pricing uses 6-8 granular keys from getDscrBucket() (includes purchase vs refi variants for <1.00x and FICO splits). 
  After upload, manually duplicate rows in the UI and rename Standard Keys to the exact strings your getDscrBucket returns, or update the DSCR bucket function + pricing to use the coarse keys from the rate sheet.
- **Prepayment / Property Type / Rent / Other**: These feed the /products/keys page. After import:
  1. Go to /products/keys
  2. Pick the tab (e.g. Prepayment Adjustment)
  3. Select the raw keys that came in from the CSV
  4. Create "canonical_key" groups (these become the selectable values in the loan form dropdowns)
  5. The loan pricing reads matrix['Prepayment Adjustment'][canonical] etc.
- **Loan Purpose** (Cash-Out Refi specific + main Acquisition/Rate-Term/Cash-Out) and **Loan Structure**: Not currently added to the runningTotal in getBrokerPrice(). They can live in "Other Adjustments" or you can extend the pricing logic if these factors should affect price.
- "NA" / "N/A" / blank in grids now cause Ineligible for that rate/LTV (see loans/new getBrokerPrice + isEligible). Numeric (incl. 0) = eligible. Master dscrMaxLtv NA also Ineligible. Preserved as strings in JSON.

## Regenerating
Run:
  node scripts/separate-rate-sheet.js [srcCsv] [outRootDir]

It always writes:
  <outRootDir>/Rate Sheet.csv                 (copy of input)
  <outRootDir>/separated_rate_sheets/*.csv    (the 12-ish per-grid files)
  <outRootDir>/separated_rate_sheets/pricing-matrix.full.json  (full: baseRates + dscrMaxLtv + adj grids; use for product creation or Adjustments import)
  <outRootDir>/separated_rate_sheets/UPLOAD_INSTRUCTIONS.md

## Notes
- The left side (Base Rates, DSCR/Max LTV Master Matrices) is NOW parsed into the pricing-matrix.full.json (and dscrMaxLtv can be imported via Adjustments UI for master eligibility). Adjustment grids still separated for the tabs UI. (Base rates are dynamic via product bulk rebase; adjustments static yearly.)
- For Signature Series: create 2 flat products ("Signature ACQ+RT", "Signature Cash Out") with their own matrices (separate base + adjs per loan type).
- This script + the adjustments page upload (incl new DSCR Master section) + the keys grouping page together let you maintain the rate sheet in the original Excel/CSV form from the lender and periodically re-separate + re-upload.
- Existing standard-dscr product + getBrokerPrice / buckets / grid / NA handling preserved (extended only for master + strict NA=Ineligible on grids).

Generated for Easy Street Capital DSCR rate sheet (tabs → Standard/Streamline/Signature; Signature split flat).