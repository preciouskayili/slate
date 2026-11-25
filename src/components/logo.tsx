import { useId } from "react";
import { cn } from "@/lib/utils";

/** The Slate mark: a slate tile holding a data grid with one selected cell. Matches build/icon.svg. */
export function Logo({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3A3D44" />
          <stop offset="1" stopColor="#1C1E22" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5B97FF" />
          <stop offset="1" stopColor="#2F6BEB" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${id}t)`} />
      <rect x=".5" y=".5" width="31" height="31" rx="7" fill="none" stroke="#fff" strokeOpacity=".1" />
      <rect x="7" y="8" width="18" height="3.6" rx="1.4" fill="#fff" />
      <rect x="7" y="13.4" width="5.4" height="4.2" rx="1.3" fill="#fff" fillOpacity=".42" />
      <rect x="14.2" y="13.4" width="10.8" height="4.2" rx="1.3" fill={`url(#${id}c)`} />
      <rect x="7" y="19.4" width="5.4" height="4.2" rx="1.3" fill="#fff" fillOpacity=".42" />
      <rect x="14.2" y="19.4" width="10.8" height="4.2" rx="1.3" fill="#fff" fillOpacity=".24" />
    </svg>
  );
}
