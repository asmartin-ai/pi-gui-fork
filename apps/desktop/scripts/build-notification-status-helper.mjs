import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(desktopDir, "..", "..");
const helpers = [
  {
    sourcePath: path.join(desktopDir, "resources", "notification-status-helper.swift"),
    outputPath: path.join(desktopDir, "build", "native", "pi-gui-notification-status-helper"),
  },
  {
    sourcePath: path.join(desktopDir, "resources", "computer-use-helper.swift"),
    outputPath: path.join(desktopDir, "build", "native", "pi-gui-computer-use-helper"),
  },
];
const outputDir = path.join(desktopDir, "build", "native");
const computerUseExtensionSourceDir = path.join(repoDir, "packages", "computer-use-extension");
const computerUseExtensionOutputDir = path.join(desktopDir, "out", "computer-use-extension");

if (process.platform !== "darwin") {
  console.log("Skipping notification status helper build outside macOS.");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
for (const helper of helpers) {
  await execFileAsync("xcrun", ["swiftc", helper.sourcePath, "-O", "-o", helper.outputPath], {
    cwd: desktopDir,
  });
  console.log(`Built native helper at ${helper.outputPath}`);
}

await rm(computerUseExtensionOutputDir, { recursive: true, force: true });
await mkdir(computerUseExtensionOutputDir, { recursive: true });
await copyFile(
  path.join(computerUseExtensionSourceDir, "package.json"),
  path.join(computerUseExtensionOutputDir, "package.json"),
);
await cp(path.join(computerUseExtensionSourceDir, "dist"), path.join(computerUseExtensionOutputDir, "dist"), {
  recursive: true,
});
console.log(`Staged Computer Use extension at ${computerUseExtensionOutputDir}`);
