import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glow";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border border-transparent hover:brightness-110 active:brightness-95",
  secondary: "bg-card border border-border-strong text-fg hover:bg-card-2 hover:border-border-strong",
  ghost: "bg-transparent border border-transparent text-fg-2 hover:bg-card-2 hover:text-fg",
  danger: "bg-transparent border border-border text-danger hover:bg-[rgba(208,59,59,0.08)]",
  // Landing CTA: accent fill with a soft halo that intensifies on hover.
  glow: "bg-accent text-accent-fg border border-transparent shadow-[0_0_0_1px_var(--accent-glow),0_10px_40px_-10px_var(--accent-glow)] hover:shadow-[0_0_0_1px_var(--accent-glow),0_14px_50px_-8px_var(--accent-glow)] hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  lg: "h-12 px-6 text-[15px] rounded-xl gap-2",
  icon: "h-10 w-10 rounded-xl",
  "icon-sm": "h-8 w-8 rounded-lg",
};

export function buttonClasses(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,box-shadow,filter,transform] duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClasses(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  href,
  children,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
