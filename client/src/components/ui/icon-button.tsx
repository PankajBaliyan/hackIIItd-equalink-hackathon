import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

/** a11y: icon-only control, so `label` is required and becomes the accessible name. */
export interface IconButtonProps extends Omit<ButtonProps, "size" | "children"> {
  label: string;
  icon: React.ReactNode;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, variant = "ghost", title, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
    </Button>
  ),
);
IconButton.displayName = "IconButton";

export { IconButton };
