#!/usr/bin/env node
/**
 * separate-rate-sheet.js
 * 
 * Separates the monolithic "Rate Sheet.csv" (with multiple "Adjustments: XXX" grids in columns 14-21)
 * into individual upload-ready CSVs for app/products/[id]/adjustments/page.tsx
 *
 * Each output has header: "Standard Key,<=50,50.01-55,55.01-60,60.01-65,65.01-70,70.01-75,75.01-80"
 * + one row per factor with the 7 LTV adjustment values.
 *
 * ALSO: parses left-side Base Rates + DSCR/Max LTV Master Matrices (per tab/series)
 * and emits full pricing_matrix JSON (baseRates, dscrMaxLtv for FICO/LoanSize/Purpose maxLTVs per band,
 * + all Adjustments grids). NA/blank preserved in grids and dscrMaxLtv (treated as Ineligible in loans/new).
 *
 * Usage:
 *   node scripts/separate-rate-sheet.js
 *   node scripts/separate-rate-sheet.js "/path/to/Rate Sheet.csv" "/path/to/output/dir"
 *
 * Outputs go to <out>/separated_rate_sheets/ plus a copy of source and UPLOAD_INSTRUCTIONS.md
 * + pricing-matrix.full.json (for seeding products or import)
 */

const fs = require('fs');
const path = require('path');

// Papa is used in the app for upload; require it here too for robust parsing of the source (handles quotes etc)
let Papa;
try {
  Papa = require('papaparse');
} catch (e) {
  // fallback to basic split if not available (dev should have it)
  Papa = null;
}

const DEFAULT_SRC = path.resolve(__dirname, '../Files/Rate Sheet.csv'); // sibling to scripts/ in package root (worktree + runtime)
const DEFAULT_OUT = path.resolve(__dirname, '../Files');

const LTV_HEADERS = ['<=50', '50.01-55', '55.01-60', '60.01-65', '65.01-70', '70.01-75', '75.01-80'];
const FACTOR_COL = 14;
const LTV_START = 15;
const LTV_END = 22;

function escapeCsvCell(cell) {
  const s = String(cell ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows) {
  return rows.map(r => r.map(escapeCsvCell).join(',')).join('\n') + '\n';
}

function isLtvHeaderRow(row) {
  if (!row || row.length <= LTV_START) return false;
  let matches = 0;
  for (let j = LTV_START; j < LTV_END; j++) {
    if (row[j] && LTV_HEADERS.includes(row[j].trim())) matches++;
  }
  return matches >= 3;
}

function looksLikeDataRow(row) {
  if (!row || row.length <= LTV_START) return false;
  const f = (row[FACTOR_COL] || '').trim();
  const fl = f.toLowerCase();
  if (f && !fl.endsWith('/ltv') && !fl.endsWith('ltv')) {
    return true;
  }
  for (let j = LTV_START; j < LTV_END; j++) {
    const v = (row[j] || '').trim().toUpperCase();
    if (v && (v === 'NA' || v === 'N/A' || /^-?\d/.test(v))) return true;
  }
  return false;
}

function cleanFactor(s) {
  return (s || '').trim().replace(/\s*\n\s*/g, ' ').trim();
}

// ===== NEW: parsers for full pricing_matrix (baseRates + dscrMaxLtv master + preserve NA) =====
function normalizeLoanSizeKeyForMaster(key) {
  return (key || '').toString().replace(/\$/g, '').replace(/,/g, '').trim().replace(/\s*-\s*/, '-');
}

function normalizeFicoKey(key) {
  return (key || '').toString().trim().replace(/\s+/g, '');
}

function isNaOrBlankMaster(v) {
  if (v == null) return true;
  const s = String(v).trim().toUpperCase();
  return !s || s === 'NA' || s === 'N/A' || s === 'NULL';
}

function parseBaseRates(rows) {
  const baseRates = {};
  let inBase = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const joined = row.join(' ');
    if (joined.includes('Base Rates')) {
      inBase = true;
      continue;
    }
    if (inBase) {
      const rate = (row[1] || '').toString().trim();
      const prem = (row[2] || '').toString().trim();
      const rnum = parseFloat(rate);
      if (rate && !isNaN(rnum) && rnum > 4 && rnum < 15) {
        baseRates[rate] = prem || rate;
      }
      if (joined.includes('DSCR / Max') || joined.includes('Adjustments: FICO')) break;
    }
  }
  return baseRates;
}

