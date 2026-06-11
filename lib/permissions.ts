// lib/permissions.ts
// Role strings (Prisma enum generated at build; use string for runtime/TS in this env without full prisma generate)
// ORG_ADMIN: scoped super-admin for exactly one Level 1 organization + its entire subtree (Level 2 children).
//   - Can fully manage users, products, loans, approvals WITHIN their L1+subtree scope ONLY.
//   - Root "Loan-App Platform" (L0) is NEVER manageable by ORG_ADMIN or TECH_SUPPORT.
// TECH_SUPPORT: limited to support tools/tickets. CANNOT manage root users, approve orgs, create/edit users outside support, or see full org lists.
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'ORG_ADMIN' | 'TECH_SUPPORT' | 'LOAN_PROCESSOR' | 'LOAN_UNDERWRITER' | 'LENDING_SUPERVISOR' | 'SENIOR_ACCOUNT_EXECUTIVE' | 'ACCOUNT_EXECUTIVE' | 'SENIOR_BROKER' | 'JUNIOR_BROKER' | 'BROKER' | 'BROKER_AE' | 'BORROWER' | 'PENDING' | string;

export type UserWithRole = {
  id: string;
  role: Role | string;
  organization_id?: string | null;
  parent_id?: string | null;
};

// Extended context for hierarchy-aware checks. Callers (server actions, pages) pass org parent info when needed.
// parentMap: { childOrgId: parentOrgId | null } for subtree checks. For ORG_ADMIN, their organization_id is the L1 scope root.
export type OrgHierarchyContext = {
  parentMap?: Record<string, string | null>; // orgId -> parentId (null for root/L0 or top L1s under root)
  rootOrgId?: string | null; // the canonical "Loan-App Platform" id if known
};

/**
 * Returns true if the role is a platform-global elevated role (can see across orgs, manage root, approve orgs, etc.).
 * ORG_ADMIN and normal ADMIN/TECH are NOT global.
 */
export const isGlobalElevatedRole = (role: Role | string | null | undefined): boolean => {
  if (!role) return false;
  return ['SUPER_ADMIN', 'ADMIN'].includes(role as string); // ADMIN here treated as legacy global for some paths; ORG_ADMIN is scoped.
};

/**
 * True if this user has ORG_ADMIN role (scoped). Their organization_id should be the Level 1 they administer.
 */
export const isOrgAdmin = (user: UserWithRole | null): boolean => {
  if (!user) return false;
  return (user.role as string) === 'ORG_ADMIN';
};

/**
 * Determine if user (esp. ORG_ADMIN) can manage the target organization (or its subtree).
 * - SUPER_ADMIN: always yes
 * - ORG_ADMIN: yes if targetOrgId === user's org OR target is a descendant (via parentMap)
 * - ADMIN: yes (legacy global-ish, but prefer ORG_ADMIN for L1 scoping)
 * - Others: no for org management
 * Root org (parent=null or matches rootOrgId) cannot be "managed" by non-SUPER_ADMIN.
 */
export const canManageOrg = (
  user: UserWithRole | null,
  targetOrgId: string | null | undefined,
  ctx?: OrgHierarchyContext
): boolean => {
  if (!user || !targetOrgId) return false;
  const r = user.role as string;

  if (r === 'SUPER_ADMIN') return true;

  // Never allow non-super to manage the root org itself
  if (ctx?.rootOrgId && targetOrgId === ctx.rootOrgId) return false;
  // If target has no parent (is a top-level, likely root or direct L1 under root), only super can "manage" broadly
  const targetParent = ctx?.parentMap?.[targetOrgId] ?? null;
  if (targetParent === null && r !== 'SUPER_ADMIN') {
    // L1s under root: ORG_ADMIN scoped to their own L1 can manage their own
    // but if targetParent===null and not the user's org, deny broad root-level
  }

  if (r === 'ORG_ADMIN') {
    const userScopeOrg = user.organization_id;
    if (!userScopeOrg) return false;
    if (targetOrgId === userScopeOrg) return true;
    // Check subtree: walk parents up from target until match userScopeOrg or root
    if (ctx?.parentMap) {
      let cur: string | null | undefined = targetOrgId;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        if (cur === userScopeOrg) return true;
        cur = ctx.parentMap[cur] ?? null;
        if (cur === ctx?.rootOrgId || cur === null) break;
      }
    }
    return false;
  }

  // Legacy ADMIN / others for backward compat (global view) — but in new model prefer scoped ORG_ADMIN
  if (['ADMIN', 'SUPER_ADMIN'].includes(r)) return true;

  return false;
};

