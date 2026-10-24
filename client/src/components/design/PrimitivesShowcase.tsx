import { useState } from "react";
import { Inbox, Plus, Settings } from "lucide-react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { LabeledSwitch } from "@/components/ui/labeled-switch";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SeverityBadge } from "@/components/ui/severity-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Stepper } from "@/components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextField } from "@/components/ui/text-field";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const STAGES = ["Crawl", "Diagnose", "Fix", "Verify", "Ship"].map((l) => ({ id: l, label: l }));

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-xl">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function PrimitivesShowcase() {
  const [level, setLevel] = useState<"A" | "AA" | "AAA">("AA");
  const [auto, setAuto] = useState(true);
  const [url, setUrl] = useState("");
  const [step, setStep] = useState(2);
  const [loading, setLoading] = useState(false);

  return (
    <TooltipProvider>
      <div className="space-y-10">
        <Block id="p-btn" title="Button and IconButton">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 1500);
              }}
            >
              {loading ? "Scanning…" : "Click to load"}
            </Button>
            <Button variant="secondary" size="sm">
              <Plus /> Small
            </Button>
            <IconButton label="Settings" icon={<Settings />} />
            <IconButton label="Add item" variant="secondary" icon={<Plus />} />
          </div>
        </Block>

        <Block id="p-input" title="Input">
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label="Site URL"
              placeholder="https://shopeasy.dev"
              hint="Public http or https address."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <TextField
              label="With error"
              defaultValue="shopeasy"
              error="Enter a valid http(s) URL."
            />
            <TextField label="Disabled" disabled defaultValue="locked" />
          </div>
        </Block>

        <Block id="p-sw" title="Switch and SegmentedControl">
          <div className="flex flex-wrap items-start gap-8">
            <LabeledSwitch
              label="Auto-open PR when done"
              description="Ships validated fixes automatically."
              checked={auto}
              onCheckedChange={setAuto}
            />
            <LabeledSwitch label="Disabled switch" disabled />
            <SegmentedControl
              label="WCAG level"
              value={level}
              onValueChange={setLevel}
              options={[
                { value: "A", label: "A" },
                { value: "AA", label: "AA" },
                { value: "AAA", label: "AAA" },
              ]}
            />
          </div>
        </Block>

        <Block id="p-card" title="Card, Badge and Chip">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-surface">
              <CardHeader>
                <CardTitle>Accessibility score</CardTitle>
                <CardDescription>Before and after fixes</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <span className="tabular text-3xl font-semibold">42 → 91</span>
                <Badge>New</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Chip>WCAG 4.1.2</Chip>
                <Chip>AA</Chip>
              </CardContent>
            </Card>
            <div className="flex flex-wrap items-start gap-2">
              <SeverityBadge severity="critical" />
              <SeverityBadge severity="serious" />
              <SeverityBadge severity="moderate" />
              <SeverityBadge severity="minor" />
              <StatusChip status="validated" />
              <StatusChip status="rejected" />
              <StatusChip status="needs-review" />
            </div>
          </div>
        </Block>

        <Block id="p-ov" title="Tooltip, Dialog and Sheet">
          <div className="flex flex-wrap gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary">Hover or focus me</Button>
              </TooltipTrigger>
              <TooltipContent>Shown on hover and keyboard focus</TooltipContent>
            </Tooltip>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Open pull request?</DialogTitle>
                  <DialogDescription>
                    5 validated fixes in 3 files will be committed to a new branch.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="primary">Open PR</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Open bottom sheet</Button>
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>Issue detail</SheetTitle>
                  <SheetDescription>
                    Bottom sheet on mobile, side panel on desktop.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Button
              variant="secondary"
              onClick={() =>
                toast.success("Fix validated", { description: "axe-core: 0 violations remain." })
              }
            >
              Show toast
            </Button>
          </div>
        </Block>

        <Block id="p-tabs" title="Tabs and Accordion">
          <div className="grid gap-6 md:grid-cols-2">
            <Tabs defaultValue="before">
              <TabsList>
                <TabsTrigger value="before">Before</TabsTrigger>
                <TabsTrigger value="after">After</TabsTrigger>
              </TabsList>
              <TabsContent value="before" className="font-mono text-sm text-muted">
                &lt;div onclick="add()"&gt;
              </TabsContent>
              <TabsContent value="after" className="font-mono text-sm text-muted">
                &lt;button aria-label="Add to cart"&gt;
              </TabsContent>
            </Tabs>
            <Accordion type="single" collapsible defaultValue="p">
              <AccordionItem value="p">
                <AccordionTrigger>Perceivable (3)</AccordionTrigger>
                <AccordionContent>Alt text, contrast, captions.</AccordionContent>
              </AccordionItem>
              <AccordionItem value="o">
                <AccordionTrigger>Operable (2)</AccordionTrigger>
                <AccordionContent>Keyboard access, focus traps.</AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </Block>

        <Block id="p-load" title="Skeleton, ProgressBar, Stepper and EmptyState">
          <div className="space-y-6">
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="max-w-md space-y-3">
              <Progress aria-label="Pages scanned" value={60} />
              <Progress aria-label="Waiting for server" />
            </div>
            <div className="space-y-3">
              <Stepper steps={STAGES} current={step} />
              <Stepper steps={STAGES} current={3} failed />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  Back
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStep((s) => Math.min(STAGES.length, s + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
            <EmptyState
              as="h3"
              icon={<Inbox className="size-6" />}
              title="No scans yet"
              description="Paste a URL to run your first accessibility scan."
              action={<Button variant="primary">New scan</Button>}
            />
          </div>
        </Block>
      </div>
    </TooltipProvider>
  );
}
