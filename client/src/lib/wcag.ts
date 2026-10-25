import type { Issue, Severity } from "@/lib/types";
import { emptyCounters } from "@/lib/score";

export const PRINCIPLES = [
  { id: "1", name: "Perceivable" },
  { id: "2", name: "Operable" },
  { id: "3", name: "Understandable" },
  { id: "4", name: "Robust" },
] as const;

export const principleOf = (sc: string) =>
  PRINCIPLES.find((p) => p.id === sc.split(".")[0]) ?? PRINCIPLES[3];

const SLUGS: Record<string, string> = {
  "1.1.1": "non-text-content",
  "1.3.1": "info-and-relationships",
  "1.4.3": "contrast-minimum",
  "2.1.1": "keyboard",
  "2.1.2": "no-keyboard-trap",
  "2.4.3": "focus-order",
  "2.4.4": "link-purpose-in-context",
  "2.4.7": "focus-visible",
  "3.3.2": "labels-or-instructions",
  "4.1.2": "name-role-value",
};

export const understandingUrl = (sc: string) =>
  SLUGS[sc]
    ? `https://www.w3.org/WAI/WCAG22/Understanding/${SLUGS[sc]}.html`
    : "https://www.w3.org/WAI/WCAG22/quickref/";

export const RULE_TITLES: Record<string, { title: string; description: string }> = {
  "button-name": {
    title: "Button has no accessible name",
    description: "Interactive controls need a native role, keyboard access and an accessible name.",
  },
  "color-contrast": {
    title: "Insufficient colour contrast",
    description: "Text must have a contrast ratio of at least 4.5:1 against its background.",
  },
  "image-alt": {
    title: "Image missing alternative text",
    description: "Informative images need a text alternative; decorative images need an empty alt.",
  },
  label: {
    title: "Form input has no label",
    description: "Every form control needs a programmatic label; placeholders are not labels.",
  },
  "keyboard-trap": {
    title: "Keyboard focus trap",
    description: "Keyboard users must be able to move focus out of every component.",
  },
  "click-events-have-key-events": {
    title: "Click handler on a non-interactive element",
    description: "Use a native button or link, or add a role, tabindex and key handler.",
  },
  "html-has-lang": {
    title: "Page language is not set",
    description: "The lang attribute lets screen readers choose the right pronunciation.",
  },
  "frame-title": {
    title: "Frame has no title",
    description: "Iframes need a title that describes their content.",
  },
  tabindex: {
    title: "Positive tabindex",
    description: "A tabindex above 0 overrides the natural tab order. Fix the DOM order instead.",
  },
  "video-caption": {
    title: "Video has no captions",
    description: "Prerecorded video with audio needs synchronized captions.",
  },
  "meta-viewport": {
    title: "Zoom is disabled",
    description: "Do not block pinch-zoom with user-scalable=no or maximum-scale=1.",
  },
  "link-name": {
    title: "Link has no accessible name",
    description: "Links need discernible text so their purpose is announced.",
  },
};
export const ruleTitle = (id: string) => {
  const t = RULE_TITLES[id]?.title;
  if (t) return t;
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const c = emptyCounters();
  for (const i of issues) c[i.impact] += 1;
  return c;
}