/**
 * Alias / convenience for "is this ORG_ADMIN (or higher scoped) for this org/subtree?"
 */
export const isOrgAdminFor = (
  user: UserWithRole | null,
  targetOrgId: string | null | undefined,
  ctx?: OrgHierarchyContext
): boolean => {
  if (!user || !targetOrgId) return false;
  const r = user.role as string;
  if (r === 'SUPER_ADMIN') return true;
  if (r === 'ORG_ADMIN') {
    return canManageOrg(user, targetOrgId, ctx);
  }
  return false;
};

/**
 * Can the user approve/reject pending organizations or manage root-level org creation?
 * SUPER_ADMIN / ADMIN (global) and ORG_ADMIN (scoped: only for their sponsored L1's child organizations;
 * call sites in /api/pending-organizations enforce the _intended_parent match for ORG_ADMIN).
 */
export const canApproveOrgs = (user: UserWithRole | null): boolean => {
  if (!user) return false;
  const r = user.role as string;
  return ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'].includes(r);
};

/**
 * Can the user manage (create/edit/delete) users at root/platform level?
 * TECH_SUPPORT and ORG_ADMIN cannot touch root users or cross-org.
 */
export const canManageRootUsers = (user: UserWithRole | null): boolean => {
  if (!user) return false;
  const r = user.role as string;
  return r === 'SUPER_ADMIN' || r === 'ADMIN';
};

