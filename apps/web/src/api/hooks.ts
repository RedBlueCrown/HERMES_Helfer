import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { Api } from "./client";
import type {
  ChangeRequestRegisterView,
  ChatReply,
  CommandResult,
  DeliverableDetailView,
  DevUserInfo,
  EventPage,
  Me,
  Portfolio,
  ProjectPage,
  ProjectView,
  Reference,
  Scope,
  VerifyResult,
} from "./types";

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi outside ApiContext");
  return api;
}

const enc = encodeURIComponent;
export const projectPath = (code: string) => `/api/projects/${enc(code)}`;

type Opts<T> = Omit<UseQueryOptions<T>, "queryKey" | "queryFn">;

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/me"), staleTime: 60_000 });
}

export function useDevUsers(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["dev-users"],
    queryFn: () => api.get<DevUserInfo[]>("/api/dev/users"),
    enabled,
    staleTime: Infinity,
  });
}

export function useReference() {
  const api = useApi();
  return useQuery({
    queryKey: ["reference"],
    queryFn: () => api.get<Reference>("/api/reference"),
    staleTime: Infinity,
  });
}

export interface ProjectFilter {
  q: string;
  phase: string;
  scope: Scope;
  limit: number;
  offset: number;
  /** Gate state of the current phase; "passed": finished projects. */
  gate?: string;
  signal?: string;
  sort?: "updated" | "name" | "attention";
}

export function useProjects(f: ProjectFilter) {
  const api = useApi();
  const qs = new URLSearchParams({ scope: f.scope, limit: String(f.limit), offset: String(f.offset) });
  if (f.q.trim()) qs.set("q", f.q.trim());
  if (f.phase) qs.set("phase", f.phase);
  if (f.gate) qs.set("gate", f.gate);
  if (f.signal) qs.set("signal", f.signal);
  if (f.sort) qs.set("sort", f.sort);
  return useQuery({
    queryKey: ["projects", f],
    queryFn: () => api.get<ProjectPage>(`/api/projects?${qs}`),
    placeholderData: (prev) => prev,
  });
}

export function usePortfolio(scope: Scope) {
  const api = useApi();
  return useQuery({
    queryKey: ["portfolio", scope],
    queryFn: () => api.get<Portfolio>(`/api/portfolio?scope=${scope}`),
    placeholderData: (prev) => prev,
  });
}

const isRunning = (v: ProjectView | undefined) =>
  !!v?.phases.some((p) => p.deliverables.some((d) => d.status === "running"));

export function useProject(code: string, opts: Opts<ProjectView> = {}) {
  const api = useApi();
  return useQuery({
    queryKey: ["project", code],
    queryFn: () => api.get<ProjectView>(projectPath(code)),
    // Poll while an agent is drafting, so the result appears by itself.
    refetchInterval: (q) => (isRunning(q.state.data) ? 1500 : false),
    retry: (count, err) => count < 2 && !(err as { status?: number }).status,
    ...opts,
  });
}

export function useDeliverable(code: string, deliverableId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ["deliverable", code, deliverableId],
    queryFn: () => api.get<DeliverableDetailView>(`${projectPath(code)}/deliverables/${enc(deliverableId!)}`),
    enabled: !!deliverableId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
  });
}

export function useChangeRequests(code: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["change-requests", code],
    queryFn: () => api.get<ChangeRequestRegisterView>(`${projectPath(code)}/change-requests`),
  });
}

export function useEvents(code: string, category: string, limit: number) {
  const api = useApi();
  const qs = new URLSearchParams({ limit: String(limit) });
  if (category) qs.set("category", category);
  return useQuery({
    queryKey: ["events", code, category, limit],
    queryFn: () => api.get<EventPage>(`${projectPath(code)}/events?${qs}`),
    placeholderData: (prev) => prev,
  });
}

/** Every command changes the project: refresh everything that depends on it. */
export function useProjectCommand<TVars>(code: string, run: (api: Api, vars: TVars) => Promise<unknown>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => run(api, vars),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", code] }),
        qc.invalidateQueries({ queryKey: ["deliverable", code] }),
        qc.invalidateQueries({ queryKey: ["events", code] }),
        qc.invalidateQueries({ queryKey: ["change-requests", code] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["portfolio"] }),
      ]);
    },
  });
}

export const commands = {
  startSkill: (code: string) => (api: Api, skillId: string) =>
    api.post<{ runId: string }>(`${projectPath(code)}/skills/${enc(skillId)}/runs`),
  /** contentVersion: the content the person reviewed; the API refuses a newer one (409 "stale"). */
  release: (code: string) => (api: Api, v: { deliverableId: string; contentVersion: string }) =>
    api.post<CommandResult>(`${projectPath(code)}/deliverables/${enc(v.deliverableId)}/release`, {
      contentVersion: v.contentVersion,
    }),
  verify: (code: string) => (api: Api) => api.post<VerifyResult>(`${projectPath(code)}/audit/verify`),
  chat: (code: string) => (api: Api, body: { message: string; history: { role: string; text: string }[] }) =>
    api.post<ChatReply>(`${projectPath(code)}/chat`, body),
};
