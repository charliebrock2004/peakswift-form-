import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/brand";
import { Button, TextField } from "@/components/ui/controls";
import { copyText } from "@/lib/onboarding/copy-text";
import { formatBytes } from "@/lib/onboarding/files";
import { briefSections, briefToText, display, NOT_PROVIDED, type Brief, type FileKind, type SummaryRow } from "@/lib/onboarding/model";
import {
  fetchBrief,
  fetchBriefs,
  getStudioState,
  loginStudio,
  logoutStudio,
  retryBriefEmail,
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
};

type Detail = {
  summary: Summary;
  brief: Brief;
  legacy: SummaryRow[];
  files: Array<{ id: string; kind: FileKind; filename: string; mime: string; sizeBytes: number }>;
};

const KIND_LABEL: Record<FileKind, string> = {
  logo: "Logo",
  work: "Photos",
  team: "Team",
  other: "Other images",
  review: "Review screenshots",
};

export function StudioApp() {
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefs, setBriefs] = useState<Summary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");

  async function refreshState() {
    const result = await getStudioState();
    setMode(result.mode === "ready" ? "ready" : result.mode);
  }

  async function loadList() {
    const result = await fetchBriefs();
    if (!result.ok) {
      if (result.status === 401) {
        setMode("login");
        return;
      }
      setError(result.error);
      return;
    }
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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return briefs;
    return briefs.filter((item) =>
      [item.businessName, item.clientName, item.clientEmail, item.clientPhone, item.reference]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [briefs, query]);

  async function onSetup(event: FormEvent<HTMLFormElement>, reset: boolean) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
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
    if (reset) event.currentTarget.reset();
  }

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const accessCode = String(new FormData(event.currentTarget).get("accessCode") ?? "");
    setBusy(true);
    const result = await loginStudio({ data: { accessCode } });
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
    setBriefs([]);
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
    setBriefs((current) => current.map((item) => (item.id === detail.summary.id ? { ...item, status } : item)));
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
      setBriefs((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
    }
  }

  if (mode === "loading") {
    return (
      <Shell>
        <p className="text-sm text-muted">Opening Studio…</p>
      </Shell>
    );
  }

  if (mode === "setup" || mode === "reset") {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight text-ink">
          {mode === "setup" ? "Set up your studio inbox" : "Reset access code"}
        </h1>
        <p className="mt-3 max-w-xl text-sm text-ink-soft">
          Client briefs are stored here, not on the public form. Enter the setup key, then choose an access code of at
          least 8 characters. You’ll use that code each time you open Studio.
        </p>
        <form className="mt-8 flex max-w-md flex-col gap-4" onSubmit={(event) => void onSetup(event, mode === "reset")}>
          <TextField label="Setup key" name="setupKey" type="password" autoComplete="off" required />
          <TextField label="Access code" name="accessCode" type="password" autoComplete="new-password" required />
          <TextField label="Confirm access code" name="confirm" type="password" autoComplete="new-password" required />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : mode === "setup" ? "Save and open inbox" : "Save new access code"}
          </Button>
          {mode === "reset" ? (
            <button type="button" className="min-h-11 text-sm text-muted" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          ) : null}
        </form>
      </Shell>
    );
  }

  if (mode === "login") {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight text-ink">Studio</h1>
        <p className="mt-3 max-w-xl text-sm text-ink-soft">Enter your access code to read client briefs.</p>
        <form className="mt-8 flex max-w-md flex-col gap-4" onSubmit={(event) => void onLogin(event)}>
          <TextField label="Access code" name="accessCode" type="password" autoComplete="current-password" required />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Open inbox"}
          </Button>
        </form>
        <button
          type="button"
          className="mt-6 min-h-11 text-sm text-muted underline-offset-4 hover:underline"
          onClick={() => {
            setError("");
            setMode("reset");
          }}
        >
          Reset access code
        </button>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pt-5">
        <Wordmark to="/studio" />
        <div className="flex items-center gap-2">
          <Link to="/" className="inline-flex h-11 items-center px-2 text-sm text-muted hover:text-ink">
            Form
          </Link>
          <Button variant="secondary" onClick={() => void onLogout()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[20rem_1fr]">
        <section className={`${selectedId ? "hidden lg:block" : ""}`}>
          <div className="mb-4 flex items-end justify-between gap-3">
            <h1 className="font-serif text-3xl tracking-tight text-ink">Inbox</h1>
            <p className="text-sm tabular-nums text-muted">{briefs.length}</p>
          </div>
          <label className="mb-3 block">
            <span className="sr-only">Search briefs</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-12 w-full rounded-sm border border-line bg-card px-3 text-base text-ink outline-none focus-visible:border-ink"
            />
          </label>
          {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
          {visible.length === 0 ? (
            <div className="rounded-lg border border-line bg-card p-4">
              <p className="text-sm font-medium text-ink">{briefs.length === 0 ? "No briefs yet" : "No matches"}</p>
              <p className="mt-1 text-sm text-muted">
                {briefs.length === 0
                  ? "When a client submits the form, their answers and files will show up here."
                  : "Try a different name, email or reference."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-lg border px-3 py-3 text-left ${
                      selectedId === item.id ? "border-ink bg-card" : "border-line bg-card hover:border-ink/40"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{item.businessName || "Untitled business"}</span>
                      <Status status={item.status} />
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted">
                      {[item.clientName, item.clientEmail || item.clientPhone].filter(Boolean).join(" · ") || "No contact name"}
                    </span>
                    <span className="mt-2 flex justify-between text-xs text-muted">
                      <span className="font-mono">{item.reference}</span>
                      <span>
                        {item.notificationStatus === "failed" ? <span className="text-danger">Email failed · </span> : null}
                        {item.fileCount} file{item.fileCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${selectedId ? "" : "hidden lg:block"}`}>
          {!selectedId ? (
            <div className="rounded-xl border border-line bg-card p-8">
              <h2 className="font-serif text-3xl text-ink">Select a brief</h2>
              <p className="mt-2 text-sm text-muted">Answers are grouped the same way the client filled them in.</p>
            </div>
          ) : detailError ? (
            <p className="text-sm text-danger">{detailError}</p>
          ) : !detail || detail.summary.id !== selectedId ? (
            <p className="text-sm text-muted">Opening brief…</p>
          ) : (
            <BriefDetail
              detail={detail}
              onBack={() => setSelectedId(null)}
              onMark={(status) => void mark(status)}
              onRetryEmail={retryEmail}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-5">
        <Wordmark to="/studio" />
        <Link to="/" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
          Client form
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const reviewed = status === "reviewed";
  return (
    <span className={`rounded-full px-2 py-1 text-xs ${reviewed ? "bg-paper-deep text-ink-soft" : "bg-ink text-accent-fg"}`}>
      {reviewed ? "Reviewed" : "New"}
    </span>
  );
}

const EMAIL_STATUS: Record<string, string> = {
  pending: "Email notification not sent yet",
  sending: "Email notification sending",
  sent: "Email notification sent",
  failed: "Email notification failed",
  skipped: "Submitted before email notifications",
};

function BriefDetail({
  detail,
  onBack,
  onMark,
  onRetryEmail,
}: {
  detail: Detail;
  onBack: () => void;
  onMark: (status: "new" | "reviewed") => void;
  onRetryEmail: () => Promise<void>;
}) {
  const { brief, summary, files, legacy } = detail;
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const when = summary.submittedAt
    ? new Date(summary.submittedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "";
  const text = briefToText(brief, {
    reference: summary.reference,
    files: files.map((file) => `${KIND_LABEL[file.kind]}: ${file.filename}`),
  });
  const grouped = (["logo", "work", "team", "other", "review"] as FileKind[])
    .map((kind) => ({ kind, files: files.filter((file) => file.kind === kind) }))
    .filter((group) => group.files.length > 0);
  const canRetry = summary.notificationStatus === "failed" || summary.notificationStatus === "pending";

  return (
    <article className="rounded-xl border border-line bg-card p-4 sm:p-8">
      <button type="button" className="mb-4 min-h-11 text-sm text-muted lg:hidden" onClick={onBack}>
        Back to inbox
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted">{summary.reference}</p>
          <h2 className="mt-1 font-serif text-4xl tracking-tight text-ink">{summary.businessName || "Untitled business"}</h2>
          <p className="mt-2 text-sm text-muted">{[summary.clientName, when].filter(Boolean).join(" · ")}</p>
        </div>
        <Status status={summary.status} />
      </div>
      <div className="mt-4 rounded-sm border border-line bg-paper px-3 py-2 text-sm">
        <p className={summary.notificationStatus === "failed" ? "text-danger" : "text-ink-soft"}>
          {EMAIL_STATUS[summary.notificationStatus] ?? "Email status unknown"}
        </p>
        {summary.notificationStatus === "failed" && summary.notificationError ? (
          <p className="mt-1 break-words text-xs text-muted">{summary.notificationError}</p>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onMark(summary.status === "reviewed" ? "new" : "reviewed")}>
          {summary.status === "reviewed" ? "Mark as new" : "Mark as reviewed"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void copyText(text).then((ok) => {
              if (ok) setCopied(true);
            });
          }}
        >
          {copied ? "Copied" : "Copy brief"}
        </Button>
        {canRetry ? (
          <Button
            variant="secondary"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              void onRetryEmail().finally(() => setRetrying(false));
            }}
          >
            {retrying ? "Sending…" : "Send email notification"}
          </Button>
        ) : null}
      </div>
      <div className="mt-8 flex flex-col gap-8">
        {briefSections(brief).map((section) => (
          <Block key={section.title} title={section.title}>
            {section.rows.map((row) => (
              <Line key={row.label} label={row.label} value={row.value} />
            ))}
            {section.list ? (
              <div>
                <p className="text-sm text-muted">{section.list.label}</p>
                {section.list.items.length === 0 ? (
                  <p className="text-sm text-muted">{NOT_PROVIDED}</p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {section.list.items.map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Block>
        ))}
        <Block title="Files">
          {grouped.length === 0 ? <p className="text-sm text-muted">No files</p> : null}
          {grouped.map((group) => (
            <FileGroup key={group.kind} label={KIND_LABEL[group.kind]} files={group.files} />
          ))}
        </Block>
        {legacy.length > 0 ? (
          <Block title="Other answers (earlier form)">
            {legacy.map((row) => (
              <Line key={row.label} label={row.label} value={row.value} />
            ))}
          </Block>
        ) : null}
      </div>
    </article>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-medium tracking-tight text-ink">{title}</h3>
      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">{children}</div>
    </section>
  );
}

function Line({ label, value }: { label: string; value?: string }) {
  const text = display(value ?? "");
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-sm whitespace-pre-wrap break-words ${text === NOT_PROVIDED ? "text-muted" : "text-ink"}`}>{text}</p>
    </div>
  );
}

function FileGroup({
  label,
  files,
}: {
  label: string;
  files: Array<{ id: string; filename: string; mime: string; sizeBytes: number }>;
}) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {files.map((file) => (
          <li key={file.id} className="overflow-hidden rounded-sm border border-line">
            {file.mime === "image/svg+xml" ? (
              <div className="flex h-28 items-center justify-center bg-paper text-sm text-muted">SVG</div>
            ) : (
              <img src={`/api/studio-file/${file.id}`} alt="" className="h-28 w-full object-cover" />
            )}
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <p className="truncate text-xs text-ink">{file.filename}</p>
              <a
                className="shrink-0 text-xs text-ink underline-offset-4 hover:underline"
                href={`/api/studio-file/${file.id}`}
                download={file.filename}
              >
                {formatBytes(file.sizeBytes)}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
