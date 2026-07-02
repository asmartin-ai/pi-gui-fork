import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
const codexModel = registry.getAll().find((model) => model.provider === "openai-codex" && model.id === "gpt-5.5");
const issueModelChecks = [
  {
    provider: "anthropic",
    id: "claude-opus-4-7",
    reason: "issue #12 Opus 4.7 visibility",
    requireReasoning: true,
    requireImageInput: true,
  },
  {
    provider: "zai",
    id: "glm-5.1",
    reason: "issue #12 GLM 5.1 visibility",
    requireReasoning: true,
    requireImageInput: false,
  },
];

if (!codexModel) {
  throw new Error("Bundled Pi runtime does not expose openai-codex/gpt-5.5.");
}

if (!codexModel.reasoning) {
  throw new Error("Bundled openai-codex/gpt-5.5 model is missing reasoning support.");
}

if (!codexModel.input.includes("image")) {
  throw new Error("Bundled openai-codex/gpt-5.5 model is missing image input support.");
}

for (const check of issueModelChecks) {
  const model = registry.getAll().find((entry) => entry.provider === check.provider && entry.id === check.id);
  const modelKey = `${check.provider}/${check.id}`;
  if (!model) {
    throw new Error(`Bundled Pi runtime does not expose ${modelKey} for ${check.reason}.`);
  }
  if (check.requireReasoning && !model.reasoning) {
    throw new Error(`Bundled ${modelKey} is missing reasoning support for ${check.reason}.`);
  }
  if (check.requireImageInput && !model.input.includes("image")) {
    throw new Error(`Bundled ${modelKey} is missing image input support for ${check.reason}.`);
  }
}

console.log(
  [
    "Verified bundled Pi runtime exposes openai-codex/gpt-5.5.",
    ...issueModelChecks.map((check) => `Verified bundled Pi runtime exposes ${check.provider}/${check.id}.`),
  ].join("\n"),
);
