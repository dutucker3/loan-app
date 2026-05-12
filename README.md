# Loan Application Platform

A modern white-label mortgage/DSCR loan origination system built with Next.js 16, Supabase, and Clerk.

## Current Status (May 12, 2026)

**Phase 1 (Multi-Tenancy + White-Labeling) - In Progress**

### What has been completed:
- Standardized pricing matrix CSV upload system (Base Rate, DSCR, FICO, Loan Balance, etc.)
- Robust `PricingTableEditor` with proper key mapping (`baseRates`, `dscrLtvGrid`, `ficoLtvGrid`, etc.)
- Dynamic pricing engine on `/loans/new` with debug panel
- Active/Inactive toggle, product management, and save functionality restored
- CSV parser that handles commas in quoted fields and parentheses for negative numbers

### Next Goal - Phase 1:
- Full multi-tenancy using Clerk Organizations
- Custom domain support (CNAME + middleware)
- White-label UI per lender (logo, colors, company name)
- Link existing products and applications to organizations

### Key Files to Focus On:
- `app/products/page.tsx` → Main product & pricing editor
- `app/loans/new/page.tsx` → Dynamic pricing grid + calculations
- `lib/tenant-context.tsx` (new)
- `middleware.ts` (new)

### How to Continue:
When starting a new conversation with Grok, please paste:
> "Continuing our loan app project: https://github.com/dutucker3/loan-app.git  
> Latest commit: [paste latest commit message]  
> We are implementing Phase 1 multi-tenancy and white-labeling."

---

**Current Branch Recommendation**: `feature/white-label-phase1`

Let me know when you've pushed the code, and we'll continue cleanly in the next session.


This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
