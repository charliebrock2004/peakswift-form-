/**
 * "Request your free website example" — the short form cold-email recipients
 * land on. Same design system, uploader and submit pipeline as the full
 * website brief, but four screens and about two minutes.
 *
 * The campaign reference (?c=…) comes from the email link and identifies a
 * campaign, never a person. Nothing personal is ever read from the URL.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { draftFileStore } from "@/components/onboarding/draft-files";
import {
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  FlagIcon,
  Header,
  LockIcon,
  Row,
  SaveIcon,
  SubmitProgress,
  Uploader,
  type LocalFile,
} from "@/components/onboarding/form";
import { prepareUpload } from "@/components/onboarding/prepare-file";
import { postForm, postJson } from "@/components/onboarding/submit-client";
import { AreaField, Button, FieldGroup, Spinner, TextField } from "@/components/ui/controls";
import { copyText } from "@/lib/onboarding/copy-text";
import {
  cleanCampaignRef,
  emptyExampleRequest,
  EXAMPLE_REVIEW_STEP,
  EXAMPLE_STEPS,
  exampleErrors,
  exampleErrorsForStep,
  exampleSections,
  firstExampleStepForErrors,
  mergeExampleRequest,
  OFFER_SUMMARY,
  PRIVACY_NOTICE,
  type ExampleRequest,
} from "@/lib/onboarding/example-model";
import { MAX_FILES } from "@/lib/onboarding/files";
import type { FileKind } from "@/lib/onboarding/model";
import { display } from "@/lib/onboarding/model";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "peakswift-free-example-v1";
const drafts = draftFileStore("peakswift-free-example-files");
const QUESTION_STEPS = EXAMPLE_REVIEW_STEP;
const MAX_EXAMPLE_FILES = Math.min(MAX_FILES, 12);

type Update = <K extends keyof ExampleRequest>(key: K, value: ExampleRequest[K]) => void;
type Session = { token: string; fingerprint: string; uploaded: Set<string> };
type Done = { reference: string; name: string; email: string; fileCount: number };

function readDraft(): { request: ExampleRequest; step: number; furthest: number; campaign: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { request?: unknown; step?: number; furthest?: number; campaign?: unknown };
    const step = typeof saved.step === "number" && saved.step >= 0 && saved.step < EXAMPLE_STEPS.length ? saved.step : 0;
    const furthest = typeof saved.furthest === "number" ? Math.max(step, Math.min(saved.furthest, EXAMPLE_STEPS.length - 1)) : step;
    return { request: mergeExampleRequest(saved.request), step, furthest, campaign: cleanCampaignRef(saved.campaign) };
  } catch {
    return null;
  }
}

function hasAnswers(request: ExampleRequest): boolean {
  return Boolean(request.businessName || request.contactName || request.email || request.trade);
}

export function ExampleRequestForm() {
  const [phase, setPhase] = useState<"intro" | "form">("intro");
  const [request, setRequest] = useState<ExampleRequest>(emptyExampleRequest);
  const [campaign, setCampaign] = useState("");
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
  const honeypot = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fromLink = cleanCampaignRef(new URLSearchParams(window.location.search).get("c"));
    const draft = readDraft();
    if (draft) {
      setRequest(draft.request);
      setStep(draft.step);
      setFurthest(draft.furthest);
      if (hasAnswers(draft.request) || draft.step > 0) setResumable(true);
    }
    // The link they arrived on wins; otherwise keep the campaign a saved draft came from.
    setCampaign(fromLink || draft?.campaign || "");
    let cancelled = false;
    void drafts.load().then((stored) => {
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

  useEffect(() => {
    if (!hydrated || done || phase !== "form") return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, furthest, request, campaign }));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [hydrated, step, furthest, request, campaign, done, phase]);

  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((file) => URL.revokeObjectURL(file.preview)), []);

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

  useEffect(() => {
    if (!sending) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [sending]);

  const update: Update = useCallback((key, value) => {
    setRequest((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }, []);

  /** Inline validation: check a field as soon as the person leaves it. */
  const validateField = useCallback(
    (key: keyof ExampleRequest) => {
      const problem = exampleErrors(mergeExampleRequest(request))[key];
      setErrors((current) => {
        if (problem) return { ...current, [key]: problem };
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    [request],
  );

  function goTo(next: number) {
    const target = Math.max(0, Math.min(EXAMPLE_STEPS.length - 1, next));
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
    const found = exampleErrorsForStep(current, mergeExampleRequest(request));
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
    void drafts.clear();
    files.forEach((file) => URL.revokeObjectURL(file.preview));
    setFiles([]);
    setRequest(emptyExampleRequest());
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
    const room = MAX_EXAMPLE_FILES - filesRef.current.length;
    if (room <= 0) {
      setFileNotes((current) => ({ ...current, [kind]: [`That’s plenty — this form takes up to ${MAX_EXAMPLE_FILES} images.`] }));
      return;
    }
    const incoming = list.slice(0, room);
    if (list.length > room) notes.push(`${list.length - room} image${list.length - room === 1 ? " was" : "s were"} left out — this form takes up to ${MAX_EXAMPLE_FILES}.`);
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
      void drafts.save({ key, kind, name: item.name, type: item.file.type, blob: item.file, order: order.current++ });
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
    void drafts.remove(key);
    void drafts.save({ key: item.key, kind: item.kind, name: item.name, type: item.file.type, blob: item.file, order: order.current++ });
  }

  function removeFile(key: string) {
    if (sendingRef.current) return;
    setFiles((current) => {
      const target = current.find((file) => file.key === key);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((file) => file.key !== key);
    });
    void drafts.remove(key);
  }

  async function submit() {
    if (sendingRef.current) return;
    const clean = mergeExampleRequest(request);
    const found = exampleErrors(clean);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      goTo(firstExampleStepForErrors(found));
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
    const fingerprint = JSON.stringify({ clean, campaign });
    const current = session.current;
    if (current && (current.fingerprint !== fingerprint || [...current.uploaded].some((key) => !files.some((file) => file.key === key)))) {
      session.current = null;
    }
    try {
      if (!session.current) {
        setProgress({ label: "Saving your details…", percent: 8 });
        const created = await postJson<{ token?: string; reference?: string; fields?: Record<string, string> | null; ignored?: boolean }>("/api/example-request", {
          request: clean,
          confirmed: true,
          campaign,
          website_url: honeypot.current?.value ?? "",
        });
        if (created.ok && created.body.ignored) {
          setDone({ reference: "", name: clean.contactName, email: clean.email, fileCount: 0 });
          return;
        }
        if (!created.ok || !created.body.token) {
          if (created.body.fields) {
            setErrors(created.body.fields);
            goTo(firstExampleStepForErrors(created.body.fields));
          }
          throw new Error(created.body.error || "We couldn’t save your details. Please try again.");
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
          const percent = 12 + ((sentBytes + item.size * fraction) / totalBytes) * 76;
          setProgress({ label: `Uploading ${pending.length === 1 ? "your image" : `image ${index + 1} of ${pending.length}`}…`, percent });
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
      setProgress({ label: "Sending your request…", percent: 92 });
      const finalised = await postJson<{ reference?: string }>("/api/brief-finalise", { token: active.token });
      if (!finalised.ok || !finalised.body.reference) {
        if (/expired|missing/i.test(finalised.body.error ?? "")) session.current = null;
        throw new Error(finalised.body.error || "We couldn’t send your request. Please try again.");
      }
      setProgress({ label: "Done", percent: 100 });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      void drafts.clear();
      session.current = null;
      setDone({ reference: finalised.body.reference, name: clean.contactName, email: clean.email, fileCount: files.length });
    } catch (error) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setFormError(
        offline
          ? "You appear to be offline. Your answers are saved on this device — reconnect and press Send again."
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

  if (done) return <ExampleSuccess done={done} />;

  if (phase === "intro") {
    return (
      <ExampleIntro
        ready={hydrated}
        resumable={resumable}
        businessName={request.businessName}
        onStart={() => (resumable ? startFresh() : setPhase("form"))}
        onResume={() => setPhase("form")}
        headingRef={headingRef}
      />
    );
  }

  const current = EXAMPLE_STEPS[step]!;
  const isReview = step === EXAMPLE_REVIEW_STEP;
  const busyPreparing = Object.values(preparing).some((count) => count > 0);

  return (
    <div className="min-h-dvh">
      <Header>
        <span className={cn("hidden items-center gap-1.5 text-sm text-muted transition-opacity sm:inline-flex", saved ? "opacity-100" : "opacity-0")}>
          <CheckIcon className="size-4 text-ok" />
          Saved on this device
        </span>
      </Header>

      <div className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6 lg:pt-6">
        <main className="min-w-0">
          <Progress step={step} furthest={furthest} disabled={sending} onSelect={goTo} />
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
            {/* Honeypot — hidden from people and assistive technology. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Leave this empty
                <input ref={honeypot} type="text" name="website_url" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            <div key={step} className="animate-step-in px-5 pt-6 pb-8 sm:px-10 sm:pt-10">
              <p className="text-sm font-medium text-accent">{isReview ? "Last step" : `Step ${step + 1} of ${QUESTION_STEPS}`}</p>
              <h1 ref={headingRef} tabIndex={-1} className="mt-1.5 text-2xl font-semibold text-ink outline-none sm:text-[28px] sm:leading-tight">
                {current.title}
              </h1>
              <p className="mt-2 max-w-xl text-[15px] text-ink-soft">{current.lede}</p>

              <div className="mt-8 flex flex-col gap-7">
                {step === 0 ? <BusinessStep request={request} errors={errors} update={update} onBlur={validateField} /> : null}
                {step === 1 ? <DetailsStep request={request} errors={errors} update={update} onBlur={validateField} /> : null}
                {step === 2 ? (
                  <>
                    <FieldGroup title="Your logo" description="If you have one. A photo of a van or sign is fine too.">
                      <Uploader kind="logo" label="a logo" files={files.filter((file) => file.kind === "logo")} preparing={preparing.logo ?? 0} notes={fileNotes.logo ?? []} contain onAdd={addFiles} onReplace={replaceFile} onRemove={removeFile} />
                    </FieldGroup>
                    <FieldGroup title="Photos of your work" description="A few of your best jobs, your premises or your team. Only send photos you’re happy for us to use in the example.">
                      <Uploader kind="work" label="photos" files={files.filter((file) => file.kind === "work")} preparing={preparing.work ?? 0} notes={fileNotes.work ?? []} onAdd={addFiles} onReplace={replaceFile} onRemove={removeFile} />
                    </FieldGroup>
                    <p className="text-sm text-muted">No photos to hand? Skip this — we can use neutral placeholder images in the example.</p>
                  </>
                ) : null}
                {isReview ? (
                  <ReviewStep
                    request={request}
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
                  <Button type="submit" size="lg" className="flex-1 sm:w-60 sm:flex-none" loading={sending} disabled={busyPreparing}>
                    {sending ? "Sending…" : "Request my free example"}
                  </Button>
                ) : (
                  <Button type="submit" size="lg" className="flex-1 sm:w-48 sm:flex-none" disabled={busyPreparing}>
                    {step === 2 ? (files.length ? "Review & send" : "Skip & review") : "Continue"}
                    <ArrowIcon className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </form>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-sm text-muted">
            <LockIcon className="size-3.5" />
            Your details are only shared with PeakSwift Studio.
          </p>
        </main>
      </div>
    </div>
  );
}

/* ───────────────────────────── Pieces ───────────────────────────── */

function Progress({ step, furthest, disabled, onSelect }: { step: number; furthest: number; disabled: boolean; onSelect: (step: number) => void }) {
  const isReview = step === EXAMPLE_REVIEW_STEP;
  return (
    <div className="pt-4 pb-4">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{EXAMPLE_STEPS[step]!.title}</span>
        <span className="tabular-nums text-muted">{isReview ? "Ready to send" : `${step + 1} of ${QUESTION_STEPS}`}</span>
      </div>
      <ol
        className="flex gap-1.5"
        role="progressbar"
        aria-label="Form progress"
        aria-valuemin={0}
        aria-valuemax={QUESTION_STEPS}
        aria-valuenow={isReview ? QUESTION_STEPS : step}
        aria-valuetext={isReview ? "Reviewing answers" : `Step ${step + 1} of ${QUESTION_STEPS}`}
      >
        {EXAMPLE_STEPS.map((item, index) => (
          <li key={item.id} className="flex-1">
            <button
              type="button"
              className="block w-full py-1.5 disabled:cursor-default"
              disabled={disabled || index > furthest}
              onClick={() => onSelect(index)}
              aria-label={`Go to ${item.title}`}
            >
              <span className="block h-1 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out"
                  style={{ transform: `scaleX(${index < step ? 1 : index === step ? (isReview ? 1 : 0.5) : 0})` }}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

type StepProps = { request: ExampleRequest; errors: Record<string, string>; update: Update; onBlur: (key: keyof ExampleRequest) => void };

function BusinessStep({ request, errors, update, onBlur }: StepProps) {
  return (
    <>
      <FieldGroup title="About the business">
        <TextField mandatory label="Business name" name="organization" autoComplete="organization" maxLength={200} value={request.businessName} error={errors.businessName} onBlur={() => onBlur("businessName")} onChange={(event) => update("businessName", event.target.value)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField mandatory label="Trade or type of business" name="trade" maxLength={160} placeholder="e.g. Joiner, Café, Hairdresser" value={request.trade} error={errors.trade} onBlur={() => onBlur("trade")} onChange={(event) => update("trade", event.target.value)} />
          <TextField mandatory label="Town or area you cover" name="area" autoComplete="address-level2" maxLength={200} placeholder="e.g. Crieff & Strathearn" value={request.area} error={errors.area} onBlur={() => onBlur("area")} onChange={(event) => update("area", event.target.value)} />
        </div>
      </FieldGroup>
      <FieldGroup title="Where to send the example" description="We’ll only use these to send your example and talk to you about it.">
        <TextField mandatory label="Your name" name="name" autoComplete="name" maxLength={200} value={request.contactName} error={errors.contactName} onBlur={() => onBlur("contactName")} onChange={(event) => update("contactName", event.target.value)} />
        <TextField mandatory label="Email address" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={200} value={request.email} error={errors.email} onBlur={() => onBlur("email")} onChange={(event) => update("email", event.target.value)} />
      </FieldGroup>
    </>
  );
}

function DetailsStep({ request, errors, update, onBlur }: StepProps) {
  return (
    <>
      <FieldGroup title="Where you are online" description="So the example can match what customers already see.">
        <TextField label="Existing website" name="url" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={300} placeholder="yourbusiness.co.uk" value={request.existingWebsite} error={errors.existingWebsite} onBlur={() => onBlur("existingWebsite")} onChange={(event) => update("existingWebsite", event.target.value)} />
        <TextField label="Facebook or Instagram page" name="social" maxLength={600} autoCapitalize="none" spellCheck={false} placeholder="facebook.com/yourbusiness" value={request.social} onChange={(event) => update("social", event.target.value)} />
      </FieldGroup>
      <FieldGroup title="What to show">
        <AreaField compact label="A short description of the business" hint="What you do and who for, in a sentence or two." maxLength={1200} value={request.description} onChange={(event) => update("description", event.target.value)} />
        <AreaField compact label="Services you’d like showcased" hint="One per line is perfect." maxLength={1200} placeholder={"Kitchen fitting\nBespoke staircases"} value={request.services} onChange={(event) => update("services", event.target.value)} />
        <AreaField compact label="Anything else we should know?" hint="Colours you like, a website you admire, things to avoid." maxLength={2000} value={request.instructions} onChange={(event) => update("instructions", event.target.value)} />
      </FieldGroup>
    </>
  );
}

function ReviewStep({
  request,
  files,
  uploadState,
  confirmed,
  confirmError,
  sending,
  onEdit,
  onConfirm,
}: {
  request: ExampleRequest;
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
      {exampleSections(mergeExampleRequest(request)).map((section) => (
        <section key={section.title} className="rounded-lg border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-5">
            <h2 className="text-[15px] font-semibold text-ink">{EXAMPLE_STEPS[section.step]!.title}</h2>
            <Button variant="ghost" size="sm" className="-mr-2 text-accent hover:bg-accent-soft hover:text-accent-hover" onClick={() => onEdit(section.step)} disabled={sending} aria-label={`Edit ${EXAMPLE_STEPS[section.step]!.title}`}>
              Edit
            </Button>
          </div>
          <dl className="divide-y divide-line/70 px-4 sm:px-5">
            {section.rows.map((row) => (
              <Row key={row.label} label={row.label} value={display(row.value)} />
            ))}
          </dl>
        </section>
      ))}
      <section className="rounded-lg border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-5">
          <h2 className="text-[15px] font-semibold text-ink">Logo & photos</h2>
          <Button variant="ghost" size="sm" className="-mr-2 text-accent hover:bg-accent-soft hover:text-accent-hover" onClick={() => onEdit(2)} disabled={sending} aria-label="Edit logo and photos">
            Edit
          </Button>
        </div>
        <div className="px-4 py-3 sm:px-5">
          {files.length === 0 ? (
            <p className="text-sm text-muted">None added</p>
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
        </div>
      </section>

      <details className="group rounded-lg border border-line bg-paper/60 px-4 py-3 sm:px-5" open>
        <summary className="cursor-pointer list-none text-[15px] font-semibold text-ink marker:hidden">
          How we use your details
          <span className="ml-1 text-sm font-normal text-muted group-open:hidden">(show)</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-ink-soft">
          {PRIVACY_NOTICE.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </details>

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
          <span className="text-[15px] text-ink">
            I’d like a free homepage example for this business, and I’m happy for PeakSwift to use these details and images to prepare it and email me about it.
          </span>
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

function ExampleIntro({
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
  const stages = EXAMPLE_STEPS.slice(0, QUESTION_STEPS);
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pt-10 pb-12 sm:px-6 sm:pt-16 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-16 lg:pt-24">
        <div className="animate-step-in">
          <p className="text-sm font-medium text-accent">Free website example</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-3 max-w-xl text-[32px] leading-[1.15] font-semibold text-ink outline-none sm:text-[40px]">
            Request your free website example.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-soft sm:text-[17px]">
            Tell us a little about your business and we’ll design an example of how your website homepage could look — so you can see it before deciding whether to take it any further.
          </p>
          <div className="mt-6 max-w-lg rounded-lg border border-line bg-card p-4 text-sm leading-relaxed text-ink-soft shadow-xs">
            <p className="font-medium text-ink">What you’ll get</p>
            <p className="mt-1">{OFFER_SUMMARY}</p>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-ink-soft">
            <li className="flex items-center gap-2">
              <ClockIcon className="size-4 text-muted" />
              About 2 minutes
            </li>
            <li className="flex items-center gap-2">
              <SaveIcon className="size-4 text-muted" />
              Saves as you go
            </li>
            <li className="flex items-center gap-2">
              <LockIcon className="size-4 text-muted" />
              No obligation
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
          {resumable ? <p className="mt-3 text-sm text-muted">We saved your answers{businessName ? ` for ${businessName}` : ""} on this device.</p> : null}
        </div>

        <aside className="mt-12 animate-step-in lg:mt-2" aria-label="What we’ll ask">
          <div className="rounded-xl border border-line bg-card p-5 shadow-card sm:p-6">
            <h2 className="text-sm font-semibold text-ink">What we’ll ask</h2>
            <ol className="mt-4 flex flex-col">
              {stages.map((item, index) => (
                <li key={item.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                  {index < stages.length - 1 ? <span className="absolute top-7 bottom-1 left-[11px] w-px bg-line" aria-hidden="true" /> : null}
                  <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card text-xs font-medium text-muted tabular-nums">{index + 1}</span>
                  <div className="pt-0.5">
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    <p className="text-sm text-muted">{INTRO_HINTS[index]}</p>
                  </div>
                </li>
              ))}
              <li className="relative flex gap-3.5">
                <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card text-muted">
                  <FlagIcon className="size-3" />
                </span>
                <div className="pt-0.5">
                  <p className="text-sm font-medium text-ink">Check & send</p>
                  <p className="text-sm text-muted">Review it, then request your example</p>
                </div>
              </li>
            </ol>
          </div>
        </aside>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 pb-8 text-sm text-muted sm:px-6">
        <p>© PeakSwift Studio</p>
        <Link to="/" className="rounded-sm underline-offset-4 hover:text-ink hover:underline">
          Ready for a full website? Start a project brief
        </Link>
      </footer>
    </div>
  );
}

const INTRO_HINTS = ["Name, trade, town and email", "Website, socials and services — optional", "Logo and photos — optional"];

function ExampleSuccess({ done }: { done: Done }) {
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
          {first ? `Thanks, ${first}.` : "Thank you."} Your request has been received.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-soft">
          Your details{done.fileCount > 0 ? ` and ${done.fileCount} image${done.fileCount === 1 ? "" : "s"}` : ""} have been sent to PeakSwift Studio. Charlie will review them personally.
        </p>

        {done.reference ? (
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
        ) : null}

        <h2 className="mt-10 text-[15px] font-semibold text-ink">What happens next</h2>
        <ol className="mt-4 flex flex-col gap-5">
          {[
            ["We review your details", "We’ll look through what you’ve sent to see how your homepage could look."],
            ["We’ll be in touch", done.email ? `We’ll email you at ${done.email} about your example.` : "We’ll email you about your example."],
            ["No obligation", "The example is free. You decide whether you’d like to take it any further."],
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
