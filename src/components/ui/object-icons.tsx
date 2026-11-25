// Slate's own icons for database objects. Duotone: a currentColor outline plus a soft tint of the
// same colour, drawn on a 16px grid so they stay crisp at 14–16px. Generic UI controls stay on Phosphor.
import { cn } from "@/lib/utils";

type IconProps = { className?: string; style?: React.CSSProperties };

function Icon({ className, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", className)}
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const tint = { fill: "currentColor", fillOpacity: 0.18, stroke: "none" } as const;
const solid = { fill: "currentColor", stroke: "none" } as const;

export const TableIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 6.2V4.6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1.6z" {...tint} fillOpacity={0.3} />
    <rect x="2.5" y="2.6" width="11" height="10.8" rx="2" />
    <path d="M2.5 6.2h11M2.5 9.8h11M6.6 6.2v7.2" />
  </Icon>
);

export const ViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="2.6" width="11" height="10.8" rx="2" {...tint} />
    <rect x="2.5" y="2.6" width="11" height="10.8" rx="2" strokeDasharray="2.2 1.6" />
    <path d="M4.9 8.3c.9-1.5 1.9-2.2 3.1-2.2s2.2.7 3.1 2.2c-.9 1.5-1.9 2.2-3.1 2.2s-2.2-.7-3.1-2.2Z" />
    <circle cx="8" cy="8.3" r=".9" {...solid} />
  </Icon>
);

export const MatViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 2.4h6.6a2 2 0 0 1 2 2V11" opacity=".55" />
    <rect x="2.4" y="4.8" width="9.6" height="8.8" rx="1.8" {...tint} />
    <rect x="2.4" y="4.8" width="9.6" height="8.8" rx="1.8" />
    <path d="M2.4 7.8H12M5.9 7.8v5.8" />
  </Icon>
);

export const FunctionIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3" {...tint} />
    <path d="M10.4 4.6c-.4-.3-.9-.4-1.3-.3-.7.1-1.1.7-1.3 1.4L6.6 11c-.2.7-.6 1.2-1.3 1.3-.4.1-.9 0-1.3-.3M5.6 7.2h4" />
  </Icon>
);

export const EnumIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3" {...tint} />
    <circle cx="5.4" cy="5.6" r=".95" {...solid} />
    <circle cx="5.4" cy="8" r=".95" {...solid} />
    <circle cx="5.4" cy="10.4" r=".95" {...solid} />
    <path d="M7.8 5.6h3.2M7.8 8h3.2M7.8 10.4h2" />
  </Icon>
);

export const QueryIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.2" y="2.6" width="11.6" height="10.8" rx="2.4" {...tint} />
    <rect x="2.2" y="2.6" width="11.6" height="10.8" rx="2.4" />
    <path d="m5 6.4 1.9 1.6L5 9.6M8.6 10h2.4" />
  </Icon>
);

export const DatabaseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 4.2v7.6c0 1.1 2.2 2 5 2s5-.9 5-2V4.2" {...tint} />
    <ellipse cx="8" cy="4.2" rx="5" ry="2" {...tint} fillOpacity={0.35} />
    <ellipse cx="8" cy="4.2" rx="5" ry="2" />
    <path d="M3 4.2v7.6c0 1.1 2.2 2 5 2s5-.9 5-2V4.2M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
  </Icon>
);

export const SchemaIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 5.2v6.2a2 2 0 0 0 2 2h7.2a2 2 0 0 0 2-2V6.8a2 2 0 0 0-2-2H8.3L7 3.2a1.6 1.6 0 0 0-1.2-.6H4.4a2 2 0 0 0-2 2z" {...tint} />
    <path d="M2.4 5.2v6.2a2 2 0 0 0 2 2h7.2a2 2 0 0 0 2-2V6.8a2 2 0 0 0-2-2H8.3L7 3.2a1.6 1.6 0 0 0-1.2-.6H4.4a2 2 0 0 0-2 2z" />
  </Icon>
);

/** Colour per object kind, tuned to read on both the light and graphite dark themes. */
export const KIND_COLOR = {
  table: "rgb(var(--kind-table))",
  view: "rgb(var(--kind-view))",
  materialized: "rgb(var(--kind-matview))",
  function: "rgb(var(--kind-function))",
  enum: "rgb(var(--kind-enum))",
  query: "rgb(var(--kind-query))",
} as const;

export type RelationKind = "table" | "partitioned" | "foreign" | "view" | "materialized";

export function RelationIcon({ kind, className, muted }: { kind: RelationKind; className?: string; muted?: boolean }) {
  const style = muted ? undefined : { color: kind === "view" ? KIND_COLOR.view : kind === "materialized" ? KIND_COLOR.materialized : KIND_COLOR.table };
  if (kind === "view") return <ViewIcon className={className} style={style} />;
  if (kind === "materialized") return <MatViewIcon className={className} style={style} />;
  return <TableIcon className={className} style={style} />;
}
