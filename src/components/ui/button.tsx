import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-fg text-canvas hover:bg-fg/90",
        accent: "bg-accent text-white hover:bg-accent/90",
        secondary: "bg-surface-hover text-fg/90 hover:bg-surface-strong",
        ghost: "text-fg/60 hover:bg-surface-hover hover:text-fg",
        outline: "bg-surface text-fg/80 hover:bg-surface-hover",
        danger: "bg-danger/12 text-danger hover:bg-danger/20",
        dangerSolid: "bg-danger text-white hover:bg-danger/90",
      },
      size: {
        default: "h-8 px-3 text-sm",
        sm: "h-7 px-2.5 text-xs",
        xs: "h-6 px-2 text-2xs",
        lg: "h-9 px-4 text-base",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-xs": "size-6",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
