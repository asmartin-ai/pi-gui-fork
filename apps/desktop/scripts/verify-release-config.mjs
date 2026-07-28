import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, "..", "..", "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function parseYaml(relativePath) {
  const filePath = path.join(repoDir, relativePath);
  const document = parseDocument(await readFile(filePath, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `${relativePath} is invalid YAML: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return document.toJS();
}

function stepNamed(job, name) {
  const step = job.steps?.find((candidate) => candidate.name === name);
  assert(step, `Missing workflow step "${name}"`);
  return step;
}

function runText(step) {
  return typeof step.run === "string" ? step.run : "";
}

function validateBuilderConfig(config) {
  assert(config.mac?.notarize === true, "electron-builder must notarize the macOS app");
  assert(
    config.win?.signAndEditExecutable === true,
    "electron-builder must sign and edit the packaged Windows executable",
  );

  const targets = new Set((config.win?.target ?? []).map(({ target }) => target));
  assert(targets.has("nsis"), "Windows packaging must include NSIS");
  assert(targets.has("portable"), "Windows packaging must include portable");

  const setupName = "${productName}-${version}-${arch}-setup.${ext}";
  const portableName = "${productName}-${version}-${arch}-portable.${ext}";
  assert(config.nsis?.artifactName === setupName, `NSIS artifactName must be ${setupName}`);
  assert(
    config.portable?.artifactName === portableName,
    `portable artifactName must be ${portableName}`,
  );
  assert(
    config.nsis.artifactName !== config.portable.artifactName,
    "NSIS and portable artifacts must not share a filename",
  );
}

function validateBuildJob(job, platform) {
  const upload = stepNamed(job, `Upload immutable ${platform} candidate`);
  assert(upload.uses === "actions/upload-artifact@v4", `${platform} must use upload-artifact v4`);
  assert(
    upload.with?.["if-no-files-found"] === "error",
    `${platform} candidate upload must fail when files are missing`,
  );
  assert(upload.with?.overwrite !== true, `${platform} candidate upload must remain immutable`);

  const stage = stepNamed(job, `Stage validated ${platform} artifacts`);
  assert(
    runText(stage).includes("release-artifacts.mjs stage"),
    `${platform} candidate must be staged through the release manifest helper`,
  );
}

function validateWorkflow(workflow, finalizerSource) {
  const jobs = workflow.jobs ?? {};
  const releaseSteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    (job.steps ?? [])
      .filter(({ uses }) => uses === "softprops/action-gh-release@v2")
      .map((step) => ({ jobName, step })),
  );
  assert(releaseSteps.length === 1, "Release workflow must have exactly one GitHub release action");
  assert(
    releaseSteps[0].jobName === "stage-draft",
    "Only the draft staging job may upload release assets",
  );
  assert(workflow.permissions?.contents === "read", "Release workflow must default to read access");

  validateBuildJob(jobs["build-macos"], "macOS");
  validateBuildJob(jobs["build-linux"], "Linux");
  validateBuildJob(jobs["build-windows"], "Windows");

  const macFinalize = stepNamed(jobs["build-macos"], "Notarize and verify final macOS artifacts");
  const macRefresh = stepNamed(jobs["build-macos"], "Refresh update metadata from final DMG");
  const macStage = stepNamed(jobs["build-macos"], "Stage validated macOS artifacts");
  assert(
    runText(macFinalize).includes("finalize-macos-release.sh"),
    "macOS build must run final DMG notarization and trust validation",
  );
  assert(
    macFinalize["continue-on-error"] !== true,
    "Final macOS validation must be fatal",
  );
  for (const command of [
    "set -euo pipefail",
    "notarytool submit",
    "stapler staple",
    "stapler validate",
    "spctl --assess --type open",
  ]) {
    assert(finalizerSource.includes(command), `macOS finalizer must contain: ${command}`);
  }
  assert(
    runText(macRefresh).includes("refresh-macos-update-metadata.mjs"),
    "macOS build must regenerate update metadata from the stapled DMG",
  );
  assert(
    jobs["build-macos"].steps.indexOf(macFinalize) <
      jobs["build-macos"].steps.indexOf(macRefresh) &&
      jobs["build-macos"].steps.indexOf(macRefresh) <
        jobs["build-macos"].steps.indexOf(macStage),
    "macOS metadata refresh must run after stapling and before artifact staging",
  );

  const windowsJob = jobs["build-windows"];
  const signingCheck = stepNamed(windowsJob, "Validate Windows signing credentials");
  const packageStep = stepNamed(windowsJob, "Package Windows");
  assert(
    JSON.stringify(signingCheck.env).includes("secrets.WINDOWS_CSC_LINK") &&
      JSON.stringify(signingCheck.env).includes("secrets.WINDOWS_CSC_KEY_PASSWORD"),
    "Windows build must require dedicated signing secrets",
  );
  assert(
    JSON.stringify(packageStep.env).includes("secrets.WINDOWS_CSC_LINK") &&
      JSON.stringify(packageStep.env).includes("secrets.WINDOWS_CSC_KEY_PASSWORD"),
    "Windows signing secrets must map to electron-builder CSC variables",
  );
  stepNamed(windowsJob, "Verify Windows signatures and architecture");

  const stageDraft = jobs["stage-draft"];
  assert(
    JSON.stringify(stageDraft.needs) ===
      JSON.stringify(["build-macos", "build-linux", "build-windows"]),
    "Draft staging must wait for every platform candidate",
  );
  assert(
    stageDraft.permissions?.contents === "write",
    "Draft staging needs release write permission",
  );

  const steps = stageDraft.steps ?? [];
  const candidateIndex = steps.findIndex(({ name }) => name === "Validate combined release candidate");
  const stateCheck = stepNamed(stageDraft, "Check existing release state");
  const stateCheckIndex = steps.indexOf(stateCheck);
  const uploadIndex = steps.findIndex(({ uses }) => uses === "softprops/action-gh-release@v2");
  assert(
    candidateIndex >= 0 &&
      candidateIndex < stateCheckIndex &&
      stateCheckIndex < uploadIndex,
    "Candidate validation and fail-closed state lookup must precede draft upload",
  );
  assert(
    runText(stateCheck).includes("github-release-state.mjs") &&
      !runText(stateCheck).includes("gh release view"),
    "Existing release lookup must use the fail-closed API state checker",
  );

  const release = releaseSteps[0].step;
  assert(release.with?.draft === true, "Release assets must be uploaded to a draft");
  assert(
    release.with?.fail_on_unmatched_files === true,
    "Draft upload must fail on unmatched artifact paths",
  );

  const draftVerifiers = [
    ["verify-draft-macos", "Verify draft macOS trust"],
    ["verify-draft-linux", "Verify draft Linux architecture"],
    ["verify-draft-windows", "Verify draft Windows signatures"],
  ];
  for (const [jobName, trustStep] of draftVerifiers) {
    const job = jobs[jobName];
    assert(job?.needs === "stage-draft", `${jobName} must wait for draft staging`);
    assert(
      runText(stepNamed(job, "Download draft release")).includes("gh release download"),
      `${jobName} must download the draft release`,
    );
    assert(
      runText(stepNamed(job, "Verify draft manifests and bytes")).includes("--platform all"),
      `${jobName} must verify the complete draft byte set`,
    );
    stepNamed(job, trustStep);
  }

  const publish = jobs.publish;
  assert(
    JSON.stringify(publish.needs) ===
      JSON.stringify(["verify-draft-macos", "verify-draft-linux", "verify-draft-windows"]),
    "Final publication must wait for all native draft trust checks",
  );
  assert(publish.environment === "release", "Final publication must use the release environment gate");
  assert(publish.permissions?.contents === "write", "Final publication needs release write permission");

  const publishSteps = publish.steps ?? [];
  const requireIndex = publishSteps.findIndex(({ name }) => name === "Require the validated draft");
  const revalidateIndex = publishSteps.findIndex(
    ({ name }) => name === "Revalidate draft bytes before publication",
  );
  const publishIndex = publishSteps.findIndex(({ name }) => name === "Publish validated draft");
  const publishedVerifyIndex = publishSteps.findIndex(
    ({ name }) => name === "Verify published release bytes",
  );
  assert(
    requireIndex >= 0 &&
      requireIndex < revalidateIndex &&
      revalidateIndex < publishIndex &&
      publishIndex < publishedVerifyIndex,
    "Draft state, bytes, publication, and public-byte verification must remain ordered",
  );
  assert(
    runText(publishSteps[requireIndex]).includes("github-release-state.mjs --require-draft"),
    "Final publication must fail closed unless the validated draft still exists",
  );
  assert(
    runText(publishSteps[revalidateIndex]).includes("--platform all"),
    "Final publication must revalidate unchanged draft bytes",
  );
  assert(
    runText(publishSteps[publishIndex]).includes("--draft=false"),
    "Only the final gated job may publish the validated draft",
  );
  assert(
    runText(publishSteps[publishedVerifyIndex]).includes("--platform all"),
    "Published release bytes must be redownloaded and verified",
  );

  const draftClears = Object.entries(jobs).flatMap(([jobName, job]) =>
    (job.steps ?? [])
      .filter((step) => runText(step).includes("--draft=false"))
      .map(() => jobName),
  );
  assert(
    JSON.stringify(draftClears) === JSON.stringify(["publish"]),
    "Exactly one final job may clear the draft flag",
  );

  const writeJobs = Object.entries(jobs)
    .filter(([, job]) => job.permissions?.contents === "write")
    .map(([jobName]) => jobName);
  assert(
    JSON.stringify(writeJobs) === JSON.stringify(["stage-draft", "publish"]),
    "Only draft staging and final publication may have release write permission",
  );
  assert(jobs["sync-homebrew"]?.needs === "publish", "Homebrew sync must wait for publication");
}

const [builderConfig, workflow, finalizerSource] = await Promise.all([
  parseYaml("apps/desktop/electron-builder.yml"),
  parseYaml(".github/workflows/release.yml"),
  readFile(path.join(scriptDir, "finalize-macos-release.sh"), "utf8"),
]);

validateBuilderConfig(builderConfig);
validateWorkflow(workflow, finalizerSource);
console.log("Release package and workflow configuration are valid.");