function parseDscrMaxLtv(rows) {
  const dscrMaxLtv = {};
  let currentBand = null;
  let currentFicos = [];
  const sheetDscrToBand = (title) => {
    const t = String(title || '').toUpperCase().replace(/\s+/g, ' ');
    if (t.includes('>=1.25') || /DSCR\s*>=?\s*1\.25/.test(t)) return '>=1.25x';
    if (t.includes('1.15') && t.includes('1.24')) return '1.15x - 1.24x';
    if (t.includes('1.00') && t.includes('1.14')) return '1.00x - 1.14x';
    if (t.includes('0.75') && (t.includes('0.99') || t.includes('0.75X - 0.99'))) return '0.75x - 0.99x';
    if (t.includes('<0.75') || t.includes('DSCR <0.75')) return '<0.75x';
    return null;
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const joined = row.join(' ').toUpperCase();
    const b = sheetDscrToBand(joined);
    if (b) {
      currentBand = b;
      currentFicos = [];
      continue;
    }
    if (!currentBand) continue;
    // FICO block (multi-line cell)
    const ficoCell = row.find(c => c && typeof c === 'string' && c.includes('\n') && /78[0-9]|76[0-9]|74[0-9]|72[0-9]|70[0-9]|68[0-9]|66[0-9]|64[0-9]|62[0-9]/.test(c));
    if (ficoCell) {
      currentFicos = String(ficoCell).split(/[\n\r]+/).map(s => normalizeFicoKey(s)).filter(Boolean);
      continue;
    }
    // Size row under current band/fico: find size pattern, then next 3 vals as acq/rt/co (or NA)
    const sizeIdx = row.findIndex(c => {
      const cs = (c || '').toString();
      return /\$?\d{2,3}[,.]?\d{3}\s*-\s*\$?\d/.test(cs) || (cs.includes('$') && cs.includes('-'));
    });
    if (sizeIdx !== -1) {
      const sizeRaw = row[sizeIdx];
      const sizeKey = normalizeLoanSizeKeyForMaster(sizeRaw);
      if (!sizeKey) continue;
      const after = row.slice(sizeIdx + 1);
      const vals = [];
      for (const v of after) {
        const vs = (v || '').toString().trim();
        if (!vs) continue;
        if (/^\d/.test(vs) || vs.includes('%') || /NA/i.test(vs) || /^-?\d/.test(vs)) {
          vals.push(vs);
          if (vals.length >= 3) break;
        }
      }
      const acq = vals[0] || 'NA';
      const rt = vals[1] || 'NA';
      const co = vals[2] || 'NA';
      if (!dscrMaxLtv[currentBand]) dscrMaxLtv[currentBand] = {};
      const ficosToUse = currentFicos.length > 0 ? currentFicos : ['780+'];
      for (const f of ficosToUse) {
        if (!dscrMaxLtv[currentBand][f]) dscrMaxLtv[currentBand][f] = {};
        dscrMaxLtv[currentBand][f][sizeKey] = {
          'Acquisition': acq,
          'Rate-Term Refinance': rt,
          'Cash-Out Refinance': co
        };
      }
    }
  }
  return dscrMaxLtv;
}

