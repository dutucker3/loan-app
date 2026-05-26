// lib/permissions.ts
import { Role } from '@prisma/client';

export type UserWithRole = {
  id: string;
  role: Role | string;
  custom_role?: string;           // ← Added for Clerk JWT
  organization_id?: string | null;
  parent_id?: string | null;
};

export const hasPermission = (
  user: UserWithRole | null,
  requiredRole: Role | Role[],
): boolean => {
  if (!user) return false;

  // Prioritize custom_role from Clerk JWT, fallback to role
  const userRole = (user.custom_role || user.role) as Role;
  const required = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  // ==================== GLOBAL / APP LEVEL ====================
  if (userRole === 'SUPER_ADMIN') return true;           // God Mode
  if (userRole === 'ADMIN') return true;                 // App-level Admin

  // ==================== NEW ROLES ====================
  if (userRole === 'ORG_ADMIN') {
    return required.some(r => 
      ['ORG_ADMIN', 'BROKER', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER'].includes(r as string)
    );
  }

  if (userRole === 'TECH_SUPPORT') {
    return required.some(r => ['TECH_SUPPORT'].includes(r as string));
  }

  // ==================== EXISTING ROLES ====================
  return required.some((r) => {
    switch (r) {
      case 'SUPER_ADMIN':
        return userRole === 'SUPER_ADMIN';

      case 'ADMIN':
        return ['ADMIN', 'SUPER_ADMIN'].includes(userRole);

      case 'ORG_ADMIN':
        return userRole === 'ORG_ADMIN';

      case 'TECH_SUPPORT':
        return userRole === 'TECH_SUPPORT';

      case 'LOAN_UNDERWRITER':
        return ['LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR'].includes(userRole);

      case 'LOAN_PROCESSOR':
        return ['LOAN_PROCESSOR', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR'].includes(userRole);

      case 'SENIOR_ACCOUNT_EXECUTIVE':
      case 'ACCOUNT_EXECUTIVE':
        return ['SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE', 'ADMIN', 'SUPER_ADMIN'].includes(userRole);

      case 'SENIOR_BROKER':
      case 'JUNIOR_BROKER':
      case 'BROKER':
      case 'BROKER_AE':
        return ['SENIOR_BROKER', 'JUNIOR_BROKER', 'BROKER', 'BROKER_AE', 'ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'].includes(userRole);

      case 'BORROWER':
        return userRole === 'BORROWER';

      default:
        return false;
    }
  });
};

// Helper for loan visibility
export const canViewLoan = (user: UserWithRole, loan: any): boolean => {
  if (!user || !loan) return false;

  if (hasPermission(user, ['SUPER_ADMIN', 'ADMIN'])) return true;

  if (user.role === 'BORROWER') {
    return loan.originator_id === user.id;
  }

  if (user.organization_id && loan.organization_id === user.organization_id) return true;

  if (loan.originator_id === user.id) return true;

  if (loan.processor_id === user.id || loan.underwriter_id === user.id) return true;

  return false;
};

export const canEditLoan = (user: UserWithRole, loan: any): boolean => {
  if (!canViewLoan(user, loan)) return false;
  if (user.role === 'BORROWER') return false;

  return hasPermission(user, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN']);
};

export const isBorrower = (user: UserWithRole): boolean => {
  return user.role === 'BORROWER';
};

export const canAddCustomCondition = (user: UserWithRole): boolean => {
  return hasPermission(user, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN']);
};

// Pricing Access
export const canSeeRetailPricing = (user: UserWithRole): boolean => {
  return user.role === 'BORROWER';
};

export const canSeeWholesalePricing = (user: UserWithRole): boolean => {
  return hasPermission(user, ['BROKER', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN']);
};
// Add this at the end of lib/permissions.ts

export const canAccessAppDashboard = (user: UserWithRole): boolean => {
  if (!user?.role) return false;
  const role = (user.custom_role || user.role) as string;
  return ['SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT'].includes(role);
};

export const canSeeAllOrganizations = (user: UserWithRole): boolean => {
  if (!user?.role) return false;
  const role = (user.custom_role || user.role) as string;
  return ['SUPER_ADMIN', 'ADMIN'].includes(role);
};