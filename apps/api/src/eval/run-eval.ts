// The evaluation of the agents (todo-later H11): fixed, fictional cases go to
// the model, and checks grade each answer. «kritisch» checks are rules that
// must hold every time (an instruction hidden in the data is not followed,
// personal data is recognised, the agent never estimates effort or changes a
// colour); «qualitaet» checks are counted as a rate. Before a new model or a
// changed prompt goes live, the rates are compared with the last run.

import type { AgentId } from "@hermes-helfer/core";
import { AiProviderError, type AiProvider, type ProviderInfo, type Usage } from "../agents/provider";

export type CheckLevel = "kritisch" | "qualitaet";

export interface EvalCheck<T> {
  /** What the check asks, in German: «Personendaten erkannt». */
  name: string;
  level: CheckLevel;
  /** true, or why the answer does not pass. */
  test(output: T): true | string;
}

export interface CheckResult {
  name: string;
  level: CheckLevel;
  passed: boolean;
  detail?: string;
}

export interface EvalCase {
  id: string;
  agent: AgentId;
  /** What the case is about, in German. */
  title: string;
  checks: readonly { name: string; level: CheckLevel }[];
  evaluate(provider: AiProvider): Promise<{ output: unknown; usage?: Usage; results: CheckResult[] }>;
}

/** A case: what goes to the model, and the checks of its answer. */
export function defineCase<T>(spec: {
  id: string;
  agent: AgentId;
  title: string;
  run(provider: AiProvider): Promise<{ output: T; usage?: Usage | undefined }>;
  checks: readonly EvalCheck<T>[];
}): EvalCase {
  return {
    id: spec.id,
    agent: spec.agent,
    title: spec.title,
    checks: spec.checks.map(({ name, level }) => ({ name, level })),
    async evaluate(provider) {
      const { output, usage } = await spec.run(provider);
      const results = spec.checks.map((c): CheckResult => {
        let outcome: true | string;
        try {
          outcome = c.test(output);
        } catch (err) {
          outcome = `Die Prüfung selbst ist fehlgeschlagen: ${String(err)}`;
        }
        return outcome === true
          ? { name: c.name, level: c.level, passed: true }
          : { name: c.name, level: c.level, passed: false, detail: outcome };
      });
      return { output, ...(usage ? { usage } : {}), results };
    },
  };
}

export interface EvalRun {
  caseId: string;
  agent: AgentId;
  title: string;
  /** 1 … repeat: a model answers differently each time. */
  attempt: number;
  durationMs: number;
  usage?: Usage;
  /** The call failed; the answer could not be graded. */
  error?: string;
  /** The model's answer, for people to read (fictional data only). */
  output?: unknown;
  results: CheckResult[];
}

export interface EvalSummary {
  runs: number;
  errors: number;
  critical: { failed: number; total: number };
  quality: { passed: number; total: number; rate: number };
  tokens: Usage;
}

export interface EvalReport {
  provider: ProviderInfo;
  startedAt: string;
  repeat: number;
  runs: EvalRun[];
  summary: EvalSummary;
}

export function summarize(runs: readonly EvalRun[]): EvalSummary {
  const results = runs.flatMap((r) => r.results);
  const critical = results.filter((c) => c.level === "kritisch");
  const quality = results.filter((c) => c.level === "qualitaet");
  const passed = quality.filter((c) => c.passed).length;
  return {
    runs: runs.length,
    errors: runs.filter((r) => r.error).length,
    critical: { failed: critical.filter((c) => !c.passed).length, total: critical.length },
    quality: { passed, total: quality.length, rate: quality.length ? passed / quality.length : 1 },
    tokens: runs.reduce(
      (t, r) => ({
        inputTokens: t.inputTokens + (r.usage?.inputTokens ?? 0),
        outputTokens: t.outputTokens + (r.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    ),
  };
}

/** Runs every case `repeat` times, one call after the other (the model's quota is shared). */
export async function runEval(
  provider: AiProvider,
  cases: readonly EvalCase[],
  opts: { repeat?: number; now?: () => Date } = {},
): Promise<EvalReport> {
  const repeat = opts.repeat ?? 1;
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runs: EvalRun[] = [];
  for (const c of cases) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const started = Date.now();
      const base = { caseId: c.id, agent: c.agent, title: c.title, attempt };
      try {
        const { output, usage, results } = await c.evaluate(provider);
        runs.push({
          ...base,
          durationMs: Date.now() - started,
          ...(usage ? { usage } : {}),
          output,
          results,
        });
      } catch (err) {
        const reason = err instanceof AiProviderError ? err.reason : "error";
        runs.push({
          ...base,
          durationMs: Date.now() - started,
          error: `${reason}: ${err instanceof Error ? err.message : String(err)}`,
          results: [],
        });
      }
    }
  }
  return { provider: provider.info, startedAt, repeat, runs, summary: summarize(runs) };
}

/** Passed: no call failed, no critical rule was broken, and the quality rate reaches `minQuality`. */
export function verdict(report: EvalReport, minQuality: number): { passed: boolean; reasons: string[] } {
  const s = report.summary;
  const reasons: string[] = [];
  if (s.errors) reasons.push(`${s.errors} Aufruf(e) fehlgeschlagen`);
  if (s.critical.failed) reasons.push(`${s.critical.failed} kritische Prüfung(en) verletzt`);
  if (s.quality.rate < minQuality) {
    reasons.push(`Qualität ${percent(s.quality.rate)} unter dem Mindestwert ${percent(minQuality)}`);
  }
  return { passed: reasons.length === 0, reasons };
}

const percent = (x: number) => `${Math.round(x * 100)} %`;

/** The report for the console, in German. */
export function formatReport(report: EvalReport, minQuality: number): string {
  const lines = [
    `Evaluation der Agenten · ${report.provider.provider} · ${report.provider.model} · ${report.runs.length} Läufe`,
    "",
  ];
  for (const r of report.runs) {
    const ok = r.results.filter((c) => c.passed).length;
    const head = `${r.agent.padEnd(4)} ${r.caseId}${report.repeat > 1 ? ` #${r.attempt}` : ""}`;
    lines.push(
      r.error
        ? `✗ ${head}: Fehler (${r.error})`
        : `${r.results.every((c) => c.passed) ? "✓" : "✗"} ${head}: ${ok} von ${r.results.length} (${r.durationMs} ms)`,
    );
    for (const c of r.results.filter((x) => !x.passed)) {
      lines.push(`    ✗ ${c.name} [${c.level}]${c.detail ? `: ${c.detail}` : ""}`);
    }
  }
  const s = report.summary;
  const v = verdict(report, minQuality);
  lines.push(
    "",
    `Kritisch: ${s.critical.failed} von ${s.critical.total} verletzt · Qualität: ${s.quality.passed} von ${s.quality.total} (${percent(s.quality.rate)}) · Fehler: ${s.errors} · Tokens: ${s.tokens.inputTokens} ein, ${s.tokens.outputTokens} aus`,
    v.passed ? "Ergebnis: bestanden" : `Ergebnis: nicht bestanden (${v.reasons.join("; ")})`,
  );
  return lines.join("\n");
}
