import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/brand";
import { clearDraftFiles, deleteDraftFile, loadDraftFiles, saveDraftFile } from "@/components/onboarding/draft-files";
import { prepareUpload } from "@/components/onboarding/prepare-file";
import { postForm, postJson } from "@/components/onboarding/submit-client";
import { AreaField, Button, ChoiceGroup, FieldGroup, Spinner, TextField, fieldClass } from "@/components/ui/controls";
import { copyText } from "@/lib/onboarding/copy-text";
import { formatBytes, MAX_FILES } from "@/lib/onboarding/files";
import {
  BUDGET_OPTIONS,
  briefErrors,
  briefSections,
  display,
  emptyBrief,
  errorsForStep,
  FEATURE_OPTIONS,
  firstStepForErrors,
  mergeBrief,
  NOT_PROVIDED,
  REVIEW_STEP,
  STEPS,
  STYLE_OPTIONS,
  TIMESCALE_OPTIONS,
  type Brief,
  type FeatureChoice,
  type FileKind,
} from "@/lib/onboarding/model";
import { cn } from "@/lib/utils";

/** Same key as before, so drafts saved by the earlier version still resume. */
const DRAFT_KEY = "peakswift-brief-v1";
const FORM_STEPS = REVIEW_STEP; // the five question steps; the review is extra

export type LocalFile = {
  key: string;
  kind: FileKind;
  file: File;
  name: string;
  size: number;
  preview: string;
};

type Done = { reference: string; name: string; email: string; fileCount: number };

/** One server-side upload session, reused when a submission is retried so a retry never creates a second brief. */
type Session = { token: string; fingerprint: string; uploaded: Set<string> };

type Update = <K extends keyof Brief>(key: K, value: Brief[K]) => void;

function readDraft(): { brief: Brief; step: number; furthest: number; started: boolean } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { step?: number; furthest?: number; brief?: unknown; started?: boolean };
    const step = typeof saved.step === "number" && saved.step >= 0 && saved.step < STEPS.length ? saved.step : 0;
    const furthest = typeof saved.furthest === "number" ? Math.max(step, Math.min(saved.furthest, STEPS.length - 1)) : step;
    return { brief: mergeBrief(saved.brief), step, furthest, started: saved.started ?? true };
  } catch {
    return null;
  }
}

function hasAnswers(brief: Brief): boolean {
  return Boolean(brief.businessName || brief.contactName || brief.email || brief.whatYouDo);
}

