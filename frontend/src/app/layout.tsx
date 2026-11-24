import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MailFlow AI",
  description: "Start every day with a clear view of your inbox.",
};

// viewport-fit=cover lets the phone tab bar sit at the very bottom, padded by the safe-area inset.
// Zooming stays allowed.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
