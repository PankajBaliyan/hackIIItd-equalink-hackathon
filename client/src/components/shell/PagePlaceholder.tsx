import { useEffect, useRef } from "react";
import { Sparkles, Clock } from "lucide-react";
import type { NavItem } from "@/lib/nav";

export function FocusHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={className ?? "text-3xl outline-none"}>
      {children}
    </h1>
  );
}

export function PagePlaceholder({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <section className="relative overflow-hidden rounded-card border bg-surface p-6 shadow-soft md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-gradient opacity-15 blur-3xl"
      />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-11 place-items-center rounded-[10px] border bg-surface-2 text-brand-2">
            <Icon aria-hidden className="size-5" />
          </span>
          <span className="rounded-full border px-2.5 py-0.5 font-mono text-xs text-muted">
            Tier {item.tier}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-muted">
            {item.soon ? (
              <Clock aria-hidden className="size-3" />
            ) : (
              <Sparkles aria-hidden className="size-3" />
            )}
            {item.soon ? "Coming soon" : `Built in ${item.phase}`}
          </span>
        </div>
        <div className="max-w-2xl space-y-3">
          <FocusHeading>{item.label}</FocusHeading>
          <p className="text-lg text-muted">{item.description}</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-muted">
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          agent idle · awaiting implementation
        </div>
      </div>
    </section>
  );
}
