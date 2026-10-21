// The evaluation as a page to read: every case with the model's answer and its
// checks, one column per model (offline, Azure OpenAI, Claude …) to compare them,
// and a field to rate each answer by hand. The ratings stay in the browser and
// can be downloaded as a file. A local file with fictional data; never published.

import type { EvalReport, EvalRun } from "./run-eval";
import { verdict } from "./run-eval";

const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const percent = (x: number) => `${Math.round(x * 100)} %`;
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const text = (s: unknown) => `<p class="text">${esc(s)}</p>`;
const list = (items: readonly string[]) =>
  items.length ? `<ul>${items.join("")}</ul>` : `<p class="none">keine</p>`;

function draft(d: Record<string, unknown>): string {
  const sections = Array.isArray(d.sections) ? (d.sections as Record<string, unknown>[]) : [];
  const open = Array.isArray(d.openPoints) ? d.openPoints : [];
  return [
    `<h4>Zusammenfassung</h4>${text(d.summary)}`,
    ...sections.map((s) => `<h4>${esc(s.heading)}</h4>${text(s.body)}`),
    `<h4>Offene Punkte</h4>${list(open.map((p) => `<li>${esc(p)}</li>`))}`,
  ].join("");
}

/** The answer in a form people read; what the page does not know is shown as JSON. */
export function renderOutput(output: unknown): string {
  if (Array.isArray(output)) {
    return `<h4>Hinweise des Kritikers</h4>${list(
      output.map(
        (f: Record<string, unknown>) => `<li><span class="tag">${esc(f.severity)}</span> ${esc(f.text)}</li>`,
      ),
    )}`;
  }
  if (!isObject(output)) return `<pre>${esc(JSON.stringify(output, null, 2))}</pre>`;
  if (isObject(output.reply)) {
    const reply = output.reply;
    const actions = Array.isArray(reply.actions) ? (reply.actions as Record<string, unknown>[]) : [];
    const events = Array.isArray(output.events) ? output.events : [];
    return [
      `<h4>Antwort (${reply.mode === "ki" ? "vom Modell" : "aus den festen Regeln"})</h4>${text(reply.text)}`,
      output.modelError ? `<p class="bad">Fehler des Modells: ${esc(output.modelError)}</p>` : "",
      `<h4>Aktionen</h4>${list(actions.map((a) => `<li>${esc(a.kind)}${a.skillId ? ` · ${esc(a.skillId)}` : ""}</li>`))}`,
      `<h4>Nächster Schritt laut Engine</h4>${text(output.nextStep)}`,
      `<h4>Neue Ereignisse</h4>${list(events.map((e) => `<li>${esc(e)}</li>`))}`,
    ].join("");
  }
  if (isObject(output.content) && isObject(output.flags)) {
    const flags = Object.entries(output.flags as Record<string, Record<string, unknown>>);
    return [
      draft(output.content),
      `<h4>Betroffene Bereiche</h4>${list(
        flags.map(([id, f]) => `<li><b>${esc(id)}</b>: ${f.value ? "ja" : "nein"} – ${esc(f.reason)}</li>`),
      )}`,
    ].join("");
  }
  if (Array.isArray(output.newRisks)) {
    const risks = output.newRisks as Record<string, unknown>[];
    const again = Array.isArray(output.reassessments)
      ? (output.reassessments as Record<string, unknown>[])
      : [];
    return [
      `<h4>Neue Risiken</h4>${list(
        risks.map(
          (r) =>
            `<li><b>${esc(r.title)}</b> (Eintritt ${esc(r.probability)}, Auswirkung ${esc(r.impact)}, ${esc(r.ownerRole)})` +
            `${text(r.description)}<p>Massnahme: ${esc(r.mitigation)}</p><p class="meta">Grund: ${esc(r.reason)} · Anlass: ${esc(r.trigger)}</p></li>`,
        ),
      )}`,
      `<h4>Neubewertungen</h4>${list(
        again.map(
          (r) =>
            `<li><b>${esc(r.risk)}</b>: Eintritt ${esc(r.probability)}, Auswirkung ${esc(r.impact)}` +
            `<p>Massnahme: ${esc(r.mitigation)}</p><p class="meta">Grund: ${esc(r.reason)} · Anlass: ${esc(r.trigger)}</p></li>`,
        ),
      )}`,
    ].join("");
  }
  if ("overview" in output && "outlook" in output) {
    const criteria = Array.isArray(output.criteria) ? (output.criteria as Record<string, unknown>[]) : [];
    return [
      `<h4>Übersicht</h4>${text(output.overview)}`,
      `<h4>Ausblick</h4>${text(output.outlook)}`,
      `<h4>Kriterien</h4>${list(
        criteria.map(
          (c) =>
            `<li><b>${esc(c.id)}</b><p>Problem: ${esc(c.problem)}</p><p>Massnahme: ${esc(c.measure)}</p></li>`,
        ),
      )}`,
    ].join("");
  }
  if ("summary" in output && Array.isArray(output.sections)) return draft(output);
  return `<pre>${esc(JSON.stringify(output, null, 2))}</pre>`;
}

