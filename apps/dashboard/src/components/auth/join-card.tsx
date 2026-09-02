"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, LinkIcon, TriangleAlert } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton, buttonClasses } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { invitePath, type InviteStatus } from "@/lib/invite";

interface Props {
  code: string;
  status: InviteStatus;
  orgName: string | null;
  orgImageUrl: string | null;
  memberCount: number;
  role: string | null;
}

type Phase = { kind: "idle" } | { kind: "joining" } | { kind: "joined"; alreadyMember: boolean } | { kind: "error"; message: string };

/** The action side of an invite link: sign in if needed, then redeem through `/api/join`. */
export function JoinCard({ code, status, orgName, orgImageUrl, memberCount, role }: Props) {
  const t = useTranslations("join");
  const tc = useTranslations("common");
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { setActive } = useOrganizationList();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  if (status !== "valid") {
    return (
      <div className="px-5 py-7 text-center sm:px-7">
        <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[rgba(250,178,25,0.14)] text-warning">
          <TriangleAlert size={20} />
        </div>
        <h2 className="text-[17px] font-semibold tracking-tight text-fg">{t("invalidTitle")}</h2>
        <p className="mx-auto mt-2 max-w-xs text-[13px] text-fg-2">{t(`errors.${status}`)}</p>
        <LinkButton href="/" variant="secondary" size="md" className="mt-6">
          {t("backHome")}
        </LinkButton>
      </div>
    );
  }

  async function join() {
    setPhase({ kind: "joining" });
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; organizationId?: string; alreadyMember?: boolean };
      if (!res.ok || !body.ok) {
        const key = body.error && ["not_found", "expired", "revoked", "exhausted"].includes(body.error) ? body.error : "generic";
        setPhase({ kind: "error", message: t(`errors.${key}`) });
        return;
      }
      // Make the organization active so the dashboard opens on the team the link was for.
      if (setActive && body.organizationId) await setActive({ organization: body.organizationId }).catch(() => {});
      setPhase({ kind: "joined", alreadyMember: !!body.alreadyMember });
      router.refresh();
    } catch {
      setPhase({ kind: "error", message: t("errors.generic") });
    }
  }

  return (
    <div className="px-5 py-7 sm:px-7">
      <div className="flex flex-col items-center text-center">
        <Avatar name={orgName} src={orgImageUrl} size={52} />
        <h2 className="mt-4 text-lg font-semibold tracking-tight text-fg">{orgName ?? tc("unknown")}</h2>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          <Badge variant="muted">{t("memberCount", { count: memberCount })}</Badge>
          <Badge variant={role === "org:admin" ? "accent" : "default"}>{t(role === "org:admin" ? "roleAdmin" : "roleMember")}</Badge>
        </div>
      </div>

      <div className="mt-6">
        {!isLoaded ? (
          <Skeleton className="h-10 rounded-xl" />
        ) : phase.kind === "joined" ? (
          <div className="text-center">
            <p className="mb-4 inline-flex items-center gap-2 text-[13px] font-medium text-success">
              <Check size={15} />
              {t(phase.alreadyMember ? "alreadyMember" : "joined", { org: orgName ?? "" })}
            </p>
            <LinkButton href="/dashboard/team" variant="primary" size="md" className="w-full">
              {t("openTeam")}
              <ArrowRight size={15} />
            </LinkButton>
          </div>
        ) : isSignedIn ? (
          <>
            <Button variant="primary" size="md" className="w-full" onClick={join} disabled={phase.kind === "joining"}>
              {phase.kind === "joining" ? t("joining") : t("cta")}
            </Button>
            {phase.kind === "error" ? (
              <p className="mt-3 text-center text-[12.5px] text-danger" role="alert">
                {phase.message}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <a href={`/sign-up?redirect_url=${encodeURIComponent(invitePath(code))}`} className={buttonClasses("primary", "md", "w-full")}>
              {t("signUpCta")}
            </a>
            <a href={`/sign-in?redirect_url=${encodeURIComponent(invitePath(code))}`} className={buttonClasses("secondary", "md", "mt-2 w-full")}>
              {t("signInCta")}
            </a>
            <p className="mt-3 text-center text-[12px] text-muted">{t("signedOutHint")}</p>
          </>
        )}
      </div>

      <p className="mt-6 flex items-center justify-center gap-1.5 border-t border-border pt-4 font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase">
        <LinkIcon size={11} />
        {code}
      </p>
    </div>
  );
}
