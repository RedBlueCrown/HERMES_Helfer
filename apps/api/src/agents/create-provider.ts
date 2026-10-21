// The model behind the agents, from the configuration: the offline provider,
// Azure OpenAI with Entra ID, or Claude for tests on a developer's machine.
// Shared by the API and the evaluation (src/eval).

import type { TokenCredential } from "@azure/identity";
import type { Config } from "../config";
import { AnthropicProvider } from "./anthropic-provider";
import { AzureOpenAiProvider, entraTokenSource } from "./azure-openai-provider";
import { MockProvider } from "./mock-provider";
import type { AiProvider } from "./provider";

export async function createProvider(
  config: Config,
  credential: () => Promise<TokenCredential>,
): Promise<AiProvider> {
  if (config.AI_PROVIDER === "mock") return new MockProvider(config.MOCK_AI_LATENCY_MS);
  if (config.AI_PROVIDER === "anthropic") {
    // A development dependency, loaded only here: the image for Azure does not contain it.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new AnthropicProvider(
      {
        draftModel: config.ANTHROPIC_MODEL_DRAFT,
        chatModel: config.ANTHROPIC_MODEL_CHAT,
        maxTokens: config.ANTHROPIC_MAX_TOKENS,
        draftMaxTokens: config.ANTHROPIC_DRAFT_MAX_TOKENS,
        timeoutMs: 180_000,
        draftTimeoutMs: 600_000,
        ...(config.ANTHROPIC_EFFORT ? { effort: config.ANTHROPIC_EFFORT } : {}),
      },
      Anthropic,
      { apiKey: config.ANTHROPIC_API_KEY ?? null },
    );
  }
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
