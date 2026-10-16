// The model behind the agents, from the configuration: the offline provider or
// Azure OpenAI with Entra ID. Shared by the API and the evaluation (src/eval).

import type { TokenCredential } from "@azure/identity";
import type { Config } from "../config";
import { AzureOpenAiProvider, entraTokenSource } from "./azure-openai-provider";
import { MockProvider } from "./mock-provider";
import type { AiProvider } from "./provider";

export function createProvider(config: Config, credential: () => Promise<TokenCredential>): AiProvider {
  if (config.AI_PROVIDER === "mock") return new MockProvider(config.MOCK_AI_LATENCY_MS);
  return new AzureOpenAiProvider(
    {
      endpoint: config.AZURE_OPENAI_ENDPOINT!,
      draftDeployment: config.AZURE_OPENAI_DEPLOYMENT_DRAFT!,
      chatDeployment: config.AZURE_OPENAI_DEPLOYMENT_CHAT!,
      apiVersion: config.AZURE_OPENAI_API_VERSION,
      regionLabel: config.AZURE_OPENAI_REGION_LABEL,
      timeoutMs: config.AZURE_OPENAI_TIMEOUT_MS,
      maxCompletionTokens: config.AZURE_OPENAI_MAX_COMPLETION_TOKENS,
      draftTimeoutMs: config.AZURE_OPENAI_DRAFT_TIMEOUT_MS,
      draftMaxCompletionTokens: config.AZURE_OPENAI_DRAFT_MAX_COMPLETION_TOKENS,
      ...(config.AZURE_OPENAI_REASONING_EFFORT
        ? { reasoningEffort: config.AZURE_OPENAI_REASONING_EFFORT }
        : {}),
    },
    entraTokenSource(credential),
  );
}