export function OnboardingForm() {
  const [phase, setPhase] = useState<"intro" | "form">("intro");
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [preparing, setPreparing] = useState<Record<string, number>>({});
  const [fileNotes, setFileNotes] = useState<Record<string, string[]>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ label: string; percent: number } | null>(null);
  const [uploadState, setUploadState] = useState<Record<string, "uploading" | "done">>({});
  const [done, setDone] = useState<Done | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const session = useRef<Session | null>(null);
  const sendingRef = useRef(false);
  const order = useRef(0);

  // Restore the saved draft (answers in localStorage, photos in IndexedDB).
  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setBrief(draft.brief);
      setStep(draft.step);
      setFurthest(draft.furthest);
      if (hasAnswers(draft.brief) || draft.step > 0) setResumable(true);
    }
    let cancelled = false;
    void loadDraftFiles().then((stored) => {
      if (cancelled || stored.length === 0) return;
      const restored = stored.map((row) => {
        const file = new File([row.blob], row.name, { type: row.type });
        order.current = Math.max(order.current, row.order + 1);
        return { key: row.key, kind: row.kind, file, name: row.name, size: file.size, preview: URL.createObjectURL(file) };
      });
      setFiles(restored);
      setResumable(true);
    });
    setHydrated(true);
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave answers on this device.
  useEffect(() => {
    if (!hydrated || done || phase !== "form") return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, furthest, brief, started: true }));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [hydrated, step, furthest, brief, done, phase]);

  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((file) => URL.revokeObjectURL(file.preview)), []);

  // Move focus to the new heading and scroll up whenever the screen changes.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [step, phase]);

  // Only warn on leaving while a submission is actually in flight; answers and photos are saved.
  useEffect(() => {
    if (!sending) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [sending]);

  const update: Update = useCallback((key, value) => {
    setBrief((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }, []);

  function goTo(next: number) {
    const target = Math.max(0, Math.min(STEPS.length - 1, next));
    setFormError("");
    setStep(target);
    setFurthest((current) => Math.max(current, target));
  }

  function focusFirstInvalid() {
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("[aria-invalid='true']");
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    });
  }

  function continueFrom(current: number) {
    const found = errorsForStep(current, brief);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError(Object.keys(found).length === 1 ? "One answer needs a quick look." : "A few answers need a quick look.");
      focusFirstInvalid();
      return;
    }
    goTo(current + 1);
  }

  function startFresh() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    void clearDraftFiles();
    files.forEach((file) => URL.revokeObjectURL(file.preview));
    setFiles([]);
    setBrief(emptyBrief());
    setErrors({});
    setStep(0);
    setFurthest(0);
    setConfirmed(false);
    setResumable(false);
    session.current = null;
    setPhase("form");
  }

  async function addFiles(kind: FileKind, list: File[]) {
    if (!list.length || sendingRef.current) return;
    const notes: string[] = [];
    const room = MAX_FILES - filesRef.current.length;
    if (room <= 0) {
      setFileNotes((current) => ({ ...current, [kind]: [`That’s the most this form can take (${MAX_FILES} files). You can send any others separately.`] }));
      return;
    }
    const incoming = list.slice(0, room);
    if (list.length > room) notes.push(`${list.length - room} file${list.length - room === 1 ? " was" : "s were"} left out — the form takes up to ${MAX_FILES}. You can send the rest separately.`);
    setFileNotes((current) => ({ ...current, [kind]: [] }));
    setPreparing((current) => ({ ...current, [kind]: (current[kind] ?? 0) + incoming.length }));
    for (const file of incoming) {
      const prepared = await prepareUpload(file);
      setPreparing((current) => ({ ...current, [kind]: Math.max(0, (current[kind] ?? 1) - 1) }));
      if ("error" in prepared) {
        notes.push(prepared.error);
        continue;
      }
      const key = crypto.randomUUID();
      const item: LocalFile = { key, kind, file: prepared.file, name: prepared.file.name, size: prepared.file.size, preview: URL.createObjectURL(prepared.file) };
      setFiles((current) => [...current, item]);
      void saveDraftFile({ key, kind, name: item.name, type: item.file.type, blob: item.file, order: order.current++ });
    }
    if (notes.length) setFileNotes((current) => ({ ...current, [kind]: notes }));
  }

  async function replaceFile(key: string, file: File) {
    const target = filesRef.current.find((item) => item.key === key);
    if (!target || sendingRef.current) return;
    setPreparing((current) => ({ ...current, [target.kind]: (current[target.kind] ?? 0) + 1 }));
    const prepared = await prepareUpload(file);
    setPreparing((current) => ({ ...current, [target.kind]: Math.max(0, (current[target.kind] ?? 1) - 1) }));
    if ("error" in prepared) {
      setFileNotes((current) => ({ ...current, [target.kind]: [prepared.error] }));
      return;
    }
    const item: LocalFile = { ...target, key: crypto.randomUUID(), file: prepared.file, name: prepared.file.name, size: prepared.file.size, preview: URL.createObjectURL(prepared.file) };
    URL.revokeObjectURL(target.preview);
    setFiles((current) => current.map((entry) => (entry.key === key ? item : entry)));
    void deleteDraftFile(key);
    void saveDraftFile({ key: item.key, kind: item.kind, name: item.name, type: item.file.type, blob: item.file, order: order.current++ });
  }

  function removeFile(key: string) {
    if (sendingRef.current) return;
    setFiles((current) => {
      const target = current.find((file) => file.key === key);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((file) => file.key !== key);
    });
    void deleteDraftFile(key);
  }

  async function submit() {
    if (sendingRef.current) return; // double-tap guard
    const found = briefErrors(brief);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      goTo(firstStepForErrors(found));
      setFormError("A few answers need a quick look before this can be sent.");
      focusFirstInvalid();
      return;
    }
    if (!confirmed) {
      setConfirmError("Please tick the box to confirm before sending.");
      return;
    }
    setConfirmError("");
    setFormError("");
    sendingRef.current = true;
    setSending(true);
    const fingerprint = JSON.stringify(brief);
    const current = session.current;
    // Reuse the previous attempt's session only if nothing it already holds has changed.
    if (current && (current.fingerprint !== fingerprint || [...current.uploaded].some((key) => !files.some((file) => file.key === key)))) {
      session.current = null;
    }
    try {
      if (!session.current) {
        setProgress({ label: "Saving your answers…", percent: 6 });
        const created = await postJson<{ token?: string; reference?: string; fields?: Record<string, string> | null }>("/api/brief", { brief, confirmed: true });
        if (!created.ok || !created.body.token) {
          if (created.body.fields) {
            setErrors(created.body.fields);
            goTo(firstStepForErrors(created.body.fields));
          }
          throw new Error(created.body.error || "We couldn’t save your answers. Please try again.");
        }
        session.current = { token: created.body.token, fingerprint, uploaded: new Set() };
      }
      const active = session.current;
      const pending = files.filter((file) => !active.uploaded.has(file.key));
      const totalBytes = pending.reduce((sum, file) => sum + file.size, 0) || 1;
      let sentBytes = 0;
      setUploadState(Object.fromEntries([...active.uploaded].map((key) => [key, "done" as const])));
      for (let index = 0; index < pending.length; index += 1) {
        const item = pending[index]!;
        setUploadState((state) => ({ ...state, [item.key]: "uploading" }));
        const body = new FormData();
        body.set("token", active.token);
        body.set("kind", item.kind);
        body.set("file", item.file, item.name);
        const uploaded = await postForm<{ id?: string }>("/api/brief-file", body, (loaded, total) => {
          const fraction = total ? loaded / total : 0;
          const percent = 10 + ((sentBytes + item.size * fraction) / totalBytes) * 78;
          setProgress({ label: `Uploading ${pending.length === 1 ? "your file" : `file ${index + 1} of ${pending.length}`}…`, percent });
        });
        if (!uploaded.ok) {
          if (/expired|missing/i.test(uploaded.body.error ?? "")) session.current = null;
          setUploadState((state) => {
            const next = { ...state };
            delete next[item.key];
            return next;
          });
          throw new Error(uploaded.body.error || `We couldn’t upload ${item.name}. Please try again.`);
        }
        sentBytes += item.size;
        active.uploaded.add(item.key);
        setUploadState((state) => ({ ...state, [item.key]: "done" }));
      }
      setProgress({ label: "Sending your brief…", percent: 92 });
      const finalised = await postJson<{ reference?: string }>("/api/brief-finalise", { token: active.token });
      if (!finalised.ok || !finalised.body.reference) {
        if (/expired|missing/i.test(finalised.body.error ?? "")) session.current = null;
        throw new Error(finalised.body.error || "We couldn’t send your brief. Please try again.");
      }
      setProgress({ label: "Done", percent: 100 });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      void clearDraftFiles();
      session.current = null;
      setDone({ reference: finalised.body.reference, name: brief.contactName, email: brief.email, fileCount: files.length });
    } catch (error) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setFormError(
        offline
          ? "You appear to be offline. Your answers are saved on this device — reconnect and press Submit again."
          : error instanceof Error && error.message !== "Failed to fetch"
            ? `${error.message} Your answers are still saved.`
            : "We couldn’t reach the server. Your answers are saved — please try again.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
      setProgress(null);
    }
  }

  if (done) return <Success done={done} />;

  if (phase === "intro") {
    return (
      <Intro
        ready={hydrated}
        resumable={resumable}
        businessName={brief.businessName}
        onStart={() => (resumable ? startFresh() : setPhase("form"))}
        onResume={() => setPhase("form")}
        headingRef={headingRef}
      />
    );
  }

  const current = STEPS[step]!;
  const isReview = step === REVIEW_STEP;
  const busyPreparing = Object.values(preparing).some((count) => count > 0);

  return (
    <div className="min-h-dvh">
      <Header>
        <span className={cn("hidden items-center gap-1.5 text-sm text-muted transition-opacity sm:inline-flex", saved ? "opacity-100" : "opacity-0")}>
          <CheckIcon className="size-4 text-ok" />
          Saved on this device
        </span>
      </Header>

      <div className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6 lg:grid lg:grid-cols-[13.5rem_1fr] lg:gap-10 lg:pt-6">
        <StepNav step={step} furthest={furthest} onSelect={goTo} disabled={sending} />

        <main className="min-w-0">
          <MobileProgress step={step} />
          <form
            noValidate
            className="overflow-hidden rounded-xl border border-line bg-card shadow-card"
            onSubmit={(event) => {
              event.preventDefault();
              if (sending) return;
              if (isReview) void submit();
              else continueFrom(step);
            }}
          >
            <div key={step} className="animate-step-in px-5 pt-6 pb-8 sm:px-10 sm:pt-10">
              <p className="text-sm font-medium text-accent">{isReview ? "Last step" : `Step ${step + 1} of ${FORM_STEPS}`}</p>
              <h1 ref={headingRef} tabIndex={-1} className="mt-1.5 text-2xl font-semibold text-ink outline-none sm:text-[28px] sm:leading-tight">
                {current.title}
              </h1>
              <p className="mt-2 max-w-xl text-[15px] text-ink-soft">{current.lede}</p>

              <div className="mt-8 flex flex-col gap-7">
                {step === 0 ? <ContactStep brief={brief} errors={errors} update={update} /> : null}
                {step === 1 ? <AboutStep brief={brief} errors={errors} update={update} /> : null}
                {step === 2 ? <DesignStep brief={brief} update={update} /> : null}
                {step === 3 ? (
                  <MaterialsStep
                    brief={brief}
                    update={update}
                    files={files}
                    preparing={preparing}
                    notes={fileNotes}
                    onAdd={addFiles}
                    onReplace={replaceFile}
                    onRemove={removeFile}
                    onSkip={() => goTo(4)}
                  />
                ) : null}
                {step === 4 ? <FinalStep brief={brief} update={update} /> : null}
                {isReview ? (
                  <ReviewStep
                    brief={brief}
                    files={files}
                    uploadState={uploadState}
                    confirmed={confirmed}
                    confirmError={confirmError}
                    sending={sending}
                    onEdit={goTo}
                    onConfirm={(value) => {
                      setConfirmed(value);
                      if (value) setConfirmError("");
                    }}
                  />
                ) : null}
              </div>
            </div>

            <div className="sticky bottom-0 z-10 border-t border-line bg-card/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-10 sm:py-4">
              {formError ? (
                <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger animate-fade-in" role="alert">
                  {formError}
                </p>
              ) : null}
              {progress ? <SubmitProgress label={progress.label} percent={progress.percent} /> : null}
              <div className="flex items-center gap-3">
                {step > 0 ? (
                  <Button variant="secondary" size="lg" className="w-24 shrink-0 sm:w-28" onClick={() => goTo(step - 1)} disabled={sending}>
                    <ArrowIcon className="size-4 rotate-180" />
                    Back
                  </Button>
                ) : null}
                <div className="hidden flex-1 sm:block" />
                {isReview ? (
                  <Button type="submit" size="lg" className="flex-1 sm:w-56 sm:flex-none" loading={sending} disabled={busyPreparing}>
                    {sending ? "Sending…" : "Submit brief"}
                  </Button>
                ) : (
                  <Button type="submit" size="lg" className="flex-1 sm:w-48 sm:flex-none" disabled={busyPreparing}>
                    {step === FORM_STEPS - 1 ? "Review answers" : "Continue"}
                    <ArrowIcon className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </form>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-sm text-muted">
            <LockIcon className="size-3.5" />
            Your answers are only shared with the PeakSwift team.
          </p>
        </main>
      </div>
    </div>
  );
}

/* ───────────────────────────── Layout pieces ───────────────────────────── */

export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <Wordmark />
        {children}
      </div>
    </header>
  );
}

