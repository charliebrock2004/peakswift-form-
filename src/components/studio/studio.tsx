import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Mark, Wordmark } from "@/components/brand";
import { Button, Spinner, TextField } from "@/components/ui/controls";
import { copyText } from "@/lib/onboarding/copy-text";
import { formatBytes } from "@/lib/onboarding/files";
import { briefSections, briefToText, display, NOT_PROVIDED, STEPS, type Brief, type FileKind, type SummaryRow } from "@/lib/onboarding/model";
import { cn } from "@/lib/utils";
import {
  fetchBrief,
  fetchBriefs,
  getStudioState,
  loginStudio,
  logoutStudio,
  fetchEmailStatus,
  retryBriefEmail,
  sendStudioTestEmail,
  setupStudio,
  updateBriefStatus,
} from "@/server/studio.functions";

type Mode = "loading" | "setup" | "login" | "reset" | "ready";

type Summary = {
  id: string;
  reference: string;
  status: string;
  businessName: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  submittedAt: string | null;
  fileCount: number;
  notificationStatus: string;
  notificationError: string | null;
  notificationSentAt: string | null;
  notificationMessageId: string | null;
  notificationResponse: string | null;
};

type Detail = {
  summary: Summary;
  brief: Brief;
  legacy: SummaryRow[];
  files: Array<{ id: string; kind: FileKind; filename: string; mime: string; sizeBytes: number }>;
};

type Filter = "all" | "new" | "reviewed" | "email";

