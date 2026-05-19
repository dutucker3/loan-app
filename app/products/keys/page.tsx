'use client';

import React, { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import TenantHeader from '@/components/TenantHeader';

export default function KeyManagementPage() {
  const { organization } = useOrganization();
  const [selectedType, setSelectedType] = useState('Prepayment Adjustment');
  const [ungroupedKeys, setUngroupedKeys] = useState<string[]>([]);
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [existingGroups, setExistingGroups] = useState<any[]>([]);
  const [newStandardKey, setNewStandardKey] = useState('');
  const [loading, setLoading] = useState(true);

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

  // Updated useEffect - waits for organization to load
  useEffect(() => {
    if (organization?.id) {
      fetchData();
    } else {
      console.log("⏳ Waiting for organization data from Clerk...");
    }
  }, [selectedType, organization?.id]);
  async function fetchData() {
    if (!organization?.id) {
      console.log("⏳ Waiting for Clerk organization...");
      return;
    }

    setLoading(true);
    console.log("🔍 Starting fetchData for type:", selectedType);
    console.log("✅ Clerk Org ID:", organization.id);

    // Step 1: Get internal organization ID from organizations table
    const { data: orgData } = await supabase
      .from('organizations')
      .select('id')
      .eq('clerk_org_id', organization.id)
      .single();

    const internalOrgId = orgData?.id;

    console.log("🔑 Internal Org ID found:", internalOrgId);

    if (!internalOrgId) {
      console.error("❌ Could not find internal organization ID for clerk_org_id:", organization.id);
      setLoading(false);
      return;
    }

    // Step 2: Get existing groups
    const { data: groups } = await supabase
      .from('adjustment_keys')
      .select('*')
      .eq('adjustment_type', selectedType)
      .order('canonical_key');

    setExistingGroups(groups || []);
    console.log("📊 Existing groups found:", groups?.length || 0);

    // Step 3: Get products using INTERNAL org ID
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

  const createNewGroup = async () => {
    if (!newStandardKey.trim() || selectedForMerge.length === 0) {
      alert("Please enter a standard key and select at least one key to merge.");
      return;
    }

    if (!organization?.id) return;

    // Get internal org ID first
    const { data: orgData } = await supabase
      .from('organizations')
      .select('id')
      .eq('clerk_org_id', organization.id)
      .single();

    const internalOrgId = orgData?.id;
    if (!internalOrgId) {
      alert("Could not find internal organization ID.");
      return;
    }

    const { error } = await supabase
      .from('adjustment_keys')
      .insert({
        organization_id: internalOrgId,
        adjustment_type: selectedType,
        canonical_key: newStandardKey.trim(),
        display_name: newStandardKey.trim(),
        aliases: selectedForMerge
      });

    if (error) {
      console.error("Insert error:", error);
      alert("Failed to create group: " + error.message);
    } else {
      alert("✅ Group created successfully!");
      setNewStandardKey('');
      setSelectedForMerge([]);
      fetchData(); // Refresh the list
    }
  };

  const addToExistingGroup = async (groupId: string) => {
    if (selectedForMerge.length === 0) return;

    const { data: group } = await supabase
      .from('adjustment_keys')
      .select('aliases')
      .eq('id', groupId)
      .single();

    const currentAliases = group?.aliases || [];
    const newAliases = [...new Set([...currentAliases, ...selectedForMerge])];

    const { error } = await supabase
      .from('adjustment_keys')
      .update({ aliases: newAliases })
      .eq('id', groupId);

    if (error) {
      alert("Failed to add to group: " + error.message);
    } else {
      alert("✅ Keys added to existing group!");
      setSelectedForMerge([]);
      fetchData();
    }
  };

  const ungroup = async (groupId: string) => {
    if (!confirm("Ungroup this key?")) return;

    const { error } = await supabase
      .from('adjustment_keys')
      .delete()
      .eq('id', groupId);

    if (error) alert(error.message);
    else fetchData();
  };
  return (
    <div className="max-w-7xl mx-auto p-8">
      <TenantHeader />
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