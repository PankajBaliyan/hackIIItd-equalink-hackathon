import ReactDiffViewer from "react-diff-viewer-continued";

import { useMediaQuery } from "@/hooks/use-media-query";

/** Token-driven diff. Split view on lg+, unified below; scrolls inside its own focusable region. */
export default function DiffViewer({ before, after }: { before: string; after: string }) {
  const split = useMediaQuery("(min-width: 1024px)");
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Code diff"
      className="overflow-x-auto rounded-card border text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ReactDiffViewer
        oldValue={before}
        newValue={after}
        splitView={split}
        hideLineNumbers={false}
        leftTitle="Before"
        rightTitle="After"
        useDarkTheme={false}
        styles={{
          variables: {
            light: {
              diffViewerBackground: "var(--surface)",
              diffViewerColor: "var(--text)",
              addedBackground: "color-mix(in oklab, var(--success) 18%, var(--surface))",
              addedColor: "var(--text)",
              removedBackground: "color-mix(in oklab, var(--critical) 18%, var(--surface))",
              removedColor: "var(--text)",
              wordAddedBackground: "color-mix(in oklab, var(--success) 38%, var(--surface))",
              wordRemovedBackground: "color-mix(in oklab, var(--critical) 38%, var(--surface))",
              addedGutterBackground: "color-mix(in oklab, var(--success) 25%, var(--surface))",
              removedGutterBackground: "color-mix(in oklab, var(--critical) 25%, var(--surface))",
              gutterBackground: "var(--surface-2)",
              gutterBackgroundDark: "var(--surface-2)",
              gutterColor: "var(--muted-c)",
              codeFoldBackground: "var(--surface-2)",
              codeFoldGutterBackground: "var(--surface-2)",
              codeFoldContentColor: "var(--muted-c)",
              emptyLineBackground: "var(--surface)",
              diffViewerTitleBackground: "var(--surface-2)",
              diffViewerTitleColor: "var(--text)",
              diffViewerTitleBorderColor: "var(--border-c)",
            },
          },
          contentText: { fontFamily: "var(--font-mono)", fontSize: "13px" },
        }}
      />
    </div>
  );
}