const KIND_LABEL: Record<FileKind, string> = {
  logo: "Logo",
  work: "Photos",
  team: "Team",
  other: "Other images",
  review: "Review screenshots",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: then.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function StudioApp() {
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefs, setBriefs] = useState<Summary[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [setupProblem, setSetupProblem] = useState<string | null>(null);
  const [passwordLogin, setPasswordLogin] = useState(false);

  async function refreshState() {
    try {
      const result = await getStudioState();
      setSetupProblem(result.setupProblem ?? null);
      setPasswordLogin(result.loginKind === "password");
      setMode(result.mode === "ready" ? "ready" : result.mode);
    } catch {
      setError("Studio couldn’t reach the server. Refresh to try again.");
      setMode("login");
    }
  }

  async function loadList() {
    const result = await fetchBriefs();
    if (!result.ok) {
      if (result.status === 401) {
        setMode("login");
        return;
      }
      setError(result.error);
      setBriefs([]);
      return;
    }
    setError("");
    setBriefs(result.briefs);
  }

  useEffect(() => {
    void refreshState();
    // Deep link from the notification email: /studio?brief=<id>
    const linked = new URLSearchParams(window.location.search).get("brief");
    if (linked && /^[0-9a-f-]{36}$/i.test(linked)) setSelectedId(linked);
  }, []);

  useEffect(() => {
    if (mode !== "ready") return;
    void loadList();
  }, [mode]);

  useEffect(() => {
    if (!selectedId || mode !== "ready") return;
    let cancelled = false;
    setDetailError("");
    void fetchBrief({ data: { id: selectedId } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setDetail(null);
        setDetailError(result.error);
        return;
      }
      setDetail(result.detail);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, mode]);

  const counts = useMemo(() => {
    const list = briefs ?? [];
    return {
      all: list.length,
      new: list.filter((item) => item.status !== "reviewed").length,
      reviewed: list.filter((item) => item.status === "reviewed").length,
      email: list.filter((item) => item.notificationStatus === "failed" || item.notificationStatus === "pending").length,
    };
  }, [briefs]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (briefs ?? []).filter((item) => {
      if (filter === "new" && item.status === "reviewed") return false;
      if (filter === "reviewed" && item.status !== "reviewed") return false;
      if (filter === "email" && item.notificationStatus !== "failed" && item.notificationStatus !== "pending") return false;
      if (!needle) return true;
      return [item.businessName, item.clientName, item.clientEmail, item.clientPhone, item.reference].join(" ").toLowerCase().includes(needle);
    });
  }, [briefs, query, filter]);

  async function onSetup(event: FormEvent<HTMLFormElement>, reset: boolean) {
    event.preventDefault();
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const setupKey = String(form.get("setupKey") ?? "");
    const accessCode = String(form.get("accessCode") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (accessCode !== confirm) {
      setError("The access codes don’t match.");
      return;
    }
    setBusy(true);
    const result = await setupStudio({ data: { setupKey, accessCode } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMode("ready");
    if (reset) formElement.reset();
  }

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const accessCode = String(form.get("accessCode") ?? "");
    const username = String(form.get("username") ?? "");
    setBusy(true);
    const result = await loginStudio({ data: { accessCode, username } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMode("ready");
  }

  async function onLogout() {
    await logoutStudio();
    setSelectedId(null);
    setDetail(null);
    setBriefs(null);
    setMode("login");
  }

  async function mark(status: "new" | "reviewed") {
    if (!detail) return;
    const result = await updateBriefStatus({ data: { id: detail.summary.id, status } });
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    setDetail({ ...detail, summary: { ...detail.summary, status } });
    setBriefs((current) => (current ?? []).map((item) => (item.id === detail.summary.id ? { ...item, status } : item)));
  }

  async function retryEmail() {
    if (!detail) return;
    const id = detail.summary.id;
    const result = await retryBriefEmail({ data: { id } });
    if (!result.ok) setDetailError(result.error);
    const refreshed = await fetchBrief({ data: { id } });
    if (refreshed.ok) {
      setDetail(refreshed.detail);
      const next = refreshed.detail.summary;
      setBriefs((current) => (current ?? []).map((item) => (item.id === id ? { ...item, ...next } : item)));
    }
  }

  function select(id: string | null) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("brief", id);
    else url.searchParams.delete("brief");
    window.history.replaceState(null, "", url);
    if (id) window.scrollTo({ top: 0 });
  }

  if (mode === "loading") {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
          <Spinner className="text-accent" />
          Opening Studio…
        </div>
      </AuthShell>
    );
  }

  if (mode === "setup" || mode === "reset") {
    return (
      <AuthShell
        title={mode === "setup" ? "Set up your inbox" : "Reset access code"}
        description="Enter the setup key, then choose an access code of at least 8 characters. You’ll use that code each time you open Studio."
      >
        {mode === "setup" && setupProblem ? (
          <div className="mb-5 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm" role="alert">
            <p className="font-medium text-danger">Studio setup isn’t available yet</p>
            <p className="mt-1 text-ink-soft">{setupProblem}</p>
          </div>
        ) : null}
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSetup(event, mode === "reset")}>
          <TextField label="Setup key" name="setupKey" type="password" autoComplete="off" required />
          <TextField label="Access code" name="accessCode" type="password" autoComplete="new-password" required />
          <TextField label="Confirm access code" name="confirm" type="password" autoComplete="new-password" required />
          {error ? <AuthError>{error}</AuthError> : null}
          <Button type="submit" size="lg" className="mt-1 w-full" loading={busy}>
            {mode === "setup" ? "Save and open inbox" : "Save new access code"}
          </Button>
          {mode === "reset" ? (
            <Button variant="ghost" className="w-full" onClick={() => setMode("login")}>
              Back to sign in
            </Button>
          ) : null}
        </form>
      </AuthShell>
    );
  }

  if (mode === "login") {
    return (
      <AuthShell title="Sign in to Studio" description={passwordLogin ? "Read and manage client website briefs." : "Enter your access code to read client briefs."}>
        <form className="flex flex-col gap-4" onSubmit={(event) => void onLogin(event)}>
          {passwordLogin ? <TextField label="Username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required /> : null}
          <TextField label={passwordLogin ? "Password" : "Access code"} name="accessCode" type="password" autoComplete="current-password" required />
          {error ? <AuthError>{error}</AuthError> : null}
          <Button type="submit" size="lg" className="mt-1 w-full" loading={busy}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </form>
        {passwordLogin ? null : (
          <button
            type="button"
            className="mt-4 w-full rounded-sm py-2 text-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            onClick={() => {
              setError("");
              setMode("reset");
            }}
          >
            Reset access code
          </button>
        )}
      </AuthShell>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Wordmark to="/studio" product="Studio" />
          <div className="flex items-center gap-1">
            <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-ink-soft hover:bg-paper-deep hover:text-ink">
              Client form
              <ExternalIcon className="size-3.5" />
            </a>
            <Button variant="ghost" size="sm" onClick={() => void onLogout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[22rem_1fr] lg:items-start">
        <section className={cn("min-w-0", selectedId && "hidden lg:block")} aria-label="Briefs">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h1 className="text-xl font-semibold text-ink">Inbox</h1>
            {briefs ? (
              <p className="text-sm tabular-nums text-muted">
                {counts.new} new · {counts.all} total
              </p>
            ) : null}
          </div>
          <label className="relative mb-3 block">
            <span className="sr-only">Search briefs</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or reference"
              className="h-10 w-full rounded-md border border-line-strong bg-card pr-3 pl-9 text-sm text-ink shadow-xs outline-none placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15"
            />
          </label>
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-md bg-paper-deep p-1" role="tablist" aria-label="Filter briefs">
            {(
              [
                ["all", "All"],
                ["new", "New"],
                ["reviewed", "Reviewed"],
                ["email", "Email issues"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[13px] whitespace-nowrap transition-colors",
                  filter === value ? "bg-card font-medium text-ink shadow-xs" : "text-ink-soft hover:text-ink",
                )}
              >
                {label}
                {value !== "all" && counts[value] > 0 ? <span className={cn("tabular-nums", value === "email" ? "text-danger" : "text-muted")}>{counts[value]}</span> : null}
              </button>
            ))}
          </div>
          {error ? (
            <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {briefs === null ? (
            <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading briefs">
              {[0, 1, 2].map((key) => (
                <li key={key} className="h-[86px] animate-pulse rounded-lg border border-line bg-card" />
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line-strong bg-card px-5 py-8 text-center">
              <InboxIcon className="mx-auto size-6 text-muted" />
              <p className="mt-3 text-sm font-medium text-ink">{briefs.length === 0 ? "No briefs yet" : "Nothing matches"}</p>
              <p className="mt-1 text-sm text-muted">
                {briefs.length === 0 ? "When a client submits the form, their answers and photos appear here." : "Try another search or filter."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((item) => {
                const active = selectedId === item.id;
                const emailIssue = item.notificationStatus === "failed";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => select(item.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "w-full rounded-lg border bg-card px-3.5 py-3 text-left transition-[border-color,box-shadow]",
                        active ? "border-accent ring-4 ring-accent/10" : "border-line hover:border-line-strong hover:shadow-card",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {item.status !== "reviewed" ? <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="New" /> : null}
                        <span className={cn("min-w-0 flex-1 truncate text-sm", item.status !== "reviewed" ? "font-semibold text-ink" : "font-medium text-ink-soft")}>
                          {item.businessName || "Untitled business"}
                        </span>
                        <span className="shrink-0 text-xs text-muted">{timeAgo(item.submittedAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted">
                        {[item.clientName, item.clientEmail || item.clientPhone].filter(Boolean).join(" · ") || "No contact name"}
                      </span>
                      <span className="mt-2 flex items-center gap-3 text-xs text-muted">
                        <span className="font-mono">{item.reference}</span>
                        {item.fileCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <ImageIcon className="size-3.5" />
                            {item.fileCount}
                          </span>
                        ) : null}
                        {emailIssue ? <span className="ml-auto font-medium text-danger">Email failed</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <EmailPanel />
        </section>

        <section className={cn("min-w-0", !selectedId && "hidden lg:block")} aria-label="Brief">
          {!selectedId ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card px-6 text-center">
              <InboxIcon className="size-6 text-muted" />
              <h2 className="mt-3 text-base font-semibold text-ink">Select a brief</h2>
              <p className="mt-1 max-w-xs text-sm text-muted">Answers are grouped the same way the client filled them in.</p>
            </div>
          ) : detailError && (!detail || detail.summary.id !== selectedId) ? (
            <div className="rounded-xl border border-line bg-card p-6">
              <BackButton onClick={() => select(null)} />
              <p className="text-sm text-danger" role="alert">
                {detailError}
              </p>
            </div>
          ) : !detail || detail.summary.id !== selectedId ? (
            <div className="rounded-xl border border-line bg-card p-6" aria-busy="true">
              <div className="h-4 w-24 animate-pulse rounded bg-paper-deep" />
              <div className="mt-3 h-7 w-64 animate-pulse rounded bg-paper-deep" />
              <div className="mt-8 space-y-3">
                {[0, 1, 2, 3].map((key) => (
                  <div key={key} className="h-4 animate-pulse rounded bg-paper-deep" style={{ width: `${80 - key * 12}%` }} />
                ))}
              </div>
            </div>
          ) : (
            <BriefDetail detail={detail} error={detailError} onBack={() => select(null)} onMark={(status) => void mark(status)} onRetryEmail={retryEmail} />
          )}
        </section>
      </main>
    </div>
  );
}

/* ───────────────────────────── Auth ───────────────────────────── */

function AuthShell({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-start justify-center px-4 pt-16 pb-10 sm:items-center sm:pt-10">
        <div className="w-full max-w-sm animate-step-in">
          <div className="mb-8 flex flex-col items-center text-center">
            <Mark className="size-10" />
            {title ? <h1 className="mt-5 text-xl font-semibold text-ink">{title}</h1> : null}
            {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
          </div>
          <div className="rounded-xl border border-line bg-card p-5 shadow-card sm:p-6">{children}</div>
          <p className="mt-6 text-center text-sm text-muted">
            <Link to="/" className="rounded-sm underline-offset-4 hover:text-ink hover:underline">
              Go to the client form
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function AuthError({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
      {children}
    </p>
  );
}

/* ───────────────────────────── Email panel ───────────────────────────── */

type EmailStatusView = {
  configured: boolean;
  provider: "resend" | "smtp" | null;
  problem: string | null;
  sender: string | null;
  recipient: string | null;
  sendsToItself: boolean;
  note: string | null;
  deployment: { environment: string | null; branch: string | null; commit: string | null };
};

type TestResult =
  | { ok: true; provider: "resend" | "smtp"; response: string; messageId: string; sender: string; recipient: string; note: string | null }
  | { ok: false; error: string };

/** Live email configuration plus a one-click real test, so delivery problems show their actual cause. */
function EmailPanel() {
  const [status, setStatus] = useState<EmailStatusView | null>(null);
  const [statusError, setStatusError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    void fetchEmailStatus().then((reply) => {
      if (reply.ok) {
        setStatus(reply.status);
        if (!reply.status.configured && details.current) details.current.open = true;
      } else setStatusError(reply.error);
    });
  }, []);

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      setResult(await sendStudioTestEmail());
    } finally {
      setSending(false);
    }
  }

  const tone = statusError || (status && !status.configured) ? "danger" : status ? "ok" : "muted";

  return (
    <details ref={details} className="group mt-6 rounded-lg border border-line bg-card text-sm" aria-label="Email notifications">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className={cn("size-2 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : "bg-line-strong")} aria-hidden="true" />
        <span className="flex-1 font-medium text-ink">Email notifications</span>
        <span className="text-xs text-muted">{status ? (status.configured ? `On · ${status.provider === "resend" ? "Resend" : "Gmail"}` : "Off") : statusError ? "Error" : "Checking…"}</span>
        <ChevronIcon className="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-3.5 pt-3 pb-3.5">
        {statusError ? <p className="text-danger">{statusError}</p> : null}
        {status ? (
          status.configured ? (
            <p className="break-words text-ink-soft">
              Sending via {status.provider === "resend" ? "Resend" : "Gmail SMTP"} from <span className="text-ink">{status.sender}</span> to{" "}
              <span className="text-ink">{status.recipient}</span>
            </p>
          ) : (
            <p className="text-danger">Off — {status.problem}</p>
          )
        ) : null}
        {status?.note ? <p className="mt-1.5 text-xs text-muted">{status.note}</p> : null}
        {status?.deployment.environment ? (
          <p className="mt-1.5 text-xs text-muted">
            Deployment: {status.deployment.environment}
            {status.deployment.branch ? ` · ${status.deployment.branch}` : ""}
            {status.deployment.commit ? ` · ${status.deployment.commit}` : ""}
          </p>
        ) : null}
        {status?.configured ? (
          <Button variant="secondary" size="sm" className="mt-3 w-full" loading={sending} onClick={() => void sendTest()}>
            {sending ? "Sending test…" : "Send test email"}
          </Button>
        ) : null}
        {result ? (
          result.ok ? (
            <div className="mt-2.5 text-xs text-ink-soft" role="status">
              <p className="text-ok">{result.response}</p>
              {result.provider === "resend" ? (
                <p className="mt-1 break-all">
                  Delivery record:{" "}
                  <a className="text-accent underline" href={`https://resend.com/emails/${encodeURIComponent(result.messageId)}`} target="_blank" rel="noreferrer">
                    resend.com/emails/{result.messageId}
                  </a>
                </p>
              ) : (
                <p className="mt-1 break-all">
                  Find it in Gmail: <span className="font-mono">rfc822msgid:{result.messageId.replace(/^<|>$/g, "")}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2.5 break-words text-xs text-danger" role="alert">
              Not sent: {result.error}
            </p>
          )
        ) : null}
      </div>
    </details>
  );
}

/* ───────────────────────────── Detail ───────────────────────────── */

const EMAIL_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  pending: { label: "Email notification not sent yet", tone: "warn" },
  sending: { label: "Email notification sending", tone: "muted" },
  sent: { label: "Email notification sent", tone: "ok" },
  failed: { label: "Email notification failed", tone: "danger" },
  skipped: { label: "Submitted before email notifications", tone: "muted" },
};

function StatusBadge({ status }: { status: string }) {
  const reviewed = status === "reviewed";
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", reviewed ? "bg-paper-deep text-ink-soft" : "bg-accent-soft text-accent")}>
      {reviewed ? <CheckIcon className="size-3" /> : <span className="size-1.5 rounded-full bg-accent" />}
      {reviewed ? "Reviewed" : "New"}
    </span>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="-ml-2 mb-3 inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm text-ink-soft hover:bg-paper-deep hover:text-ink lg:hidden" onClick={onClick}>
      <ChevronIcon className="size-4 rotate-90" />
      Inbox
    </button>
  );
}

function BriefDetail({
  detail,
  error,
  onBack,
  onMark,
  onRetryEmail,
}: {
  detail: Detail;
  error: string;
  onBack: () => void;
  onMark: (status: "new" | "reviewed") => void;
  onRetryEmail: () => Promise<void>;
}) {
  const { brief, summary, files, legacy } = detail;
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const when = summary.submittedAt ? new Date(summary.submittedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
  const text = briefToText(brief, {
    reference: summary.reference,
    files: files.map((file) => `${KIND_LABEL[file.kind]}: ${file.filename}`),
  });
  const grouped = (["logo", "work", "team", "other", "review"] as FileKind[])
    .map((kind) => ({ kind, files: files.filter((file) => file.kind === kind) }))
    .filter((group) => group.files.length > 0);
  const canRetry = summary.notificationStatus === "failed" || summary.notificationStatus === "pending";
  const email = EMAIL_STATUS[summary.notificationStatus] ?? { label: "Email status unknown", tone: "muted" as const };
  const reviewed = summary.status === "reviewed";

  return (
    <article className="animate-fade-in overflow-hidden rounded-xl border border-line bg-card shadow-card">
      <div className="border-b border-line px-5 pt-4 pb-5 sm:px-8 sm:pt-7">
        <BackButton onClick={onBack} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted">{summary.reference}</span>
          <StatusBadge status={summary.status} />
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-ink">{summary.businessName || "Untitled business"}</h2>
        <p className="mt-1 text-sm text-muted">{[summary.clientName, when && `Submitted ${when}`].filter(Boolean).join(" · ")}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant={reviewed ? "secondary" : "primary"} size="sm" onClick={() => onMark(reviewed ? "new" : "reviewed")}>
            {reviewed ? "Mark as new" : (
              <>
                <CheckIcon className="size-4" />
                Mark as reviewed
              </>
            )}
          </Button>
          {summary.clientEmail ? (
            <a className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-card px-3 text-sm font-medium text-ink shadow-xs hover:border-ink/30 hover:bg-paper" href={`mailto:${summary.clientEmail}?subject=${encodeURIComponent(`Your website brief — ${summary.reference}`)}`}>
              <MailIcon className="size-4" />
              Email client
            </a>
          ) : null}
          {summary.clientPhone ? (
            <a className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-card px-3 text-sm font-medium text-ink shadow-xs hover:border-ink/30 hover:bg-paper" href={`tel:${summary.clientPhone.replace(/[^\d+]/g, "")}`}>
              <PhoneIcon className="size-4" />
              Call
            </a>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void copyText(text).then((ok) => {
                if (ok) setCopied(true);
              });
            }}
          >
            {copied ? <CheckIcon className="size-4 text-ok" /> : <CopyIcon className="size-4" />}
            {copied ? "Copied" : "Copy brief"}
          </Button>
        </div>

        <div
          className={cn(
            "mt-5 rounded-md px-3.5 py-2.5 text-sm",
            email.tone === "ok" && "bg-ok-soft",
            email.tone === "warn" && "bg-warn-soft",
            email.tone === "danger" && "bg-danger-soft",
            email.tone === "muted" && "bg-paper",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn("font-medium", email.tone === "ok" && "text-ok", email.tone === "warn" && "text-warn", email.tone === "danger" && "text-danger", email.tone === "muted" && "text-ink-soft")}>
              {email.label}
            </p>
            {canRetry ? (
              <Button
                variant="secondary"
                size="sm"
                loading={retrying}
                onClick={() => {
                  setRetrying(true);
                  void onRetryEmail().finally(() => setRetrying(false));
                }}
              >
                {retrying ? "Sending…" : "Send email notification"}
              </Button>
            ) : null}
          </div>
          {summary.notificationStatus === "failed" && summary.notificationError ? <p className="mt-1 break-words text-xs text-ink-soft">{summary.notificationError}</p> : null}
          {summary.notificationStatus === "sent" ? (
            <dl className="mt-1.5 grid gap-0.5 text-xs text-ink-soft">
              {summary.notificationSentAt ? (
                <div>
                  <dt className="inline">Accepted: </dt>
                  <dd className="inline">{new Date(summary.notificationSentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</dd>
                </div>
              ) : null}
              <div>
                <dt className="inline">Mail server reply: </dt>
                <dd className="inline break-all">{summary.notificationResponse ?? "Not recorded (sent before receipts were kept)"}</dd>
              </div>
              {summary.notificationMessageId ? (
                /^[0-9a-f-]{36}$/i.test(summary.notificationMessageId) ? (
                  <div>
                    <dt className="inline">Delivery record: </dt>
                    <dd className="inline break-all">
                      <a className="text-accent underline" href={`https://resend.com/emails/${summary.notificationMessageId}`} target="_blank" rel="noreferrer">
                        resend.com/emails/{summary.notificationMessageId}
                      </a>
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className="inline">Find it in Gmail: </dt>
                    <dd className="inline break-all font-mono">rfc822msgid:{summary.notificationMessageId.replace(/^<|>$/g, "")}</dd>
                  </div>
                )
              ) : null}
            </dl>
          ) : null}
        </div>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
        {grouped.length > 0 ? (
          <Block title="Files" aside={`${files.length} file${files.length === 1 ? "" : "s"}`}>
            <div className="flex flex-col gap-5 pt-3">
              {grouped.map((group) => (
                <FileGroup key={group.kind} label={KIND_LABEL[group.kind]} contain={group.kind === "logo"} files={group.files} />
              ))}
            </div>
          </Block>
        ) : null}
        {briefSections(brief).map((section) => (
          <Block key={section.title} title={STEPS[section.step]?.title ?? section.title}>
            <dl className="divide-y divide-line/70">
              {section.rows.map((row) => (
                <Line key={row.label} label={row.label} value={row.value} />
              ))}
              {section.list ? (
                <div className="py-3 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-4">
                  <dt className="text-sm text-muted">{section.list.label}</dt>
                  <dd className="mt-0.5 sm:mt-0">
                    {section.list.items.length === 0 ? (
                      <p className="text-sm text-muted/80">—</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {section.list.items.map((item, index) => (
                          <li key={`${index}-${item}`} className="rounded-full bg-paper-deep px-2.5 py-0.5 text-sm text-ink">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Block>
        ))}
        {grouped.length === 0 ? (
          <Block title="Files">
            <p className="py-3 text-sm text-muted">No files were attached.</p>
          </Block>
        ) : null}
        {legacy.length > 0 ? (
          <Block title="Other answers (earlier form)">
            <dl className="divide-y divide-line/70">
              {legacy.map((row) => (
                <Line key={row.label} label={row.label} value={row.value} />
              ))}
            </dl>
          </Block>
        ) : null}
      </div>
    </article>
  );
}

function Block({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {aside ? <span className="text-xs text-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function linkFor(label: string, value: string): string | null {
  if (/email/i.test(label) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/phone/i.test(label)) return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (/website|example/i.test(label) && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(value)) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }
  return null;
}

function Line({ label, value }: { label: string; value?: string }) {
  const text = display(value ?? "");
  const empty = text === NOT_PROVIDED;
  const href = empty ? null : linkFor(label, text);
  return (
    <div className="py-3 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] whitespace-pre-wrap break-words sm:mt-0", empty ? "text-muted/80" : "text-ink")}>
        {empty ? (
          "—"
        ) : href ? (
          <a href={href} className="text-accent underline-offset-4 hover:underline" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
            {text}
          </a>
        ) : (
          text
        )}
      </dd>
    </div>
  );
}

function FileGroup({ label, files, contain }: { label: string; contain?: boolean; files: Array<{ id: string; filename: string; mime: string; sizeBytes: number }> }) {
  return (
    <div>
      <p className="mb-2 text-sm text-muted">{label}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {files.map((file) => {
          const url = `/api/studio-file/${file.id}`;
          return (
            <li key={file.id} className="group overflow-hidden rounded-md border border-line bg-card">
              <a href={url} target="_blank" rel="noreferrer" className={cn("block aspect-[4/3] overflow-hidden", contain || file.mime === "image/svg+xml" ? "bg-paper" : "bg-paper-deep")} aria-label={`Open ${file.filename}`}>
                {/* SVGs render safely inside <img>: scripts never run there. */}
                <img src={url} alt="" loading="lazy" decoding="async" className={cn("size-full transition-transform duration-300 group-hover:scale-[1.03]", contain || file.mime === "image/svg+xml" ? "object-contain p-3" : "object-cover")} />
              </a>
              <div className="flex items-center gap-2 py-1.5 pr-1 pl-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink" title={file.filename}>
                    {file.filename}
                  </p>
                  <p className="text-xs text-muted">{formatBytes(file.sizeBytes)}</p>
                </div>
                <a className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-paper-deep hover:text-ink" href={url} download={file.filename} aria-label={`Download ${file.filename}`} title="Download">
                  <DownloadIcon className="size-4" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────────────────────────── Icons ───────────────────────────── */

type IconProps = { className?: string };
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...stroke} strokeWidth={2} />
    </svg>
  );
}
function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" {...stroke} />
      <path d="m10.5 10.5 3 3" {...stroke} />
    </svg>
  );
}
function InboxIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M3 11.5 5 4.5h10l2 7M3 11.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-3.5M3 11.5h4l1 2h4l1-2h4" {...stroke} />
    </svg>
  );
}
function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="m4 6 4 4 4-4" {...stroke} />
    </svg>
  );
}
function ExternalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" {...stroke} />
    </svg>
  );
}
function ImageIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" {...stroke} />
      <path d="m3 11 3-3 2.5 2.5L10 9l3 3" {...stroke} />
    </svg>
  );
}
function MailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" {...stroke} />
      <path d="m2.5 4.5 5.5 4 5.5-4" {...stroke} />
    </svg>
  );
}
function PhoneIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M5.5 2.5h-2a1 1 0 0 0-1 1.1A10.5 10.5 0 0 0 12.4 13.5a1 1 0 0 0 1.1-1v-2l-2.75-1-1.25 1.25a7 7 0 0 1-3.25-3.25L7.5 6.25z" {...stroke} />
    </svg>
  );
}
function CopyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" {...stroke} />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" {...stroke} />
    </svg>
  );
}
function DownloadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" {...stroke} />
    </svg>
  );
}
