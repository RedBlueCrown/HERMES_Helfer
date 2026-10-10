import type { TokenCredential } from "@azure/identity";

export interface CredentialOptions {
  /** In Azure: only the managed identity, never developer credentials such as the Azure CLI. */
  managedIdentityOnly: boolean;
  /** Client ID of a user-assigned managed identity. */
  clientId?: string | undefined;
}

/** Entra ID credential for Azure resources (SQL, Azure OpenAI). @azure/identity loads on first use. */
export async function azureCredential(opts: CredentialOptions): Promise<TokenCredential> {
  const identity = await import("@azure/identity");
  if (opts.managedIdentityOnly) {
    return opts.clientId
      ? new identity.ManagedIdentityCredential({ clientId: opts.clientId })
      : new identity.ManagedIdentityCredential();
  }
  return new identity.DefaultAzureCredential(opts.clientId ? { managedIdentityClientId: opts.clientId } : {});
}
