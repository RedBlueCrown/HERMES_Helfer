// Sign-in. The API tells the web app at runtime which mode applies
// (GET /api/config), so one build serves every environment.
// "dev": fictional users for local development (the API refuses this mode in
// production). "entra": Microsoft Entra ID with MSAL, loaded only then.
// MSAL sign-in is not yet tested against a real tenant (todo-later P08).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApi } from "../api/client";

export type AuthMode = "dev" | "entra";

interface EntraSettings {
  tenantId: string;
  clientId: string;
  apiScope: string;
}

type ClientConfig = { authMode: "dev" } | { authMode: "entra"; entra: EntraSettings };

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

function EntraAuthProvider({ settings, children }: { settings: EntraSettings; children: ReactNode }) {
  const [state, setState] = useState<{
    ready: boolean;
    error?: string;
    msal?: Msal;
    pca?: InstanceType<Msal["PublicClientApplication"]>;
  }>({ ready: false });
  const scope = settings.apiScope;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const msal = await import("@azure/msal-browser");
        const pca = new msal.PublicClientApplication({
          auth: {
            clientId: settings.clientId,
            authority: `https://login.microsoftonline.com/${settings.tenantId}`,
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
  }, [scope, settings.clientId, settings.tenantId]);

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

/** Not signed in yet: the sign-in settings are loading or could not be loaded. */
function pending(error?: string): AuthState {
  return {
    mode: "dev",
    ready: false,
    ...(error ? { error } : {}),
    setDevUser: () => undefined,
    headers: async () => ({}),
    signOut: () => undefined,
  };
}

function validConfig(c: unknown): c is ClientConfig {
  const v = c as Partial<{ authMode: string; entra: Partial<EntraSettings> }>;
  if (v?.authMode === "dev") return true;
  return v?.authMode === "entra" && !!v.entra?.tenantId && !!v.entra.clientId && !!v.entra.apiScope;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ClientConfig | { error: string }>();
  useEffect(() => {
    let cancelled = false;
    createApi(async () => ({}))
      .get<unknown>("/api/config")
      .then(
        (c) =>
          validConfig(c)
            ? c
            : { error: "Die Anmeldung ist nicht vollständig konfiguriert (Betrieb informieren)." },
        (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
      )
      .then((c) => {
        if (!cancelled) setConfig(c);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config || "error" in config) {
    return <AuthContext.Provider value={pending(config?.error)}>{children}</AuthContext.Provider>;
  }
  return config.authMode === "entra" ? (
    <EntraAuthProvider settings={config.entra}>{children}</EntraAuthProvider>
  ) : (
    <DevAuthProvider>{children}</DevAuthProvider>
  );
}
