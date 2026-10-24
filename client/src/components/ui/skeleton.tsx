import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("skeleton-shimmer rounded-md motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Skeleton };
