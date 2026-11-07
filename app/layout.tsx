import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Tracker",
  description: "Tracks careers pages and emails you new postings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">Job Tracker</Link>
          <Link href="/">Companies</Link>
          <Link href="/jobs">Jobs</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
