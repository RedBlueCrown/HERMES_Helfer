import {
  FluentProvider,
  MessageBar,
  MessageBarBody,
  Spinner,
  makeStyles,
  tokens,
  webLightTheme,
} from "@fluentui/react-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { createApi } from "./api/client";
import { ApiContext, useMe } from "./api/hooks";
import { AuthProvider, useAuth } from "./auth/auth";
import { AppHeader } from "./components/AppHeader";
import { ErrorView, NotifyProvider } from "./components/ui";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000 } },
});

const useStyles = makeStyles({
  main: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXL}`,
  },
  center: { padding: tokens.spacingVerticalXXXL },
});

function Shell() {
  const s = useStyles();
  const me = useMe();
  if (me.isPending) return <Spinner className={s.center} label="Anmeldung wird geprüft …" />;
  if (me.isError) {
    return (
      <main className={s.main}>
        <ErrorView error={me.error} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/vorhaben/:code" element={<ProjectPage />} />
          <Route
            path="*"
            element={
              <MessageBar intent="warning">
                <MessageBarBody>Diese Seite gibt es nicht.</MessageBarBody>
              </MessageBar>
            }
          />
        </Routes>
      </main>
    </>
  );
}

function WithApi() {
  const auth = useAuth();
  const api = useMemo(() => createApi(() => auth.headers()), [auth]);
  if (auth.error) return <ErrorView error={new Error(auth.error)} onRetry={() => window.location.reload()} />;
  if (!auth.ready) return <Spinner label="Anmeldung …" />;
  return (
    <ApiContext.Provider value={api}>
      <Shell />
    </ApiContext.Provider>
  );
}

export function App() {
  return (
    <FluentProvider
      theme={webLightTheme}
      style={{ minHeight: "100vh", backgroundColor: tokens.colorNeutralBackground2 }}
    >
      <QueryClientProvider client={queryClient}>
        <NotifyProvider>
          <BrowserRouter>
            <AuthProvider>
              <WithApi />
            </AuthProvider>
          </BrowserRouter>
        </NotifyProvider>
      </QueryClientProvider>
    </FluentProvider>
  );
}