const label = (r: EvalReport) => r.provider.model;
const duration = (ms: number) => (ms < 10_000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);

/**
 * ✓ every run passed; ~ a quality check missed; ✗ a critical rule broken or the call
 * failed; – the case did not run with this model. With repeats: runs that passed.
 */
function mark(report: EvalReport, caseId: string): string {
  const runs = report.runs.filter((x) => x.caseId === caseId);
  if (!runs.length) return `<span class="none" title="nicht gelaufen">–</span>`;
  const passed = runs.filter((x) => !x.error && x.results.every((c) => c.passed)).length;
  const count = runs.length > 1 ? ` ${passed}/${runs.length}` : "";
  if (runs.some((x) => x.error || x.results.some((c) => !c.passed && c.level === "kritisch"))) {
    return `<span class="bad" title="kritische Prüfung verletzt oder Fehler">✗${count}</span>`;
  }
  return passed === runs.length
    ? `<span class="ok">✓${count}</span>`
    : `<span class="warn" title="Qualitätsprüfung nicht erfüllt">~${count}</span>`;
}

function runCell(report: EvalReport, run: EvalRun): string {
  const ok = !run.error && run.results.every((c) => c.passed);
  const checks = run.results.map(
    (c) =>
      `<li class="${c.passed ? "ok" : "bad"}">${c.passed ? "✓" : "✗"} ${esc(c.name)} <span class="tag">${esc(c.level)}</span>` +
      `${c.detail ? `<div class="detail">${esc(c.detail)}</div>` : ""}</li>`,
  );
  const id = [run.caseId, report.provider.provider, report.provider.model, run.attempt].join("|");
  const tokens = run.usage ? ` · ${run.usage.inputTokens} Tokens ein, ${run.usage.outputTokens} aus` : "";
  return `<div class="run ${ok ? "pass" : "fail"}">
  <p class="meta">${report.repeat > 1 ? `Versuch ${run.attempt} · ` : ""}${duration(run.durationMs)}${tokens}</p>
  ${run.error ? `<p class="bad">Fehler: ${esc(run.error)}</p>` : `<ul class="checks">${checks.join("")}</ul>`}
  ${run.error ? "" : `<details><summary>Antwort des Modells</summary><div class="output">${renderOutput(run.output)}</div></details>`}
  <form class="rate" data-rate="${esc(id)}">
    <span>Deine Bewertung:</span>
    ${["gut", "brauchbar", "schlecht"].map((v) => `<label><input type="radio" name="r" value="${v}"> ${v}</label>`).join("")}
    <input type="text" name="note" placeholder="Notiz" aria-label="Notiz">
  </form>
</div>`;
}

