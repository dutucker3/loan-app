'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
// TenantHeader removed - replaced by global AppHeader in root layout (with logout + profile)
import {
  createAdjustmentKeyGroup,
  addAliasesToAdjustmentKey,
  deleteAdjustmentKey,
} from '@/app/actions/organization-actions';

export default function KeyManagementPage() {
  const [selectedType, setSelectedType] = useState('Prepayment Adjustment');
  const [ungroupedKeys, setUngroupedKeys] = useState<string[]>([]);
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [existingGroups, setExistingGroups] = useState<any[]>([]);
  const [newStandardKey, setNewStandardKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  const adjustmentTypes = [
    'Prepayment Adjustment',
    'Property Type Adjustment',
    'FICO Adjustment',
    'DSCR Adjustment',
    'Loan Balance Adjustment',
    'Amortization Adjustment',
    'Rent Adjustments',
    'Other Adjustments'
  ];

  // Load current user's organization from profiles (post Clerk removal)
  useEffect(() => {
    async function loadCurrentOrg() {
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        if (sbUser?.id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('organization_id')
            .eq('id', sbUser.id)
            .maybeSingle();
          if (prof?.organization_id) {
            setCurrentOrgId(prof.organization_id);
          }
        }
      } catch (e) {
        console.warn('Could not load current org for keys page', e);
      }
    }
    loadCurrentOrg();
  }, []);

  // Load data when org or type changes
  useEffect(() => {
    if (currentOrgId) {
      fetchData();
    } else {
      console.log("⏳ Waiting for current organization (from profile)...");
    }
  }, [selectedType, currentOrgId]);

  async function fetchData() {
    if (!currentOrgId) {
      console.log("⏳ No current organization id yet.");
      setLoading(false);
      return;
    }

    setLoading(true);
    console.log("🔍 Starting fetchData for type:", selectedType);
    console.log("✅ Current Org ID (from profile):", currentOrgId);

    const internalOrgId = currentOrgId;

    // Step 2: Get existing groups — now properly scoped to the user's org (inserts set organization_id,
    // and loans/new already queries with the filter). This prevents cross-org leakage in white-label setups.
    const { data: groups } = await supabase
      .from('adjustment_keys')
      .select('*')
      .eq('adjustment_type', selectedType)
      .eq('organization_id', internalOrgId)
      .order('canonical_key');

    setExistingGroups(groups || []);
    console.log("📊 Existing groups found:", groups?.length || 0);

    // Step 3: Get products using the org ID
    const { data: products, error } = await supabase
      .from('loan_products')
      .select('id, name, pricing_matrix')
      .eq('organization_id', internalOrgId);

    console.log("📦 Products query error:", error);
    console.log("📦 Products found:", products?.length || 0);

    const rawSet = new Set<string>();

    products?.forEach((product: any) => {
      let matrix = product.pricing_matrix;
      if (typeof matrix === 'string') {
        try { matrix = JSON.parse(matrix); } 
        catch (e) { console.error("Parse error for product", product.id); return; }
      }

      const storageKey = getStorageKey(selectedType);
      const section = matrix?.[storageKey] || matrix?.[selectedType] || {};

      console.log(`Product ${product.id} (${product.name}) → "${storageKey}" → ${Object.keys(section).length} keys`);

      Object.keys(section).forEach(key => {
        if (key && typeof key === 'string' && key.trim()) {
          rawSet.add(key.trim());
        }
      });
    });

    console.log("🔑 All raw keys found:", Array.from(rawSet));

    const grouped = new Set(
      groups?.flatMap((g: any) => [g.canonical_key, ...(g.aliases || [])]) || []
    );

    const ungrouped = Array.from(rawSet)
      .filter(key => !grouped.has(key))
      .sort();

    setUngroupedKeys(ungrouped);
    console.log("✅ Final ungrouped keys:", ungrouped);

    setLoading(false);
  }

  const getStorageKey = (t: string): string => {
    const map: any = {
      'Base Rate': 'baseRates',
      'FICO Adjustment': 'ficoLtvGrid',
      'DSCR Adjustment': 'dscrLtvGrid',
      'Loan Balance Adjustment': 'loanBalanceLtvGrid',
      'Property Type Adjustment': 'propertyTypeRefi',        // ← Important fix
      'Prepayment Adjustment': 'Prepayment Adjustment',
      'Rent Adjustments': 'Rent Adjustments',
      'Other Adjustments': 'Other Adjustments',
      'Amortization Adjustment': 'Amortization Adjustment',
    };
    return map[t] || t;
  };

  const toggleSelectKey = (key: string) => {
    if (selectedForMerge.includes(key)) {
      setSelectedForMerge(selectedForMerge.filter(k => k !== key));
    } else {
      setSelectedForMerge([...selectedForMerge, key]);
    }
  };

  // Robust error message extractor (the Supabase error sometimes arrives as {} or without .message
  // when logged from client; server actions now throw a clean string).
  function getErrorMessage(err: any): string {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    return err.message || err.hint || err.details || err.code || JSON.stringify(err);
  }

  const createNewGroup = async () => {
    if (!newStandardKey.trim() || selectedForMerge.length === 0) {
      alert("Please enter a standard key and select at least one key to merge.");
      return;
    }

    if (!currentOrgId) {
      alert("No current organization loaded yet.");
      return;
    }

    try {
      await createAdjustmentKeyGroup({
        organizationId: currentOrgId,
        adjustmentType: selectedType,
        canonicalKey: newStandardKey.trim(),
        aliases: selectedForMerge,
      });
      alert("✅ Group created successfully!");
      setNewStandardKey('');
      setSelectedForMerge([]);
      fetchData(); // Refresh the list
    } catch (err: any) {
      console.error("Insert error:", err);
      alert("Failed to create group: " + getErrorMessage(err));
    }
  };

  const addToExistingGroup = async (groupId: string) => {
    if (selectedForMerge.length === 0) return;

    try {
      await addAliasesToAdjustmentKey(groupId, selectedForMerge);
      alert("✅ Keys added to existing group!");
      setSelectedForMerge([]);
      fetchData();
    } catch (err: any) {
      console.error("Add to group error:", err);
      alert("Failed to add to group: " + getErrorMessage(err));
    }
  };

  const ungroup = async (groupId: string) => {
    if (!confirm("Ungroup this key?")) return;

    try {
      await deleteAdjustmentKey(groupId, currentOrgId);
      fetchData();
    } catch (err: any) {
      console.error("Ungroup error:", err);
      alert(getErrorMessage(err));
    }
  };
  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Global AppHeader (root layout) */}
      <h1 className="text-3xl font-bold mb-8">Key Management — Merge Similar Keys</h1>

      <div className="flex gap-4 mb-8 flex-wrap">
        {adjustmentTypes.map(t => (
          <button
            key={t}
            onClick={() => setSelectedType(t)}
            className={`px-6 py-3 rounded-2xl ${selectedType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Ungrouped Keys */}
        <div className="bg-white border rounded-3xl p-8">
          <h3 className="font-semibold mb-4">Ungrouped Keys ({ungroupedKeys.length})</h3>
          <div className="max-h-96 overflow-auto space-y-2">
            {ungroupedKeys.map(k => (
              <div
                key={k}
                onClick={() => toggleSelectKey(k)}
                className={`p-4 border rounded-2xl cursor-pointer transition ${selectedForMerge.includes(k) ? 'bg-blue-50 border-blue-600' : 'hover:bg-gray-50'}`}
              >
                {k}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Merge Controls */}
        <div className="bg-white border rounded-3xl p-8">
          <h3 className="font-semibold mb-4">Keys to Merge ({selectedForMerge.length})</h3>
          <div className="mb-6 min-h-[200px] border rounded-2xl p-4 bg-gray-50">
            {selectedForMerge.length > 0 ? selectedForMerge.join(', ') : 'Select keys from the left'}
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">New Standard Key</label>
              <input
                type="text"
                value={newStandardKey}
                onChange={e => setNewStandardKey(e.target.value)}
                placeholder="e.g. 5 Year Step Down"
                className="w-full px-4 py-3 border rounded-2xl"
              />
              <button onClick={createNewGroup} className="mt-3 px-6 py-3 bg-green-600 text-white rounded-2xl w-full">
                Create New Group
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Add to Existing Group</label>
              <select 
                onChange={(e) => addToExistingGroup(e.target.value)} 
                className="w-full px-4 py-3 border rounded-2xl"
                defaultValue=""
              >
                <option value="">Select group...</option>
                {existingGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.canonical_key}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Existing Groups Table */}
      <div className="mt-12 bg-white border rounded-3xl p-8">
        <h3 className="font-semibold mb-6">Current Groups</h3>
        {existingGroups.map((group, i) => (
          <div key={i} className="border rounded-2xl p-6 mb-6 flex justify-between items-center">
            <div>
              <div className="font-medium text-lg">{group.canonical_key}</div>
              <div className="text-sm text-gray-600">Display: {group.display_name}</div>
              <div className="text-xs text-gray-400 mt-1">
                Aliases: {group.aliases?.join(', ') || 'None'}
              </div>
            </div>
            <button 
              onClick={() => ungroup(group.id)}
              className="px-6 py-3 text-red-600 border border-red-200 rounded-2xl hover:bg-red-50"
            >
              Ungroup
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}