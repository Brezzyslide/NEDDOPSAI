/**
 * MarkdownRenderer — lightweight, dependency-free Markdown → React
 *
 * Supports:
 *   - Headings h1–h4
 *   - Bold, italic, inline code
 *   - Unordered and ordered lists (nested up to 2 levels)
 *   - Blockquotes
 *   - Fenced code blocks
 *   - Tables (GFM-style)
 *   - Horizontal rules
 *   - Paragraph text with line-break handling
 *   - Links
 */

import React from "react";

type Node =
  | { type: "heading"; level: 1|2|3|4; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "ul"; items: InlineNode[][] }
  | { type: "ol"; items: InlineNode[][] }
  | { type: "blockquote"; children: InlineNode[] }
  | { type: "codeblock"; lang: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" };

type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; href: string; label: string };

// ─── Inline parser ────────────────────────────────────────────────────────────

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // bold **...**
    const bold = remaining.match(/^\*\*(.+?)\*\*/s);
    if (bold) { nodes.push({ type: "bold", value: bold[1]! }); remaining = remaining.slice(bold[0].length); continue; }

    // bold __...__
    const boldU = remaining.match(/^__(.+?)__/s);
    if (boldU) { nodes.push({ type: "bold", value: boldU[1]! }); remaining = remaining.slice(boldU[0].length); continue; }

    // italic *...*
    const ital = remaining.match(/^\*([^*\n]+?)\*/);
    if (ital) { nodes.push({ type: "italic", value: ital[1]! }); remaining = remaining.slice(ital[0].length); continue; }

    // inline code `...`
    const code = remaining.match(/^`([^`]+?)`/);
    if (code) { nodes.push({ type: "code", value: code[1]! }); remaining = remaining.slice(code[0].length); continue; }

    // link [...](...)
    const link = remaining.match(/^\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
    if (link) { nodes.push({ type: "link", href: link[2]!, label: link[1]! }); remaining = remaining.slice(link[0].length); continue; }

    // text up to next special char
    const next = remaining.match(/^([^*_`\[]+)/s);
    if (next) { nodes.push({ type: "text", value: next[1]! }); remaining = remaining.slice(next[0].length); continue; }

    // fallback — consume one char
    nodes.push({ type: "text", value: remaining[0]! });
    remaining = remaining.slice(1);
  }
  return nodes;
}

// ─── Block parser ─────────────────────────────────────────────────────────────

function parse(markdown: string): Node[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      nodes.push({ type: "codeblock", lang, code: codeLines.join("\n") });
      i++; continue;
    }

    // horizontal rule
    if (/^(---+|===+|\*\*\*+)$/.test(line.trim())) {
      nodes.push({ type: "hr" });
      i++; continue;
    }

    // heading
    const hMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (hMatch) {
      const level = Math.min(hMatch[1]!.length, 4) as 1|2|3|4;
      nodes.push({ type: "heading", level, children: parseInline(hMatch[2]!) });
      i++; continue;
    }

    // table (detect by | separator on header row)
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[-:| ]+\|/.test(lines[i + 1]!)) {
      const headers = line.split("|").slice(1, -1).map(h => h.trim());
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        rows.push(lines[i]!.split("|").slice(1, -1).map(c => c.trim()));
        i++;
      }
      nodes.push({ type: "table", headers, rows });
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const bqLines = [line.replace(/^>\s?/, "")];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1]!)) {
        i++;
        bqLines.push(lines[i]!.replace(/^>\s?/, ""));
      }
      nodes.push({ type: "blockquote", children: parseInline(bqLines.join(" ")) });
      i++; continue;
    }

    // unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.replace(/^[-*+]\s/, "")));
        i++;
      }
      nodes.push({ type: "ul", items });
      continue;
    }

    // ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.replace(/^\d+\.\s/, "")));
        i++;
      }
      nodes.push({ type: "ol", items });
      continue;
    }

    // blank line
    if (line.trim() === "") { i++; continue; }

    // paragraph — collect consecutive non-blank lines
    const paraLines = [line];
    while (i + 1 < lines.length && lines[i + 1]!.trim() !== "" && !/^(#{1,4}\s|```|>|\d+\.\s|[-*+]\s|\|)/.test(lines[i + 1]!)) {
      i++;
      paraLines.push(lines[i]!);
    }
    nodes.push({ type: "paragraph", children: parseInline(paraLines.join(" ")) });
    i++;
  }
  return nodes;
}

