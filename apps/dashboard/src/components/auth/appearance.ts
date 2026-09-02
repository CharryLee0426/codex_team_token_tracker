import type { SignIn } from "@clerk/nextjs";

type ClerkAppearance = NonNullable<React.ComponentProps<typeof SignIn>["appearance"]>;

/**
 * Strips Clerk's own card chrome so the widget sits *inside* the aperture frame rather than being a
 * second card on top of it, and restyles the controls with the dashboard's tokens (14px rhythm,
 * 12px radii, mono eyebrows). Merged over the global appearance set in `providers.tsx`.
 */
export const authAppearance: ClerkAppearance = {
  layout: {
    socialButtonsPlacement: "top",
    socialButtonsVariant: "blockButton",
    shimmer: true,
  },
  elements: {
    // `!` because the global appearance in `providers.tsx` gives every Clerk surface a card border
    // and background; here the aperture frame is the surface, so Clerk's own chrome must yield.
    rootBox: "w-full",
    cardBox: "w-full rounded-none! border-0! bg-transparent! shadow-none!",
    card: "w-full rounded-none! border-0! bg-transparent! px-5 py-6 shadow-none! sm:px-7",
    header: "gap-1",
    headerTitle: "text-[17px] font-semibold tracking-tight",
    headerSubtitle: "text-[13px]",
    socialButtonsBlockButton:
      "h-10 rounded-xl border-border bg-[color-mix(in_srgb,var(--card-2)_70%,transparent)] transition-[background-color,border-color] hover:border-border-strong",
    socialButtonsBlockButtonText: "text-[13px] font-medium",
    dividerLine: "bg-border",
    dividerText: "font-mono text-[10.5px] uppercase tracking-[0.16em]",
    formFieldLabel: "text-[12px] font-medium",
    formFieldInput: "h-10 rounded-xl border-border bg-[color-mix(in_srgb,var(--bg-2)_70%,transparent)]!",
    formButtonPrimary:
      "h-10 rounded-xl text-[13px] font-semibold tracking-tight normal-case shadow-[0_10px_34px_-14px_var(--accent-glow)] transition-[filter,box-shadow] hover:brightness-110",
    formButtonReset: "text-[13px]",
    otpCodeFieldInput: "rounded-xl border-border",
    identityPreview: "rounded-xl border border-border bg-[color-mix(in_srgb,var(--card-2)_60%,transparent)]",
    alert: "rounded-xl border-border",
    // Clerk tints its footer with a background *image*, so `bg-transparent` alone leaves a band.
    footer: "border-0! bg-transparent! bg-none!",
    footerAction: "bg-transparent!",
    footerActionText: "text-[12px]",
    footerActionLink: "text-[12px] font-medium",
    footerPages: "text-[11px]",
  },
};
