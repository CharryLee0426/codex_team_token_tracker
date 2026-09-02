"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Link2, Plus, Trash2 } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useNow } from "@/hooks/use-now";
import { fmtRelative } from "@/lib/format";
import { INVITE_DAY_OPTIONS, INVITE_SEAT_OPTIONS, inviteUrl } from "@/lib/invite";
import { cn } from "@/lib/utils";

export interface InviteRow {
  id: Id<"orgInvites">;
  code: string;
  role: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  remaining: number | null;
  status: "valid" | "expired" | "revoked" | "exhausted";
}

const STATUS_VARIANT = { valid: "success", expired: "muted", revoked: "danger", exhausted: "warning" } as const;

interface PanelProps {
  invites: InviteRow[] | undefined;
  onCreate: (args: { days: number; maxUses: number; role: string }) => Promise<{ code: string }>;
  onRevoke: (id: Id<"orgInvites">) => void;
}

/**
 * Admin panel for reusable join links. Clerk's own invitations are per-email; these are the
 * paste-into-a-group-chat kind, so the controls that matter are the two that bound the blast radius:
 * how long the link lives and how many people it will let in.
 *
 * Presentational, like `MembersTable`, so the design harness can render it without a session;
 * `InviteLinks` wires it to Convex.
 */
export function InviteLinksPanel({ invites, onCreate, onRevoke }: PanelProps) {
  const t = useTranslations("invites");
  const locale = useLocale();
  const now = useNow(30_000);

  const [days, setDays] = useState<string>("7");
  const [seats, setSeats] = useState<string>("0");
  const [role, setRole] = useState<string>("org:member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const invite = await onCreate({ days: Number(days), maxUses: Number(seats), role });
      setJustCreated(invite.code);
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as { code?: string })?.code : undefined;
      setError(code === "FORBIDDEN" || code === "ORG_MISMATCH" ? t("errors.forbidden") : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CardHeader title={t("title")} hint={t("hint")} />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-[color-mix(in_srgb,var(--card-2)_55%,transparent)] p-3 lg:flex-row lg:items-end">
          <Field label={t("expiry")}>
            <Segmented
              ariaLabel={t("expiry")}
              value={days}
              onChange={setDays}
              options={INVITE_DAY_OPTIONS.map((d) => ({ value: String(d), label: t("dayShort", { count: d }) }))}
            />
          </Field>
          <Field label={t("seats")}>
            <Segmented
              ariaLabel={t("seats")}
              value={seats}
              onChange={setSeats}
              options={INVITE_SEAT_OPTIONS.map((s) => ({ value: String(s), label: s === 0 ? t("unlimitedShort") : String(s) }))}
            />
          </Field>
          <Field label={t("role")}>
            <Segmented
              ariaLabel={t("role")}
              value={role}
              onChange={setRole}
              options={[
                { value: "org:member", label: t("roleMember") },
                { value: "org:admin", label: t("roleAdmin") },
              ]}
            />
          </Field>
          <Button variant="primary" size="md" onClick={create} disabled={busy} className="lg:ml-auto">
            <Plus size={15} />
            {busy ? t("creating") : t("create")}
          </Button>
        </div>

        {error ? (
          <p className="mt-2 text-[12.5px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {justCreated ? <InviteUrlBar code={justCreated} /> : null}

        <div className="mt-4">
          {invites === undefined ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !invites.length ? (
            <EmptyState icon={<Link2 size={18} />} title={t("empty")} body={t("emptyBody")} />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{t("link")}</Th>
                    <Th>{t("status")}</Th>
                    <Th>{t("role")}</Th>
                    <Th right>{t("uses")}</Th>
                    <Th>{t("expires")}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => (
                    <tr key={invite.id} className="hover:bg-card-2/60">
                      <Td primary>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[12.5px] tracking-[0.08em] text-fg">{invite.code}</span>
                          <CopyButton code={invite.code} />
                        </span>
                      </Td>
                      <Td label={t("status")}>
                        <Badge variant={STATUS_VARIANT[invite.status]}>{t(`statuses.${invite.status}`)}</Badge>
                      </Td>
                      <Td label={t("role")}>
                        <Badge variant={invite.role === "org:admin" ? "accent" : "default"}>{t(invite.role === "org:admin" ? "roleAdmin" : "roleMember")}</Badge>
                      </Td>
                      <Td right mono label={t("uses")}>
                        {invite.maxUses > 0 ? `${invite.usedCount}/${invite.maxUses}` : invite.usedCount}
                      </Td>
                      <Td label={t("expires")} className="text-xs whitespace-nowrap text-fg-2">
                        {fmtRelative(invite.expiresAt, now, locale)}
                      </Td>
                      <Td right>
                        {invite.status === "revoked" ? null : (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onRevoke(invite.id)}
                            aria-label={t("revoke")}
                            title={t("revoke")}
                          >
                            <Trash2 size={14} />
                            <span className="md:hidden">{t("revoke")}</span>
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
        <p className="mt-3 text-[11.5px] text-muted">{t("footnote")}</p>
      </div>
    </>
  );
}

/** Convex-backed panel for the active organization. */
export function InviteLinks({ orgId }: { orgId: Id<"orgs"> }) {
  const invites = useQuery(api.orgInvites.listForOrg, { orgId }) as InviteRow[] | undefined;
  const create = useMutation(api.orgInvites.create);
  const revoke = useMutation(api.orgInvites.revoke);
  return (
    <InviteLinksPanel
      invites={invites}
      onCreate={(args) => create({ orgId, ...args })}
      onRevoke={(inviteId) => void revoke({ inviteId })}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="eyebrow mb-1.5 block text-[10px]">{label}</span>
      {children}
    </label>
  );
}

/** The freshly minted link, front and centre — creating one is only useful once it is on the clipboard. */
function InviteUrlBar({ code }: { code: string }) {
  const t = useTranslations("invites");
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2.5 sm:flex-row sm:items-center">
      <span className="eyebrow shrink-0 text-accent">{t("ready")}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{inviteUrl(code)}</span>
      <CopyButton code={code} label />
    </div>
  );
}

function CopyButton({ code, label = false }: { code: string; label?: boolean }) {
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
    } catch {
      // Clipboard denied (insecure origin or permission): the URL is on screen to copy by hand.
    }
  }

  return (
    <Button variant={label ? "secondary" : "ghost"} size="sm" onClick={onCopy} aria-label={tc("copy")} title={tc("copy")} className={cn("shrink-0", !label && "px-1.5")}>
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      {label ? (copied ? tc("copied") : tc("copy")) : null}
    </Button>
  );
}
