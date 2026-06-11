'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { fetchSupportTicket, updateSupportTicket, fetchSupportAssignees, aiSummarizeTicket, aiSuggestResponse, aiCategorizeTicket } from '@/app/actions/submitApplication';
import { supabase } from '@/lib/supabase';

export default function SupportTicketDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const ticketId = params?.id as string;

  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState<any[]>([]);
  const [newResponse, setNewResponse] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [suggested, setSuggested] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    async function loadCurrentUser() {
      const { data: { user: sbUser } } = await supabase.auth.getUser();
      if (sbUser) {
        // enrich with profile if possible
        const { data: prof } = await supabase.from('profiles').select('full_name, email').eq('id', sbUser.id).maybeSingle();
        setCurrentUser({
          id: sbUser.id,
          full_name: prof?.full_name || sbUser.user_metadata?.full_name || '',
          email: prof?.email || sbUser.email || ''
        });
      }
    }
    loadCurrentUser();
  }, []);

  async function loadTicket() {
    if (!ticketId) return;
    setLoading(true);
    try {
      const t = await fetchSupportTicket(ticketId);
      setTicket(t);
      setNewStatus(t.status || 'open');
      setNewAssignee(t.assigned_to || '');
    } catch (e: any) {
      console.error(e);
      alert('Failed to load ticket: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAssignees() {
    const a = await fetchSupportAssignees();
    setAssignees(a);
  }

  useEffect(() => {
    loadTicket();
    loadAssignees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const handleAiAction = async (type: 'summarize' | 'suggest' | 'categorize') => {
    if (!ticket) return;
    setAiLoading(type);
    try {
      if (type === 'summarize') {
        const res = await aiSummarizeTicket(ticket.description, ticket.page_url, ticket.user_id);
        if (res.summary) {
          await updateSupportTicket(ticketId, { summary: res.summary });
          setTicket((prev: any) => ({ ...prev, summary: res.summary }));
          alert('AI summary saved: ' + res.summary);
        }
      } else if (type === 'suggest') {
        const res = await aiSuggestResponse(ticket.description, ticket.page_url, ticket.responses || []);
        setSuggested(res.suggested_response || '');
        if (res.category_guess && !ticket.category) {
          await updateSupportTicket(ticketId, { category: res.category_guess });
        }
        alert('AI suggestion ready in the response box (copy or edit).');
      } else if (type === 'categorize') {
        const res = await aiCategorizeTicket(ticket.description, ticket.page_url);
        await updateSupportTicket(ticketId, { category: res.category });
        setTicket((prev: any) => ({ ...prev, category: res.category }));
        alert('AI category: ' + res.category);
      }
      await loadTicket();
    } catch (e: any) {
      alert('AI action failed: ' + e.message);
    } finally {
      setAiLoading(null);
    }
  };

  const addResponse = async () => {
    if (!newResponse.trim() || !ticket) return;
    setUpdating(true);
    const resp = {
      id: Date.now().toString(36),
      author_id: currentUser?.id || 'admin',
      author_name: currentUser?.full_name || currentUser?.email || 'Support Staff',
      message: newResponse.trim(),
      timestamp: new Date().toISOString(),
      is_ai_suggested: !!suggested && newResponse.includes(suggested.substring(0, 30)),
    };
    const currentResponses = Array.isArray(ticket.responses) ? ticket.responses : [];
    const updatedResponses = [...currentResponses, resp];
    try {
      await updateSupportTicket(ticketId, { responses: updatedResponses });
      setNewResponse('');
      setSuggested('');
      await loadTicket();
    } catch (e: any) {
      alert('Failed to add response: ' + e.message);
    } finally {
      setUpdating(false);
    }
  };

  const saveAssignAndStatus = async () => {
    setUpdating(true);
    try {
      await updateSupportTicket(ticketId, {
        status: newStatus,
        assigned_to: newAssignee || null,
      });
      await loadTicket();
      alert('Updated.');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="p-10">Loading ticket {ticketId}...</div>;
  if (!ticket) return <div className="p-10">Ticket not found. <Link href="/admin/support" className="underline">Back to list</Link></div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin/support" className="text-blue-600 hover:underline">← All Support Requests</Link>
        <span className="text-gray-400">/</span>
        <span className="font-mono text-sm">#{ticketId}</span>
      </div>

      <div className="bg-white rounded-3xl border p-8 mb-8">
        <div className="flex justify-between mb-6">
          <h1 className="text-3xl font-bold">Support Ticket Detail</h1>
          <div className="text-right text-sm">
            <div>Status: <span className="font-semibold">{ticket.status}</span></div>
            <div>Category: <span className="font-semibold">{ticket.category || '—'}</span></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm mb-8">
          <div><span className="text-gray-500">User ID:</span> {ticket.user_id}</div>
          <div><span className="text-gray-500">Org ID:</span> {ticket.organization_id || '—'}</div>
          <div className="col-span-2"><span className="text-gray-500">Page URL:</span> <a href={ticket.page_url} target="_blank" className="text-blue-600 break-all">{ticket.page_url}</a></div>
          <div className="col-span-2"><span className="text-gray-500">Submitted:</span> {new Date(ticket.created_at).toLocaleString()}</div>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">Description</h3>
          <div className="bg-gray-50 p-4 rounded-2xl whitespace-pre-wrap">{ticket.description}</div>
        </div>

        {ticket.summary && (
          <div className="mb-6">
            <h3 className="font-semibold mb-2">AI Summary</h3>
            <div className="bg-amber-50 p-4 rounded-2xl text-sm">{ticket.summary}</div>
          </div>
        )}

        {Array.isArray(ticket.screenshot_urls) && ticket.screenshot_urls.length > 0 && (
          <div className="mb-6">
            <h3 className="font-semibold mb-2">Screenshots ({ticket.screenshot_urls.length})</h3>
            <div className="flex flex-wrap gap-3">
              {ticket.screenshot_urls.map((url: string, i: number) => (
                <a key={i} href={url} target="_blank" className="block border rounded-xl overflow-hidden">
                  <img src={url} alt={`screenshot ${i}`} className="w-40 h-28 object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* xAI integration controls */}
        <div className="mb-8 border-t pt-6">
          <h3 className="font-semibold mb-3">xAI Assistance (auto-summarize, suggest, categorize)</h3>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleAiAction('summarize')} disabled={!!aiLoading} className="px-4 py-2 bg-purple-600 text-white rounded-2xl text-sm disabled:opacity-50">
              {aiLoading === 'summarize' ? 'Summarizing...' : '🤖 Re-summarize with xAI'}
            </button>
            <button onClick={() => handleAiAction('suggest')} disabled={!!aiLoading} className="px-4 py-2 bg-purple-600 text-white rounded-2xl text-sm disabled:opacity-50">
              {aiLoading === 'suggest' ? 'Suggesting...' : '💡 Suggest Response with xAI'}
            </button>
            <button onClick={() => handleAiAction('categorize')} disabled={!!aiLoading} className="px-4 py-2 bg-purple-600 text-white rounded-2xl text-sm disabled:opacity-50">
              {aiLoading === 'categorize' ? 'Categorizing...' : '🏷️ Re-categorize with xAI'}
            </button>
          </div>
          {suggested && (
            <div className="mt-3 p-3 bg-purple-50 rounded-2xl text-sm">
              <strong>AI Suggested Response (use below):</strong><br />
              {suggested}
            </div>
          )}
        </div>

        {/* Assign / Status */}
        <div className="border-t pt-6 mb-8">
          <h3 className="font-semibold mb-3">Assign &amp; Status</h3>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs block mb-1">Status</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="border px-3 py-2 rounded-2xl">
                <option value="open">open</option>
                <option value="in_progress">in_progress</option>
                <option value="resolved">resolved</option>
                <option value="closed">closed</option>
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1">Assign to</label>
              <select value={newAssignee} onChange={e => setNewAssignee(e.target.value)} className="border px-3 py-2 rounded-2xl min-w-[220px]">
                <option value="">Unassigned</option>
                {assignees.map(a => (
                  <option key={a.id} value={a.id}>{a.full_name || a.email} — {a.role}</option>
                ))}
              </select>
            </div>
            <button onClick={saveAssignAndStatus} disabled={updating} className="px-6 py-2 bg-blue-600 text-white rounded-2xl">Save Assign/Status</button>
          </div>
        </div>

        {/* Responses / Thread */}
        <div>
          <h3 className="font-semibold mb-3">Responses / Notes ({Array.isArray(ticket.responses) ? ticket.responses.length : 0})</h3>
          <div className="space-y-3 mb-4">
            {Array.isArray(ticket.responses) && ticket.responses.length > 0 ? (
              ticket.responses.map((r: any, idx: number) => (
                <div key={idx} className="bg-gray-50 p-4 rounded-2xl text-sm">
                  <div className="text-xs text-gray-500 mb-1">{r.author_name || r.author_id} • {new Date(r.timestamp).toLocaleString()} {r.is_ai_suggested ? ' (AI assisted)' : ''}</div>
                  <div className="whitespace-pre-wrap">{r.message}</div>
                </div>
              ))
            ) : (
              <p className="text-gray-500">No responses yet.</p>
            )}
          </div>

          <div>
            <textarea
              value={newResponse}
              onChange={e => setNewResponse(e.target.value)}
              placeholder="Type your response here... Use AI suggest button above for draft."
              className="w-full h-28 border rounded-2xl p-4"
            />
            <button onClick={addResponse} disabled={updating || !newResponse.trim()} className="mt-2 px-6 py-2 bg-green-600 text-white rounded-2xl disabled:opacity-50">
              {updating ? 'Saving...' : 'Add Response &amp; Save'}
            </button>
            {suggested && (
              <button type="button" onClick={() => setNewResponse(suggested)} className="ml-3 text-sm underline text-purple-600">Use AI suggestion</button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">All changes use server actions (admin client for DB + Resend on submit). xAI calls server-side only.</p>
    </div>
  );
}
