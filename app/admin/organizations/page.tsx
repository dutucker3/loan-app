'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type Organization = {
  id: string;
  clerk_org_id: string;
  name: string;
  slug?: string;
  logo_url?: string;
  primary_color?: string;
  domain?: string;
  from_email?: string;
  support_email?: string;
  reply_to_email?: string;
  custom_domain_verified?: boolean;
  created_at: string;
};

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  async function fetchOrganizations() {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) console.error("Fetch error:", error);
    setOrgs(data || []);
    setLoading(false);
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingOrg) return;

    setUploading(true);
    const fileName = `${editingOrg.id}-${Date.now()}.${file.name.split('.').pop()}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName);

      setEditingOrg({ ...editingOrg, logo_url: urlData.publicUrl });
      alert('Logo uploaded successfully! Now click "Save Changes".');
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const saveWhiteLabel = async () => {
    if (!editingOrg) return;

    const { error } = await supabase
      .from('organizations')
      .update({
        logo_url: editingOrg.logo_url,
        primary_color: editingOrg.primary_color,
        domain: editingOrg.domain,
        from_email: editingOrg.from_email,
        support_email: editingOrg.support_email,
        reply_to_email: editingOrg.reply_to_email,
      })
      .eq('id', editingOrg.id);

    if (error) {
      console.error("❌ Update error:", error);
      alert('Save failed: ' + error.message);
    } else {
      alert('✅ White-label settings saved successfully!');
      setEditingOrg(null);
      fetchOrganizations();
    }
  };

  if (loading) return <div className="p-10 text-center">Loading organizations...</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Manage Organizations (White Label)</h1>

      <div className="bg-white rounded-3xl border divide-y">
        {orgs.map((org) => (
          <div key={org.id} className="p-8 flex justify-between items-center">
            <div className="flex items-center gap-4">
              {org.logo_url && <img src={org.logo_url} alt="logo" className="h-12 w-12 object-contain" />}
              <div>
                <h3 className="text-xl font-semibold">{org.name}</h3>
                <p className="text-sm text-gray-500">
                  Domain: {org.domain || '—'} | From: {org.from_email || '—'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setEditingOrg(org)}
              className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700"
            >
              Edit White Label
            </button>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {editingOrg && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-10 w-full max-w-lg max-h-[90vh] overflow-auto">
            <h2 className="text-2xl font-bold mb-6">White Label — {editingOrg.name}</h2>

            <div className="space-y-8">
              {/* Logo Upload */}
              <div>
                <label className="block text-sm font-medium mb-3">Logo</label>
                <div className="border-2 border-dashed border-gray-300 rounded-3xl p-8 text-center">
                  {editingOrg.logo_url && (
                    <img src={editingOrg.logo_url} alt="preview" className="mx-auto max-h-28 mb-4" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                  />
                  <label htmlFor="logo-upload" className="cursor-pointer text-blue-600 font-medium">
                    {uploading ? 'Uploading...' : 'Upload New Logo'}
                  </label>
                </div>
              </div>

              {/* Primary Color */}
              <div>
                <label className="block text-sm font-medium mb-2">Primary Color</label>
                <input
                  type="color"
                  value={editingOrg.primary_color || '#3b82f6'}
                  onChange={(e) => setEditingOrg({ ...editingOrg, primary_color: e.target.value })}
                  className="w-24 h-12 border-0 p-1 rounded cursor-pointer"
                />
              </div>

              {/* Custom Domain */}
              <div>
                <label className="block text-sm font-medium mb-2">Custom Domain</label>
                <input
                  type="text"
                  value={editingOrg.domain || ''}
                  onChange={(e) => setEditingOrg({ ...editingOrg, domain: e.target.value })}
                  className="w-full px-5 py-4 border rounded-2xl"
                  placeholder="loans.abc-capital.com"
                />
                <p className="text-xs text-gray-500 mt-1">Used for white-labeled links and emails</p>
              </div>

              {/* Email Settings */}
              <div className="pt-4 border-t">
                <h3 className="font-semibold mb-4">Email Settings (Postmark)</h3>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">From Email (Sender)</label>
                    <input
                      type="email"
                      value={editingOrg.from_email || ''}
                      onChange={(e) => setEditingOrg({ ...editingOrg, from_email: e.target.value })}
                      className="w-full px-5 py-4 border rounded-2xl"
                      placeholder="noreply@abc-capital.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Support Email</label>
                    <input
                      type="email"
                      value={editingOrg.support_email || ''}
                      onChange={(e) => setEditingOrg({ ...editingOrg, support_email: e.target.value })}
                      className="w-full px-5 py-4 border rounded-2xl"
                      placeholder="support@abc-capital.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Reply-To Email</label>
                    <input
                      type="email"
                      value={editingOrg.reply_to_email || ''}
                      onChange={(e) => setEditingOrg({ ...editingOrg, reply_to_email: e.target.value })}
                      className="w-full px-5 py-4 border rounded-2xl"
                      placeholder="loans@abc-capital.com"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-4 mt-10">
              <button
                onClick={saveWhiteLabel}
                className="flex-1 py-4 bg-green-600 text-white rounded-2xl font-semibold hover:bg-green-700"
              >
                Save White Label Settings
              </button>
              <button
                onClick={() => setEditingOrg(null)}
                className="flex-1 py-4 bg-gray-200 rounded-2xl font-semibold hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}