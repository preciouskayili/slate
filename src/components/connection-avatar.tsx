import type { Connection } from "@shared/types";
import { connectionColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** A connection's identity: a small square in its colour with its initial, like a workspace avatar. */
export function ConnectionAvatar({ connection, className }: { connection: Pick<Connection, "name" | "color">; className?: string }) {
  const initial = (connection.name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  return (
    <span
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-[5px] text-[10.5px] font-semibold text-white", className)}
      style={{ background: connectionColor(connection.color) }}
    >
      {initial}
    </span>
  );
}
