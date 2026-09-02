import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { CalendarClock, KeyRound, UserPlus } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import { AuthShell } from "@/components/auth/auth-shell";
import { JoinCard } from "@/components/auth/join-card";
import { daysLeft, type InviteStatus } from "@/lib/invite";

/** The invite ledger changes under us; never cache a link's state. */
export const dynamic = "force-dynamic";

type Preview = {
  status: InviteStatus;
  org: { name: string; imageUrl: string | null; memberCount: number } | null;
  expiresAt: number | null;
  remaining: number | null;
  role: string | null;
};

const MISSING: Preview = { status: "not_found", org: null, expiresAt: null, remaining: null, role: null };

async function loadPreview(code: string): Promise<Preview> {
  try {
    return (await fetchQuery(api.orgInvites.preview, { code })) as Preview;
  } catch (err) {
    // A misconfigured or unreachable Convex deployment should read as a dead link, not a 500.
    console.error("invite preview failed", err);
    return MISSING;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const [{ code }, t] = await Promise.all([params, getTranslations("join")]);
  const preview = await loadPreview(code);
  return {
    title: preview.org ? t("metaTitle", { org: preview.org.name }) : t("invalidTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [preview, t] = await Promise.all([loadPreview(code), getTranslations("join")]);
  const valid = preview.status === "valid" && preview.org;

  const facts = valid
    ? [
        {
          Icon: CalendarClock,
          label: t("expiresIn", { days: daysLeft(preview.expiresAt ?? 0, Date.now()) }),
        },
        {
          Icon: UserPlus,
          label: preview.remaining === null ? t("unlimitedSeats") : t("seatsLeft", { count: preview.remaining }),
        },
        { Icon: KeyRound, label: t(preview.role === "org:admin" ? "roleAdminHint" : "roleMemberHint") },
      ]
    : [];

  return (
    <AuthShell
      eyebrow={t("eyebrow")}
      title={valid ? t("headline", { org: preview.org!.name }) : t("invalidTitle")}
      lead={valid ? t("lead") : t("invalidLead")}
      aside={
        valid ? (
          <ul className="stagger mt-8 grid gap-2.5 sm:max-w-sm">
            {facts.map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-[13px] text-fg-2">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon size={14} />
                </span>
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-8" />
        )
      }
    >
      <JoinCard
        code={code}
        status={preview.status}
        orgName={preview.org?.name ?? null}
        orgImageUrl={preview.org?.imageUrl ?? null}
        memberCount={preview.org?.memberCount ?? 0}
        role={preview.role}
      />
    </AuthShell>
  );
}