export const hasPermission = (
  user: UserWithRole | null,
  requiredRole: Role | Role[],
  options?: { childOrgAllowed?: boolean; hierarchy?: OrgHierarchyContext; targetOrgId?: string | null }
): boolean => {
  if (!user) return false;

  const userRole = user.role as Role;
  const required = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  // Super Admin = God Mode (platform-wide, including root + all subtrees)
  if (userRole === 'SUPER_ADMIN') return true;

  // PENDING org applicants have no elevated access until their org is approved
  if (userRole === 'PENDING') return false;

  // TECH_SUPPORT: strictly limited. Can access support tickets / admin support pages, but:
  // - NOT treated as ADMIN for user management, org approval, root users, or broad org lists.
  // - Explicitly blocked from SUPER_ADMIN/ADMIN-required paths and org approve/root user paths.
  if (userRole === 'TECH_SUPPORT') {
    return required.some((r) => {
      const rs = r as string;
      if (rs === 'TECH_SUPPORT' || rs === 'SUPPORT') return true;
      // Limited overlap only for viewing/processing support-related; no org mgmt or user mgmt
      if (['LOAN_PROCESSOR', 'LOAN_UNDERWRITER'].includes(rs)) return false; // no, unless separately granted
      return false;
    });
  }

  // ORG_ADMIN: acts as a scoped "ADMIN" + more for its L1 + subtree. Global checks still require SUPER.
  // When targetOrgId + hierarchy provided, we can scope it; otherwise fall back to role string.
  const targetOrg = options?.targetOrgId ?? user.organization_id;
  const ctx = options?.hierarchy;
  const isScopedOrgAdmin = isOrgAdmin(user) && (!targetOrg || canManageOrg(user, targetOrg, ctx));

  return required.some((r) => {
    const rs = r as string;
    switch (rs) {
      case 'SUPER_ADMIN':
        return userRole === 'SUPER_ADMIN';

      case 'ADMIN':
        // ORG_ADMIN counts as admin *within scope*; global ADMIN still for legacy.
        return ['ADMIN', 'SUPER_ADMIN'].includes(userRole as string) || isScopedOrgAdmin;

      case 'ORG_ADMIN':
        return userRole === 'ORG_ADMIN' || isScopedOrgAdmin || userRole === 'SUPER_ADMIN';

      case 'TECH_SUPPORT':
        // Only real TECH_SUPPORT (or super); do not auto-promote ORG_ADMIN here
        return ['TECH_SUPPORT', 'SUPER_ADMIN'].includes(userRole as string);

      case 'LOAN_UNDERWRITER':
        return ['LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN'].includes(userRole as string) ||
               isScopedOrgAdmin;

      case 'LOAN_PROCESSOR':
        return ['LOAN_PROCESSOR', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN'].includes(userRole as string) ||
               isScopedOrgAdmin;

      case 'SENIOR_ACCOUNT_EXECUTIVE':
      case 'ACCOUNT_EXECUTIVE':
        return ['SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE', 'ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'].includes(userRole as string) ||
               isScopedOrgAdmin;

      // NOTE: User hierarchy for AE referrals uses existing parent_id on users/profiles (Senior AE parents Junior AE;
      // AEs parent their assigned brokers). Dashboards filter loans/users by traversing parent_id for the AE's subtree.
      // Loan visibility for AEs is additionally enforced in dashboard load (by assigned broker originator_id) and canViewLoan below.

      case 'SENIOR_BROKER':
      case 'JUNIOR_BROKER':
      case 'BROKER':
      case 'BROKER_AE':
        return ['SENIOR_BROKER', 'JUNIOR_BROKER', 'BROKER', 'BROKER_AE', 'ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'].includes(userRole as string) ||
               isScopedOrgAdmin;

      case 'BORROWER':
        return userRole === 'BORROWER';

      default:
        return false;
    }
  });
};

// Helper for loan visibility (updated for hierarchy + ORG_ADMIN scoping + TECH_SUPPORT limits)
export const canViewLoan = (user: UserWithRole, loan: any, ctx?: OrgHierarchyContext): boolean => {
  if (!user || !loan) return false;

  const r = user.role as string;

  // Super Admin sees everything (including root org loans)
  if (r === 'SUPER_ADMIN') return true;

  // TECH_SUPPORT: can view support-related but do NOT get blanket loan visibility unless assigned or same scope.
  // They are not granted broad "ADMIN" loan view.
  if (r === 'TECH_SUPPORT') {
    // Only if explicitly assigned as processor/underwriter or originator (rare for support)
    if (loan.originator_id === user.id || loan.processor_id === user.id || loan.underwriter_id === user.id) return true;
    return false;
  }

  // ORG_ADMIN or scoped ADMIN: see loans in their org + subtree
  if (r === 'ORG_ADMIN' || r === 'ADMIN') {
    if (hasPermission(user, ['ADMIN', 'ORG_ADMIN'], { hierarchy: ctx, targetOrgId: loan.organization_id })) {
      // If we have hierarchy ctx, ensure it's within scope for ORG_ADMIN
      if (r === 'ORG_ADMIN') {
        return canManageOrg(user, loan.organization_id, ctx) || loan.originator_id === user.id || loan.processor_id === user.id || loan.underwriter_id === user.id;
      }
      return true; // legacy ADMIN
    }
  }

  // LENDING_SUPERVISOR etc still get broad within their prior rules (kept for compat)
  if (hasPermission(user, ['LENDING_SUPERVISOR'])) return true;

  // Borrower can only see their own loans
  if (user.role === 'BORROWER') {
    return loan.originator_id === user.id;
  }

  // Same organization or child (basic org match; full subtree uses canManageOrg when ctx provided)
  if (user.organization_id && loan.organization_id === user.organization_id) return true;
  if (ctx?.parentMap && user.organization_id) {
    // allow viewing loans in descendant orgs for scoped users
    if (canManageOrg(user, loan.organization_id, ctx)) return true;
  }

  // Broker / AE can see their originated loans
  if (loan.originator_id === user.id) return true;

  // AE referral hierarchy (parent_id on users): Senior AE sees loans from Juniors + their brokers; Junior AE sees assigned brokers' loans.
  // (Primary filtering + child id collection happens in dashboard for performance; this is a safety net.)
  if (['SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE'].includes(String(user.role)) && loan.originator_id) {
    // If the list was already filtered to the AE's subtree in the caller, treat as visible.
    // (Full parent_id join would require extra query; dashboards pre-compute child broker ids.)
    return true;
  }

  // Processor / Underwriter assigned to the loan
  if (loan.processor_id === user.id || loan.underwriter_id === user.id) return true;

  return false;
};

export const canEditLoan = (user: UserWithRole, loan: any, ctx?: OrgHierarchyContext): boolean => {
  if (!canViewLoan(user, loan, ctx)) return false;

  // Borrowers cannot edit loans (they can only view and submit documents)
  if (user.role === 'BORROWER') return false;

  // TECH_SUPPORT cannot edit loans (support only)
  if ((user.role as string) === 'TECH_SUPPORT') return false;

  // Processors and above (incl scoped ORG_ADMIN) can edit
  return hasPermission(user, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN'], { hierarchy: ctx, targetOrgId: loan.organization_id });
};

export const isBorrower = (user: UserWithRole): boolean => {
  return user.role === 'BORROWER';
};

export const canAddCustomCondition = (user: UserWithRole, ctx?: OrgHierarchyContext): boolean => {
  return hasPermission(user, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN'], { hierarchy: ctx });
};

// Bonus: Retail vs Wholesale access
export const canSeeRetailPricing = (user: UserWithRole): boolean => {
  return user.role === 'BORROWER';
};

export const canSeeWholesalePricing = (user: UserWithRole): boolean => {
  return hasPermission(user, ['BROKER', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN']);
};

/**
 * Product visibility helper (for use in pages like /products, /loans/new, dashboard products tab).
 * Rules (per spec):
 * - SUPER_ADMIN: all products everywhere.
 * - Level 1 (or ORG_ADMIN for a L1): own products + any direct L2 children products? No: "Level 2 own products hidden from parents."
 *   So parents (L1) see ONLY their own products. Never child's.
 * - Level 2: only parent's products + own products. (multi-parent visibility)
 * - Child's own products never visible upward.
 */
export const canSeeProduct = (
  user: UserWithRole | null,
  product: { organization_id?: string | null; id?: string } | null,
  userOrgParentId?: string | null, // pass the parent of the *user's own org* if known
  productOrgParentId?: string | null, // pass parent of the *product's org* if known
  ctx?: OrgHierarchyContext
): boolean => {
  if (!user || !product) return false;
  const r = user.role as string;
  const prodOrg = product.organization_id;
  const userOrg = user.organization_id;

  if (r === 'SUPER_ADMIN') return true;

  if (!prodOrg) return false; // platform products? rare, deny for safety

  if (r === 'ORG_ADMIN') {
    // ORG_ADMIN sees products in their scope (own L1 + ? but per rule L2 own hidden from parent, so mainly own L1 products)
    return canManageOrg(user, prodOrg, ctx);
  }

  if (!userOrg) {
    // non-org user: only if global elevated (already handled)
    return hasPermission(user, ['ADMIN']);
  }

  // Same org: always see own
  if (prodOrg === userOrg) return true;

  // Level 2 user (has a parent): can see parent's products + own (own already matched above)
  if (userOrgParentId && prodOrg === userOrgParentId) return true;

  // Parent user (L1) seeing child's product: NEVER (per "Level 2 own products hidden from parents")
  if (productOrgParentId && productOrgParentId === userOrg) return false;

  // Fallback: if we have full ctx, use canManageOrg which walks for ORG_ADMIN etc.
  if (ctx && canManageOrg(user, prodOrg, ctx)) return true;

  return false;
};

// Helper to filter a list of products according to hierarchy rules for the current user.
export function filterVisibleProductsForUser<T extends { organization_id?: string | null }>(
  user: UserWithRole | null,
  products: T[],
  getOrgParent: (orgId: string) => string | null | undefined, // sync lookup or preloaded map fn
  ctx?: OrgHierarchyContext
): T[] {
  if (!user) return [];
  const r = user.role as string;
  if (r === 'SUPER_ADMIN') return products;

  const userOrg = user.organization_id;
  if (!userOrg) {
    // non-scoped: fall back to prior ADMIN global for some, else empty
    return hasPermission(user, ['ADMIN']) ? products : [];
  }

  const userParent = getOrgParent(userOrg) ?? null;

  return products.filter((p) => {
    const pOrg = p.organization_id;
    if (!pOrg) return false;
    if (pOrg === userOrg) return true;
    const pParent = getOrgParent(pOrg) ?? null;

    if (r === 'ORG_ADMIN') {
      return canManageOrg(user, pOrg, ctx);
    }

    // Level 2 view: own (above) + direct parent's products
    if (userParent && pOrg === userParent) return true;

    // Parent never sees direct child's own products
    if (pParent === userOrg) return false;

    // Otherwise only if same (or via admin higher)
    return hasPermission(user, ['ADMIN']) && canManageOrg(user, pOrg, ctx);
  });
}

// === EXTENDED for L2 private products (owner_user_id) + retail markup usage in pricing (L2 own products) ===
// Within same org, Level 2 BROKER_AE (user has parent_id) create products with owner_user_id set to self => hidden upward from their parent user.
// L2 can view parent (L1) products (owner null or L1's) + own, and set margin on inherited (owner null).
// L1/parent BROKER_AE see only owner null + own (L2 privates hidden).
// ORG_ADMIN (and ADMIN) see all products in their org (per "ORG_ADMIN only sees their org products").
// This augments the org-parent filter above; call after org scoping.
export function filterVisibleProductsWithOwner<T extends { organization_id?: string | null; owner_user_id?: string | null }>(
  user: UserWithRole | null,
  products: T[]
): T[] {
  if (!user || !products?.length) return products || [];
  const r = (user.role || '').toString();
  const uid = user.id;
  const parentId = user.parent_id || null;

  // Super, ORG_ADMIN, ADMIN, TECH etc: full within their org-scoped list (caller ensures org filter for ORG_ADMIN)
  if (r === 'SUPER_ADMIN' || r === 'ORG_ADMIN' || r === 'ADMIN' || r === 'TECH_SUPPORT' || r === 'LENDING_SUPERVISOR') {
    return products;
  }

  if (r !== 'BROKER_AE') {
    return products;
  }

  const isL2 = !!parentId;
  return products.filter((p: any) => {
    const oid = p.owner_user_id || null;
    if (!oid) return true; // org/inherited (visible down, including to L2)
    if (oid === uid) return true; // self (L2 private or L1)
    if (isL2 && parentId && oid === parentId) return true; // L2 sees direct parent's owned products
    // L1 never sees L2-owned (oid set to some child); already filtered by not matching above
    return false;
  });
}

export const isLevel2BrokerAE = (user: UserWithRole | null): boolean => {
  if (!user) return false;
  return (user.role || '') === 'BROKER_AE' && !!user.parent_id;
};

// Bulk base rate FRED update permission (per task): ORG_ADMIN + Level 1 scoped (L1 admins).
// Uses existing canManageOrg + isOrgAdmin + hasPermission. Callers pass ctx for full subtree walk when available.
export const canBulkUpdateBaseRates = (
  user: UserWithRole | null,
  targetOrgId?: string | null,
  ctx?: OrgHierarchyContext
): boolean => {
  if (!user || !targetOrgId) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (isOrgAdmin(user) && canManageOrg(user, targetOrgId, ctx)) return true;
  return hasPermission(user, ['ORG_ADMIN', 'ADMIN'], { hierarchy: ctx, targetOrgId });
};

// Admin portal gate: global elevated (SUPER/ADMIN/TECH_SUPPORT at root) or tenant ORG_ADMINs (scoped to their org subtree).
// TECH_SUPPORT is intentionally blocked from root user/org approval paths elsewhere.
export function canAccessAdminPortal(user: UserWithRole | null, ctx?: any): boolean {
  if (!user) return false;
  const r = (user.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'ADMIN'].includes(r)) return true;
  // TECH_SUPPORT can access most admin but not root user management (enforced in pages)
  if (r === 'TECH_SUPPORT') return true;
  if (isOrgAdmin(user)) return true;
  return hasPermission(user, ['ORG_ADMIN', 'ADMIN', 'SENIOR_ACCOUNT_EXECUTIVE'], { hierarchy: ctx });
}
