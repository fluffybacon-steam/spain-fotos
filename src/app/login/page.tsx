// src/app/login/page.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import LoginForm from "./LoginForm";
import EmojiSky from "@/components/EmojiSky";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <EmojiSky />
      <div className="relative z-10 w-full max-w-sm">
        <div className="dancing-lady">💃</div>

        <h1 className="font-display text-4xl font-extrabold tracking-tight">Spain Fotos</h1>
        <p className="mt-2 text-sm text-haze">
          Everyone&apos;s photos in one place. 
        </p>

        <div className="mt-8">
          <LoginForm />
        </div>

      </div>
      <div style={{ position: 'fixed', left: '0px', bottom: '0px', zIndex: 1000, fontSize: '0.5rem', color: 'pink'}}>Version 0.02</div>
    </main>
  );
}