export interface CarePlanProtectiveStrategyConfirmationIssue {
  strategy: string;
  bspSource: string;
  reason: string;
}

export function findUnconfirmedCarePlanProtectiveStrategies(
  contentMarkdown: string,
): CarePlanProtectiveStrategyConfirmationIssue[] {
  const protectiveBlock = contentMarkdown.match(
    /(?:^|\n)#{1,6}\s+protective strategies\s*\n([\s\S]*?)(?=\n#{1,6}\s+|$)/i,
  )?.[1] ?? "";
  if (!protectiveBlock.trim()) return [];

  const table = extractMarkdownTablesFromText(protectiveBlock).find((candidate) =>
    ["behaviour or trigger", "strategy", "what the worker does", "bsp source"].every((required) =>
      candidate.headers.some((header) => normaliseText(header).includes(required)),
    ),
  );
  if (!table) return [];

  return table.rows.flatMap((row) => {
    if (row.length < 4) return [];
    if (row.some((cell) => /\[[A-Z0-9_]+\]/.test(cell))) return [];
    const strategy = row[1]?.trim() ?? "";
    const bspSource = row[3]?.trim() ?? "";
    if (!strategy) return [];
    const combined = row.join(" ");
    const confirmed = /\b(?:apo|authorised program officer)\b.{0,80}\bconfirm(?:ed|ation)?\b/i.test(combined) ||
      /\bconfirm(?:ed|ation)?\b.{0,80}\b(?:apo|authorised program officer)\b/i.test(combined);
    const explicitlyUnconfirmed = /\bunconfirmed\b|\bnot confirmed\b|\bpending confirmation\b|\bapo review required\b/i.test(combined);
    if (confirmed && !explicitlyUnconfirmed) return [];
    return [{
      strategy,
      bspSource,
      reason: explicitlyUnconfirmed
        ? "Protective strategy is visibly marked unconfirmed."
        : "Protective strategy does not carry an APO confirmation signal.",
    }];
  });
}

function extractMarkdownTablesFromText(markdown: string): Array<{ headers: string[]; rows: string[][] }> {
  const lines = markdown.split(/\r?\n/);
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? "";
    const separator = lines[index + 1] ?? "";
    if (!header.includes("|") || !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)) continue;
    const headers = splitMarkdownTableRow(header);
    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex] ?? "";
      if (!row.includes("|") || !row.trim()) break;
      rows.push(splitMarkdownTableRow(row));
      index = rowIndex;
    }
    tables.push({ headers, rows });
  }
  return tables;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
