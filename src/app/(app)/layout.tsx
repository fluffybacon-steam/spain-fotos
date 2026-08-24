// src/app/(app)/layout.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { ViewerProvider } from "@/components/Viewer";

// Middleware already blocks unauthenticated requests; this is the second lock
// so a middleware matcher mistake can never expose the gallery.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Read once here rather than fetched per page: the role is already in the
  // cookie the server just verified, and a client that had to ask for it would
  // render every write button for a moment before hiding them again.
  return (
    <ViewerProvider value={{ uid: user.uid, name: user.name, canWrite: user.role !== "guest" }}>
      {children}
    </ViewerProvider>
  );
}
