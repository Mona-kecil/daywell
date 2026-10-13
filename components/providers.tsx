"use client";
import {
  AuthKitProvider,
  useAuth,
  useAccessToken,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useState, type ReactNode } from "react";

// Next.js bridge from the official Convex AuthKit guide. The @convex-dev/workos
// helper targets authkit-react; Next.js splits auth and token state into two hooks.
function useAuthFromAuthKit() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) return null;
      try {
        return (
          (forceRefreshToken ? await refresh() : await getAccessToken()) ?? null
        );
      } catch {
        return null;
      }
    },
    [user, getAccessToken, refresh],
  );
  return {
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  };
}
export function Providers({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const [client] = useState(() => new ConvexReactClient(url));
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