// ─── Inline renderer ──────────────────────────────────────────────────────────

function RenderInline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "bold":   return <strong key={i} className="font-semibold text-[#E2E8F0]">{n.value}</strong>;
          case "italic": return <em key={i} className="italic text-[#CBD5E1]">{n.value}</em>;
          case "code":   return <code key={i} className="px-1.5 py-0.5 rounded bg-[#0B1829] text-[#00D4FF] text-[0.85em] font-mono">{n.value}</code>;
          case "link":   return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-[#00D4FF] underline hover:text-cyan-300">{n.label}</a>;
          case "text":   return <React.Fragment key={i}>{n.value}</React.Fragment>;
          default:       return null;
        }
      })}
    </>
  );
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function RenderNode({ node, idx }: { node: Node; idx: number }) {
  switch (node.type) {
    case "heading": {
      const className = [
        "font-bold text-[#E2E8F0] mb-2 mt-6",
        node.level === 1 ? "text-2xl" :
        node.level === 2 ? "text-xl border-b border-[#1E3A5F] pb-2" :
        node.level === 3 ? "text-lg" : "text-base",
      ].join(" ");
      const Tag = `h${node.level}` as "h1"|"h2"|"h3"|"h4";
      return (
        <Tag id={`section-${idx}`} className={className}>
          <RenderInline nodes={node.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="text-[#CBD5E1] leading-relaxed mb-4">
          <RenderInline nodes={node.children} />
        </p>
      );
    case "ul":
      return (
        <ul className="list-disc list-inside mb-4 space-y-1 text-[#CBD5E1]">
          {node.items.map((item, i) => (
            <li key={i} className="leading-relaxed pl-2">
              <RenderInline nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal list-inside mb-4 space-y-1 text-[#CBD5E1]">
          {node.items.map((item, i) => (
            <li key={i} className="leading-relaxed pl-2">
              <RenderInline nodes={item} />
            </li>
          ))}
        </ol>
      );
    case "blockquote":
      return (
        <blockquote className="border-l-4 border-[#00D4FF]/40 pl-4 py-1 mb-4 text-[#94A3B8] italic">
          <RenderInline nodes={node.children} />
        </blockquote>
      );
    case "codeblock":
      return (
        <div className="mb-4 rounded-lg overflow-hidden border border-[#1E3A5F]">
          {node.lang && (
            <div className="px-4 py-1.5 bg-[#0B1829] border-b border-[#1E3A5F] text-[#64748B] text-xs font-mono">
              {node.lang}
            </div>
          )}
          <pre className="bg-[#071020] p-4 overflow-x-auto text-sm font-mono text-[#CBD5E1] leading-relaxed">
            <code>{node.code}</code>
          </pre>
        </div>
      );
    case "table":
      return (
        <div className="mb-4 overflow-x-auto rounded-lg border border-[#1E3A5F]">
          <table className="w-full text-sm">
            <thead className="bg-[#112033]">
              <tr>
                {node.headers.map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-[#E2E8F0] font-semibold border-b border-[#1E3A5F]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-[#0B1829]" : "bg-[#0d1f32]"}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-3 text-[#CBD5E1] border-b border-[#1E3A5F]/40 last:border-b-0">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={idx} className="border-[#1E3A5F] my-6" />;
    default:
      return null;
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

interface Props {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: Props) {
  const nodes = React.useMemo(() => parse(content), [content]);
  return (
    <div className={`prose-invert max-w-none ${className}`}>
      {nodes.map((node, i) => <RenderNode key={i} node={node} idx={i} />)}
    </div>
  );
}

/** Extract heading sections from markdown for document outline */
export function extractOutline(content: string): { level: number; text: string; idx: number }[] {
  const nodes = parse(content);
  return nodes
    .map((n, i) => n.type === "heading" ? { level: n.level, text: n.children.map(c => ("value" in c ? c.value : "")).join(""), idx: i } : null)
    .filter(Boolean) as { level: number; text: string; idx: number }[];
}
