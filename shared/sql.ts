// SQL helpers shared by server and client.

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export function qualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

export function quoteLiteral(value: string | null): string {
  if (value === null) return "NULL";
  return "'" + value.replace(/'/g, "''") + "'";
}

export interface Statement {
  text: string;
  /** Offsets into the original source (start inclusive, end exclusive), trimmed. */
  from: number;
  to: number;
}

/**
 * Split a SQL script into statements on top-level semicolons. Understands
 * single/double quotes, E'' escapes, dollar quoting, line and nested block comments.
 * Statements that contain only comments/whitespace are dropped.
 */
export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  let hasCode = false;

  const push = (end: number) => {
    if (hasCode) {
      const raw = sql.slice(start, end);
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim();
      out.push({ text, from: start + lead, to: start + lead + text.length });
    }
    hasCode = false;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") (depth++, (i += 2));
        else if (sql[i] === "*" && sql[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const escapes = ch === "'" && (sql[i - 1] === "E" || sql[i - 1] === "e");
      hasCode = true;
      i++;
      while (i < n) {
        if (escapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === "$") {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      // `$1` parameters are not dollar quotes.
      if (match && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")) {
        const tag = match[0];
        const close = sql.indexOf(tag, i + tag.length);
        hasCode = true;
        i = close < 0 ? n : close + tag.length;
        continue;
      }
    }
    if (ch === ";") {
      push(i);
      start = i + 1;
      i++;
      continue;
    }
    if (!/\s/.test(ch)) hasCode = true;
    i++;
  }
  push(n);
  return out;
}

/** The statement that contains (or ends just before) the cursor offset. */
export function statementAt(sql: string, offset: number): Statement | undefined {
  const statements = splitStatements(sql);
  if (statements.length === 0) return undefined;
  let best = statements[0];
  for (const s of statements) {
    if (s.from <= offset) best = s;
  }
  // If the cursor sits in the gap after a statement, prefer that statement.
  return best;
}

/** First keyword of a statement, uppercased (comments skipped). */
export function leadingKeyword(sql: string): string {
  const stripped = sql.replace(/^(\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "");
  return (/^[A-Za-z]+/.exec(stripped)?.[0] ?? "").toUpperCase();
}
