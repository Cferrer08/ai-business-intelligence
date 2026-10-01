import type { Metadata } from "next";
import "@fontsource-variable/public-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "InsightAI", template: "%s · InsightAI" },
  description: "Upload your business data, ask questions in plain English, and get calculated answers with clear next steps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