export function reportHtml(reports: readonly EvalReport[], minQuality: number): string {
  const caseIds = [
    ...new Set(reports.flatMap((r) => [...r.runs.map((x) => x.caseId), ...r.skipped.map((x) => x.caseId)])),
  ];
  const summary = reports
    .map((r) => {
      const v = verdict(r, minQuality);
      const s = r.summary;
      const ms = r.runs.reduce((t, x) => t + x.durationMs, 0);
      return `<tr>
  <th scope="row">${esc(label(r))}<div class="meta">${esc(r.provider.provider)} · ${esc(r.provider.region)} · ${esc(r.startedAt.slice(0, 16).replace("T", " "))}</div></th>
  <td class="${v.passed ? "ok" : "bad"}">${v.passed ? "bestanden" : esc(`nicht bestanden: ${v.reasons.join("; ")}`)}</td>
  <td>${s.critical.failed} von ${s.critical.total}</td>
  <td>${percent(s.quality.rate)} (${s.quality.passed} von ${s.quality.total})</td>
  <td>${s.errors}</td>
  <td>${s.tokens.inputTokens} / ${s.tokens.outputTokens}</td>
  <td>${duration(ms)}</td>
</tr>`;
    })
    .join("");
  const agentOf = (caseId: string) =>
    reports.flatMap((r) => [...r.runs, ...r.skipped]).find((x) => x.caseId === caseId)?.agent ?? "";
  const matrix = caseIds
    .map(
      (caseId) =>
        `<tr><th scope="row"><a href="#${esc(caseId)}">${esc(caseId)}</a> <span class="tag">${esc(agentOf(caseId))}</span></th>` +
        `${reports.map((r) => `<td>${mark(r, caseId)}</td>`).join("")}</tr>`,
    )
    .join("");
  const cases = caseIds
    .map((caseId) => {
      const first = reports.flatMap((r) => r.runs).find((x) => x.caseId === caseId);
      const agent = first?.agent ?? reports.flatMap((r) => r.skipped).find((x) => x.caseId === caseId)?.agent;
      const columns = reports
        .map((r) => {
          const runs = r.runs.filter((x) => x.caseId === caseId);
          const skipped = r.skipped.find((x) => x.caseId === caseId);
          const body = runs.length
            ? runs.map((x) => runCell(r, x)).join("")
            : `<p class="none">${skipped ? `übersprungen: ${esc(skipped.reason)}` : "nicht gelaufen"}</p>`;
          return `<article><h3>${esc(label(r))}</h3>${body}</article>`;
        })
        .join("");
      return `<section id="${esc(caseId)}"><h2><span class="tag">${esc(agent ?? "")}</span> ${esc(caseId)}</h2>
<p>${esc(first?.title ?? "")}</p><div class="cols" style="--n:${reports.length}">${columns}</div></section>`;
    })
    .join("");
  const storageKey = `hh-eval:${reports.map((r) => r.startedAt).join(",")}`;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evaluation der Agenten</title>
<style>
:root { --bg:#fafafa; --fg:#1b1b1f; --muted:#5f6068; --card:#fff; --line:#e3e3e8; --ok:#0f7b3f; --bad:#b3261e; --warn:#8a5a00; --tag:#ececf1; }
@media (prefers-color-scheme: dark) { :root { --bg:#141417; --fg:#ececf1; --muted:#a3a4ad; --card:#1d1d22; --line:#33333a; --ok:#5cc489; --bad:#ff8a80; --warn:#f0b955; --tag:#2a2a31; } }
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1400px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 4px; } h3 { font-size: 15px; margin: 0 0 8px; } h4 { font-size: 13px; margin: 12px 0 2px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
.meta, .none { color: var(--muted); font-size: 13px; margin: 2px 0; }
.table { overflow-x: auto; } table { border-collapse: collapse; width: 100%; background: var(--card); }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 14px; }
.matrix td, .matrix th { padding: 4px 10px; } a { color: inherit; }
.cols { display: grid; gap: 12px; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
article { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
.run { border-left: 3px solid var(--line); padding-left: 10px; margin-bottom: 12px; } .run.pass { border-color: var(--ok); } .run.fail { border-color: var(--bad); }
ul { margin: 4px 0; padding-left: 20px; } .checks { list-style: none; padding: 0; }
.ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); } .detail { color: var(--fg); font-size: 13px; margin-left: 18px; overflow-wrap: anywhere; }
.tag { background: var(--tag); color: var(--fg); border-radius: 4px; padding: 0 6px; font-size: 12px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 2px 0; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
details { margin-top: 6px; } summary { cursor: pointer; color: var(--muted); }
.rate { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; font-size: 13px; }
.rate input[type=text] { flex: 1 1 140px; min-width: 0; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--fg); }
button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>Evaluation der Agenten</h1>
<p class="meta">Erfundene Fälle · Mindestqualität ${percent(minQuality)} · «kritisch»: muss jedes Mal halten · «qualitaet»: zählt als Quote</p>
<div class="table"><table>
<thead><tr><th>Modell</th><th>Ergebnis</th><th>Kritisch verletzt</th><th>Qualität</th><th>Fehler</th><th>Tokens ein / aus</th><th>Dauer</th></tr></thead>
<tbody>${summary}</tbody></table></div>
<h2>Fälle</h2>
<p class="meta">✓ bestanden · <span class="warn">~</span> Qualitätsprüfung nicht erfüllt · <span class="bad">✗</span> kritische Regel verletzt oder Fehler · – nicht gelaufen</p>
<div class="table"><table class="matrix">
<thead><tr><th>Fall</th>${reports.map((r) => `<th>${esc(label(r))}</th>`).join("")}</tr></thead>
<tbody>${matrix}</tbody></table></div>
<p><button type="button" id="export">Bewertungen herunterladen</button> <span class="meta">Deine Bewertungen bleiben in diesem Browser.</span></p>
${cases}
</main>
<script>
(() => {
  const key = ${JSON.stringify(storageKey).replace(/</g, "\\u003c")};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  const store = () => { try { localStorage.setItem(key, JSON.stringify(saved)); } catch {} };
  for (const form of document.querySelectorAll("form[data-rate]")) {
    const id = form.dataset.rate;
    const s = saved[id] || {};
    if (s.rating) { const r = form.querySelector('input[value="' + s.rating + '"]'); if (r) r.checked = true; }
    form.elements.note.value = s.note || "";
    form.addEventListener("input", () => {
      const r = form.querySelector('input[name="r"]:checked');
      saved[id] = { rating: r ? r.value : "", note: form.elements.note.value };
      store();
    });
    form.addEventListener("submit", (e) => e.preventDefault());
  }
  document.getElementById("export").addEventListener("click", () => {
    const rows = Object.entries(saved).map(([id, v]) => {
      const [caseId, provider, model, attempt] = id.split("|");
      return { caseId, provider, model, attempt: Number(attempt), rating: v.rating, note: v.note };
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
    a.download = "bewertungen.json";
    a.click();
  });
})();
</script>
</body>
</html>
`;
}
