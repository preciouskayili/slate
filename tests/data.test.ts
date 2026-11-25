import { describe, expect, it } from "vitest";
import type { TableDetails } from "../shared/types";
import { buildMutations, buildWhere, csvCell } from "../server/data";

const table = {
  schema: "app",
  name: "users",
  kind: "table",
  primaryKey: ["id"],
  columns: [
    { name: "id", type: "uuid", udt: "uuid", generated: false, identity: null },
    { name: "email", type: "text", udt: "text", generated: false, identity: null },
    { name: "avatar", type: "bytea", udt: "bytea", generated: false, identity: null },
    { name: "full", type: "text", udt: "text", generated: true, identity: null },
  ],
} as unknown as TableDetails;

describe("buildWhere", () => {
  it("parameterises filter values and escapes LIKE wildcards", () => {
    const where = buildWhere(
      { filters: [{ id: "1", column: "email", op: "contains", value: "50%_off", enabled: true }], match: "all", search: "", where: "" },
      table,
    );
    expect(where.sql).toBe(` WHERE "email"::text ILIKE $1`);
    expect(where.params).toEqual(["%50\\%\\_off%"]);
  });

  it("combines filters with OR for match=any, then search and raw SQL with AND", () => {
    const where = buildWhere(
      {
        filters: [
          { id: "1", column: "email", op: "null", value: "", enabled: true },
          { id: "2", column: "id", op: "in", value: "a, b", enabled: true },
          { id: "3", column: "email", op: "eq", value: "skip", enabled: false },
        ],
        match: "any",
        search: "x",
        where: "1 = 1",
      },
      table,
    );
    expect(where.sql).toBe(` WHERE ("email" IS NULL OR "id"::text = ANY($1::text[])) AND ("id"::text ILIKE $2 OR "email"::text ILIKE $2 OR "full"::text ILIKE $2) AND (1 = 1)`);
    expect(where.params).toEqual([["a", "b"], "%x%"]);
  });

  it("rejects unknown columns", () => {
    expect(() => buildWhere({ filters: [{ id: "1", column: "nope", op: "eq", value: "1", enabled: true }], match: "all" }, table)).toThrow(/Unknown column/);
  });
});

describe("buildMutations", () => {
  it("builds parameterised statements keyed by primary key", () => {
    const [update, insert, del] = buildMutations(
      {
        schema: "app",
        table: "users",
        mutations: [
          { kind: "update", key: { id: "u1" }, values: { email: "a@example.test" } },
          { kind: "insert", values: {} },
          { kind: "delete", key: { id: "u2" } },
        ],
      },
      table,
      false,
    );
    expect(update).toEqual({ text: `UPDATE "app"."users" SET "email" = $1 WHERE "id" = $2`, params: ["a@example.test", "u1"], expectOne: true });
    expect(insert.text).toBe(`INSERT INTO "app"."users" DEFAULT VALUES`);
    expect(del).toEqual({ text: `DELETE FROM "app"."users" WHERE "id" = $1`, params: ["u2"], expectOne: true });
  });

  it("inlines literals for previews", () => {
    const [stmt] = buildMutations({ schema: "app", table: "users", mutations: [{ kind: "update", key: { id: "1" }, values: { email: "O'Hara", avatar: null } }] }, table, true);
    expect(stmt.text).toBe(`UPDATE "app"."users" SET "email" = 'O''Hara', "avatar" = NULL WHERE "id" = '1'`);
  });

  it("refuses non-key filters, unknown and generated columns", () => {
    const run = (m: Parameters<typeof buildMutations>[0]["mutations"][number]) => () => buildMutations({ schema: "app", table: "users", mutations: [m] }, table, false);
    expect(run({ kind: "delete", key: { email: "x" } })).toThrow(/primary key/);
    expect(run({ kind: "update", key: { id: "1" }, values: { nope: "x" } })).toThrow(/Unknown column/);
    expect(run({ kind: "update", key: { id: "1" }, values: { full: "x" } })).toThrow(/generated/);
  });
});

describe("csvCell", () => {
  it("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
});
