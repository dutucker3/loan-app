// lib/permissions.ts
import { Role } from '@prisma/client';

export type UserWithRole = {
  id: string;
  role: Role | string;
  organization_id?: string | null;
  parent_id?: string | null;
};

export const hasPermission = (
  user: UserWithRole | null,
  requiredRole: Role | Role[],
  options?: { childOrgAllowed?: boolean }
): boolean => {
  if (!user) return false;

  const userRole = user.role as Role;
  const required = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  // Super Admin = God Mode
  if (userRole === 'SUPER_ADMIN') return true;

  return required.some((r) => {
    switch (r) {
      case 'SUPER_ADMIN':
        return userRole === 'SUPER_ADMIN';

      case 'ADMIN':
        return ['ADMIN', 'SUPER_ADMIN'].includes(userRole);

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
        return ['SENIOR_BROKER', 'JUNIOR_BROKER', 'BROKER', 'BROKER_AE', 'ADMIN', 'SUPER_ADMIN'].includes(userRole);

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

  // Super Admin / Admin / Lending Supervisor see everything
  if (hasPermission(user, ['SUPER_ADMIN', 'ADMIN', 'LENDING_SUPERVISOR'])) return true;

  // Borrower can only see their own loans
  if (user.role === 'BORROWER') {
    return loan.originator_id === user.id;
  }

  // Same organization or child
  if (user.organization_id && loan.organization_id === user.organization_id) return true;

  // Broker / AE can see their originated loans
  if (loan.originator_id === user.id) return true;

  // Processor / Underwriter assigned to the loan
  if (loan.processor_id === user.id || loan.underwriter_id === user.id) return true;

  return false;
};

export const canEditLoan = (user: UserWithRole, loan: any): boolean => {
  if (!canViewLoan(user, loan)) return false;

  // Borrowers cannot edit loans (they can only view and submit documents)
  if (user.role === 'BORROWER') return false;

  // Processors and above can edit
  return hasPermission(user, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR']);
};

export const isBorrower = (user: UserWithRole): boolean => {
  return user.role === 'BORROWER';
};

export const canAddCustomCondition = (user: UserWithRole): boolean => {
  return hasPermission(user, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR']);
};

// Bonus: Retail vs Wholesale access
export const canSeeRetailPricing = (user: UserWithRole): boolean => {
  return user.role === 'BORROWER';
};

export const canSeeWholesalePricing = (user: UserWithRole): boolean => {
  return hasPermission(user, ['BROKER', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'ADMIN', 'SUPER_ADMIN']);
};