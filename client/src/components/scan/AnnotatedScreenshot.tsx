import { ImageIcon } from "lucide-react";

export interface IssueBox {
  issueId: string;
  /** Percent coordinates relative to the screenshot. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** P1 slot: component API only. Renders a placeholder until `src` is provided by the backend. */
export function AnnotatedScreenshot({
  src,
  alt,
  boxes = [],
}: {
  src?: string;
  alt?: string;
  boxes?: IssueBox[];
}) {
  if (!src) {
    return (
      <div className="grid h-48 place-items-center rounded-card border border-dashed bg-surface text-center text-sm text-muted">
        <p className="flex items-center gap-2">
          <ImageIcon aria-hidden className="size-4" /> Annotated screenshot arrives with the P1
          crawl
        </p>
      </div>
    );
  }
  return (
    <figure className="relative overflow-hidden rounded-card border">
      <img src={src} alt={alt ?? "Screenshot of the scanned page"} className="w-full" />
      {boxes.map((b) => (
        <span
          key={b.issueId}
          title={b.label}
          className="absolute rounded-sm border-2 border-critical"
          style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
        />
      ))}
    </figure>
  );
}
