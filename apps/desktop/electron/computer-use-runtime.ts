import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const computerUsePackageName = "@pi-gui/computer-use-extension";
const helperEnv = "PI_GUI_COMPUTER_USE_HELPER_PATH";
const disableEnv = "PI_GUI_DISABLE_BUILTIN_COMPUTER_USE";

interface ConfigureComputerUseRuntimeOptions {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly execPath: string;
}

export async function configureComputerUseRuntime(options: ConfigureComputerUseRuntimeOptions): Promise<void> {
  if (process.env[disableEnv] === "1") {
    return;
  }

  configureHelperPath(options);
  await ensureComputerUsePackageEnabled(resolveAgentDir(), resolveComputerUsePackageDir(options));
}

function configureHelperPath(options: ConfigureComputerUseRuntimeOptions): void {
  if (process.env[helperEnv]?.trim()) {
    return;
  }

  const helperPath = options.isPackaged
    ? path.join(path.dirname(options.execPath), "pi-gui-computer-use-helper")
    : path.join(__dirname, "..", "..", "build", "native", "pi-gui-computer-use-helper");

  process.env[helperEnv] = helperPath;
}

function resolveAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  return configured ? path.resolve(expandHome(configured)) : path.join(os.homedir(), ".pi", "agent");
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveComputerUsePackageDir(options: ConfigureComputerUseRuntimeOptions): string {
  if (options.isPackaged) {
    return path.join(options.resourcesPath, "app.asar", "out", "computer-use-extension");
  }
  return path.dirname(require.resolve(`${computerUsePackageName}/package.json`));
}

async function ensureComputerUsePackageEnabled(agentDir: string, packageDir: string): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const settingsPath = path.join(agentDir, "settings.json");
  const settings = await readSettings(settingsPath);
  const currentPackages = Array.isArray(settings.packages) ? settings.packages : [];
  const nextPackages = [
    ...currentPackages.filter((entry) => !isComputerUsePackageEntry(entry, packageDir)),
    packageDir,
  ];

  const changed =
    !Array.isArray(settings.packages) ||
    settings.packages.length !== nextPackages.length ||
    settings.packages.some((entry, index) => entry !== nextPackages[index]);

  if (!changed) {
    return;
  }

  await writeFile(settingsPath, `${JSON.stringify({ ...settings, packages: nextPackages }, null, 2)}\n`, "utf8");
}

async function readSettings(settingsPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  return {};
}

function isComputerUsePackageEntry(entry: unknown, packageDir: string): boolean {
  const source = packageEntrySource(entry);
  if (!source) {
    return false;
  }
  return (
    path.resolve(expandHome(source)) === path.resolve(packageDir) ||
    source.includes(computerUsePackageName) ||
    path.basename(source) === "computer-use-extension"
  );
}

function packageEntrySource(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object" && "source" in entry) {
    const source = (entry as { source?: unknown }).source;
    return typeof source === "string" ? source : undefined;
  }
  return undefined;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
