'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const REQUIRED = [
  'Invoice',
  'Certificate of Insurance',
  'Declarations',
];

export default function InsuranceProviderPortal() {
  const params = useParams<{ loanId: string }>();
  const loanId = params.loanId;

  const [token, setToken] = useState<string>('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) {
      setError('Missing token. Please use the link from your email.');
      setLoading(false);
      return;
    }
    fetch(`/api/providers/verify?loanId=${loanId}&type=insurance&token=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) throw new Error(j.error || 'Invalid link');
        setData(j);
      })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [loanId]);

  async function uploadForLabel(label: string, file: File) {
    if (!token) return;
    setUploading(prev => ({ ...prev, [label]: true }));
    try {
      const fd = new FormData();
      fd.append('loanId', String(loanId));
      fd.append('type', 'insurance');
      fd.append('token', token);
      fd.append('docLabel', label);
      fd.append('file', file);

      const res = await fetch('/api/providers/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Upload failed');

      setDone(prev => ({ ...prev, [label]: true }));
      alert(`✅ ${label} uploaded. Thank you.`);
    } catch (e: any) {
      alert('Upload failed: ' + (e.message || e));
    } finally {
      setUploading(prev => ({ ...prev, [label]: false }));
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center p-8 text-xl">Verifying secure link...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center p-8 text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Insurance Document Upload</h1>
        <p className="text-gray-600">Secure portal — no login required. Link is unique to this request.</p>
      </div>

      <div className="bg-white border rounded-3xl p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><span className="font-medium">Loan #:</span> {data.loan?.id}</div>
          <div><span className="font-medium">Loan Amount:</span> ${Number(data.loan?.loan_amount || 0).toLocaleString()}</div>
          <div className="md:col-span-2"><span className="font-medium">Property:</span> {data.loan?.property_address}</div>
          <div className="md:col-span-2 border-t pt-3 mt-2">
            <div className="font-medium mb-1">Mortgagee Clause:</div>
            <pre className="text-xs bg-gray-50 p-3 rounded-xl whitespace-pre-wrap">{data.loan?.mortgagee_clause || '—'}</pre>
          </div>
          {data.product?.insurance_requirements && (
            <div className="md:col-span-2">
              <div className="font-medium mb-1">Insurance Requirements (from lender):</div>
              <pre className="text-xs bg-gray-50 p-3 rounded-xl whitespace-pre-wrap">{data.product.insurance_requirements}</pre>
            </div>
          )}
        </div>
      </div>

      <div className="mb-6">
        <h2 className="font-semibold mb-3">Required Documents (3)</h2>
        <div className="space-y-4">
          {REQUIRED.map((label) => (
            <div key={label} className="border rounded-2xl p-5 bg-white">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{label}</div>
                {done[label] && <span className="text-green-600 text-sm">✓ Uploaded</span>}
              </div>
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadForLabel(label, f);
                }}
                disabled={!!uploading[label] || done[label]}
                className="block w-full text-sm"
              />
              {uploading[label] && <div className="text-xs text-gray-500 mt-1">Uploading...</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Upload the exact three items listed. The lender will be notified automatically. You may re-upload corrected versions using the same link. Reply to the original request email for questions.
      </div>
    </div>
  );
}
