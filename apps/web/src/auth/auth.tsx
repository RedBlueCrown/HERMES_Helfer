// Sign-in. "dev": fictional users for local development (the API refuses this
// mode in production). "entra": Microsoft Entra ID with MSAL, loaded only then.
// MSAL sign-in is not yet tested against a real tenant (todo-later P08).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AuthMode = "dev" | "entra";
export const AUTH_MODE: AuthMode = import.meta.env.VITE_AUTH_MODE === "entra" ? "entra" : "dev";

const DEV_USER_KEY = "hh:devUser";
const DEFAULT_DEV_USER = "u-anna";

export interface AuthState {
  mode: AuthMode;
  ready: boolean;
  /** Fatal sign-in error (todo-later E01). */
  error?: string;
  devUserId?: string;
  setDevUser(id: string): void;
  headers(): Promise<Record<string, string>>;
  signOut(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

function readDevUser(): string {
  try {
    return localStorage.getItem(DEV_USER_KEY) ?? DEFAULT_DEV_USER;
  } catch {
    return DEFAULT_DEV_USER;
  }
}

function DevAuthProvider({ children }: { children: ReactNode }) {
  const [devUserId, setDevUserId] = useState(readDevUser);
  const setDevUser = useCallback((id: string) => {
    try {
      localStorage.setItem(DEV_USER_KEY, id);
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
    setDevUserId(id);
  }, []);
  const value = useMemo<AuthState>(
    () => ({
      mode: "dev",
      ready: true,
      devUserId,
      setDevUser,
      headers: async () => ({ "x-dev-user": devUserId }),
      signOut: () => undefined,
    }),
    [devUserId, setDevUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

type Msal = typeof import("@azure/msal-browser");

function EntraAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    ready: boolean;
    error?: string;
    msal?: Msal;
    pca?: InstanceType<Msal["PublicClientApplication"]>;
  }>({ ready: false });
  const scope = import.meta.env.VITE_API_SCOPE as string;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const msal = await import("@azure/msal-browser");
        const pca = new msal.PublicClientApplication({
          auth: {
            clientId: import.meta.env.VITE_ENTRA_CLIENT_ID as string,
            authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID as string}`,
            redirectUri: window.location.origin,
          },
          cache: { cacheLocation: "sessionStorage" },
        });
        await pca.initialize();
        const result = await pca.handleRedirectPromise();
        const account = result?.account ?? pca.getAllAccounts()[0];
        if (!account) {
          await pca.loginRedirect({ scopes: [scope] });
          return;
        }
        pca.setActiveAccount(account);
        if (!cancelled) setState({ ready: true, msal, pca });
      } catch (err) {
        if (!cancelled) {
          setState({
            ready: false,
            error: `Die Anmeldung ist fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const value = useMemo<AuthState>(
    () => ({
      mode: "entra",
      ready: state.ready,
      ...(state.error ? { error: state.error } : {}),
      setDevUser: () => undefined,
      headers: async (): Promise<Record<string, string>> => {
        const { pca, msal } = state;
        if (!pca || !msal) return {};
        const account = pca.getActiveAccount() ?? undefined;
        try {
          const token = await pca.acquireTokenSilent({ scopes: [scope], ...(account ? { account } : {}) });
          return { authorization: `Bearer ${token.accessToken}` };
        } catch (err) {
          if (err instanceof msal.InteractionRequiredAuthError)
            await pca.acquireTokenRedirect({ scopes: [scope] });
          throw err;
        }
      },
      signOut: () => void state.pca?.logoutRedirect(),
    }),
    [state, scope],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return AUTH_MODE === "entra" ? (
    <EntraAuthProvider>{children}</EntraAuthProvider>
  ) : (
    <DevAuthProvider>{children}</DevAuthProvider>
  );
}
