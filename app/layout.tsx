// app/layout.tsx (updated)
import { ClerkProvider } from "@clerk/nextjs";
import { TenantProvider } from "@/lib/tenant-context";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <TenantProvider>
        <html lang="en">
          <body>{children}</body>
        </html>
      </TenantProvider>
    </ClerkProvider>
  );
}