function StepNav({ step, furthest, onSelect, disabled }: { step: number; furthest: number; onSelect: (step: number) => void; disabled: boolean }) {
  return (
    <nav aria-label="Form sections" className="hidden lg:block">
      <ol className="sticky top-24 flex flex-col gap-0.5">
        {STEPS.map((item, index) => {
          const active = index === step;
          const complete = index < furthest && !active;
          const reachable = index <= furthest;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={disabled || !reachable}
                onClick={() => onSelect(index)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex h-11 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm transition-colors",
                  active ? "bg-card font-medium text-ink shadow-card ring-1 ring-line" : "text-ink-soft",
                  !active && reachable && "hover:bg-paper-deep hover:text-ink",
                  !reachable && "cursor-default text-muted/70",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors",
                    active && "bg-accent text-white",
                    complete && "bg-accent-soft text-accent",
                    !active && !complete && "border border-line-strong text-muted",
                  )}
                >
                  {complete ? <CheckIcon className="size-3.5" /> : index === REVIEW_STEP ? <FlagIcon className="size-3" /> : index + 1}
                </span>
                {item.title}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobileProgress({ step }: { step: number }) {
  const isReview = step === REVIEW_STEP;
  return (
    <div className="pt-4 pb-4 lg:hidden">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{isReview ? "Review" : STEPS[step]!.title}</span>
        <span className="tabular-nums text-muted">{isReview ? "All steps done" : `${step + 1} of ${FORM_STEPS}`}</span>
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-label="Form progress"
        aria-valuemin={0}
        aria-valuemax={FORM_STEPS}
        aria-valuenow={isReview ? FORM_STEPS : step}
        aria-valuetext={isReview ? "Reviewing answers" : `Step ${step + 1} of ${FORM_STEPS}`}
      >
        {Array.from({ length: FORM_STEPS }, (_, index) => (
          <span key={index} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${index < step || isReview ? 1 : index === step ? 0.5 : 0})` }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

export function SubmitProgress({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="mb-3" role="status" aria-live="polite">
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="tabular-nums text-muted">{Math.round(percent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ───────────────────────────── Intro ───────────────────────────── */

function Intro({
  ready,
  resumable,
  businessName,
  onStart,
  onResume,
  headingRef,
}: {
  ready: boolean;
  resumable: boolean;
  businessName: string;
  onStart: () => void;
  onResume: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const stages = STEPS.slice(0, FORM_STEPS);
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pt-10 pb-12 sm:px-6 sm:pt-16 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-16 lg:pt-24">
        <div className="animate-step-in">
          <p className="text-sm font-medium text-accent">Website project brief</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-3 max-w-xl text-[32px] leading-[1.15] font-semibold text-ink outline-none sm:text-[40px]">
            Let’s get your new website started.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-soft sm:text-[17px]">
            This short form helps us understand your business and prepare your website project. You don’t need everything ready — we can
            fill in any gaps together.
          </p>

          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-ink-soft">
            <li className="flex items-center gap-2">
              <ClockIcon className="size-4 text-muted" />
              About 5 minutes
            </li>
            <li className="flex items-center gap-2">
              <SaveIcon className="size-4 text-muted" />
              Saves as you go
            </li>
            <li className="flex items-center gap-2">
              <LockIcon className="size-4 text-muted" />
              Only 4 questions required
            </li>
          </ul>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            {resumable ? (
              <>
                <Button size="lg" className="w-full sm:w-auto sm:px-7" onClick={onResume} disabled={!ready}>
                  Continue where you left off
                  <ArrowIcon className="size-4" />
                </Button>
                <Button size="lg" variant="ghost" className="w-full sm:w-auto" onClick={onStart} disabled={!ready}>
                  Start again
                </Button>
              </>
            ) : (
              <Button size="lg" className="w-full sm:w-auto sm:px-7" onClick={onStart} disabled={!ready}>
                Get started
                <ArrowIcon className="size-4" />
              </Button>
            )}
          </div>
          {resumable ? (
            <p className="mt-3 text-sm text-muted">
              We saved your answers{businessName ? ` for ${businessName}` : ""} on this device.
            </p>
          ) : null}
        </div>

        <aside className="mt-12 animate-step-in lg:mt-2" aria-label="What we’ll ask">
          <div className="rounded-xl border border-line bg-card p-5 shadow-card sm:p-6">
            <h2 className="text-sm font-semibold text-ink">What we’ll ask</h2>
            <ol className="mt-4 flex flex-col">
              {stages.map((item, index) => (
                <li key={item.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                  {index < stages.length - 1 ? <span className="absolute top-7 bottom-1 left-[11px] w-px bg-line" aria-hidden="true" /> : null}
                  <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card text-xs font-medium text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <div className="pt-0.5">
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    <p className="text-sm text-muted">{INTRO_HINTS[index]}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pb-8 text-sm text-muted sm:px-6">
        <p>© PeakSwift</p>
        <Link to="/studio" className="rounded-sm underline-offset-4 hover:text-ink hover:underline">
          Team sign in
        </Link>
      </footer>
    </div>
  );
}

const INTRO_HINTS = [
  "Name and contact details",
  "What you do and offer",
  "Style, colours and features",
  "Logo, photos and links",
  "Timing and budget",
];

/* ───────────────────────────── Steps ───────────────────────────── */

function ContactStep({ brief, errors, update }: { brief: Brief; errors: Record<string, string>; update: Update }) {
  return (
    <>
      <FieldGroup title="About the business">
        <TextField mandatory label="Business name" name="organization" autoComplete="organization" maxLength={200} value={brief.businessName} error={errors.businessName} onChange={(event) => update("businessName", event.target.value)} />
        <TextField label="Town or area you serve" name="area" autoComplete="address-level2" maxLength={300} placeholder="e.g. Perth & Kinross" value={brief.area} onChange={(event) => update("area", event.target.value)} />
      </FieldGroup>
      <FieldGroup title="Your contact details" description="We’ll only use these to talk to you about your website.">
        <TextField mandatory label="Your name" name="name" autoComplete="name" maxLength={200} value={brief.contactName} error={errors.contactName} onChange={(event) => update("contactName", event.target.value)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField mandatory label="Email address" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={200} value={brief.email} error={errors.email} onChange={(event) => update("email", event.target.value)} />
          <TextField label="Phone number" name="tel" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={brief.phone} error={errors.phone} onChange={(event) => update("phone", event.target.value)} />
        </div>
      </FieldGroup>
    </>
  );
}

function AboutStep({ brief, errors, update }: { brief: Brief; errors: Record<string, string>; update: Update }) {
  const listRef = useRef<HTMLDivElement>(null);
  function setService(index: number, name: string) {
    update(
      "services",
      brief.services.map((service, item) => (item === index ? { ...service, name } : service)),
    );
  }
  function addService() {
    update("services", [...brief.services, { id: `service-${crypto.randomUUID()}`, name: "" }]);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus());
  }
  return (
    <>
      <AreaField
        compact
        mandatory
        label="What does the business do?"
        hint="Describe it the way you would to a new customer."
        name="whatYouDo"
        maxLength={1500}
        placeholder="e.g. Family-run landscaping firm covering domestic gardens across Perthshire."
        value={brief.whatYouDo}
        error={errors.whatYouDo}
        onChange={(event) => update("whatYouDo", event.target.value)}
      />
      <ChoiceGroup label="Main services" hint="The things you’d like to feature on the website.">
        <div ref={listRef}>
          <ul className="flex flex-col gap-2">
            {brief.services.map((service, index) => (
              <li key={service.id} className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`service-${service.id}`}>
                  Service {index + 1}
                </label>
                <span className="w-5 shrink-0 text-right text-sm text-muted tabular-nums" aria-hidden="true">
                  {index + 1}
                </span>
                <input
                  id={`service-${service.id}`}
                  className={cn(fieldClass, "h-12")}
                  placeholder={index === 0 ? "e.g. Garden design" : index === 1 ? "e.g. Lawn care" : "Another service"}
                  value={service.name}
                  maxLength={160}
                  onChange={(event) => setService(index, event.target.value)}
                />
                {brief.services.length > 1 ? (
                  <button
                    type="button"
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-paper-deep hover:text-ink"
                    aria-label={`Remove service ${index + 1}${service.name ? ` (${service.name})` : ""}`}
                    onClick={() => update("services", brief.services.filter((_, item) => item !== index))}
                  >
                    <CloseIcon className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {brief.services.length < 40 ? (
          <Button variant="ghost" size="sm" className="-ml-1 self-start pl-2 text-accent hover:bg-accent-soft hover:text-accent-hover" onClick={addService}>
            <PlusIcon className="size-4" />
            Add another service
          </Button>
        ) : null}
      </ChoiceGroup>
      <AreaField compact label="What makes you different?" hint="Experience, guarantees, awards, the way you work — anything customers love." name="whatMakesDifferent" maxLength={2000} value={brief.whatMakesDifferent} onChange={(event) => update("whatMakesDifferent", event.target.value)} />
      <TextField label="Opening hours" name="openingHours" maxLength={500} placeholder="e.g. Mon–Fri 8am–5pm, Sat by appointment" value={brief.openingHours} onChange={(event) => update("openingHours", event.target.value)} />
    </>
  );
}

function DesignStep({ brief, update }: { brief: Brief; update: Update }) {
  function toggle(feature: FeatureChoice) {
    const has = brief.features.includes(feature);
    update("features", has ? brief.features.filter((item) => item !== feature) : [...brief.features, feature]);
  }
  return (
    <>
      <FieldGroup title="Look and feel">
        <PillRadio label="Overall style" hint="Pick the closest. Tap again to clear." name="style" options={STYLE_OPTIONS} value={brief.style} onChange={(value) => update("style", value)} />
        <TextField label="Colours you like" hint="Brand colours, or just colours you’d like to see." name="preferredColours" maxLength={300} placeholder="e.g. Navy and white" value={brief.preferredColours} onChange={(event) => update("preferredColours", event.target.value)} />
      </FieldGroup>
      <FieldGroup title="Inspiration" description="Websites you like the look of — they don’t need to be in your industry.">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Website you like" name="example1" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} placeholder="www.example.co.uk" value={brief.example1} onChange={(event) => update("example1", event.target.value)} />
          <TextField label="Another website you like" name="example2" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} placeholder="www.example.com" value={brief.example2} onChange={(event) => update("example2", event.target.value)} />
        </div>
      </FieldGroup>
      <FieldGroup title="Features">
        <ChoiceGroup label="What should the website include?" hint="Choose any that apply.">
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURE_OPTIONS.map((feature) => {
              const selected = brief.features.includes(feature);
              return (
                <label
                  key={feature}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3.5 text-[15px] transition-[border-color,background-color] duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15",
                    selected ? "border-accent bg-accent-soft text-ink" : "border-line-strong bg-card text-ink hover:border-ink/30",
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={selected} onChange={() => toggle(feature)} />
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                      selected ? "border-accent bg-accent text-white" : "border-line-strong bg-card",
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <CheckIcon className="size-3.5" /> : null}
                  </span>
                  {feature}
                </label>
              );
            })}
          </div>
        </ChoiceGroup>
        <TextField label="Anything else it should do?" name="featuresOther" maxLength={500} placeholder="e.g. Quote request form, price list" value={brief.featuresOther} onChange={(event) => update("featuresOther", event.target.value)} />
      </FieldGroup>
    </>
  );
}

function MaterialsStep({
  brief,
  update,
  files,
  preparing,
  notes,
  onAdd,
  onReplace,
  onRemove,
  onSkip,
}: {
  brief: Brief;
  update: Update;
  files: LocalFile[];
  preparing: Record<string, number>;
  notes: Record<string, string[]>;
  onAdd: (kind: FileKind, list: File[]) => void;
  onReplace: (key: string, file: File) => void;
  onRemove: (key: string) => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg bg-paper px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-soft">Don’t have these to hand? No problem — you can send them later.</p>
        <Button variant="secondary" size="sm" className="self-start sm:self-auto" onClick={onSkip}>
          Skip this step
        </Button>
      </div>
      <FieldGroup title="Logo" description="Any version you have is fine — we can tidy it up.">
        <Uploader kind="logo" label="logo" files={files.filter((file) => file.kind === "logo")} preparing={preparing.logo ?? 0} notes={notes.logo ?? []} contain onAdd={onAdd} onReplace={onReplace} onRemove={onRemove} />
      </FieldGroup>
      <FieldGroup title="Photos" description="Your work, your team or your premises. Phone photos are perfect.">
        <Uploader kind="work" label="photos" files={files.filter((file) => file.kind === "work")} preparing={preparing.work ?? 0} notes={notes.work ?? []} onAdd={onAdd} onReplace={onReplace} onRemove={onRemove} />
      </FieldGroup>
      <FieldGroup title="Online presence">
        <TextField label="Current website" hint="If you have one already." name="existingWebsite" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} placeholder="www.mybusiness.co.uk" value={brief.existingWebsite} onChange={(event) => update("existingWebsite", event.target.value)} />
        <AreaField compact label="Social media links" hint="Facebook, Instagram, TikTok — one per line." name="socialLinks" maxLength={1000} placeholder={"facebook.com/mybusiness\ninstagram.com/mybusiness"} value={brief.socialLinks} onChange={(event) => update("socialLinks", event.target.value)} />
        <TextField label="Domain name or Google Business Profile" hint="If you already own a web address or have a Google listing." name="domainGbp" maxLength={500} placeholder="e.g. mybusiness.co.uk" value={brief.domainGbp} onChange={(event) => update("domainGbp", event.target.value)} />
      </FieldGroup>
      <p className="text-sm text-muted">{files.length > 0 ? `${files.length} of ${MAX_FILES} files added.` : `Up to ${MAX_FILES} images in total.`}</p>
    </>
  );
}

function FinalStep({ brief, update }: { brief: Brief; update: Update }) {
  return (
    <>
      <PillRadio label="When would you like the website?" name="timescale" options={TIMESCALE_OPTIONS} value={brief.timescale} onChange={(value) => update("timescale", value)} />
      <PillRadio label="Rough budget" hint="This just helps us suggest the right approach." name="budget" options={BUDGET_OPTIONS} value={brief.budget} onChange={(value) => update("budget", value)} />
      <AreaField label="Anything else we should know?" hint="Questions, ideas, deadlines — anything at all." name="anythingElse" maxLength={4000} value={brief.anythingElse} onChange={(event) => update("anythingElse", event.target.value)} />
    </>
  );
}

/** Single choice shown as tappable pills. Native radios keep it keyboard and screen-reader friendly; tap again to clear. */
function PillRadio<T extends string>({
  label,
  hint,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  name: string;
  options: readonly T[];
  value: T | "";
  onChange: (value: T | "") => void;
}) {
  return (
    <ChoiceGroup label={label} hint={hint}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option;
          return (
            <label
              key={option}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm transition-[border-color,background-color,color] duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15",
                selected ? "border-accent bg-accent text-white" : "border-line-strong bg-card text-ink hover:border-ink/30",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                onClick={() => {
                  if (selected) onChange("");
                }}
              />
              {selected ? <CheckIcon className="-ml-1 size-3.5" /> : null}
              {option}
            </label>
          );
        })}
      </div>
    </ChoiceGroup>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/svg+xml,.jpg,.jpeg,.png,.webp,.svg";

export function Uploader({
  kind,
  label,
  files,
  preparing,
  notes,
  contain = false,
  onAdd,
  onReplace,
  onRemove,
}: {
  kind: FileKind;
  label: string;
  files: LocalFile[];
  preparing: number;
  notes: string[];
  contain?: boolean;
  onAdd: (kind: FileKind, list: File[]) => void;
  onReplace: (key: string, file: File) => void;
  onRemove: (key: string) => void;
}) {
  const id = useId();
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    onAdd(kind, Array.from(event.dataTransfer.files));
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={id}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-paper/60 hover:border-ink/30 hover:bg-paper",
        )}
      >
        <span className={cn("mb-1 flex size-10 items-center justify-center rounded-full bg-card shadow-card transition-colors", dragging ? "text-accent" : "text-ink-soft group-hover:text-ink")}>
          <UploadIcon className="size-5" />
        </span>
        <span className="text-sm font-medium text-ink">
          {dragging ? "Drop to add" : <>Choose {label}<span className="hidden font-normal text-muted sm:inline"> or drag them here</span></>}
        </span>
        <span className="text-sm text-muted">JPG, PNG, WEBP or SVG · large photos are resized for you</span>
        <input
          id={id}
          className="sr-only"
          type="file"
          accept={ACCEPT}
          multiple
          onChange={(event) => {
            onAdd(kind, Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      <input
        ref={replaceInput}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && replacing.current) onReplace(replacing.current, file);
          replacing.current = null;
          event.target.value = "";
        }}
      />
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 || preparing > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={`Added ${label}`}>
          {files.map((file) => (
            <li key={file.key} className="group/tile overflow-hidden rounded-md border border-line bg-card shadow-xs animate-pop-in">
              <div className={cn("relative aspect-[4/3] overflow-hidden", contain ? "bg-paper" : "bg-paper-deep")}>
                <img src={file.preview} alt="" className={cn("size-full", contain ? "object-contain p-3" : "object-cover")} decoding="async" />
                <div className="absolute top-1.5 right-1.5 flex gap-1">
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-md bg-card/95 text-ink-soft shadow-card ring-1 ring-ink/5 transition-colors hover:text-ink"
                    aria-label={`Replace ${file.name}`}
                    title="Replace"
                    onClick={() => {
                      replacing.current = file.key;
                      replaceInput.current?.click();
                    }}
                  >
                    <SwapIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-md bg-card/95 text-ink-soft shadow-card ring-1 ring-ink/5 transition-colors hover:bg-danger-soft hover:text-danger"
                    aria-label={`Remove ${file.name}`}
                    title="Remove"
                    onClick={() => onRemove(file.key)}
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-sm text-ink" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted">{formatBytes(file.size)}</p>
              </div>
            </li>
          ))}
          {Array.from({ length: preparing }, (_, index) => (
            <li key={`preparing-${index}`} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md border border-line bg-paper text-sm text-muted" role="status">
              <Spinner className="size-5 text-accent" />
              Preparing…
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReviewStep({
  brief,
  files,
  uploadState,
  confirmed,
  confirmError,
  sending,
  onEdit,
  onConfirm,
}: {
  brief: Brief;
  files: LocalFile[];
  uploadState: Record<string, "uploading" | "done">;
  confirmed: boolean;
  confirmError: string;
  sending: boolean;
  onEdit: (step: number) => void;
  onConfirm: (value: boolean) => void;
}) {
  return (
    <>
      {briefSections(brief).map((section) => (
        <section key={section.title} className="rounded-lg border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-5">
            <h2 className="text-[15px] font-semibold text-ink">{STEPS[section.step]!.title}</h2>
            <Button variant="ghost" size="sm" className="-mr-2 text-accent hover:bg-accent-soft hover:text-accent-hover" onClick={() => onEdit(section.step)} disabled={sending} aria-label={`Edit ${STEPS[section.step]!.title}`}>
              Edit
            </Button>
          </div>
          <dl className="divide-y divide-line/70 px-4 sm:px-5">
            {section.rows.map((row) => (
              <Row key={row.label} label={row.label} value={display(row.value)} />
            ))}
            {section.list ? <Row label={section.list.label} value={section.list.items.length ? section.list.items.join("\n") : NOT_PROVIDED} /> : null}
            {section.step === 3 ? (
              <div className="py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
                <dt className="text-sm text-muted">Files</dt>
                <dd className="mt-1 sm:mt-0">
                  {files.length === 0 ? (
                    <p className="text-sm text-muted">None added — you can send them later</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {files.map((file) => (
                        <li key={file.key} className="relative size-16 overflow-hidden rounded-md border border-line bg-paper" title={file.name}>
                          <img src={file.preview} alt={file.name} className={cn("size-full", file.kind === "logo" ? "object-contain p-1.5" : "object-cover")} />
                          {uploadState[file.key] ? (
                            <span className="absolute inset-0 flex items-center justify-center bg-ink/45 text-white animate-fade-in">
                              {uploadState[file.key] === "done" ? <CheckIcon className="size-5" /> : <Spinner className="size-5" />}
                              <span className="sr-only">{uploadState[file.key] === "done" ? "Uploaded" : "Uploading"}</span>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ))}
      <div className={cn("rounded-lg border p-4 sm:p-5", confirmError ? "border-danger bg-danger-soft/50" : "border-line bg-paper/60")}>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--color-accent)]"
            checked={confirmed}
            disabled={sending}
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? "confirm-error" : undefined}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          <span className="text-[15px] text-ink">I confirm these details are correct and I’m happy for PeakSwift to contact me about my website.</span>
        </label>
        {confirmError ? (
          <p id="confirm-error" className="mt-2 pl-8 text-sm text-danger" role="alert">
            {confirmError}
          </p>
        ) : null}
      </div>
    </>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  const empty = value === NOT_PROVIDED;
  return (
    <div className="py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] whitespace-pre-wrap break-words sm:mt-0", empty ? "text-muted/80" : "text-ink")}>{empty ? "—" : value}</dd>
    </div>
  );
}

/* ───────────────────────────── Success ───────────────────────────── */

function Success({ done }: { done: Done }) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, []);
  const first = done.name.trim().split(/\s+/)[0];
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-12 pb-16 sm:pt-20">
        <div className="flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok animate-pop-in">
          <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
            <path d="M5 12.5 10 17.5 19 7.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" className="animate-draw" />
          </svg>
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[28px] leading-tight font-semibold text-ink outline-none sm:text-[32px]">
          {first ? `Thanks, ${first}.` : "Thank you."} We’ve received your brief.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">
          Your answers{done.fileCount > 0 ? ` and ${done.fileCount} file${done.fileCount === 1 ? "" : "s"}` : ""} have been submitted to PeakSwift. There’s nothing else you need to do right now.
        </p>

        <div className="mt-8 flex items-center justify-between gap-4 rounded-lg border border-line bg-card p-4 shadow-card sm:p-5">
          <div>
            <p className="text-sm text-muted">Your reference</p>
            <p className="mt-0.5 font-mono text-xl font-medium tracking-wide text-ink tabular-nums">{done.reference}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void copyText(done.reference).then((ok) => {
                if (ok) setCopied(true);
              });
            }}
          >
            {copied ? <CheckIcon className="size-4 text-ok" /> : <CopyIcon className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <h2 className="mt-10 text-[15px] font-semibold text-ink">What happens next</h2>
        <ol className="mt-4 flex flex-col gap-5">
          {[
            ["We review your brief", "We’ll read through everything and start shaping ideas for your website."],
            ["We get in touch", done.email ? `We’ll contact you at ${done.email} to talk through the next steps.` : "We’ll contact you to talk through the next steps."],
            ["Thought of something else?", "Just mention your reference when we speak — there’s no need to fill in the form again."],
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-3.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent tabular-nums">{index + 1}</span>
              <div>
                <p className="text-[15px] font-medium text-ink">{title}</p>
                <p className="mt-0.5 text-sm text-ink-soft">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 border-t border-line pt-6 text-sm text-muted">You can safely close this page.</p>
      </main>
    </div>
  );
}

/* ───────────────────────────── Icons ───────────────────────────── */

type IconProps = { className?: string };
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...stroke} strokeWidth={2} />
    </svg>
  );
}
export function ArrowIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" {...stroke} />
    </svg>
  );
}
function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 3v10M3 8h10" {...stroke} />
    </svg>
  );
}
function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
    </svg>
  );
}
function UploadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 13v2a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2" {...stroke} />
    </svg>
  );
}
function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" {...stroke} />
    </svg>
  );
}
function SwapIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" {...stroke} />
    </svg>
  );
}
export function CopyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" {...stroke} />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" {...stroke} />
    </svg>
  );
}
export function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" {...stroke} />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" {...stroke} />
    </svg>
  );
}
export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" {...stroke} />
      <path d="M8 5v3l2 1.5" {...stroke} />
    </svg>
  );
}
export function SaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M4.5 13.5h7a1.5 1.5 0 0 0 1.5-1.5V5.5L10.5 3h-6A1.5 1.5 0 0 0 3 4.5V12a1.5 1.5 0 0 0 1.5 1.5Z" {...stroke} />
      <path d="M5.5 3v3h4M5.5 13.5V10h5v3.5" {...stroke} />
    </svg>
  );
}
export function FlagIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M4.5 14V2.5" {...stroke} strokeWidth={1.75} />
      <path d="M4.5 3h7.5L10 5.75 12 8.5H4.5Z" fill="currentColor" />
    </svg>
  );
}
