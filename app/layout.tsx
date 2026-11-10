import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Tracker",
  description: "Tracks careers pages and emails you new postings.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">Job Tracker</Link>
          {user ? (
            <>
              <Link href="/">Companies</Link>
              <Link href="/jobs">Jobs</Link>
              <Link href="/settings" title={user.email}>Settings</Link>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </>
          )}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
