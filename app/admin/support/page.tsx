'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchSupportTickets, fetchSupportAssignees, updateSupportTicket } from '@/app/actions/submitApplication';

export default function SupportRequestsPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [assignees, setAssignees] = useState<any[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [tix, asgs] = await Promise.all([
        fetchSupportTickets({ status: statusFilter, search, assignedTo: assigneeFilter || undefined }),
        fetchSupportAssignees(),
      ]);
      setTickets(tix);
      setAssignees(asgs);
    } catch (e: any) {
      console.error(e);
      alert('Failed to load support tickets: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, assigneeFilter, search]);

  const quickUpdateStatus = async (id: string, newStatus: string) => {
    setUpdating(id);
    try {
      await updateSupportTicket(id, { status: newStatus });
      await load();
    } catch (e: any) {
      alert('Update failed: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold">Support Requests</h1>
          <p className="text-gray-500 mt-1">Manage incoming tickets from all users. TECH_SUPPORT and admins only.</p>
        </div>
        <button onClick={load} className="px-5 py-2 border rounded-2xl hover:bg-gray-50">Refresh</button>
      </div>

      {/* Filters / Search */}
      <div className="flex flex-wrap gap-4 mb-6 bg-white p-4 rounded-3xl border">
        <input
          type="text"
          placeholder="Search description, page, user..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] px-4 py-2 border rounded-2xl"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-4 py-2 border rounded-2xl"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="px-4 py-2 border rounded-2xl"
        >
          <option value="">All Assignees</option>
          {assignees.map(a => (
            <option key={a.id} value={a.id}>{a.full_name || a.email} ({a.role})</option>
          ))}
        </select>
        <button onClick={() => { setSearch(''); setStatusFilter('all'); setAssigneeFilter(''); }} className="px-4 py-2 text-sm underline">Clear Filters</button>
      </div>

      {loading ? (
        <div className="p-12 text-center">Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-3xl border p-12 text-center text-gray-500">No support tickets found matching filters.</div>
      ) : (
        <div className="bg-white rounded-3xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-6 py-4">Ticket</th>
                <th className="px-6 py-4">User / Org</th>
                <th className="px-6 py-4">Page</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Assigned</th>
                <th className="px-6 py-4">Screenshots</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link href={`/admin/support/${t.id}`} className="font-medium text-blue-600 hover:underline">
                      #{t.id.slice(0, 8)}
                    </Link>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2 max-w-[320px]">{t.description}</div>
                    {t.category && <span className="inline-block mt-1 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{t.category}</span>}
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <div>{t.user_id}</div>
                    {t.organization_id && <div className="text-gray-400">org: {t.organization_id}</div>}
                  </td>
                  <td className="px-6 py-4 text-xs font-mono break-all max-w-[180px]">{t.page_url}</td>
                  <td className="px-6 py-4">
                    <select
                      value={t.status || 'open'}
                      onChange={(e) => quickUpdateStatus(t.id, e.target.value)}
                      disabled={updating === t.id}
                      className="text-xs border rounded px-2 py-1"
                    >
                      <option value="open">open</option>
                      <option value="in_progress">in_progress</option>
                      <option value="resolved">resolved</option>
                      <option value="closed">closed</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-xs">{t.assigned_to || '— unassigned'}</td>
                  <td className="px-6 py-4 text-xs">{Array.isArray(t.screenshot_urls) ? t.screenshot_urls.length : 0}</td>
                  <td className="px-6 py-4 text-xs text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <Link href={`/admin/support/${t.id}`} className="text-blue-600 hover:underline text-sm">View / Respond →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 text-xs text-gray-500">
        Tickets stored in support_tickets (created via Prisma schema + direct admin inserts). RLS policies should allow authenticated inserts for own tickets and admin reads/updates.
      </div>
    </div>
  );
}
