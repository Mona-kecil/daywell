"use client";
import {
  AuthKitProvider,
  useAuth,
  useAccessToken,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().nullable() });
function useDevAuth() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const fetchAccessToken = useCallback(async () => {
    try {
      const response = await fetch("/api/dev-token", { cache: "no-store" });
      if (!response.ok) return null;
      return tokenSchema.parse(await response.json()).token;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    let active = true;
    void fetchAccessToken().then((token) => {
      if (active) {
        setAuthenticated(Boolean(token));
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchAccessToken]);
  return {
    isLoading: loading,
    isAuthenticated: authenticated,
    fetchAccessToken,
  };
}

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
  devAuth = false,
}: {
  url: string;
  children: ReactNode;
  devAuth?: boolean;
}) {
  const [client] = useState(() => new ConvexReactClient(url));
  if (devAuth)
    return (
      <ConvexProviderWithAuth client={client} useAuth={useDevAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
