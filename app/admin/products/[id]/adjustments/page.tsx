'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// TenantHeader removed - AppHeader is now global via root layout
import Papa from 'papaparse';
import { fetchTreasuryRate } from '@/app/actions/organization-actions';

const adjustmentTypes = [
  'FICO Adjustment', 
  'DSCR Adjustment', 
  'Loan Balance Adjustment',
  'Property Type Adjustment', 
  'Loan Structure Adjustment', 
  'Amortization Adjustment',
  'Prepayment Adjustment', 
  'Rent Adjustments', 
  'Other Adjustments'
  // Removed: 'Base Rate' and 'Markup'
];

export default function ProductAdjustmentsPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchProduct();
  }, [productId]);

  async function fetchProduct() {
    setLoading(true);
    const { data } = await supabase
      .from('loan_products')
      .select('*')
      .eq('id', productId)
      .single();
    if (data) setProduct(data);
    setLoading(false);
  }

  const updatePricingMatrix = (newMatrix: any) => {
    setProduct((prev: any) => ({
      ...prev,
      pricing_matrix: { ...(prev?.pricing_matrix || {}), ...newMatrix }
    }));
  };

  const saveTable = async (tab: string) => {
    if (!product) return;
    setSaving(tab);
    const { error } = await supabase
      .from('loan_products')
      .update({ pricing_matrix: product.pricing_matrix })
      .eq('id', productId);
    if (error) alert('Save failed');
    else alert(`✅ ${tab} saved successfully!`);
    setSaving(null);
  };

  const saveDscrMaster = async () => {
    if (!product) return;
    setSaving('dscrMaster');
    const { error } = await supabase
      .from('loan_products')
      .update({ pricing_matrix: product.pricing_matrix })
      .eq('id', productId);
    if (error) alert('Save DSCR Master failed');
    else alert('✅ DSCR Master / Rate Sheet saved to pricing_matrix!');
    setSaving(null);
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading adjustments...</div>;
  if (!product) return <div className="p-10">Product not found</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Global AppHeader rendered by root layout */}
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold">{product.name} — All Adjustments</h1>
        <button
          onClick={() => router.push(`/admin/products/${productId}`)}
          className="px-8 py-4 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
        >
          ← Back to Main Product
        </button>
      </div>

      {adjustmentTypes.map((tab) => (
        <AdjustmentSection
          key={tab}
          tab={tab}
          product={product}
          updatePricingMatrix={updatePricingMatrix}
          onSave={() => saveTable(tab)}
          saving={saving === tab}
        />
      ))}

      {/* NEW: Import DSCR Master / Rate Sheet section (supports "dscr greater than 1.25x ratio.csv" + full Rate Sheet.csv from tabs; parses to dscrMaxLtv + can pull baseRates; NA preserved) */}
      <DscrMasterImportSection
        product={product}
        updatePricingMatrix={updatePricingMatrix}
        onSave={() => saveDscrMaster()}
        saving={saving === 'dscrMaster'}
      />
    </div>
  );
}

