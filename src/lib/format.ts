import type { Cell } from "@shared/types";

export type ValueKind = "bool" | "number" | "json" | "date" | "uuid" | "array" | "enum" | "bytes" | "text";

/** Classify a column from its type name (format_type output or udt). */
export function valueKind(type: string, category?: string): ValueKind {
  const t = type.toLowerCase();
  if (category === "A" || t.endsWith("[]") || t.startsWith("_")) return "array";
  if (category === "E") return "enum";
  if (t === "boolean" || t === "bool") return "bool";
  if (category === "N" || /^(smallint|integer|bigint|int[248]?|numeric|decimal|real|double precision|float[48]|money|oid)\b/.test(t)) return "number";
  if (t === "json" || t === "jsonb") return "json";
  if (category === "D" || /^(date|time|timestamp|interval)/.test(t)) return "date";
  if (t === "uuid") return "uuid";
  if (t === "bytea") return "bytes";
  return "text";
}

export function displayValue(value: Cell, kind: ValueKind): string {
  if (value === null) return "NULL";
  if (kind === "bool") return value === "t" || value === "true" ? "true" : value === "f" || value === "false" ? "false" : value;
  if (value.length > 400) return value.slice(0, 400).replace(/\s+/g, " ") + "…";
  return kind === "json" ? value.replace(/\s+/g, " ") : value.replace(/\n/g, "↵ ");
}

export function isTrue(value: Cell) {
  return value === "t" || value === "true";
}

export function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function estimateWidth(name: string, sample: Cell[], kind: ValueKind): number {
  const charW = 7.1;
  let max = name.length * 7.4 + 44;
  for (const v of sample) {
    if (v === null) continue;
    const len = Math.min(v.length, 60);
    max = Math.max(max, len * charW + 24);
  }
  const min = kind === "bool" ? 72 : kind === "number" ? 80 : 96;
  const cap = kind === "json" || kind === "text" ? 340 : kind === "uuid" ? 300 : 240;
  return Math.round(Math.min(Math.max(max, min), cap));
}

export function toTsv(rows: Cell[][], header?: string[]): string {
  const esc = (v: Cell) => (v === null ? "" : /[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) => r.map(esc).join("\t"));
  if (header) lines.unshift(header.map(esc).join("\t"));
  return lines.join("\n");
}

export function toCsv(rows: Cell[][], header: string[]): string {
  const esc = (v: Cell) => (v === null ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}

export function toJson(rows: Cell[][], header: string[]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))), null, 2);
}

export function toMarkdown(rows: Cell[][], header: string[]): string {
  const esc = (v: Cell) => (v === null ? "NULL" : v.replace(/\|/g, "\\|").replace(/\n/g, " "));
  return [`| ${header.map(esc).join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}
