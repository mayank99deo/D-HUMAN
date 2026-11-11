import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { SignInForm } from "@/components/platform/SignInForm";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in | D-Human", robots: { index: false } };

async function AlreadySignedIn() {
  if (await getSessionUser()) redirect("/home");
  return null;
}

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <Suspense fallback={null}>
        <AlreadySignedIn />
      </Suspense>
      <Link href="/" className="flex h-11 items-center self-start" aria-label="D-Human home">
        <Wordmark className="h-3.5 w-auto" />
      </Link>
      <div className="mt-auto pt-16">
        <h1 className="headline text-[clamp(2.25rem,8vw,3.25rem)]">Your body speaks data.</h1>
        <p className="mt-4 text-graphite">Start free or sign in with your email. We send a 6-digit code; no password to remember.</p>
        <SignInForm />
      </div>
      <p className="mt-10 text-sm text-graphite">
        D-Human reads your reports with AI and keeps them private to you. It isn&apos;t a diagnosis; anything serious goes to a doctor.
      </p>
    </main>
  );
}
