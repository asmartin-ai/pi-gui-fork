import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function summarizePlaywrightReport(report, metadata = {}) {
  const groups = new Map();

  visitSuites(report.suites ?? [], (spec) => {
    const file = spec.file || "unknown";
    const group = groups.get(file) ?? {
      specFile: file,
      counts: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
      failures: [],
    };

    for (const test of spec.tests ?? []) {
      const status = normalizeStatus(test.status);
      group.counts[status] += 1;
      if (status === "unexpected" || status === "flaky") {
        const failedResults = (test.results ?? []).filter((result) => result.status !== "passed");
        group.failures.push({
          title: spec.title,
          line: spec.line,
          column: spec.column,
          status,
          errors: failedResults.flatMap((result) =>
            (result.errors ?? []).map((error) => error.message ?? String(error)),
          ),
        });
      }
    }

    groups.set(file, group);
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run: {
      sha: metadata.sha ?? null,
      runId: metadata.runId ?? null,
      runAttempt: metadata.runAttempt ?? null,
    },
    stats: report.stats ?? {},
    errors: (report.errors ?? []).map((error) => error.message ?? String(error)),
    groups: [...groups.values()].sort((left, right) => left.specFile.localeCompare(right.specFile)),
  };
}

function visitSuites(suites, visitSpec) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      visitSpec(spec);
    }
    visitSuites(suite.suites ?? [], visitSpec);
  }
}

function normalizeStatus(status) {
  if (status === "unexpected" || status === "flaky" || status === "skipped") {
    return status;
  }
  return "expected";
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("Usage: summarize-playwright-trend.mjs <input.json> <output.json>");
  }

  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const summary = summarizePlaywrightReport(report, {
    sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
