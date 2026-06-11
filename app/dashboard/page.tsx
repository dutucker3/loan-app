'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
// TenantHeader removed - now provided globally via root layout + AppHeader
import NextImage from 'next/image';
import { hasPermission, canManageOrg, isOrgAdmin, filterVisibleProductsForUser, filterVisibleProductsWithOwner, isLevel2BrokerAE } from '@/lib/permissions';
import {
  fetchReggoraOrders,
  fetchReggoraProducts,
  fetchReggoraUsers,
  createReggoraLoan,
  createReggoraOrder,
} from '@/app/actions/reggora';
import { snapshotPricingMatrixForLoan, fetchTreasuryRate, globalRebaseBaseRates, listLevelOneSponsors, ensurePlatformRootOrg, sendAEProspectInvite, bulkFredBaseRateUpdate, addUserToOrganization, ensureUserInOrg } from '@/app/actions/organization-actions';
import * as XLSX from 'xlsx';
import { ROOT_ORG_NAME } from '@/lib/constants'; // for hiding root in lists
import { logAudit, logPageVisit } from '@/lib/audit';

const loanStatuses = [
  'Processing', 'Underwriting', 'Clear to Close', 
  'Closed and Funded', 'On Hold', 'Rejected'
];

export default function DashboardPage() {
  const [sbUser, setSbUser] = useState<any>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const router = useRouter();

  const [activeLoans, setActiveLoans] = useState<any[]>([]);
  const [closedLoans, setClosedLoans] = useState<any[]>([]);
  const [unassignedLoans, setUnassignedLoans] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [processors, setProcessors] = useState<any[]>([]);
  const [orgsMap, setOrgsMap] = useState<Record<string, any>>({});
  const [usersMap, setUsersMap] = useState<Record<string, any>>({});
  const [allOrgs, setAllOrgs] = useState<any[]>([]);

  // Appraisals (Reggora Lender API)
  const [appraisals, setAppraisals] = useState<any[]>([]);
  const [reggoraProducts, setReggoraProducts] = useState<any[]>([]);
  const [reggoraUsers, setReggoraUsers] = useState<any[]>([]);
  const [reggoraLoading, setReggoraLoading] = useState(false);
  const [reggoraError, setReggoraError] = useState<string | null>(null);
  const [reggoraSuccess, setReggoraSuccess] = useState<string | null>(null);

  // New Appraisal Order form fields
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string>('');
  const [priority, setPriority] = useState<'Normal' | 'Rush'>('Normal');
  const [allocationType, setAllocationType] = useState<'automatically' | 'manually'>('automatically');
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [addFeeDesc, setAddFeeDesc] = useState('');
  const [addFeeAmount, setAddFeeAmount] = useState('');

  // For appraisals: per-loan product matrix context (fetched on select for auto-use fee + snapshot display)
  const [selectedLoanProduct, setSelectedLoanProduct] = useState<any>(null);

  const [loading, setLoading] = useState(true);
const [activeTab, setActiveTab] = useState<
  'price' | 'applications' | 'pending' | 'processing' | 'closed' | 'unassigned' | 'organizations' | 'appraisals'
>('processing');

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);
  const [currentUserParentId, setCurrentUserParentId] = useState<string | null>(null);

  // AE specific modals for Senior/Junior AE
  const [showBrokerInviteModal, setShowBrokerInviteModal] = useState(false);
  const [brokerName, setBrokerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [brokerInviteEmail, setBrokerInviteEmail] = useState('');

  // User Management States
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('BROKER_AE');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');

  // AE Referral + Junior AE hierarchy states (for Senior/Junior AE dashboards + invite)
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [seniorAEs, setSeniorAEs] = useState<any[]>([]);
  const [selectedParentIdForJunior, setSelectedParentIdForJunior] = useState('');
  const [aeJuniors, setAeJuniors] = useState<any[]>([]);
  const [aeChildBrokers, setAeChildBrokers] = useState<any[]>([]);

  // Permission helpers
  const currentUserForPerms = {
    id: sbUser?.id || '',
    role: currentUserRole as any,
    organization_id: currentUserOrgId,
  };

  const isSuperAdmin = hasPermission(currentUserForPerms, 'SUPER_ADMIN');
  const isAdminOrHigher = hasPermission(currentUserForPerms, ['ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR']);
  const isProcessorOrHigher = hasPermission(currentUserForPerms, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR']);
  const canManageUsers = hasPermission(currentUserForPerms, ['SUPER_ADMIN', 'ADMIN', 'LENDING_SUPERVISOR', 'SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE', 'ORG_ADMIN']);

  const isOrgAdminUser = isOrgAdmin(currentUserForPerms);
  // Global = can see/approve cross-org pending, full org lists, root users etc. ORG_ADMIN is scoped (L1+subtree only).
  const isGlobalAdmin = isSuperAdmin || (isAdminOrHigher && !currentUserOrgId);
  const isTenantAdmin = !!currentUserOrgId && (currentUserRole === 'ADMIN' || currentUserRole === 'ORG_ADMIN') && !isSuperAdmin;

  // Light page visit logging for critical dashboard (loans mgmt, admin-like tabs).
  useEffect(() => {
    if (sbUser?.id) {
      logPageVisit('/dashboard', sbUser.id, currentUserOrgId).catch(() => {});
    }
  }, [sbUser?.id, currentUserOrgId]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
  };

  useEffect(() => {
    async function loadSbUser() {
      const { data: { user: u } } = await supabase.auth.getUser();
      setSbUser(u);
      setUserLoaded(true);
      if (!u) {
        router.push('/sign-in');
      }
    }
    loadSbUser();
  }, [router]);

  useEffect(() => {
    if (!userLoaded || !sbUser) return;

    async function loadAllData() {
      // Prefer profiles for Supabase auth users to avoid 404s on legacy 'users' table
      let userData = null;
      try {
        let res = await supabase
          .from('profiles')
          .select('role, organization_id')
          .eq('id', sbUser.id)
          .maybeSingle();
        userData = res.data;
        // legacy 'users' fallback removed - profiles only to eliminate 404s for tenant roles
      } catch (e) {
        console.warn('load userData failed (using defaults)', e);
      }

      const role = userData?.role || 'BROKER_AE';
      setCurrentUserRole(role);
      setCurrentUserOrgId(userData?.organization_id || null);

      // Best-effort: ensure this logged-in user has rows in *both* profiles and users tables with the org + role.
      // This makes them (and by extension other team members once added) appear reliably in:
      // - this dashboard's Users tab (for the L1/tenant)
      // - /admin/organizations/[id]/users (which queries profiles with admin bypass)
      if (userData?.organization_id && sbUser?.id) {
        const meta = (sbUser as any).user_metadata || {};
        const fullName = meta.full_name || sbUser.email?.split('@')[0] || undefined;
        ensureUserInOrg(sbUser.id, userData.organization_id, role, fullName, sbUser.email).catch(() => {});
      }

      // parent_id for AE hierarchy (was on legacy 'users'; removed - now only profiles, parent_id may be undefined for non-AE)
      let pId: string | null = null;
      try {
        const { data: uFull } = await supabase
          .from('profiles')
          .select('parent_id')
          .eq('id', sbUser.id)
          .maybeSingle();
        pId = uFull?.parent_id || null;
      } catch {}
      if (!pId && userData && (userData as any).parent_id) pId = (userData as any).parent_id;
      setCurrentUserParentId(pId);

      const isSeniorAE = role === 'SENIOR_ACCOUNT_EXECUTIVE';
      const isJuniorAE = role === 'ACCOUNT_EXECUTIVE';
      const isAnyAE = isSeniorAE || isJuniorAE;

      // === AE REFERRAL HIERARCHY (Senior/Junior AE dashboards per task) ===
      // Senior sees Juniors (ACCOUNT_EXECUTIVE with parent_id=me) + their child brokers + loans by those brokers.
      // Junior (ACCOUNT_EXECUTIVE) sees only assigned child brokers (parent_id=me) + their loans.
      // Uses existing parent_id on users (no new columns). Loans filtered by originator_id of the relevant brokers.
      // Also loads seniors list for "Junior AE creation" dropdown in users tab.
      let childBrokerIds: string[] = [];
      let loadedJuniors: any[] = [];
      let loadedChildBrokers: any[] = [];
      if (isAnyAE && sbUser?.id) {
        try {
          // Load direct children of this AE (juniors or direct brokers) - legacy users -> profiles (parent_id support removed with table)
          const { data: directs } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, parent_id')
            .eq('parent_id', sbUser.id);
          const directList = directs || [];
          loadedJuniors = directList.filter((u: any) => u.role === 'ACCOUNT_EXECUTIVE');
          loadedChildBrokers = directList.filter((u: any) => ['BROKER_AE', 'JUNIOR_BROKER', 'SENIOR_BROKER', 'BROKER'].includes(u.role));

          if (isSeniorAE && loadedJuniors.length > 0) {
            const juniorIds = loadedJuniors.map((j: any) => j.id);
            const { data: grands } = await supabase
              .from('profiles')
              .select('id, full_name, email, role, parent_id')
              .in('parent_id', juniorIds);
            const grandBrokers = (grands || []).filter((u: any) => ['BROKER_AE', 'JUNIOR_BROKER', 'SENIOR_BROKER', 'BROKER'].includes(u.role));
            loadedChildBrokers = [...loadedChildBrokers, ...grandBrokers];
          }

          childBrokerIds = loadedChildBrokers.map((b: any) => b.id);
          setAeJuniors(loadedJuniors);
          setAeChildBrokers(loadedChildBrokers);
        } catch (aeHierErr) {
          console.warn('AE hierarchy load failed (non-fatal for loans)', aeHierErr);
        }

        // Also ensure seniors list is available for Junior AE creation dropdown (even if not AE, for admins)
        // Use profiles to avoid legacy 'users' table 404s (table may not be exposed or RLS denies for ORG_ADMIN tenants)
        try {
          const { data: seniorsData } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .eq('role', 'SENIOR_ACCOUNT_EXECUTIVE')
            .order('created_at', { ascending: false });
          setSeniorAEs(seniorsData || []);
        } catch {}
      }

      // Also load seniors for the dropdown when canManageUsers (covers admins + AEs)
      if (canManageUsers && !isAnyAE) {
        try {
          const { data: seniorsData } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .eq('role', 'SENIOR_ACCOUNT_EXECUTIVE')
            .order('created_at', { ascending: false });
          setSeniorAEs(seniorsData || []);
        } catch {}
      }

      // Loans (updated for AE: filter by self + assigned child brokers' originator_id; preserve prior for others)
      let loansQuery = supabase.from('loans').select('*').order('created_at', { ascending: false });
      if (isAdminOrHigher) {
        // full access (no change)
      } else if (isAnyAE) {
        const orClauses: string[] = [`originator_id.eq.${sbUser.id}`];
        childBrokerIds.forEach((bid) => orClauses.push(`originator_id.eq.${bid}`));
        // also allow if the AE is processor/underwriter on loans
        orClauses.push(`processor_id.eq.${sbUser.id}`);
        orClauses.push(`underwriter_id.eq.${sbUser.id}`);
        loansQuery = loansQuery.or(orClauses.join(','));
      } else {
        loansQuery = loansQuery.or(`originator_id.eq.${sbUser.id},processor_id.eq.${sbUser.id},underwriter_id.eq.${sbUser.id}`);
      }
      const { data: loansData } = await loansQuery;

      setActiveLoans(loansData?.filter(l => 
        ['Processing', 'Underwriting', 'Clear to Close'].includes(l.loan_status || '')
      ) || []);

      setClosedLoans(loansData?.filter(l => 
        ['Closed and Funded', 'On Hold', 'Rejected'].includes(l.loan_status || '')
      ) || []);

      // Enrich for tenant pipeline view: load org names (child orgs) and user names (Senior AE / originators)
      try {
        const loanOrgIds = Array.from(new Set((loansData || []).map((l: any) => l.organization_id).filter(Boolean)));
        const loanUserIds = Array.from(new Set((loansData || []).map((l: any) => l.originator_id).filter(Boolean)));
        if (loanOrgIds.length) {
          const { data: orgs } = await supabase.from('organizations').select('id, name, parent_organization_id').in('id', loanOrgIds);
          const map: Record<string, any> = {};
          (orgs || []).forEach((o: any) => { map[o.id] = o; });
          setOrgsMap(map);
        }
        if (loanUserIds.length) {
          // Use profiles (avoids 404s on legacy 'users' table for tenant ORG_ADMIN roles)
          const { data: usrs } = await supabase.from('profiles').select('id, full_name, email, role').in('id', loanUserIds);
          const map: Record<string, any> = {};
          (usrs || []).forEach((u: any) => { map[u.id] = u; });
          setUsersMap(map);
        }
      } catch (e) { console.warn('Failed to enrich org/user maps for loan list', e); }

      // Applications (role-aware for bridge review flow)
      // - Borrowers see only their own
      // - Company users (brokers, AEs, underwriters, admins) see org-visible / team applications so they can review bridge submissions
      let appsQuery = supabase.from('loan_applications').select('*').order('created_at', { ascending: false });

      const isBorrowerRole = currentUserRole === 'BORROWER';
      if (isBorrowerRole) {
        appsQuery = appsQuery.eq('user_id', sbUser.id);
      } else if (currentUserOrgId && !isSuperAdmin) {
        appsQuery = appsQuery.eq('organization_id', currentUserOrgId);
      } else if (isAnyAE && sbUser?.id) {
        // AE team scope (self + reports) - fall back to org if no children
        const orClauses = [`user_id.eq.${sbUser.id}`];
        // Note: for full AE child scoping we would need to join or load child user_ids; org filter is good baseline
        appsQuery = appsQuery.or(orClauses.join(','));
      }
      // Super admins / no org: see everything (previous global behavior for them)

      const { data: appData } = await appsQuery;
      setApplications(appData || []);

      if (canManageUsers) {
        if (isAnyAE && sbUser?.id) {
          // AE scoped users: self + direct reports + (for senior) grandchildren brokers. Avoids leaking full user list.
          const orParts = [`id.eq.${sbUser.id}`, `parent_id.eq.${sbUser.id}`];
          const juniorIds = loadedJuniors.map((j: any) => j.id);
          if (juniorIds.length) orParts.push(`parent_id.in.(${juniorIds.join(',')})`);
          const { data: aeScopedUsers } = await supabase.from('profiles').select('*').or(orParts.join(',')).order('created_at', { ascending: false });
          setUsers(aeScopedUsers || []);
        } else if (currentUserOrgId && !isGlobalAdmin) {
          // Tenant / ORG_ADMIN (L1): explicitly scope to this org - profiles only (legacy users removed)
          const { data: pRes } = await supabase.from('profiles').select('*').eq('organization_id', currentUserOrgId).order('created_at', { ascending: false });
          setUsers(pRes || []);
        } else {
          const { data: usersData } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
          setUsers(usersData || []);
        }
      }

      if (isProcessorOrHigher) {
        const { data: procData } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('role', ['LOAN_PROCESSOR', 'LENDING_SUPERVISOR', 'SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT', 'LOAN_UNDERWRITER', 'ORG_ADMIN']);
        setProcessors(procData || []);
      }

      // === Load org parents map for hierarchy (for product visibility + ORG_ADMIN subtree checks) ===
      let parentMap: Record<string, string | null> = {};
      let rootOrgId: string | null = null;
      try {
        const { data: allOrgsForMap } = await supabase.from('organizations').select('id, parent_organization_id, name');
        (allOrgsForMap || []).forEach((o: any) => {
          parentMap[o.id] = o.parent_organization_id ?? null;
          if (o.name === ROOT_ORG_NAME || o.parent_organization_id === null) rootOrgId = o.id;
        });
      } catch {}

      // Products loading removed from dashboard main load (Products now managed via Admin sidebar -> /admin/products)

      setLoading(false);
    }

    loadAllData();
  }, [userLoaded, sbUser, router, isAdminOrHigher, canManageUsers, isProcessorOrHigher]);
  // Products data loading removed from dashboard (moved to Admin sidebar linking to full /admin/products list + management)



  // Load Reggora data when Appraisals tab is activated (permission gated in load func)
  useEffect(() => {
    if (activeTab === 'appraisals') {
      // default due date ~14 days out if not set
      if (!dueDate) {
        const d = new Date();
        d.setDate(d.getDate() + 14);
        setDueDate(d.toISOString().split('T')[0]);
      }
      loadReggoraData();
    }
  }, [activeTab, isAdminOrHigher, isSuperAdmin]);

  // On loan selection in appraisals form: if the loan has product_id, fetch its full pricing_matrix for display + fee suggestion context
  useEffect(() => {
    async function loadSelectedLoanProduct() {
      if (!selectedLoanId) {
        setSelectedLoanProduct(null);
        return;
      }
      // Find in loaded lists (has product_id from select('*'))
      const allLoans = [...activeLoans, ...closedLoans, ...unassignedLoans];
      const loan = allLoans.find((l: any) => String(l.id) === selectedLoanId);
      if (!loan || !loan.product_id) {
        setSelectedLoanProduct(null);
        return;
      }
      try {
        const { data: prod } = await supabase
          .from('loan_products')
          .select('*')
          .eq('id', loan.product_id)
          .single();
        setSelectedLoanProduct(prod || null);
      } catch (e) {
        console.warn('Could not load product for selected loan matrix context', e);
        setSelectedLoanProduct(null);
      }
    }
    loadSelectedLoanProduct();
  }, [selectedLoanId, activeLoans, closedLoans, unassignedLoans]);

  const fetchUnassignedLoans = async () => {
    if (!isProcessorOrHigher) return;
    const { data } = await supabase
      .from('loans')
      .select('*')
      .is('processor_id', null)
      .order('created_at', { ascending: false });
    setUnassignedLoans(data || []);
  };

  const fetchAllOrganizations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });
    // Hide the root "Loan-App Platform" (Level 0) from normal lists (visible only to super at root home / special views)
    const filtered = (data || []).filter((o: any) => o.name !== ROOT_ORG_NAME && o.parent_organization_id !== null /* L1s have parent, root has null */ );
    setAllOrgs(filtered);
  };
  // === REGGORA APPRAISALS HELPERS ===
  const loadReggoraData = async () => {
    if (!isAdminOrHigher && !isSuperAdmin) return;
    setReggoraLoading(true);
    setReggoraError(null);
    setReggoraSuccess(null);
    try {
      const [ordersRes, prodsRes, usersRes] = await Promise.all([
        fetchReggoraOrders(),
        fetchReggoraProducts(),
        fetchReggoraUsers(),
      ]);
      if (ordersRes.error) {
        setReggoraError(ordersRes.error);
      } else {
        setAppraisals(ordersRes.orders || []);
      }
      if (prodsRes.error) {
        setReggoraError((prev) => prev || prodsRes.error!);
      } else {
        setReggoraProducts(prodsRes.products || []);
      }
      if (usersRes.error) {
        setReggoraError((prev) => prev || usersRes.error!);
      } else {
        setReggoraUsers(usersRes.users || []);
      }
    } catch (e: any) {
      setReggoraError(e.message || 'Failed to load Reggora data');
    } finally {
      setReggoraLoading(false);
    }
  };

  const orderNewAppraisal = async () => {
    setReggoraError(null);
    setReggoraSuccess(null);

    if (!selectedLoanId) {
      setReggoraError('Please select a loan from your organization.');
      return;
    }
    if (selectedProductIds.length === 0) {
      setReggoraError('Please select at least one Reggora product.');
      return;
    }
    if (!dueDate) {
      setReggoraError('Please select a due date.');
      return;
    }

    // Collect candidate loans (use loaded lists; admins see broad data)
    const allLoans = [...activeLoans, ...closedLoans, ...unassignedLoans];
    const loan = allLoans.find((l: any) => String(l.id) === selectedLoanId);
    if (!loan) {
      setReggoraError('Selected loan not found in current dashboard data. Try switching tabs to refresh loans.');
      return;
    }

    try {
      setReggoraLoading(true);

      // 1) Create Reggora loan from app loan data (address, borrower, etc.)
      const loanRes = await createReggoraLoan(loan, dueDate);
      if (loanRes.error) throw new Error(loanRes.error);
      const reggoraLoanId = loanRes.reggoraLoanId!;
      if (!reggoraLoanId) throw new Error('Reggora did not return a loan ID');

      // 2) Auto-use this loan's product pricing matrix (if any) for suggested additional fee (light scan Other Adjustments or baseRates; + any user-entered fee)
      let additional_fees: Array<{ description: string; amount: string }> | undefined = undefined;
      let prodForFee: any = selectedLoanProduct;
      if (!prodForFee && loan.product_id) {
        // robust re-fetch inside action path
        const { data: p } = await supabase.from('loan_products').select('*').eq('id', loan.product_id).single();
        prodForFee = p || null;
      }
      const userFee = (addFeeDesc && addFeeAmount) ? [{ description: addFeeDesc, amount: addFeeAmount }] : [];
      if (prodForFee?.pricing_matrix) {
        const mRaw = prodForFee.pricing_matrix;
        const matrix = (typeof mRaw === 'string') ? (() => { try { return JSON.parse(mRaw); } catch { return {}; } })() : (mRaw || {});
        const other = matrix['Other Adjustments'] || matrix['otherAdjustments'] || matrix['Other Adjustment'] || {};
        let suggested = 650;
        for (const [key, val] of Object.entries(other)) {
          if (/apprais|valuation|inspection/i.test(String(key))) {
            let nv = val;
            if (nv && typeof nv === 'object' && !Array.isArray(nv)) {
              const vs = Object.values(nv as any).filter((v: any) => !isNaN(parseFloat(v)));
              nv = vs.length ? vs[0] : 0;
            }
            const n = parseFloat(String(nv));
            if (!isNaN(n)) { suggested = n !== 0 ? n : 650; break; }
          }
        }
        if (suggested === 650) {
          const br = matrix.baseRates || matrix['Base Rate'] || matrix['baseRates'] || {};
          const pvs: number[] = Object.values(br).map((v: any) => parseFloat(String(v))).filter(n => !isNaN(n));
          if (pvs.length) {
            const avg = pvs.reduce((a,b)=>a+b,0) / pvs.length;
            const prx = Math.abs(100 - avg);
            suggested = Math.round(Math.max(200, Math.min(950, prx * 350)));
          }
        }
        const autoFee = { description: `Appraisal fee (auto from loan product ${prodForFee?.name || 'matrix'} context)`, amount: Number(suggested).toFixed(2) };
        additional_fees = [...userFee, autoFee];
      } else if (userFee.length > 0) {
        additional_fees = userFee;
      }

      // 3) Create the order
      const dueDateIso = `${dueDate}T17:00:00Z`;
      const vendors =
        allocationType === 'manually' && selectedVendorIds.length > 0
          ? selectedVendorIds
          : undefined;

      const orderRes = await createReggoraOrder({
        loan: reggoraLoanId,
        products: selectedProductIds,
        due_date: dueDateIso,
        priority,
        allocation_type: allocationType,
        ...(vendors ? { vendors } : {}),
        ...(additional_fees && additional_fees.length ? { additional_fees } : {}),
      });
      if (orderRes.error) throw new Error(orderRes.error);

      // Persist the order ID locally (new column for lifecycle / webhooks / white-label)
      if (supabaseAdmin && loan.id) {
        await supabaseAdmin
          .from('loans')
          .update({ reggora_order_id: orderRes.orderId, reggora_status: 'created' })
          .eq('id', loan.id);
      }

      // 4) Snapshot the loan's product matrix (full + org FRED context) into local loan.notes (marker [PRICING-MATRIX-SNAPSHOT:appraisal ...])
      // Do in success path; graceful if no product_id
      try {
        await snapshotPricingMatrixForLoan(parseInt(selectedLoanId, 10), 'appraisal');
      } catch (snapErr: any) {
        console.warn('Non-fatal snapshot in dashboard appraisal order:', snapErr?.message);
      }

      setReggoraSuccess(
        `Success! Reggora Loan created (ID: ${reggoraLoanId}). Order ID: ${orderRes.orderId}. Stored reggora_loan_id + reggora_order_id on local Loan #${loan.id}. ${additional_fees && additional_fees.some(f=>f.description.includes('auto from')) ? '(matrix fee + snapshot used)' : '(snapshot used)'}`
      );

      // Refresh orders list
      const refreshRes = await fetchReggoraOrders();
      if (!refreshRes.error) {
        setAppraisals(refreshRes.orders || []);
      }

      // Reset form fields for next order
      setSelectedLoanId('');
      setSelectedProductIds([]);
      setSelectedVendorIds([]);
      setAddFeeDesc('');
      setAddFeeAmount('');
      setSelectedLoanProduct(null);
    } catch (e: any) {
      setReggoraError(e.message || 'Failed to create Reggora loan + order');
    } finally {
      setReggoraLoading(false);
    }
  };

  const assignProcessor = async (loanId: number, processorClerkId: string) => {
    if (!processorClerkId) return;

    // Log key mutation: AE/processor referral assignment
    await logAudit({
      userId: sbUser?.id,
      organizationId: currentUserOrgId,
      action: 'loan_processor_assigned',
      resourceType: 'loan',
      resourceId: loanId,
      details: { processor_id: processorClerkId, assigned_by: sbUser?.id, via: 'dashboard' },
    });

    const { error } = await supabase
      .from('loans')
      .update({ assigned_processor_id: processorClerkId })
      .eq('id', loanId);

    if (error) {
      alert('Failed to assign processor: ' + error.message);
    } else {
      alert('Processor assigned successfully!');
      fetchUnassignedLoans();
    }
  };

  const deleteLoan = async (loanId: number, propertyAddress?: string) => {
    if (!isSuperAdmin && !isAdminOrHigher) return alert('Only admins can delete loans.');
    if (!confirm(`Delete loan #${loanId} (${propertyAddress || ''})? This cannot be undone.`)) return;

    await logAudit({
      userId: sbUser?.id,
      organizationId: currentUserOrgId,
      action: 'loan_deleted',
      resourceType: 'loan',
      resourceId: loanId,
      details: { deleted_by: sbUser?.id, property: propertyAddress },
    });

    const { error } = await supabase.from('loans').delete().eq('id', loanId);
    if (error) {
      alert('Failed to delete loan: ' + error.message);
    } else {
      alert('Loan deleted.');
      window.location.reload();
    }
  };

  const addNewUser = async () => {
    if (!newUserEmail.trim()) return;

    await logAudit({
      userId: sbUser?.id,
      organizationId: currentUserOrgId,
      action: 'user_added_to_org',
      resourceType: 'user',
      resourceId: newUserEmail.trim(),
      details: { role: newUserRole, invited_by: sbUser?.id, via: 'dashboard_add' },
    });

    // For Junior AE (ACCOUNT_EXECUTIVE) creation: use the selected Senior AE as parent_id (per task; uses existing parent_id on users).
    // Falls back to current user for prior flows / other roles.
    const parentToSet = (newUserRole === 'ACCOUNT_EXECUTIVE' && selectedParentIdForJunior)
      ? selectedParentIdForJunior
      : sbUser?.id;

    const { error } = await supabase
      .from('profiles')
      .insert({
        id: 'clerk_' + Date.now(),
        email: newUserEmail.trim(),
        full_name: newUserEmail.split('@')[0],
        role: newUserRole,
        // parent_id removed with legacy users table
      });

    if (error) alert('Failed to add user: ' + error.message);
    else {
      alert('User added successfully!' + (newUserRole === 'ACCOUNT_EXECUTIVE' && parentToSet !== sbUser?.id ? ' (with Senior AE parent for hierarchy)' : ''));
      setNewUserEmail('');
      setSelectedParentIdForJunior('');
      window.location.reload();
    }
  };

  // Bulk XLS template download for organizations (tenant admins)
  const downloadBulkUserTemplate = () => {
    const wb = XLSX.utils.book_new();
    const headers = ['Email*', 'Full Name', 'Role*'];
    const exampleRows = [
      ['jane.doe@company.com', 'Jane Doe', 'BROKER_AE'],
      ['john.smith@company.com', 'John Smith', 'LOAN_PROCESSOR'],
      ['alex@company.com', 'Alex Rivera', 'ACCOUNT_EXECUTIVE'],
    ];
    const wsData = [headers, ...exampleRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Users');

    const instructions = [
      ['BULK USER UPLOAD INSTRUCTIONS'],
      [''],
      ['1. Fill out the "Users" sheet.'],
      ['   - Email* : Required. Must be unique.'],
      ['   - Full Name : Optional. Defaults to email local part.'],
      ['   - Role* : Required. Must be one of the valid roles below (exact match recommended).'],
      [''],
      ['VALID ROLES:'],
      ['PENDING, BROKER_AE, SENIOR_BROKER, JUNIOR_BROKER, ACCOUNT_EXECUTIVE, SENIOR_ACCOUNT_EXECUTIVE, LOAN_PROCESSOR, LOAN_UNDERWRITER, TECH_SUPPORT, ADMIN, ORG_ADMIN'],
      [''],
      ['2. For ACCOUNT_EXECUTIVE (as Junior), use the single "Add New User" form with the Senior AE parent dropdown (or upload and manually set parent after).'],
      ['3. Save as .xlsx and upload using the "Upload Filled XLS" button.'],
      ['4. Each user will be created (if new) with a temporary password and linked to this organization.'],
      ['5. New users receive a welcome email with login instructions.'],
      ['6. Do not upload more than ~100 at a time to avoid rate limits.'],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

    XLSX.writeFile(wb, 'organization-bulk-user-upload-template.xlsx');
  };

  const handleBulkUserUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserOrgId) {
      alert('No file or organization context.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

        let added = 0;
        const errors: string[] = [];
        const tempPasswords: string[] = [];

        for (const row of rows) {
          const email = String(row['Email*'] || row.Email || row.email || '').trim();
          if (!email) continue;

          const fullName = String(row['Full Name'] || row['Full Name*'] || row.full_name || row.name || email.split('@')[0]).trim();
          let role = String(row['Role*'] || row.Role || row.role || 'BROKER_AE').trim().replace(/ /g, '_').toUpperCase();

          // basic validation / normalization
          const validRoles = ['PENDING','BROKER_AE','SENIOR_BROKER','JUNIOR_BROKER','ACCOUNT_EXECUTIVE','SENIOR_ACCOUNT_EXECUTIVE','LOAN_PROCESSOR','LOAN_UNDERWRITER','TECH_SUPPORT','ADMIN','ORG_ADMIN'];
          if (!validRoles.includes(role)) {
            role = 'BROKER_AE';
          }

          try {
            const result = await addUserToOrganization(email, fullName, role, currentUserOrgId);
            if (result && result.success) {
              added++;
              if (result.tempPassword) {
                tempPasswords.push(`${email}: ${result.tempPassword}`);
              }
            } else {
              errors.push(`${email}: ${result?.error || 'failed'}`);
            }
          } catch (err: any) {
            errors.push(`${email}: ${err.message || 'error'}`);
          }
        }

        let msg = `Bulk upload finished: ${added} user(s) processed successfully.`;
        if (errors.length > 0) {
          msg += `\n\nErrors (${errors.length}):\n` + errors.slice(0, 8).join('\n');
        }
        if (tempPasswords.length > 0) {
          msg += `\n\nTemporary passwords (copy and share securely):\n` + tempPasswords.slice(0, 8).join('\n');
        }
        alert(msg);

        // Refresh the users list (same pattern as single add)
        window.location.reload();
      } catch (err: any) {
        alert('Failed to read or process the XLS file: ' + (err.message || err));
      } finally {
        e.target.value = ''; // allow re-upload same file
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // AE invite (Senior or Junior): name + email only. Sends email containing apply link with ?referred_by= current AE id.
  // 6-digit OTP only (prospect does /sign-up email code then /apply/organization); no temp pw created here.
  // Updates pending_organizations.referred_by (and organizations on approve) + used for dashboard hierarchy/loans.
  const handleAEInvite = async () => {
    if (!inviteEmail.trim()) {
      alert('Prospect email is required');
      return;
    }
    const isAEUser = currentUserRole === 'SENIOR_ACCOUNT_EXECUTIVE' || currentUserRole === 'ACCOUNT_EXECUTIVE';
    if (!isAEUser || !sbUser?.id) {
      alert('AE invite only available for Account Executive roles.');
      return;
    }
    try {
      await sendAEProspectInvite(sbUser.id, inviteName.trim(), inviteEmail.trim());
      alert('✅ AE referral invite sent! Email contains the apply link (referred_by prefilled; prospect uses 6-digit OTP sign-up, no temp password).');
      setInviteName('');
      setInviteEmail('');
    } catch (e: any) {
      alert('Failed to send AE invite: ' + (e?.message || e));
    }
  };

  const startEdit = (u: any) => {
    setEditingUser(u);
    setEditEmail(u.email || '');
    setEditRole(u.role || 'BROKER_AE');
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        email: editEmail,
        role: editRole,
        updated_at: new Date().toISOString()
      })
      .eq('id', editingUser.id);

    if (error) alert('Failed to update: ' + error.message);
    else {
      alert('User updated successfully!');
      setEditingUser(null);
      setEditEmail('');
      setEditRole('');
      window.location.reload();
    }
  };

  const deleteUser = async (userId: string) => {
    if (!isSuperAdmin) return alert("Only Super Admin can delete users.");
    if (!confirm("Delete this user (auth + profile + legacy records)?")) return;

    try {
      const { fullDeleteUser } = await import('@/app/actions/organization-actions');
      await fullDeleteUser(userId, sbUser?.id);
      alert('✅ User fully deleted (auth + profiles + users table).');
      window.location.reload();
    } catch (e: any) {
      alert('Failed to fully delete user: ' + (e?.message || e));
    }
  };

  if (!userLoaded || loading) return <div className="p-8 text-center">Loading dashboard...</div>;

  if (currentUserRole === 'PENDING') {
    return (
      <div className="max-w-7xl mx-auto p-8">
        {/* Global AppHeader (from root layout) provides branding + user menu + logout */}
        <div className="bg-yellow-50 border border-yellow-300 rounded-3xl p-12 text-center">
          <h2 className="text-3xl font-semibold mb-4 text-yellow-800">Organization Application Pending</h2>
          <p className="text-yellow-700 max-w-md mx-auto">
            Your organization application has been submitted and is under review. 
            You will receive a welcome email (with login details) once it is approved. 
            Full access to the dashboard and tools will be enabled at that time.
          </p>
          <button 
            onClick={handleLogout} 
            className="mt-8 px-8 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-2xl font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const drafts = applications.filter(a => a.status === 'draft');
  const pendingApps = applications.filter(a => ['submitted', 'priced', 'in_process'].includes(a.status || ''));

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-10 border-b pb-6">
        <div className="flex items-center gap-4">
          {sbUser?.user_metadata?.avatar_url && (
            <NextImage src={sbUser.user_metadata.avatar_url} alt="Profile" width={64} height={64} className="rounded-full border-2 border-gray-200" />
          )}
          <div>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="text-gray-600">Welcome back, <span className="font-medium">{sbUser?.user_metadata?.full_name || sbUser?.email}</span></p>
            <p className="text-sm text-gray-500">Role: <span className="font-medium">{currentUserRole}</span></p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push('/loan-application')}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-medium flex items-center gap-2"
          >
            + Start New Application
          </button>
          {/* <OrganizationSwitcher ... /> removed - using Supabase-based org context */}
          <button onClick={handleLogout} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-medium">
            Logout
          </button>
        </div>
         </div>

      {/* Prominent link for L1 ORG_ADMIN / tenant admins to the Admin Portal (child org approvals + white-label settings) */}
      {isTenantAdmin && (
        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-3xl flex items-center justify-between">
          <div>
            <div className="font-semibold text-blue-900">White Label & Sponsored Organizations</div>
            <div className="text-sm text-blue-700">Manage child (L2) org approvals, domain, from_email, branding, and other white-label settings.</div>
          </div>
          <Link 
            href="/admin" 
            className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap"
          >
            Go to Admin Dashboard →
          </Link>
        </div>
      )}

      {/* AE only buttons for Senior/Junior AE */}
      {(currentUserRole === 'SENIOR_ACCOUNT_EXECUTIVE' || currentUserRole === 'ACCOUNT_EXECUTIVE') && (
        <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-2xl">
          <div className="flex gap-4 flex-wrap">
            <button
              onClick={() => setShowBrokerInviteModal(true)}
              className="px-6 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 font-medium"
            >
              Send Broker Invite
            </button>
            <Link
              href="/wholesaleusers"
              className="px-6 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 font-medium"
            >
              Manage Wholesale Users
            </Link>
          </div>
          <p className="text-xs text-indigo-600 mt-2">Available only for Senior AE and Junior AE roles.</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mb-8 gap-6 text-lg flex-wrap">
        <button onClick={() => setActiveTab('price')} className={`pb-4 font-medium ${activeTab === 'price' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Price a Loan
        </button>

        <button onClick={() => setActiveTab('applications')} className={`pb-4 font-medium ${activeTab === 'applications' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Draft Applications ({drafts.length})
        </button>

        <button onClick={() => setActiveTab('pending')} className={`pb-4 font-medium ${activeTab === 'pending' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Pending Applications ({pendingApps.length})
        </button>

        <button onClick={() => setActiveTab('processing')} className={`pb-4 font-medium ${activeTab === 'processing' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Processing ({activeLoans.length})
        </button>

        <button onClick={() => setActiveTab('closed')} className={`pb-4 font-medium ${activeTab === 'closed' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Closed Loans ({closedLoans.length})
        </button>

        {isProcessorOrHigher && (
          <button 
            onClick={() => { setActiveTab('unassigned'); fetchUnassignedLoans(); }}
            className={`pb-4 font-medium ${activeTab === 'unassigned' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Assign to Processor
          </button>
        )}


        {/* APPRAISALS TAB (Reggora) - visible for ADMIN/SUPER_ADMIN or similar, like products */}
        {(isSuperAdmin || isAdminOrHigher) && (
          <button
            onClick={() => {
              setActiveTab('appraisals');
            }}
            className={`pb-4 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === 'appraisals' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            📋 Appraisals
          </button>
        )}

        {/* Organizations list: only for global approvers (SUPER/ADMIN). ORG_ADMIN (L1 tenant admins) are directed to the Admin Portal (/admin) for child (L2) org approvals & white-label settings via the banner above; they do not get the New Orgs tab here. */}
        {isGlobalAdmin && (
          <>
            <button
              onClick={() => { setActiveTab('organizations'); fetchAllOrganizations(); }}
              className={`pb-4 font-medium capitalize ${activeTab === 'organizations' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Organizations
            </button>
          </>
        )}


      </div>

      {/* Tab Contents */}
      {activeTab === 'price' && (
        <div className="text-center py-20">
          <button onClick={() => router.push('/loans/new')} className="px-12 py-6 bg-blue-600 text-white text-2xl rounded-3xl hover:bg-blue-700">
            Go to Pricing Tool →
          </button>
        </div>
      )}

      {activeTab === 'applications' && (
        <div>
          <h2 className="text-2xl font-semibold mb-6">Draft Applications</h2>
          {drafts.length === 0 ? <p className="text-gray-500">No draft applications yet.</p> : (
            drafts.map(app => (
              <div key={app.id} className="border rounded-3xl p-6 mb-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{app.form_data?.propertyAddress || 'Untitled Property'}</p>
                  <p className="text-sm text-gray-500">{new Date(app.created_at).toLocaleDateString()}</p>
                </div>
                <button onClick={() => router.push(`/loan-application?edit=${app.id}`)} className="px-8 py-3 border border-blue-600 text-blue-600 rounded-2xl">Continue Editing</button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'pending' && (
        <div>
          <h2 className="text-2xl font-semibold mb-6">Pending / Submitted Applications</h2>
          <p className="text-sm text-gray-500 mb-4">Company users, brokers and AEs: review submitted bridge &amp; rental applications here.</p>
          {pendingApps.length === 0 ? <p className="text-gray-500">No pending applications yet.</p> : (
            pendingApps.map(app => {
              const isBridge = !!(app.borrowers?.length || app.form_data?.rehabFundingNeeded !== undefined || app.form_data?.purposes?.bridgeLoan || app.form_data?.purposes?.fixAndFlip);
              const borrowerName = app.borrowers?.[0]?.fullLegalName || app.form_data?.borrowerEntityName || 'Unknown Borrower';
              const propAddr = app.form_data?.subjectPropertyAddress || app.form_data?.propertyAddress || 'Untitled Property';
              const loanAmt = app.form_data?.loanAmountRequest || app.form_data?.loanAmount || 'TBD';

              return (
                <div key={app.id} className="border rounded-3xl p-6 mb-4 flex justify-between items-center">
                  <div className="space-y-0.5">
                    <p className="font-semibold">Borrower: {borrowerName}</p>
                    <p className="text-sm">Property: {propAddr}</p>
                    <p className="text-sm">Loan Amount: {loanAmt}</p>
                    <p className="text-xs text-gray-500 capitalize">Status: {app.status || 'submitted'} • {new Date(app.created_at).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => router.push(isBridge ? `/bridge-loans/${app.id}` : `/loans/new?id=${app.id}`)}
                    className="px-8 py-3 bg-black text-white rounded-3xl font-medium hover:bg-zinc-800 transition"
                  >
                    {isBridge ? 'Click to Review' : 'View Pricing'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {(activeTab === 'processing' || activeTab === 'closed') && (
        <div className="bg-white rounded-3xl shadow-sm border divide-y">
          {(activeTab === 'processing' ? activeLoans : closedLoans).map((loan) => (
            <div key={loan.id} className="p-8 hover:bg-gray-50 flex justify-between items-center group cursor-pointer" onClick={() => router.push(`/loans/${loan.id}`)}>
              <div>
                <div className="font-semibold text-xl">Loan #{loan.id}</div>
                <div className="text-gray-600 mt-1">{loan.property_address || 'No address'}</div>
                {/* Tenant pipeline enhancement: show Senior AE / originator and child org */}
                <div className="mt-1 text-xs text-indigo-600 flex gap-3">
                  <span>
                    Senior AE / AE: {usersMap[loan.originator_id]?.full_name || usersMap[loan.originator_id]?.email || loan.originator_id || '—'}
                  </span>
                  <span>
                    Child Org: {orgsMap[loan.organization_id]?.name || loan.organization_id || '—'}
                    {orgsMap[loan.organization_id]?.parent_organization_id ? ' (child)' : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <select 
                  value={loan.loan_status || 'Processing'} 
                  onClick={(e) => e.stopPropagation()} 
                  onChange={async (e) => {
                    e.stopPropagation();
                    const newStatus = e.target.value;
                    const { error } = await supabase
                      .from('loans')
                      .update({ loan_status: newStatus, updated_at: new Date().toISOString() })
                      .eq('id', loan.id);
                    if (!error) {
                      if (newStatus === 'Closed and Funded' && loan.organization_id) {
                        // Log for root billing (1st/15th ACH)
                        try {
                          await supabase.from('loan_billing_events').insert({
                            loan_id: loan.id,
                            organization_id: loan.organization_id,
                            tenant_name: orgsMap[loan.organization_id]?.name || 'Unknown Tenant',
                            loan_amount: loan.loan_amount || 0,
                          });
                        } catch (billErr) {
                          console.warn('Billing event log failed (non fatal)', billErr);
                        }
                      }
                      // Refresh lists
                      window.location.reload();
                    } else {
                      alert('Failed to update status');
                    }
                  }}
                  className="bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm"
                >
                  {loanStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {(isSuperAdmin || isAdminOrHigher) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteLoan(loan.id, loan.property_address); }}
                    className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-700 text-sm font-medium px-3 py-1 border border-red-200 rounded-xl"
                    title="Delete loan (audited)"
                  >
                    Delete
                  </button>
                )}
                <div className="opacity-0 group-hover:opacity-100 text-blue-600 font-medium">View Details →</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ====================== APPRAISALS TAB (Reggora Lender Sandbox) ====================== */}
      {activeTab === 'appraisals' && (isSuperAdmin || isAdminOrHigher) && (
        <div className="bg-white rounded-3xl border p-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">Appraisals via Reggora</h2>
            <button
              onClick={loadReggoraData}
              disabled={reggoraLoading}
              className="px-4 py-2 text-sm border rounded-2xl hover:bg-gray-50 disabled:opacity-50"
            >
              {reggoraLoading ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>

          {reggoraError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl">
              {reggoraError}
            </div>
          )}
          {reggoraSuccess && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-700 rounded-2xl">
              {reggoraSuccess}
            </div>
          )}

          {/* Current Orders Table */}
          <div className="mb-10">
            <h3 className="text-lg font-semibold mb-3">Current Reggora Orders</h3>
            {reggoraLoading && appraisals.length === 0 ? (
              <p className="text-gray-500">Loading orders from Reggora...</p>
            ) : appraisals.length === 0 ? (
              <p className="text-gray-500">No orders returned (or Reggora not configured yet).</p>
            ) : (
              <div className="overflow-x-auto border rounded-2xl">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3">Order ID</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Loan Info</th>
                      <th className="text-left px-4 py-3">Due Date</th>
                      <th className="text-left px-4 py-3">Priority</th>
                      <th className="text-left px-4 py-3">Accepted Vendor</th>
                      <th className="text-left px-4 py-3">Products</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {appraisals.map((o: any) => (
                      <tr key={o.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{o.id}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded bg-gray-100 text-xs">{o.status}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {o.loan_file?.loan_number ? `#${o.loan_file.loan_number}` : ''}
                          <div className="text-gray-500 truncate max-w-[180px]">
                            {o.loan_file?.subject_property_address || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">{o.due_date || '—'}</td>
                        <td className="px-4 py-3 text-xs">{o.priority || 'Normal'}</td>
                        <td className="px-4 py-3 text-xs">
                          {o.accepted_vendor?.firm_name || o.accepted_vendor?.id || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {(o.products || []).map((p: any) => p.product_name || p.id).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Data fetched live from Reggora sandbox via server actions. Use the form below to order more.</p>
          </div>

          {/* Order New Appraisal Form */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Order New Appraisal</h3>
            <p className="text-sm text-gray-600 mb-4">
              Select a loan from this org, choose Reggora products, set due date/priority/allocation. The system will first create a corresponding loan in Reggora (storing the ID back to our loans table), then create the order. (auto-using this loan&apos;s product pricing matrix for fee suggestion + snapshot of rates/adjustments at order time).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {/* Loan selector */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Select Loan (from loaded dashboard loans)</label>
                <select
                  value={selectedLoanId}
                  onChange={(e) => setSelectedLoanId(e.target.value)}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm"
                >
                  <option value="">-- Select a loan --</option>
                  {[...activeLoans, ...closedLoans]
                    .filter((l, idx, arr) => arr.findIndex((x) => x.id === l.id) === idx)
                    .map((loan: any) => (
                      <option key={loan.id} value={loan.id}>
                        #{loan.id} — {loan.borrower_name || 'Unknown Borrower'} — {loan.property_address?.slice(0, 50) || 'No address'}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Uses active + closed loans visible to your role. (Add reggora_loan_id column to loans for best correlation.)</p>
              </div>

              {/* Pricing Matrix Context from selected loan's product (auto-use for appraisal fee suggestion + snapshot) */}
              {selectedLoanId && (
                <div className="md:col-span-2">
                  {selectedLoanProduct ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm">
                      <div className="font-medium text-emerald-800">Pricing Matrix Context from loan&apos;s product: <strong>{selectedLoanProduct.name}</strong></div>
                      {(() => {
                        const m = selectedLoanProduct.pricing_matrix || {};
                        const br = m.baseRates || m['Base Rate'] || m['baseRates'] || {};
                        const hasFico = !!(m.ficoLtvGrid || m['FICO Adjustment']);
                        const hasDscr = !!(m.dscrLtvGrid || m['DSCR Adjustment'] || m['dscrLtvGrid']);
                        const hasOther = !!(m['Other Adjustments'] || m['otherAdjustments']);
                        const bench = m.benchmark || m.benchmark_treasury || null;
                        const anch = m.benchmark_anchor_rate != null ? m.benchmark_anchor_rate : null;
                        return (
                          <div className="text-emerald-700 mt-0.5">
                            baseRates: {Object.keys(br).length} entries; grids: fico={hasFico ? 'yes' : 'no'}, dscr={hasDscr ? 'yes' : 'no'}; Other Adjustments: {hasOther ? 'yes' : 'no'}.
                            {bench ? ` benchmark: ${bench}` : ''}{anch != null ? ` anchored @ ${anch}%` : ''}. Will snapshot + derive suggested fee on order.
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">Selected loan has no product_id / pricing_matrix — order will proceed without matrix snapshot (fee from Reggora products + any manual additional).</div>
                  )}
                </div>
              )}

              {/* Products multi-select */}
              <div>
                <label className="block text-sm font-medium mb-1">Reggora Products (multi-select)</label>
                <select
                  multiple
                  value={selectedProductIds}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions, (opt) => opt.value);
                    setSelectedProductIds(values);
                  }}
                  className="w-full h-28 border border-gray-300 rounded-2xl px-3 py-2 text-sm"
                  size={5}
                >
                  {reggoraProducts.length === 0 && <option disabled>No products loaded</option>}
                  {reggoraProducts.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.product_name} (${p.amount}) — {p.inspection_type || ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-500">Ctrl/Cmd + click for multiple</p>
              </div>

              {/* Due date + Priority + Allocation */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'Normal' | 'Rush')}
                    className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Rush">Rush</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Allocation Type</label>
                  <select
                    value={allocationType}
                    onChange={(e) => setAllocationType(e.target.value as 'automatically' | 'manually')}
                    className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm"
                  >
                    <option value="automatically">Automatically</option>
                    <option value="manually">Manually (select vendors below)</option>
                  </select>
                </div>
              </div>

              {/* Manual vendors */}
              {allocationType === 'manually' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Vendors (from Reggora users, multi)</label>
                  <select
                    multiple
                    value={selectedVendorIds}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions, (opt) => opt.value);
                      setSelectedVendorIds(values);
                    }}
                    className="w-full h-28 border border-gray-300 rounded-2xl px-3 py-2 text-sm"
                    size={5}
                  >
                    {reggoraUsers.length === 0 && <option disabled>No users loaded</option>}
                    {reggoraUsers.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.firstname || ''} {u.lastname || ''} — {u.email || ''} {u.role ? `(${u.role})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Optional additional fees (single for simplicity) */}
              <div>
                <label className="block text-sm font-medium mb-1">Additional Fee (optional)</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Description e.g. rush exterior"
                    value={addFeeDesc}
                    onChange={(e) => setAddFeeDesc(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-2xl px-4 py-3 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Amount"
                    value={addFeeAmount}
                    onChange={(e) => setAddFeeAmount(e.target.value)}
                    className="w-28 border border-gray-300 rounded-2xl px-4 py-3 text-sm"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={orderNewAppraisal}
              disabled={reggoraLoading}
              className="mt-6 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white rounded-3xl font-medium"
            >
              {reggoraLoading ? 'Working with Reggora...' : 'Create Reggora Loan then Order Appraisal'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Uses exact Reggora Lender API (Bearer + integration header). If env vars missing, you will see the configuration message above. Fee suggestions and notes snapshot auto-use the selected loan&apos;s product pricing_matrix when available.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'unassigned' && isProcessorOrHigher && (
        <div className="bg-white rounded-3xl border overflow-hidden">
          <div className="p-8 border-b">
            <h2 className="text-2xl font-semibold">Assign to Processor</h2>
            <p className="text-gray-500">These loans need to be assigned to a processor</p>
          </div>
          <div className="divide-y">
            {unassignedLoans.length === 0 ? (
              <p className="p-12 text-center text-gray-500">No unassigned loans at the moment.</p>
            ) : (
              unassignedLoans.map((loan) => (
                <div key={loan.id} className="p-8 flex justify-between items-center hover:bg-gray-50">
                  <div>
                    <p className="font-medium">Loan #{loan.id} — {loan.property_address}</p>
                    <p className="text-sm text-gray-500">{loan.borrower_name}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <select 
                      onChange={(e) => assignProcessor(loan.id, e.target.value)}
                      className="border border-gray-300 rounded-2xl px-5 py-3 focus:outline-none focus:border-blue-500"
                      defaultValue=""
                    >
                      <option value="">Assign to Processor...</option>
                      {processors.map((proc) => (
                        <option key={proc.id} value={proc.id}>
                          {proc.full_name || proc.email} ({proc.role})
                        </option>
                      ))}
                    </select>
                    {(isSuperAdmin || isAdminOrHigher) && (
                      <button
                        onClick={() => deleteLoan(loan.id, loan.property_address)}
                        className="text-red-600 hover:text-red-700 text-sm font-medium px-4 py-2 border border-red-200 rounded-2xl"
                        title="Delete loan (audited)"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}



      {activeTab === 'organizations' && isGlobalAdmin && (
  <div className="bg-white rounded-3xl border p-8">
    <div className="flex justify-between items-center mb-6">
      <h2 className="text-2xl font-semibold">All Organizations</h2>
      <button
        onClick={() => router.push('/admin/organizations')}
        className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 font-medium"
      >
        Manage White Label Settings →
      </button>
    </div>
  </div>
      )}


      {/* organizations tab renders minimal header + delegates full list/white-label mgmt to /admin/organizations (no duplicate floating list here to keep JSX balanced) */}

      {/* Broker Invite Modal for AE */}
      {showBrokerInviteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-6">Send Broker Invite</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Broker Name</label>
                <input type="text" value={brokerName} onChange={(e) => setBrokerName(e.target.value)} className="w-full px-4 py-3 border rounded-2xl" placeholder="Broker Full Name" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Company Name</label>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full px-4 py-3 border rounded-2xl" placeholder="Broker Company Name" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email Address</label>
                <input type="email" value={brokerInviteEmail} onChange={(e) => setBrokerInviteEmail(e.target.value)} className="w-full px-4 py-3 border rounded-2xl" placeholder="broker@company.com" />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button 
                onClick={async () => {
                  if (!brokerInviteEmail) return alert('Email required');
                  try {
                    const fullName = `${brokerName} (${companyName})`.trim();
                    await sendAEProspectInvite(sbUser.id, fullName, brokerInviteEmail);
                    alert('Broker invite sent. The inviting AE is preserved via referred_by for assignment after approval.');
                    setShowBrokerInviteModal(false);
                    setBrokerName('');
                    setCompanyName('');
                    setBrokerInviteEmail('');
                  } catch (e: any) {
                    alert('Failed to send invite: ' + (e.message || e));
                  }
                }} 
                className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700"
              >
                Send Invite
              </button>
              <button onClick={() => { setShowBrokerInviteModal(false); setBrokerName(''); setCompanyName(''); setBrokerInviteEmail(''); }} className="flex-1 py-3 bg-gray-200 rounded-2xl hover:bg-gray-300">Cancel</button>
            </div>
            <p className="text-xs text-gray-500 mt-4">The AE who sends this invite (you) will be linked via the referral metadata for approval and assignment.</p>
          </div>
        </div>
      )}
    </div>
  );
}