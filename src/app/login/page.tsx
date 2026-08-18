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
        <div className="dancing-lady">💃</div>

        <h1 className="font-display text-4xl font-extrabold tracking-tight">Spain Fotos</h1>
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
