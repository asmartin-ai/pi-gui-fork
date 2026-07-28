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
  assert(releaseSteps[0].jobName === "publish", "Only the publish job may mutate a release");

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

  const publish = jobs.publish;
  assert(
    JSON.stringify(publish.needs) ===
      JSON.stringify(["build-macos", "build-linux", "build-windows"]),
    "Publish job must wait for every platform candidate",
  );
  assert(publish.environment === "release", "Publish job must use the release environment gate");
  assert(publish.permissions?.contents === "write", "Only publish needs release write permission");

  const steps = publish.steps ?? [];
  const candidateIndex = steps.findIndex(({ name }) => name === "Validate combined release candidate");
  const uploadIndex = steps.findIndex(({ uses }) => uses === "softprops/action-gh-release@v2");
  const draftVerifyIndex = steps.findIndex(({ name }) => name === "Verify uploaded draft bytes");
  const publishIndex = steps.findIndex(({ name }) => name === "Publish validated release");
  assert(
    candidateIndex >= 0 &&
      candidateIndex < uploadIndex &&
      uploadIndex < draftVerifyIndex &&
      draftVerifyIndex < publishIndex,
    "Candidate, draft upload, remote byte validation, and publication must remain ordered",
  );

  const release = releaseSteps[0].step;
  assert(release.with?.draft === true, "Release assets must be uploaded to a draft");
  assert(
    release.with?.fail_on_unmatched_files === true,
    "Draft upload must fail on unmatched artifact paths",
  );
  assert(
    runText(steps[publishIndex]).includes("--draft=false"),
    "The final gated step must publish the validated draft",
  );

  for (const jobName of [
    "verify-published-macos",
    "verify-published-linux",
    "verify-published-windows",
  ]) {
    assert(jobs[jobName]?.needs === "publish", `${jobName} must validate the published release`);
  }
}

const [builderConfig, workflow, finalizerSource] = await Promise.all([
  parseYaml("apps/desktop/electron-builder.yml"),
  parseYaml(".github/workflows/release.yml"),
  readFile(path.join(scriptDir, "finalize-macos-release.sh"), "utf8"),
]);

validateBuilderConfig(builderConfig);
validateWorkflow(workflow, finalizerSource);
console.log("Release package and workflow configuration are valid.");
