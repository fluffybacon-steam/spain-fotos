"use client";
// src/app/login/LoginForm.tsx

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Where to go after signing in. `next` is written by the middleware, but it
 * arrives in a URL anyone can hand-craft, so only a path on this site is
 * honoured — `//evil.example` is a protocol-relative URL, not a path, and is
 * exactly what an open redirect looks like.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Sign in failed");
        return;
      }
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Starts a view-only session. No credentials, by design — this is the "have a
   * look" door for someone who was on the trip's group chat but doesn't want an
   * account. What they get is genuinely read-only: the server refuses every
   * write from a guest session, not just the buttons.
   */
  async function viewOnly() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/guest", { method: "POST" });
      if (!res.ok) {
        setError("Couldn't start a view-only session");
        return;
      }
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function setPassVisible(){
    const passField = document.querySelector('input[type="password"]') as HTMLInputElement;
    if (passField) {
      passField.type = passField.type === "password" ? "text" : "password";
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Your name</span>
        <input
          className="field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Password</span>
        <input
          className="field"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="button" className="" disabled={busy} onClick={() => setPassVisible()}>
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM214-281.5Q94-363 40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200q-146 0-266-81.5ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z"/></svg>
        </button>
      </label>

      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary mt-2" disabled={busy}>
        {busy ? "Checking…" : "Sign in"}
      </button>

      {/* type="button" matters inside a form — a stray submit here would post
          empty credentials and show "that name and password don't match". */}
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void viewOnly()}>
        Look around without an account
      </button>
      <p className="coord text-center">
        View only: no uploading, commenting or reacting
      </p>
      </form>
  );
}
