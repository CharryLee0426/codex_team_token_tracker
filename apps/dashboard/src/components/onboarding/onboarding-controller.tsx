"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import { useMe } from "@/hooks/use-me";
import { onboardingMode, TOUR_QUERY, trackerCommands } from "@/lib/onboarding";
import { OnboardingTour } from "./onboarding-tour";

/**
 * Decides when the guided tour opens and remembers that it did. It opens once per account — the
 * first dashboard visit after signing in, judged by `users.onboardedAt` — and on demand through
 * `?tour=1` (the Settings button). `NEXT_PUBLIC_ONBOARDING_TOUR=force` (`pnpm dev:tour`) opens it on
 * every load for design work; `off` disables the automatic opening.
 */
export function OnboardingController() {
  return (
    <Suspense fallback={null}>
      <Controller />
    </Suspense>
  );
}

function Controller() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const { me, ready } = useMe();
  const complete = useMutation(api.users.completeOnboarding);
  const devices = useQuery(api.usage.myDevices, ready ? {} : "skip");
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  // Closed stays closed for this page load, so `force` does not replay on every navigation.
  const shown = useRef(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const requested = params.get(TOUR_QUERY) === "1";
  const onDashboard = pathname?.startsWith("/dashboard") ?? false;
  const mode = onboardingMode();

  useEffect(() => {
    if (open) return;
    if (requested) {
      shown.current = true;
      setOpen(true);
      // Drop the flag so a reload does not replay the tour.
      const rest = new URLSearchParams(params.toString());
      rest.delete(TOUR_QUERY);
      const qs = rest.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? "/dashboard"), { scroll: false });
      return;
    }
    if (shown.current || !onDashboard || mode === "off") return;
    if (mode === "force" || (ready && me && !me.onboardedAt)) {
      shown.current = true;
      setOpen(true);
    }
  }, [open, requested, onDashboard, mode, ready, me, pathname, params, router]);

  const onClose = useCallback(() => {
    setOpen(false);
    // Finished or skipped both count: nobody wants to be asked twice.
    if (me && !me.onboardedAt) complete({}).catch((err) => console.warn("completeOnboarding failed", err));
  }, [me, complete]);

  const commands = trackerCommands(origin);
  return <OnboardingTour open={open} onClose={onClose} loginCommand={commands.login} runCommand={commands.run} userName={me?.name} deviceCount={devices?.length} />;
}
