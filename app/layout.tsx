// app/layout.tsx (updated - Clerk fully purged)
import { TenantProvider } from "@/lib/tenant-context";
import AppHeader from "@/components/AppHeader";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TenantProvider>
          <AppHeader />
          {children}
        </TenantProvider>
      </body>
    </html>
  );
}