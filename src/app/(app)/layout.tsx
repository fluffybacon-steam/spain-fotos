// src/app/(app)/layout.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

// Middleware already blocks unauthenticated requests; this is the second lock
// so a middleware matcher mistake can never expose the gallery.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
