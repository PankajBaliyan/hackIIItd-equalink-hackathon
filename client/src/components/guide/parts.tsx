import { FocusHeading } from "@/components/shell/PagePlaceholder";

export function DocHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <header className="space-y-2">
      <FocusHeading className="text-4xl font-semibold outline-none">{title}</FocusHeading>
      <p className="text-lg text-muted">{intro}</p>
    </header>
  );
}

/** Jump links to the sections of the current page. */
export function PageToc({ sections }: { sections: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label="On this page">
      <ul className="flex flex-wrap gap-2 text-sm">
        {sections.map(([id, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="inline-flex min-h-11 items-center rounded-full border px-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-3">
      <h2 id={`${id}-h`} className="text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Table({ head, rows }: { head: string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className="overflow-x-auto rounded-card border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.join("|")} className="border-t">
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-2 text-left font-mono font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="px-3 py-2">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
