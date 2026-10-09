// Authentication. Production: Entra ID access tokens (architecture §6).
// Local development: fictional dev users selected with the x-dev-user header;
// config.ts refuses this mode in production.

import { GLOBAL_ROLES, type GlobalRole, type Viewer } from "@hermes-helfer/core";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { HttpError } from "./errors";

export interface AuthenticatedUser extends Viewer {
  upn: string;
}

export interface Authenticator {
  readonly mode: "entra" | "dev";
  authenticate(req: FastifyRequest): Promise<AuthenticatedUser>;
}

export interface DevUser {
  id: string;
  displayName: string;
  upn: string;
  globalRoles: GlobalRole[];
  description: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export interface EntraOptions {
  tenantId: string;
  clientId: string;
  requiredScope: string;
  /** Override for tests; defaults to the tenant's published signing keys. */
  jwks?: JWTVerifyGetKey;
}

export function createEntraAuthenticator(opts: EntraOptions): Authenticator {
  const issuer = `https://login.microsoftonline.com/${opts.tenantId}/v2.0`;
  const jwks =
    opts.jwks ??
    createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${opts.tenantId}/discovery/v2.0/keys`));
  return {
    mode: "entra",
    async authenticate(req) {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw new HttpError(401, "not_authenticated", "Bitte anmelden.");
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(header.slice("Bearer ".length), jwks, {
          issuer,
          audience: [opts.clientId, `api://${opts.clientId}`],
          algorithms: ["RS256"],
          clockTolerance: 30,
        }));
      } catch {
        throw new HttpError(
          401,
          "invalid_token",
          "Die Anmeldung ist abgelaufen oder ungültig. Bitte neu anmelden.",
        );
      }
      if (payload.tid !== opts.tenantId) throw new HttpError(401, "invalid_token", "Falscher Mandant.");
      const scopes = str(payload.scp)?.split(" ") ?? [];
      if (!scopes.includes(opts.requiredScope)) {
        throw new HttpError(
          403,
          "missing_scope",
          "Der Anmeldung fehlt die Berechtigung für den HERMES Helfer.",
        );
      }
      const oid = str(payload.oid);
      if (!oid) throw new HttpError(401, "invalid_token", "Die Anmeldung enthält keine Benutzerkennung.");
      const roles = (Array.isArray(payload.roles) ? payload.roles : []).filter((r): r is GlobalRole =>
        (GLOBAL_ROLES as readonly string[]).includes(String(r)),
      );
      if (!roles.length) {
        throw new HttpError(
          403,
          "no_app_role",
          "Du hast keinen Zugriff auf den HERMES Helfer. Bitte beim PMO Zugriff beantragen.",
        );
      }
      return {
        userId: oid,
        displayName: str(payload.name) ?? str(payload.preferred_username) ?? oid,
        upn: str(payload.preferred_username) ?? "",
        globalRoles: roles.includes("HH.User") ? roles : ["HH.User", ...roles],
      };
    },
  };
}

export function createDevAuthenticator(users: readonly DevUser[]): Authenticator {
  return {
    mode: "dev",
    async authenticate(req) {
      const id = req.headers["x-dev-user"];
      if (typeof id !== "string" || !id) {
        throw new HttpError(401, "not_authenticated", "Kein Dev-Benutzer gewählt (Header x-dev-user).");
      }
      const u = users.find((x) => x.id === id);
      if (!u) throw new HttpError(401, "not_authenticated", "Unbekannter Dev-Benutzer.");
      return { userId: u.id, displayName: u.displayName, upn: u.upn, globalRoles: u.globalRoles };
    },
  };
}
