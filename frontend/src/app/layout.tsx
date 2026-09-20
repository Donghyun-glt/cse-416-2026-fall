import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MailFlow AI",
  description: "Connect Gmail and review recent messages.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