function main() {
  const src = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SRC;
  const outRoot = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT;
  const outDir = path.join(outRoot, 'separated_rate_sheets');

  if (!fs.existsSync(src)) {
    console.error('Source not found:', src);
    console.error('Pass path as first arg, e.g. node scripts/separate-rate-sheet.js "/home/elijah/loan-app/Files/Rate Sheet.csv"');
    process.exit(1);
  }

  console.log('Reading:', src);
  const raw = fs.readFileSync(src, 'utf8');

  let rows;
  if (Papa) {
    const parsed = Papa.parse(raw, { skipEmptyLines: false });
    rows = parsed.data;
  } else {
    // very basic fallback (assumes no newlines inside cells for this sheet)
    rows = raw.split(/\r?\n/).map(line => {
      // naive split on , but will be wrong for quoted; better to error if no papa
      return line.split(',');
    });
    console.warn('papaparse not found, using naive split. Install deps or run from project root.');
  }

  console.log(`Parsed ${rows.length} rows`);

  // NEW: parse left side for full matrix (base + master dscrMaxLtv). Adjs grids still separated to CSVs.
  const baseRates = parseBaseRates(rows);
  console.log(`Parsed ${Object.keys(baseRates).length} baseRates from Base Rates section`);
  const dscrMaxLtv = parseDscrMaxLtv(rows);
  console.log(`Parsed dscrMaxLtv for bands: ${Object.keys(dscrMaxLtv).join(', ') || '(none)'}`);

  // Find grids by scanning for LTV header rows
  const grids = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (isLtvHeaderRow(row)) {
      // find title upward
      let title = '';
      for (let look = 1; look <= 5; look++) {
        if (i - look < 0) break;
        const prev = rows[i - look] || [];
        const joined = prev.join(' ');
        if (joined.includes('Adjustments:')) {
          title = prev.find(c => c && c.includes('Adjustments:')) || '';
          break;
        }
        const c14 = (prev[FACTOR_COL] || '').trim();
        if (c14 && !isLtvHeaderRow(prev) && !/^\d/.test(c14)) {
          title = c14;
          break;
        }
      }
      if (!title) title = (row[FACTOR_COL] || `grid-${i}`).trim();

      const dataStart = i + 1;
      let j = dataStart;
      while (j < rows.length) {
        const rj = rows[j] || [];
        if (rj.join(' ').includes('Adjustments:')) break;
        if (isLtvHeaderRow(rj)) break; // sub-grid (e.g. "Other Adjustments" under Loan Purpose) starts its own
        if (j > 140 && !(rj[FACTOR_COL] || '').trim() && !looksLikeDataRow(rj)) break;
        j++;
      }
      grids.push({ title: title.trim(), headerIdx: i, dataStart, dataEnd: j });
      i = j;
      continue;
    }
    i++;
  }

  console.log(`Found ${grids.length} grids:`);
  grids.forEach(g => console.log(`  ${g.title.slice(0,45)} @${g.headerIdx} data:${g.dataStart}-${g.dataEnd-1}`));

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const written = [];

  grids.forEach((g, idx) => {
    const hrow = rows[g.headerIdx] || [];
    const ltvs = [];
    for (let j = LTV_START; j < LTV_END; j++) {
      const v = (hrow[j] || '').trim();
      if (LTV_HEADERS.includes(v)) ltvs.push(v);
    }
    if (ltvs.length !== 7) {
      console.warn(`  skip ${g.title}: found ${ltvs.length} LTV cols`);
      return;
    }

    const dataRows = [];
    for (let r = g.dataStart; r < g.dataEnd; r++) {
      const row = rows[r] || [];
      const factor = cleanFactor(row[FACTOR_COL]);
      if (!factor || factor.toLowerCase().endsWith('/ltv') || factor.toLowerCase() === 'ltv') continue;
      if (!looksLikeDataRow(row)) continue;
      const vals = [];
      for (let k = 0; k < 7; k++) {
        const j = LTV_START + k;
        vals.push((row[j] || '').trim());
      }
      if (!vals.some(v => v)) continue;
      dataRows.push([factor, ...vals]);
    }

    if (!dataRows.length) {
      console.log(`  no data rows for ${g.title}`);
      return;
    }

    const safe = g.title.toLowerCase()
      .replace(/adjustments:/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || `grid-${idx}`;
    const fname = `${String(idx).padStart(2, '0')}-${safe}.csv`;
    const fpath = path.join(outDir, fname);

    const csvRows = [["Standard Key", ...ltvs], ...dataRows];
    fs.writeFileSync(fpath, toCsv(csvRows), 'utf8');
    console.log(`  wrote ${fname} (${dataRows.length} rows)`);
    written.push({ fname, title: g.title, count: dataRows.length });
  });

  // NEW: build + emit full pricing_matrix JSON (baseRates + dscrMaxLtv + all adj grids)
  // (adjs also written as CSVs for the per-tab upload UI; this json for bulk product create / import)
  const fullMatrix = { baseRates, dscrMaxLtv };
  const mappings = {
    '00-fico.csv': 'ficoLtvGrid',
    '01-dscr.csv': 'dscrLtvGrid',
    '02-loan-size.csv': 'loanBalanceLtvGrid',
    '04-property-type.csv': 'propertyTypeAcquisition',
    '06-amortization-or-io.csv': 'amortizationAdjustment',
    '07-prepayment-penalty.csv': 'Prepayment Adjustment',
    '08-rent-qualification.csv': 'Rent Adjustments',
    '11-other-adjustments.csv': 'Other Adjustments',
    '03-loan-purpose-cash-out-refinance.csv': 'Other Adjustments',
    '05-loan-structure.csv': 'Other Adjustments',
    '09-30-day-mortgage-lates-last-12-months.csv': 'Other Adjustments',
    '10-loan-purpose.csv': 'Other Adjustments',
  };
  for (const [file, key] of Object.entries(mappings)) {
    const fpath = path.join(outDir, file);
    if (fs.existsSync(fpath)) {
      let data = [];
      try {
        if (Papa) {
          const parsed = Papa.parse(fs.readFileSync(fpath, 'utf8'), { header: true, skipEmptyLines: true });
          data = parsed.data || [];
        }
      } catch (e) { /* ignore */ }
      const grid = {};
      data.forEach(row => {
        const k = row['Standard Key'] || Object.values(row || {})[0];
        if (!k || typeof k !== 'string') return;
        const tk = k.trim();
        if (!tk) return;
        grid[tk] = { standardKey: tk };
        LTV_HEADERS.forEach(col => {
          grid[tk][col] = (row[col] != null ? row[col] : '0');
        });
      });
      if (Object.keys(grid).length) fullMatrix[key] = grid;
    }
  }
  const matrixPath = path.join(outDir, 'pricing-matrix.full.json');
  fs.writeFileSync(matrixPath, JSON.stringify(fullMatrix, null, 2), 'utf8');
  console.log('  wrote full pricing_matrix JSON to', matrixPath);
  console.log('  matrix top-level keys:', Object.keys(fullMatrix));

  // copy source
  const srcCopy = path.join(outRoot, 'Rate Sheet.csv');
  fs.copyFileSync(src, srcCopy);
  console.log('  copied source ->', srcCopy);

  // manifest
  const manifestPath = path.join(outDir, 'UPLOAD_INSTRUCTIONS.md');

  function getTabForTitle(title) {
    const low = title.toLowerCase();
    if (low.includes('fico')) return 'FICO Adjustment';
    if (low.includes('dscr')) return 'DSCR Adjustment';
    if (low.includes('loan size') || low.includes('balance')) return 'Loan Balance Adjustment';
    if (low.includes('property')) return 'Property Type Adjustment';
    if (low.includes('structure')) return 'Loan Structure Adjustment';
    if (low.includes('amort')) return 'Amortization Adjustment';
    if (low.includes('prepay')) return 'Prepayment Adjustment';
    if (low.includes('rent')) return 'Rent Adjustments';
    if (low.includes('late') || low.includes('30 day')) return 'Other Adjustments';
    if (low.includes('purpose')) return 'Other Adjustments (Loan Purpose grids not wired into pricing yet)';
    return 'Other Adjustments';
  }

  const mappingLines = written.map(w => {
    const tab = getTabForTitle(w.title);
    return `- **${w.fname}** (${w.count} rows)  →  **${tab}**  \n  (source: ${w.title})`;
  }).join('\n\n');

  const md = [
    '# Rate Sheet Separated CSVs — Upload Instructions for products/[id]/adjustments',
    '',
    'Source: "Rate Sheet.csv" (Easy Street Capital DSCR STANDARD Series, ~280 rows, 11 adjustment grids in right columns). Enhanced to also parse Base Rates + DSCR/Max LTV Master Matrices (FICO/LoanSize/Purpose → max LTV% per DSCR band) into full pricing_matrix.',
    '',
    'These files were auto-extracted so each "Adjustments: XXX" LTV grid can be uploaded independently.',
    '',
    '## Upload steps',
    '1. Open a loan product’s adjustments page: `/products/[id]/adjustments`',
    '2. For each tab (FICO Adjustment, DSCR Adjustment, …), click the purple **📤 Upload CSV** button and pick the matching file.',
    '3. The importer (handleCsvUpload + Papa) expects:',
    '   - Column "Standard Key" (or first column) → becomes the row key / factor name',
    '   - Exact LTV columns: `<=50,50.01-55,55.01-60,60.01-65,65.01-70,70.01-75,75.01-80`',
    '4. After the preview table appears, you can edit the **Standard Key (Primary)** cells.',
    '5. Click **💾 Save This Table** (saves that section into the product’s pricing_matrix JSON).',
    '6. Repeat for all sections you want. Then test in a loan quote /loans/new.',
    '',
    '## NEW: DSCR Master / Max LTV import (for eligibility)',
    '- Use the new "Import DSCR Master / Rate Sheet" section on the adjustments page (or load the pricing-matrix.full.json into product).',
    '- Upload "dscr greater than 1.25x ratio.csv" (or equiv per tab, or the full Rate Sheet.csv).',
    '- This populates `dscrMaxLtv` in pricing_matrix: { band: { fico: { sizeKey: { "Acquisition": "80.0%"| "NA", "Rate-Term Refinance":.., "Cash-Out Refinance":.. } } } }',
    '- In /loans/new: computed dscr + fico + loanSize + purpose (from loanType) → lookup maxLTV; if selected LTV > max or NA → Ineligible.',
    '- Grids (FICO/DSCR/LoanBalance/etc): if cell for LTV is "NA"/blank/non-numeric → Ineligible (0 or negative numeric = eligible 0-adj).',
    '',
    '## File → Tab mapping (use this order)',
    '',
    mappingLines,
    '',
    '## Post-import cleanup & key canonicalization (IMPORTANT)',
    '',
    '- **FICO Adjustment**: Keys (780+, 760-779 … 620-639) match getFicoBucket() in loans/new/page.tsx. Import should "just work".',
    '- **Loan Balance Adjustment**: Keys come in as "$100,001 - $125,000". The page’s normalizeLoanSizeKey() strips $ and commas and normalizes spaces around -, producing "100001-125000" which matches getLoanSizeBucket(). Good.',
    '- **DSCR Adjustment**: CSV has 5 coarse rows. Pricing uses 6-8 granular keys from getDscrBucket() (includes purchase vs refi variants for <1.00x and FICO splits). ',
    '  After upload, manually duplicate rows in the UI and rename Standard Keys to the exact strings your getDscrBucket returns, or update the DSCR bucket function + pricing to use the coarse keys from the rate sheet.',
    '- **Prepayment / Property Type / Rent / Other**: These feed the /products/keys page. After import:',
    '  1. Go to /products/keys',
    '  2. Pick the tab (e.g. Prepayment Adjustment)',
    '  3. Select the raw keys that came in from the CSV',
    '  4. Create "canonical_key" groups (these become the selectable values in the loan form dropdowns)',
    '  5. The loan pricing reads matrix[\'Prepayment Adjustment\'][canonical] etc.',
    '- **Loan Purpose** (Cash-Out Refi specific + main Acquisition/Rate-Term/Cash-Out) and **Loan Structure**: Not currently added to the runningTotal in getBrokerPrice(). They can live in "Other Adjustments" or you can extend the pricing logic if these factors should affect price.',
    '- "NA" / "N/A" / blank in grids now cause Ineligible for that rate/LTV (see loans/new getBrokerPrice + isEligible). Numeric (incl. 0) = eligible. Master dscrMaxLtv NA also Ineligible. Preserved as strings in JSON.',
    '',
    '## Regenerating',
    'Run:',
    '  node scripts/separate-rate-sheet.js [srcCsv] [outRootDir]',
    '',
    'It always writes:',
    '  <outRootDir>/Rate Sheet.csv                 (copy of input)',
    '  <outRootDir>/separated_rate_sheets/*.csv    (the 12-ish per-grid files)',
    '  <outRootDir>/separated_rate_sheets/pricing-matrix.full.json  (full: baseRates + dscrMaxLtv + adj grids; use for product creation or Adjustments import)',
    '  <outRootDir>/separated_rate_sheets/UPLOAD_INSTRUCTIONS.md',
    '',
    '## Notes',
    '- The left side (Base Rates, DSCR/Max LTV Master Matrices) is NOW parsed into the pricing-matrix.full.json (and dscrMaxLtv can be imported via Adjustments UI for master eligibility). Adjustment grids still separated for the tabs UI. (Base rates are dynamic via product bulk rebase; adjustments static yearly.)',
    '- For Signature Series: create 2 flat products ("Signature ACQ+RT", "Signature Cash Out") with their own matrices (separate base + adjs per loan type).',
    '- This script + the adjustments page upload (incl new DSCR Master section) + the keys grouping page together let you maintain the rate sheet in the original Excel/CSV form from the lender and periodically re-separate + re-upload.',
    '- Existing standard-dscr product + getBrokerPrice / buckets / grid / NA handling preserved (extended only for master + strict NA=Ineligible on grids).',
    '',
    'Generated for Easy Street Capital DSCR rate sheet (tabs → Standard/Streamline/Signature; Signature split flat).'
  ].join('\n');

  fs.writeFileSync(manifestPath, md, 'utf8');
  console.log('\nWrote manifest:', manifestPath);
  console.log('\nDone. Copy the Files/ (or just separated_rate_sheets + script) to your runtime tree if using worktrees.');
}

if (require.main === module) {
  main();
}
module.exports = { main }; // for testing if needed
