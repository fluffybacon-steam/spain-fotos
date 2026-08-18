// src/app/login/page.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        {/* Concentric rings and a rotated print: the wordmark restates the
            thesis — a photograph fixed to a coordinate. */}
        <svg width="52" height="52" viewBox="0 0 64 64" className="mb-6" aria-hidden="true">
          <circle cx="32" cy="32" r="24" fill="none" stroke="#244553" strokeWidth="1" />
          <circle cx="32" cy="32" r="17" fill="none" stroke="#244553" strokeWidth="1" />
          <rect x="24" y="24" width="16" height="16" rx="2" fill="#E7EFEC" transform="rotate(-8 32 32)" />
          <circle cx="32" cy="32" r="3.5" fill="#4CC9C0" />
        </svg>

        <h1 className="font-display text-4xl font-extrabold tracking-tight">Travel Fotos</h1>
        <p className="mt-2 text-sm text-haze">
          Everyone&apos;s photos from Spain and the Balearics, pinned to where they were taken.
        </p>

        <div className="mt-8">
          <LoginForm />
        </div>

        <p className="coord mt-8">Ask whoever set this up for your name and password</p>
      </div>
    </main>
  );
}
