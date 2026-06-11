const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

// Relative paths (worktree + runtime compatible; no absolute outside worktree). Preserve existing standard-dscr product name.
const RUNTIME_FILES = path.resolve(__dirname, '../Files');
const SEPARATED_DIR = path.join(RUNTIME_FILES, 'separated_rate_sheets');
const ORG_ID = 'org_e8046f1c596f';
const PRODUCT_NAME = 'standard-dscr';

const { createClient } = require('@supabase/supabase-js');
const envPath = path.resolve(__dirname, '../.env.local');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k) acc[k.trim()] = v.join('=').trim();
  return acc;
}, {});
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const LTV_COLS = ['<=50', '50.01-55', '55.01-60', '60.01-65', '65.01-70', '70.01-75', '75.01-80'];

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = Papa.parse(content, { header: true, skipEmptyLines: true });
  return result.data;
}

function csvToGrid(data) {
  const grid = {};
  data.forEach(row => {
    const key = row['Standard Key'] || Object.values(row)[0];
    if (!key || typeof key !== 'string') return;
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    grid[trimmedKey] = { standardKey: trimmedKey };
    LTV_COLS.forEach(col => {
      grid[trimmedKey][col] = row[col] || '0';
    });
  });
  return grid;
}

// Inline (from separator) for dscrMaxLtv master + better base (preserve prior structure + NA handling)
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
    if (joined.includes('Base Rates')) { inBase = true; continue; }
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
    if (b) { currentBand = b; currentFicos = []; continue; }
    if (!currentBand) continue;
    const ficoCell = row.find(c => c && typeof c === 'string' && c.includes('\n') && /78[0-9]|76[0-9]|74[0-9]|72[0-9]|70[0-9]|68[0-9]|66[0-9]|64[0-9]|62[0-9]/.test(c));
    if (ficoCell) { currentFicos = String(ficoCell).split(/[\n\r]+/).map(s => normalizeFicoKey(s)).filter(Boolean); continue; }
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
        if (/^\d/.test(vs) || vs.includes('%') || /NA/i.test(vs) || /^-?\d/.test(vs)) { vals.push(vs); if (vals.length >= 3) break; }
      }
      const acq = vals[0] || 'NA';
      const rt = vals[1] || 'NA';
      const co = vals[2] || 'NA';
      if (!dscrMaxLtv[currentBand]) dscrMaxLtv[currentBand] = {};
      const ficosToUse = currentFicos.length > 0 ? currentFicos : ['780+'];
      for (const f of ficosToUse) {
        if (!dscrMaxLtv[currentBand][f]) dscrMaxLtv[currentBand][f] = {};
        dscrMaxLtv[currentBand][f][sizeKey] = { 'Acquisition': acq, 'Rate-Term Refinance': rt, 'Cash-Out Refinance': co };
      }
    }
  }
  return dscrMaxLtv;
}

async function main() {
  console.log('Creating product standard-dscr for org', ORG_ID);

  // Create product
  const { data: existing } = await supabase
    .from('loan_products')
    .select('id')
    .eq('name', PRODUCT_NAME)
    .eq('organization_id', ORG_ID)
    .single();

  let productId;
  if (existing) {
    productId = existing.id;
    console.log('Product exists, id:', productId);
  } else {
    const { data: newProd, error } = await supabase
      .from('loan_products')
      .insert({
        name: PRODUCT_NAME,
        description: 'Standard DSCR product from Rate Sheet',
        pricing_matrix: {},
        default_profit_percent: 1.0,
        active: true,
        organization_id: ORG_ID,
      })
      .select()
      .single();
    if (error) throw error;
    productId = newProd.id;
    console.log('Created product, id:', productId);
  }

  // Build matrix from separated CSVs (grids) + parsed base/dscrMaxLtv from rate sheet.
  // Legacy series/* kept for backward compat with prior pricing_matrix consumers; new code uses baseRates + dscrMaxLtv + *LtvGrid etc.
  const matrix = {
    series: {
      standard: { maxLTV: 75, baseAdjustment: 0 },
      signature: { maxLTV: 80, baseAdjustment: -0.25 }
    },
    baseRate: 6.0,  // placeholder from sheet ~6
    ltvAdjustments: {},
    dscrAdjustments: {},
    ficoAdjustments: {},
    // the grids + dscrMaxLtv added below
  };

  const mappings = {
    '00-fico.csv': 'ficoLtvGrid',
    '01-dscr.csv': 'dscrLtvGrid',
    '02-loan-size.csv': 'loanBalanceLtvGrid',
    '04-property-type.csv': 'propertyTypeAcquisition',
    '06-amortization-or-io.csv': 'amortizationAdjustment',
    '07-prepayment-penalty.csv': 'Prepayment Adjustment',
    '08-rent-qualification.csv': 'Rent Adjustments',
    '11-other-adjustments.csv': 'Other Adjustments',
    // add more if wanted
    '03-loan-purpose-cash-out-refinance.csv': 'Other Adjustments',
    '05-loan-structure.csv': 'Other Adjustments',
    '09-30-day-mortgage-lates-last-12-months.csv': 'Other Adjustments',
    '10-loan-purpose.csv': 'Other Adjustments',
  };

  for (const [file, key] of Object.entries(mappings)) {
    const fullPath = path.join(SEPARATED_DIR, file);
    if (fs.existsSync(fullPath)) {
      const data = parseCsv(fullPath);
      const grid = csvToGrid(data);
      matrix[key] = grid;
      console.log(`Loaded ${file} -> ${key} (${Object.keys(grid).length} rows)`);
    } else {
      console.warn('Missing:', file);
    }
  }

  // Parse baseRates + dscrMaxLtv (master) from original CSV (enhanced; NA preserved)
  const originalCsv = path.join(RUNTIME_FILES, 'Rate Sheet.csv');
  if (fs.existsSync(originalCsv)) {
    const content = fs.readFileSync(originalCsv, 'utf8');
    const rows = Papa.parse(content, { skipEmptyLines: false }).data;
    const baseRates = parseBaseRates(rows);
    if (Object.keys(baseRates).length > 0) {
      matrix.baseRates = baseRates;
      console.log('Loaded baseRates:', Object.keys(baseRates).length);
    }
    const dscrMax = parseDscrMaxLtv(rows);
    if (Object.keys(dscrMax).length > 0) {
      matrix.dscrMaxLtv = dscrMax;
      console.log('Loaded dscrMaxLtv bands:', Object.keys(dscrMax).join(', '));
    }
  }

  // Update product
  const { error: updateErr } = await supabase
    .from('loan_products')
    .update({ pricing_matrix: matrix })
    .eq('id', productId);

  if (updateErr) {
    console.error('Update error:', updateErr);
    throw updateErr;
  }

  console.log('✅ Product standard-dscr updated with rate sheet data. pricing_matrix keys:', Object.keys(matrix));
  if (matrix.dscrMaxLtv) console.log('  (incl dscrMaxLtv for master eligibility)');
  console.log('Go to /products/' + productId + '/adjustments to view/edit (use Import DSCR Master), or use in loans/new.');
}

main().catch(console.error);
