import type { Participant } from "@workspace/db";

export const PICKER_FUZZY_THRESHOLD = 0.72;
export const DUPLICATE_WARNING_THRESHOLD = 0.62;

export function normalizeParticipantName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSort(value: string): string {
  return normalizeParticipantName(value).split(" ").filter(Boolean).sort().join(" ");
}

function bigrams(value: string): string[] {
  const normalized = normalizeParticipantName(value).replace(/\s+/g, "");
  if (normalized.length <= 1) return normalized ? [normalized] : [];
  const grams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.push(normalized.slice(index, index + 2));
  }
  return grams;
}

function diceCoefficient(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const gram of a) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of b) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function editDistance(left: string, right: string): number {
  const a = normalizeParticipantName(left);
  const b = normalizeParticipantName(right);
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

function editSimilarity(left: string, right: string): number {
  const a = normalizeParticipantName(left);
  const b = normalizeParticipantName(right);
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

export function participantNameSimilarity(
  query: string,
  candidate: Pick<Participant, "displayName" | "preferredName">,
): number {
  const q = normalizeParticipantName(query);
  if (!q) return 0;
  const names = [candidate.displayName, candidate.preferredName].map(normalizeParticipantName).filter(Boolean);
  return Math.max(0, ...names.flatMap(name => [
    diceCoefficient(q, name),
    diceCoefficient(tokenSort(q), tokenSort(name)),
    editSimilarity(q, name),
    editSimilarity(tokenSort(q), tokenSort(name)),
  ]));
}