// ====================== UNIVERSAL ADJUSTMENT SECTION (Standard Key First) ======================
function AdjustmentSection({ tab, product, updatePricingMatrix, onSave, saving }: any) {
  const [tableData, setTableData] = useState<any>({});

  useEffect(() => {
    const matrix = product?.pricing_matrix || {};
    const storageKey = getStorageKey(tab);
    let source = matrix[storageKey] || {};

    setTableData((prev: any) => {
      const merged = JSON.parse(JSON.stringify(source));
      Object.keys(prev || {}).forEach(key => {
        if (prev[key]) merged[key] = { ...(merged[key] || {}), ...prev[key] };
      });
      return merged;
    });
  }, [tab, product]);

  const handleCellChange = (rowKey: string, colKey: string, value: string) => {
    setTableData((prev: any) => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] || {}), [colKey]: value }
    }));
  };

  const saveCurrentTableToParent = () => {
    const storageKey = getStorageKey(tab);
    let dataToSave = { ...tableData };

    // Ensure every row has standardKey
    Object.keys(dataToSave).forEach(key => {
      const row = dataToSave[key];
      dataToSave[key] = {
        ...row,
        standardKey: row.standardKey || key
      };
    });

    updatePricingMatrix({ [storageKey]: dataToSave });
  };

  const clearTable = () => {
    if (!confirm(`Clear all data in ${tab}?`)) return;
    updatePricingMatrix({ [getStorageKey(tab)]: {} });
    setTableData({});
  };

  const getStorageKey = (t: string): string => {
    const map: any = {
      'Base Rate': 'baseRates',
      'FICO Adjustment': 'ficoLtvGrid',
      'DSCR Adjustment': 'dscrLtvGrid',
      'Loan Balance Adjustment': 'loanBalanceLtvGrid',
      'Property Type Adjustment': 'propertyTypeAcquisition',
      'Prepayment Adjustment': 'Prepayment Adjustment',
      'Rent Adjustments': 'Rent Adjustments',
      'Other Adjustments': 'Other Adjustments',
      'Amortization Adjustment': 'amortizationAdjustment',
    };
    return map[t] || t;
  };

  // ... (keep your normalizeLoanSizeKey and handleCsvUpload exactly as they are)

  const normalizeLoanSizeKey = (key: string): string => {
    return key.toString().replace(/\$/g, '').replace(/,/g, '').trim().replace(/\s*-\s*/, '-');
  };

   const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: any) => {
        const newData: any = {};
        const ltvColumns = ['<=50', '50.01-55', '55.01-60', '60.01-65', '65.01-70', '70.01-75', '75.01-80'];

        results.data.forEach((row: any) => {
          let rowKey = row['Standard Key'] || row['standardKey'] ||
                       row[Object.keys(row)[0]] || row[0]?.trim();

          if (!rowKey || typeof rowKey === 'object') return;
          rowKey = String(rowKey).trim();

          const finalKey = tab === 'Loan Balance Adjustment' 
            ? normalizeLoanSizeKey(rowKey) 
            : rowKey;

          if (tab === 'Base Rate' || tab === 'Amortization Adjustment' || tab === 'Markup') {
            newData[finalKey] = row['Price'] || row['Premium / Price'] || row['Adjustment'] || row[1] || '0';
          } else {
            newData[finalKey] = {
              standardKey: finalKey,
              ...Object.fromEntries(ltvColumns.map(col => [col, row[col] || '0']))
            };
          }
        });

        updatePricingMatrix({ [getStorageKey(tab)]: newData });
        alert(`✅ Imported ${Object.keys(newData).length} rows into ${tab}`);

        // Snapshot treasury anchor for base rates if org has benchmark (fire-and-forget to avoid await-in-non-async in parser callback)
        if (tab === 'Base Rate' && product?.organization_id) {
          (async () => {
            try {
              const { data: org } = await supabase
                .from('organizations')
                .select('benchmark_treasury')
                .eq('id', product.organization_id)
                .single();
              if (org?.benchmark_treasury) {
                const treas = await fetchTreasuryRate(org.benchmark_treasury);
                if (!treas.error && treas.rate != null) {
                  updatePricingMatrix({
                    benchmark: org.benchmark_treasury,
                    benchmark_anchor_rate: treas.rate,
                  });
                  alert(`Base rates now anchored to ${org.benchmark_treasury} @ ${treas.rate}% (delta will be applied on future rebase)`);
                }
              }
            } catch (e) {
              console.warn('Could not snapshot treasury anchor on base rate upload', e);
            }
          })();
        }
      }
    });
  };

   return (
    <div className="bg-white border rounded-3xl p-8 mb-12">
      <div className="flex justify-between items-center mb-6 border-b pb-6">
        <h2 className="text-2xl font-semibold">{tab}</h2>
        <div className="flex gap-3">
          <button onClick={clearTable} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">🗑️ Clear Table</button>
          <label className="px-6 py-3 bg-purple-600 text-white rounded-2xl text-sm font-medium hover:bg-purple-700 cursor-pointer flex items-center gap-2">
            📤 Upload CSV
            <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
          </label>
          <button 
            onClick={() => { saveCurrentTableToParent(); setTimeout(onSave, 100); }}
            disabled={saving}
            className="px-8 py-3 bg-green-600 text-white rounded-2xl font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : '💾 Save This Table'}
          </button>
        </div>
      </div>

      {/* Main Table - Standard Key is the primary column */}
      <table className="w-full border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-3 text-left">Standard Key (Primary)</th>
            <th className="border p-3 text-left">Original CSV Key (Reference)</th>
            {['<=50','50.01-55','55.01-60','60.01-65','65.01-70','70.01-75','75.01-80'].map(c => (
              <th key={c} className="border p-3">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(tableData).map(originalKey => {
            const row = tableData[originalKey] || {};
            return (
              <tr key={originalKey}>
                {/* STANDARD KEY - Primary editable column */}
                <td className="border p-3 font-medium bg-gray-50">
                  <input 
                    type="text" 
                    value={row.standardKey || originalKey} 
                    onChange={e => handleCellChange(originalKey, 'standardKey', e.target.value)}
                    className="w-full bg-transparent focus:outline-none font-medium"
                  />
                </td>

                {/* Original CSV Key - Reference only */}
                <td className="border p-3 text-gray-500">
                  {originalKey}
                </td>

                {/* LTV Columns */}
                {['<=50','50.01-55','55.01-60','60.01-65','65.01-70','70.01-75','75.01-80'].map(col => (
                  <td key={col} className="border p-3 text-center">
                    <input 
                      type="text" 
                      value={row[col] || ''} 
                      onChange={e => handleCellChange(originalKey, col, e.target.value)} 
                      className="w-full text-center" 
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ====================== NEW: DSCR MASTER / RATE SHEET IMPORT SECTION ======================
// Supports upload of dedicated "dscr greater than 1.25x ratio.csv" (and per-tab equivs) + full Rate Sheet.csv
// Parses into dscrMaxLtv (FICO/LoanSize/Purpose -> maxLTV% or "NA" per band) + optionally baseRates.
// NA/blank preserved as strings. Updates local matrix; use Save button (or parent).
function DscrMasterImportSection({ product, updatePricingMatrix, onSave, saving }: any) {
  const [importStatus, setImportStatus] = useState<string>('');

  const normalizeLoanSizeForMaster = (key: string): string => {
    return key.toString().replace(/\$/g, '').replace(/,/g, '').trim().replace(/\s*-\s*/, '-');
  };

  const isIneligibleVal = (v: any): boolean => {
    if (v == null) return true;
    const s = String(v).trim().toUpperCase();
    if (!s || s === 'NA' || s === 'N/A') return true;
    const n = parseFloat(s.replace('%', ''));
    return isNaN(n);
  };

  // Flexible parser: works on full Rate Sheet.csv rows (header:false) and simpler per-dscr CSVs.
  // Returns partial { dscrMaxLtv: {...}, baseRates?: {...} }
  function parseDscrMasterFromRows(rows: any[][], filename: string = ''): any {
    const out: any = { dscrMaxLtv: {} };
    let currentBand: string | null = null;
    let currentFicos: string[] = [];
    const bandFromName = (name: string): string | null => {
      const n = name.toLowerCase();
      if (n.includes('1.25') || n.includes('greater than 1.25')) return '>=1.25x';
      if (n.includes('1.15')) return '1.15x - 1.24x';
      if (n.includes('1.00') || n.includes('1.14')) return '1.00x - 1.14x';
      if (n.includes('0.75')) return '0.75x - 0.99x';
      return null;
    };
    const sheetToBand = (title: string): string | null => {
      const t = String(title || '').toUpperCase().replace(/\s+/g, ' ');
      if (t.includes('>=1.25') || /DSCR\s*>=?\s*1\.25/.test(t)) return '>=1.25x';
      if (t.includes('1.15') && t.includes('1.24')) return '1.15x - 1.24x';
      if (t.includes('1.00') && t.includes('1.14')) return '1.00x - 1.14x';
      if (t.includes('0.75') && t.includes('0.99')) return '0.75x - 0.99x';
      if (t.includes('<0.75')) return '<0.75x';
      return null;
    };

    // quick base parse (if full sheet)
    const base: any = {};
    let sawBase = false;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i] || [];
      const j = r.join(' ');
      if (j.includes('Base Rates')) { sawBase = true; continue; }
      if (sawBase) {
        const rate = (r[1] || '').toString().trim();
        const prem = (r[2] || '').toString().trim();
        if (rate && !isNaN(parseFloat(rate))) base[rate] = prem || rate;
        if (j.includes('DSCR / Max')) break;
      }
    }
    if (Object.keys(base).length) out.baseRates = base;

    // main master parse (state machine over rows as arrays)
    let defaultBand = bandFromName(filename);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const joined = row.join(' ').toUpperCase();

      const b = sheetToBand(joined);
      if (b) { currentBand = b; currentFicos = []; continue; }

      if (!currentBand && defaultBand && (joined.includes('FICO') || joined.includes('LOAN SIZE') || joined.includes('ACQUISITION'))) {
        currentBand = defaultBand;
      }
      if (!currentBand) continue;

      // FICO multi-line block
      const ficoCell = row.find((c: any) => c && String(c).includes('\n') && /78[0-9]|76|74|72|70|68|66|64|62/.test(String(c)));
      if (ficoCell) {
        currentFicos = String(ficoCell).split(/[\n\r]+/).map((s: string) => s.trim().replace(/\s+/g, '')).filter(Boolean);
        continue;
      }

      // size row
      const sizeIdx = row.findIndex((c: any) => {
        const cs = (c || '').toString();
        return /\$?\d{2,3}[,.]?\d{3}\s*-\s*\$?\d/.test(cs) || (cs.includes('$') && cs.includes('-'));
      });
      if (sizeIdx !== -1) {
        const sizeKey = normalizeLoanSizeForMaster(row[sizeIdx]);
        if (!sizeKey) continue;
        const after = row.slice(sizeIdx + 1);
        const vals: string[] = [];
        for (const v of after) {
          const vs = (v || '').toString().trim();
          if (!vs) continue;
          if (/^\d/.test(vs) || vs.includes('%') || /NA/i.test(vs)) { vals.push(vs); if (vals.length >= 3) break; }
        }
        const acq = vals[0] || 'NA';
        const rt = vals[1] || 'NA';
        const co = vals[2] || 'NA';
        const bandKey = currentBand;
        if (!out.dscrMaxLtv[bandKey]) out.dscrMaxLtv[bandKey] = {};
        const fUse = currentFicos.length ? currentFicos : ['780+'];
        for (const f of fUse) {
          if (!out.dscrMaxLtv[bandKey][f]) out.dscrMaxLtv[bandKey][f] = {};
          out.dscrMaxLtv[bandKey][f][sizeKey] = {
            'Acquisition': acq,
            'Rate-Term Refinance': rt,
            'Cash-Out Refinance': co
          };
        }
      }
    }

    // if dedicated simple table (header row with Acquisition etc, no bands seen), wrap under default or first
    if (Object.keys(out.dscrMaxLtv).length === 0 && defaultBand) {
      // try header-based simple parse (assume columns FICO,Loan Size,Acquisition,... or firsts)
      const headerRow = rows.find(r => (r||[]).some((c:any)=> String(c||'').toUpperCase().includes('ACQUISITION')));
      if (headerRow) {
        const hIdx = rows.indexOf(headerRow);
        out.dscrMaxLtv[defaultBand] = {};
        for (let k = hIdx + 1; k < rows.length; k++) {
          const r = rows[k] || [];
          if (!r.length || !r.some((c:any)=>c)) continue;
          const ficoRaw = (r[0] || '').toString().trim();
          const sizeRaw = (r[1] || r.find((c:any,i:number)=>i>0 && /\$?\d/.test(String(c))) || '').toString();
          const sizeK = normalizeLoanSizeForMaster(sizeRaw);
          if (!sizeK || !ficoRaw) continue;
          const fK = ficoRaw.replace(/\s+/g,'');
          out.dscrMaxLtv[defaultBand][fK] = out.dscrMaxLtv[defaultBand][fK] || {};
          out.dscrMaxLtv[defaultBand][fK][sizeK] = {
            'Acquisition': r[2] || 'NA',
            'Rate-Term Refinance': r[3] || 'NA',
            'Cash-Out Refinance': r[4] || 'NA'
          };
        }
      }
    }

    return out;
  }

  const handleDscrMasterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus('Parsing...');

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results: any) => {
        const rows = results.data as any[][];
        const parsed = parseDscrMasterFromRows(rows, file.name);
        const bands = Object.keys(parsed.dscrMaxLtv || {});
        if (!bands.length && !parsed.baseRates) {
          setImportStatus('No DSCR master data or baseRates found in CSV.');
          return;
        }

        const updates: any = {};
        if (bands.length) {
          const existing = (product?.pricing_matrix?.dscrMaxLtv || {});
          updates.dscrMaxLtv = { ...existing, ...parsed.dscrMaxLtv };
        }
        if (parsed.baseRates && Object.keys(parsed.baseRates).length) {
          updates.baseRates = { ...(product?.pricing_matrix?.baseRates || {}), ...parsed.baseRates };
        }

        updatePricingMatrix(updates);
        setImportStatus(`✅ Imported ${bands.length ? 'dscrMaxLtv bands: ' + bands.join(', ') : ''} ${parsed.baseRates ? ' + baseRates' : ''}. Click Save DSCR Master.`);
        // reset file input
        e.target.value = '';
      }
    });
  };

  return (
    <div className="bg-white border-2 border-violet-300 rounded-3xl p-8 mb-12">
      <div className="flex justify-between items-center mb-6 border-b pb-6">
        <h2 className="text-2xl font-semibold">Import DSCR Master / Rate Sheet (dscrMaxLtv + base)</h2>
        <div className="flex gap-3">
          <label className="px-6 py-3 bg-violet-600 text-white rounded-2xl text-sm font-medium hover:bg-violet-700 cursor-pointer flex items-center gap-2">
            📤 Upload DSCR Master CSV (or full Rate Sheet.csv)
            <input type="file" accept=".csv" onChange={handleDscrMasterUpload} className="hidden" />
          </label>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-8 py-3 bg-green-600 text-white rounded-2xl font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : '💾 Save DSCR Master'}
          </button>
        </div>
      </div>
      <div className="text-sm text-gray-600 mb-4">
        Uploads like <code>dscr greater than 1.25x ratio.csv</code> (or equivalents from XLS tabs, or the Rate Sheet.csv itself).
        Populates <code>dscrMaxLtv</code> (qualification: band → fico → size → purpose max LTV% or "NA") and baseRates if present.
        Values with "NA"/blank remain as strings (→ Ineligible in loans/new grid). Numeric 0 is eligible.
      </div>
      {importStatus && (
        <div className="p-3 bg-violet-50 border border-violet-200 rounded text-sm">{importStatus}</div>
      )}
      {product?.pricing_matrix?.dscrMaxLtv && (
        <div className="mt-4 text-xs text-gray-500">
          Current dscrMaxLtv bands in matrix: {Object.keys(product.pricing_matrix.dscrMaxLtv).join(', ')}
        </div>
      )}
    </div>
  );
}