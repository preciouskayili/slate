// Types shared by the local server and the web client.

export type SslMode = "disable" | "prefer" | "require" | "verify-full";

export interface ConnectionInput {
  name: string;
  color: string;
  host: string;
  port: number;
  database: string;
  user: string;
  /** Omitted on update means "keep the stored password". Empty string clears it. */
  password?: string;
  ssl: SslMode;
  readOnly: boolean;
}

export interface Connection extends Omit<ConnectionInput, "password"> {
  id: string;
  hasPassword: boolean;
  createdAt: string;
}

export type RelationKind = "table" | "view" | "materialized" | "foreign" | "partitioned";

export interface RelationSummary {
  schema: string;
  name: string;
  kind: RelationKind;
  rowEstimate: number | null;
  bytes: number | null;
  comment: string | null;
}

export interface RoutineSummary {
  schema: string;
  name: string;
  args: string;
  returns: string;
  kind: "function" | "procedure" | "aggregate" | "window";
}

export interface EnumSummary {
  schema: string;
  name: string;
  values: string[];
}

export interface SchemaTree {
  schemas: string[];
  relations: RelationSummary[];
  routines: RoutineSummary[];
  enums: EnumSummary[];
  sequences: { schema: string; name: string }[];
  /** Column names keyed by `schema.table`, for editor autocomplete. */
  columns: Record<string, string[]>;
}

export interface ColumnInfo {
  name: string;
  /** Formatted type, e.g. `character varying(255)` */
  type: string;
  /** Base type name for UI decisions, e.g. `varchar`, `int4`, `jsonb`, `_text` */
  udt: string;
  /** pg_type.typcategory: B boolean, N numeric, S string, D datetime, U user, A array, E enum ... */
  category: string;
  nullable: boolean;
  default: string | null;
  identity: "always" | "by default" | null;
  generated: boolean;
  isPrimaryKey: boolean;
  comment: string | null;
  enumValues: string[] | null;
  position: number;
}

export interface ForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface IndexInfo {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
  bytes: number | null;
}

export interface ConstraintInfo {
  name: string;
  type: "primary" | "unique" | "check" | "foreign" | "exclusion" | "other";
  definition: string;
}

export interface TableDetails {
  schema: string;
  name: string;
  kind: RelationKind;
  comment: string | null;
  rowEstimate: number | null;
  bytes: number | null;
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  referencedBy: (ForeignKey & { schema: string; table: string })[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  triggers: { name: string; definition: string; enabled: boolean }[];
  ddl: string;
  /** Rows can be updated/deleted (table with PK, or a plain table addressed by ctid). */
  editable: boolean;
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "not_contains"
  | "starts"
  | "ends"
  | "in"
  | "not_in"
  | "null"
  | "not_null"
  | "true"
  | "false"
  | "regex";

export interface Filter {
  id: string;
  column: string;
  op: FilterOperator;
  value: string;
  enabled: boolean;
}

export interface Sort {
  column: string;
  dir: "asc" | "desc";
}

export interface RowsRequest {
  database?: string;
  schema: string;
  table: string;
  filters: Filter[];
  match: "all" | "any";
  /** Raw SQL appended as an extra WHERE condition (advanced). */
  where?: string;
  search?: string;
  sort: Sort[];
  limit: number;
  offset: number;
}

export interface FieldInfo {
  name: string;
  typeId: number;
  type: string;
}

export type Cell = string | null;

export interface RowsResponse {
  fields: FieldInfo[];
  rows: Cell[][];
  /** Row locator per row: ctid when the table has no primary key. */
  ctids: (string | null)[];
  /** null when an exact count timed out and no estimate applies. */
  total: number | null;
  totalIsEstimate: boolean;
  ms: number;
  sql: string;
}

export type RowKey = Record<string, Cell>;

export type Mutation =
  | { kind: "update"; key: RowKey; values: Record<string, Cell> }
  | { kind: "insert"; values: Record<string, Cell> }
  | { kind: "delete"; key: RowKey };

export interface MutateRequest {
  database?: string;
  schema: string;
  table: string;
  mutations: Mutation[];
  /** Only build SQL; do not execute. */
  dryRun?: boolean;
}

export interface MutateResponse {
  sql: string[];
  affected: number;
}

export interface QueryRequest {
  database?: string;
  sql: string;
  queryId: string;
  maxRows?: number;
}

export interface QueryResultSet {
  command: string;
  rowCount: number | null;
  fields: FieldInfo[];
  rows: Cell[][];
  truncated: boolean;
}

export interface QueryResponse {
  results: QueryResultSet[];
  notices: string[];
  ms: number;
}

export interface ApiError {
  error: string;
  detail?: string;
  hint?: string;
  position?: number;
  code?: string;
}

export interface SavedQuery {
  id: string;
  connectionId: string | null;
  name: string;
  sql: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  connectionId: string;
  database: string;
  sql: string;
  ok: boolean;
  ms: number;
  rows: number | null;
  at: string;
}
