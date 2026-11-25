import { describe, expect, it } from "vitest";
import { leadingKeyword, quoteIdent, quoteLiteral, splitStatements, statementAt } from "../shared/sql";

describe("splitStatements", () => {
  it("splits on top-level semicolons and trims", () => {
    expect(splitStatements("select 1;  select 2 ;\n\nselect 3").map((s) => s.text)).toEqual(["select 1", "select 2", "select 3"]);
  });

  it("ignores semicolons in strings, identifiers, comments and dollar quotes", () => {
    const sql = `select 'a;b', "c;d" from t; -- x;y
/* nested /* ; */ ; */ select E'it\\'s;'; create function f() returns int as $body$ select 1; $body$ language sql; select $1::int`;
    expect(splitStatements(sql).map((s) => s.text)).toEqual([
      `select 'a;b', "c;d" from t`,
      `-- x;y\n/* nested /* ; */ ; */ select E'it\\'s;'`,
      "create function f() returns int as $body$ select 1; $body$ language sql",
      "select $1::int",
    ]);
  });

  it("drops comment-only statements", () => {
    expect(splitStatements("-- just a comment\n;  ;select 1")).toHaveLength(1);
  });

  it("reports offsets into the original text", () => {
    const sql = "select 1;\n  select 2;";
    const [, second] = splitStatements(sql);
    expect(sql.slice(second.from, second.to)).toBe("select 2");
  });
});

describe("statementAt", () => {
  const sql = "select 1;\nselect 2;\n\nselect 3";
  it("finds the statement under the cursor", () => {
    expect(statementAt(sql, sql.indexOf("2"))?.text).toBe("select 2");
    expect(statementAt(sql, sql.length)?.text).toBe("select 3");
    expect(statementAt(sql, 0)?.text).toBe("select 1");
  });
});

describe("quoting", () => {
  it("escapes identifiers and literals", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
    expect(quoteLiteral(null)).toBe("NULL");
  });
  it("finds the leading keyword past comments", () => {
    expect(leadingKeyword("/* hi */ -- there\n  update t set a = 1")).toBe("UPDATE");
  });
});
