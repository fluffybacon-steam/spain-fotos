"use client";
// src/components/Viewer.tsx

import { createContext, useContext } from "react";

export type Viewer = {
  /** Null only if the provider is missing — every rendered page has a session. */
  uid: string | null;
  name: string;
  /** False for a view-only session. Mirrors requireMember on the server. */
  canWrite: boolean;
};

/**
 * Fails closed. A component rendered outside the provider shows no write
 * affordances rather than buttons whose every request would come back 403 —
 * the wrong default is visible immediately to a member and invisible to a
 * guest, so it points the wrong way round.
 */
const ViewerContext = createContext<Viewer>({ uid: null, name: "", canWrite: false });

export function ViewerProvider({ value, children }: { value: Viewer; children: React.ReactNode }) {
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

/**
 * The session as the UI sees it. This decides what to *offer*; it never decides
 * what's allowed. Anything gated on `canWrite` here is gated again on the
 * server, because a hidden button is not a permission.
 */
export function useViewer(): Viewer {
  return useContext(ViewerContext);
}
