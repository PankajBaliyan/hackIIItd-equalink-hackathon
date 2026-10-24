import { Toaster as Sonner } from "sonner";

import { useTheme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      className="toaster group"
      // sonner renders an aria-live region; keyboard: Alt+T focuses the toast stack
      theme={theme}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-text group-[.toaster]:border-border group-[.toaster]:shadow-soft",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-brand group-[.toast]:text-brand-fg",
          cancelButton: "group-[.toast]:bg-surface-2 group-[.toast]:text-muted",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
