import { cn } from "../lib/cn";

/**
 * Doble brand mark: a circle split into a filled half and an outlined half —
 * "tú" y "tu doble". Rendered inside an emerald chip.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500 shadow-sm",
        className
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-950" fill="none">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2.2" />
        <path d="M12 4 A8 8 0 0 1 12 20 Z" fill="currentColor" />
      </svg>
    </span>
  );
}
