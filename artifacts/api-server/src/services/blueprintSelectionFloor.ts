import { getRegistryEntry, resolveRegistryCodeForNewWork } from "./blueprintRegistry.js";
import { getIntentsForCode, resolveIntent, type IntentResolution } from "./blueprintIntentMap.js";
import type { BlueprintSelectionResult, WorkBlueprint } from "./workBlueprintService.js";

function parseCanonicalIntent(value: string | undefined | null): (IntentResolution & { canonicalIntent: string }) | null {
  const normalised = value?.trim().toLowerCase().replace(/[:/]/g, ".") ?? "";
  const resolved = resolveIntent(normalised);
  if (!resolved || resolved.isAction) {
    const canonicalCode = resolveRegistryCodeForNewWork(normalised);
    const entry = getRegistryEntry(canonicalCode);
    if (!entry) return null;
    return {
      family: entry.blueprintFamily,
      mode: entry.supportedModes[0] ?? "create",
      code: entry.code,
      isAction: false,
      canonicalIntent: normalised,
    };
  }
  return { ...resolved, canonicalIntent: normalised };
}

function inferRequestedBlueprintMode(blueprint: Pick<WorkBlueprint, "code" | "supportedModes">, requestHint?: string | null): string | null {
  const modes = blueprint.supportedModes ?? [];
  if (modes.length === 0) return null;

  const parsed = parseCanonicalIntent(requestHint);
  if (parsed?.code === blueprint.code && modes.includes(parsed.mode)) return parsed.mode;

  const text = requestHint?.toLowerCase() ?? "";
  const requestedMode = /\b(review|audit|assess|validate|check)\b/.test(text)
    ? "review"
    : /\b(update|revise|amend|refresh|change)\b/.test(text)
      ? "revise"
      : /\b(create|draft|write|develop|design|prepare|build|template|standard)\b/.test(text)
        ? "create"
        : null;

  if (requestedMode && modes.includes(requestedMode)) return requestedMode;
  return modes[0] ?? null;
}

export function deriveBlueprintSelectionFloor(
  blueprint: Pick<WorkBlueprint, "code" | "blueprintFamily" | "supportedModes">,
  requestHint?: string | null,
): Pick<BlueprintSelectionResult, "canonicalIntent" | "blueprintFamily" | "blueprintMode"> {
  const registryEntry = getRegistryEntry(blueprint.code);
  if (!registryEntry) return {};

  const blueprintMode = inferRequestedBlueprintMode(blueprint, requestHint);
  const intents = getIntentsForCode(blueprint.code);
  const mappedIntent = blueprintMode
    ? intents.find((intent) => {
        const resolved = resolveIntent(intent);
        return Boolean(resolved && !resolved.isAction && resolved.mode === blueprintMode);
      })
    : intents[0];
  const blueprintFamily = blueprint.blueprintFamily ?? registryEntry.blueprintFamily ?? undefined;
  const canonicalIntent = mappedIntent
    ?? (blueprintFamily && blueprintMode ? `${blueprintFamily}.${blueprintMode}` : undefined);

  return {
    canonicalIntent,
    blueprintFamily,
    blueprintMode: blueprintMode ?? undefined,
  };
}
