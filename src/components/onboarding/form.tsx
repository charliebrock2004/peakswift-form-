import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/brand";
import { prepareUpload } from "@/components/onboarding/prepare-file";
import { AreaField, Button, ChoiceGroup, TextField } from "@/components/ui/controls";
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

const DRAFT_KEY = "peakswift-brief-v1";

type LocalFile = {
  key: string;
  kind: FileKind;
  file: File;
  name: string;
  size: number;
  preview: string;
};

type Done = { reference: string };

type Update = <K extends keyof Brief>(key: K, value: Brief[K]) => void;

const inputClass = "h-12 w-full rounded-sm border border-line bg-card px-3 text-base text-ink outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15";

export function OnboardingForm() {
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [fileNote, setFileNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previews = useRef<string[]>([]);
  const skipFocus = useRef(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { step?: number; brief?: unknown };
        setBrief(mergeBrief(saved.brief));
        if (typeof saved.step === "number" && saved.step >= 0 && saved.step < STEPS.length) setStep(saved.step);
      }
    } catch {
      /* keep the empty form */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || done) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, brief }));
  }, [hydrated, step, brief, done]);

  useEffect(() => {
    return () => {
      previews.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    setFileNote("");
  }, [step]);

  useEffect(() => {
    if (skipFocus.current) {
      skipFocus.current = false;
      return;
    }
    headingRef.current?.focus();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [step, done]);

  useEffect(() => {
    if (done) return;
    const dirty = step > 0 || files.length > 0 || brief.businessName.trim().length > 0 || brief.email.trim().length > 0;
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [brief.businessName, brief.email, done, files.length, step]);

  function update<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function goTo(next: number) {
    setFormError("");
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  }

  function continueFrom(current: number) {
    const found = errorsForStep(current, brief);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError("Have a look at the fields marked below.");
      return;
    }
    setFormError("");
    goTo(current + 1);
  }

  async function addFiles(kind: FileKind, list: FileList | null) {
    if (!list?.length) return;
    setFileNote("");
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      setFileNote("That’s as many files as this form can take. You can send the rest separately.");
      return;
    }
    const incoming = Array.from(list).slice(0, room);
    if (list.length > room) setFileNote("Some files were left out so the form stays easy to send. You can send the rest separately.");
    const next: LocalFile[] = [];
    for (const file of incoming) {
      const prepared = await prepareUpload(file);
      if ("error" in prepared) {
        setFileNote(prepared.error);
        continue;
      }
      const preview = URL.createObjectURL(prepared.file);
      previews.current.push(preview);
      next.push({
        key: crypto.randomUUID(),
        kind,
        file: prepared.file,
        name: prepared.file.name,
        size: prepared.file.size,
        preview,
      });
    }
    if (next.length) setFiles((current) => [...current, ...next]);
  }

  function removeFile(key: string) {
    setFiles((current) => {
      const target = current.find((file) => file.key === key);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((file) => file.key !== key);
    });
  }

  async function submit() {
    const found = briefErrors(brief);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFormError("A few answers need a quick check before this can be sent.");
      goTo(firstStepForErrors(found));
      return;
    }
    if (!confirmed) {
      setConfirmError("Tick the confirmation before sending.");
      return;
    }
    setConfirmError("");
    setFormError("");
    setSending(true);
    try {
      setProgress("Saving your answers…");
      const created = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, confirmed: true }),
      });
      const createdBody = (await created.json()) as { token?: string; reference?: string; error?: string; fields?: Record<string, string> | null };
      if (!created.ok || !createdBody.token || !createdBody.reference) {
        if (createdBody.fields) {
          setErrors(createdBody.fields);
          goTo(firstStepForErrors(createdBody.fields));
        }
        throw new Error(createdBody.error || "Could not save the form.");
      }
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index]!;
        setProgress(`Uploading files ${index + 1} of ${files.length}…`);
        const body = new FormData();
        body.set("token", createdBody.token);
        body.set("kind", item.kind);
        body.set("file", item.file, item.name);
        const uploaded = await fetch("/api/brief-file", { method: "POST", body });
        const uploadedBody = (await uploaded.json()) as { error?: string };
        if (!uploaded.ok) throw new Error(uploadedBody.error || `Could not upload ${item.name}.`);
      }
      setProgress("Submitting…");
      const finalised = await fetch("/api/brief-finalise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: createdBody.token }),
      });
      const finalBody = (await finalised.json()) as { reference?: string; error?: string };
      if (!finalised.ok || !finalBody.reference) throw new Error(finalBody.error || "Could not submit the form.");
      localStorage.removeItem(DRAFT_KEY);
      setDone({ reference: finalBody.reference });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not send the form. Please try again.");
    } finally {
      setSending(false);
      setProgress("");
    }
  }

  if (done) return <Success reference={done.reference} />;

  const current = STEPS[step]!;
  const stepFiles = (kind: FileKind) => files.filter((file) => file.kind === kind);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-5">
        <Wordmark />
        <p className="text-sm tabular-nums text-muted" aria-live="polite">
          {step === REVIEW_STEP ? "Review" : `Step ${step + 1} of ${REVIEW_STEP}`}
        </p>
      </header>
      {step === 0 ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-2">
          <h1 ref={headingRef} tabIndex={-1} className="font-serif text-4xl leading-tight tracking-tight text-ink outline-none sm:text-5xl">
            Let’s build your website.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-soft">
            Tell us a little about your business and what you need. This short form helps PeakSwift understand your
            requirements so we can get started. Don’t worry if you don’t have everything ready — we can work out the
            details together.
          </p>
          <p className="mt-3 text-sm text-muted">Takes about 2–3 minutes. Only fields marked * are required.</p>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <div
          className="h-1 overflow-hidden rounded-full bg-paper-deep"
          role="progressbar"
          aria-label="Form progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <form
          noValidate
          className="mt-4 overflow-hidden rounded-xl border border-line bg-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (sending) return;
            if (step === STEPS.length - 1) void submit();
            else continueFrom(step);
          }}
        >
          <div className="lg:grid lg:grid-cols-[15rem_1fr]">
            <nav className="hidden border-b border-line p-4 lg:block lg:border-r lg:border-b-0" aria-label="Sections">
              <ol className="flex flex-col gap-1">
                {STEPS.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => goTo(index)}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-sm px-2 text-left text-sm ${
                        index === step ? "bg-paper font-medium text-ink" : "text-muted hover:bg-paper hover:text-ink"
                      }`}
                      aria-current={index === step ? "step" : undefined}
                    >
                      <span className="w-6 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                      {item.title}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="p-4 sm:p-8">
              <label className="mb-6 flex flex-col gap-2 lg:hidden">
                <span className="text-sm font-medium text-ink">Section</span>
                <select className={inputClass} value={step} onChange={(event) => goTo(Number(event.target.value))}>
                  {STEPS.map((item, index) => (
                    <option key={item.id} value={index}>
                      {index + 1}. {item.title}
                    </option>
                  ))}
                </select>
              </label>
              {step === 0 ? null : (
                <h1 ref={headingRef} tabIndex={-1} className="font-serif text-4xl leading-tight tracking-tight text-ink outline-none">
                  {current.title}
                </h1>
              )}
              {step === 0 ? (
                <h2 className="font-serif text-3xl leading-tight tracking-tight text-ink">{current.title}</h2>
              ) : null}
              <p className="mt-2 text-sm text-muted">{current.lede}</p>
              <div className="mt-8 flex flex-col gap-6">
                {step === 0 ? <ContactStep brief={brief} errors={errors} update={update} /> : null}
                {step === 1 ? <AboutStep brief={brief} errors={errors} update={update} /> : null}
                {step === 2 ? <DesignStep brief={brief} update={update} /> : null}
                {step === 3 ? (
                  <MaterialsStep
                    brief={brief}
                    update={update}
                    files={files}
                    note={fileNote}
                    onAdd={addFiles}
                    onRemove={removeFile}
                    onSkip={() => goTo(4)}
                    groups={stepFiles}
                  />
                ) : null}
                {step === 4 ? <FinalStep brief={brief} update={update} /> : null}
                {step === REVIEW_STEP ? (
                  <ReviewStep
                    brief={brief}
                    files={files}
                    confirmed={confirmed}
                    confirmError={confirmError}
                    onEdit={goTo}
                    onConfirm={(value) => {
                      setConfirmed(value);
                      if (value) setConfirmError("");
                    }}
                  />
                ) : null}
              </div>
              {formError ? (
                <p className="mt-6 text-sm text-danger" role="alert">
                  {formError}
                </p>
              ) : null}
              {progress ? (
                <p className="mt-4 text-sm text-muted" role="status">
                  {progress}
                </p>
              ) : null}
              <div className="mt-8 flex gap-3 border-t border-line pt-4">
                {step > 0 ? (
                  <Button variant="secondary" className="min-w-24" onClick={() => goTo(step - 1)} disabled={sending}>
                    Back
                  </Button>
                ) : null}
                {step < STEPS.length - 1 ? (
                  <Button type="submit" className="flex-1">
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" className="flex-1" disabled={sending}>
                    {sending ? "Submitting…" : "Submit"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pb-10 text-sm text-muted">
        <p>Website enquiry</p>
        <Link to="/studio" className="underline-offset-4 hover:text-ink hover:underline">
          Studio
        </Link>
      </footer>
    </div>
  );
}

function Success({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <div className="min-h-screen">
      <header className="mx-auto w-full max-w-3xl px-4 pt-5">
        <Wordmark />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col px-4 py-16">
        <p className="text-sm font-medium text-ok">Submitted</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-3 font-serif text-5xl leading-tight tracking-tight text-ink outline-none">
          Thanks!
        </h1>
        <p className="mt-4 max-w-xl text-base text-ink-soft">
          Your website brief has been submitted successfully. We’ll review your requirements and get back to you.
        </p>
        <p className="mt-2 max-w-xl text-sm text-muted">Keep your reference handy in case you need to contact us. You can close this page.</p>
        <div className="mt-8 rounded-lg border border-line bg-card p-5">
          <p className="text-sm text-muted">Your reference</p>
          <p className="mt-1 font-mono text-2xl tracking-wide text-ink tabular-nums">{reference}</p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => {
              void copyText(reference).then((ok) => {
                if (ok) setCopied(true);
              });
            }}
          >
            {copied ? "Copied" : "Copy reference"}
          </Button>
        </div>
      </main>
    </div>
  );
}

function ContactStep({ brief, errors, update }: { brief: Brief; errors: Record<string, string>; update: Update }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <TextField className="sm:col-span-2" mandatory label="Business name" name="organization" autoComplete="organization" value={brief.businessName} error={errors.businessName} onChange={(event) => update("businessName", event.target.value)} />
      <TextField mandatory label="Your name" name="name" autoComplete="name" value={brief.contactName} error={errors.contactName} onChange={(event) => update("contactName", event.target.value)} />
      <TextField mandatory label="Email address" name="email" type="email" inputMode="email" autoComplete="email" value={brief.email} error={errors.email} onChange={(event) => update("email", event.target.value)} />
      <TextField label="Phone number" name="tel" type="tel" inputMode="tel" autoComplete="tel" value={brief.phone} error={errors.phone} onChange={(event) => update("phone", event.target.value)} />
      <TextField label="Town or area served" name="area" autoComplete="address-level2" placeholder="e.g. Perth & Kinross" value={brief.area} onChange={(event) => update("area", event.target.value)} />
    </div>
  );
}

function AboutStep({ brief, errors, update }: { brief: Brief; errors: Record<string, string>; update: Update }) {
  function setService(index: number, name: string) {
    update(
      "services",
      brief.services.map((service, item) => (item === index ? { ...service, name } : service)),
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <AreaField compact mandatory label="What does the business do?" name="whatYouDo" placeholder="e.g. Family-run landscaping firm covering domestic gardens." value={brief.whatYouDo} error={errors.whatYouDo} onChange={(event) => update("whatYouDo", event.target.value)} />
      <ChoiceGroup label="Main services to show on the website">
        <div className="flex flex-col gap-2">
          {brief.services.map((service, index) => (
            <div key={service.id} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`service-${service.id}`}>
                Service {index + 1}
              </label>
              <input
                id={`service-${service.id}`}
                className={inputClass}
                placeholder={index === 0 ? "e.g. Garden design" : `Service ${index + 1}`}
                value={service.name}
                maxLength={160}
                onChange={(event) => setService(index, event.target.value)}
              />
              {brief.services.length > 1 ? (
                <button
                  type="button"
                  className="min-h-11 shrink-0 px-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
                  aria-label={`Remove service ${index + 1}`}
                  onClick={() => update("services", brief.services.filter((_, item) => item !== index))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => update("services", [...brief.services, { id: `service-${crypto.randomUUID()}`, name: "" }])}
        >
          + Add a service
        </Button>
      </ChoiceGroup>
      <AreaField compact label="What makes the business different?" name="whatMakesDifferent" value={brief.whatMakesDifferent} onChange={(event) => update("whatMakesDifferent", event.target.value)} />
      <TextField label="Opening hours" name="openingHours" placeholder="e.g. Mon–Fri 8am–5pm" value={brief.openingHours} onChange={(event) => update("openingHours", event.target.value)} />
    </div>
  );
}

function DesignStep({ brief, update }: { brief: Brief; update: Update }) {
  function toggle(feature: FeatureChoice) {
    const has = brief.features.includes(feature);
    update("features", has ? brief.features.filter((item) => item !== feature) : [...brief.features, feature]);
  }
  return (
    <div className="flex flex-col gap-6">
      <PillRadio label="Website style" name="style" options={STYLE_OPTIONS} value={brief.style} onChange={(value) => update("style", value)} />
      <TextField label="Preferred colours" name="preferredColours" placeholder="e.g. Navy and white" value={brief.preferredColours} onChange={(event) => update("preferredColours", event.target.value)} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="A website you like" name="example1" inputMode="url" placeholder="e.g. www.example.co.uk" value={brief.example1} onChange={(event) => update("example1", event.target.value)} />
        <TextField label="Another website you like" name="example2" inputMode="url" placeholder="Optional" value={brief.example2} onChange={(event) => update("example2", event.target.value)} />
      </div>
      <ChoiceGroup label="Features you need" hint="Tap any that apply.">
        <div className="flex flex-wrap gap-2">
          {FEATURE_OPTIONS.map((feature) => {
            const selected = brief.features.includes(feature);
            return (
              <button key={feature} type="button" aria-pressed={selected} onClick={() => toggle(feature)} className={pillClass(selected)}>
                {feature}
              </button>
            );
          })}
        </div>
      </ChoiceGroup>
      <TextField label="Anything else it should do?" name="featuresOther" placeholder="Optional" value={brief.featuresOther} onChange={(event) => update("featuresOther", event.target.value)} />
    </div>
  );
}

function MaterialsStep({
  brief,
  update,
  files,
  note,
  onAdd,
  onRemove,
  onSkip,
  groups,
}: {
  brief: Brief;
  update: Update;
  files: LocalFile[];
  note: string;
  onAdd: (kind: FileKind, list: FileList | null) => void;
  onRemove: (key: string) => void;
  onSkip: () => void;
  groups: (kind: FileKind) => LocalFile[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-3">
        <p className="text-sm text-ink-soft">Don’t have these ready?</p>
        <Button variant="secondary" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
      <Uploader label="Logo" kind="logo" files={groups("logo")} onAdd={onAdd} onRemove={onRemove} />
      <Uploader label="Photos" hint="Your work, team or premises." kind="work" files={groups("work")} onAdd={onAdd} onRemove={onRemove} />
      {note ? (
        <p className="text-sm text-danger" role="alert">
          {note}
        </p>
      ) : null}
      {files.length > 0 ? <p className="text-sm text-muted">{`${files.length} file${files.length === 1 ? "" : "s"} ready.`}</p> : null}
      <TextField label="Existing website" name="existingWebsite" inputMode="url" placeholder="e.g. www.mybusiness.co.uk" value={brief.existingWebsite} onChange={(event) => update("existingWebsite", event.target.value)} />
      <AreaField compact label="Facebook, Instagram or other social links" name="socialLinks" placeholder="One per line" value={brief.socialLinks} onChange={(event) => update("socialLinks", event.target.value)} />
      <TextField label="Existing domain or Google Business Profile" name="domainGbp" placeholder="e.g. mybusiness.co.uk" value={brief.domainGbp} onChange={(event) => update("domainGbp", event.target.value)} />
    </div>
  );
}

function FinalStep({ brief, update }: { brief: Brief; update: Update }) {
  return (
    <div className="flex flex-col gap-6">
      <PillRadio label="Preferred timescale" name="timescale" options={TIMESCALE_OPTIONS} value={brief.timescale} onChange={(value) => update("timescale", value)} />
      <PillRadio label="Budget range" name="budget" options={BUDGET_OPTIONS} value={brief.budget} onChange={(value) => update("budget", value)} />
      <AreaField compact label="Anything else we should know?" name="anythingElse" value={brief.anythingElse} onChange={(event) => update("anythingElse", event.target.value)} />
    </div>
  );
}

function pillClass(selected: boolean): string {
  return `inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors ${
    selected ? "bg-accent text-accent-fg" : "border border-line bg-paper text-ink hover:border-ink/40"
  }`;
}

/** Single choice shown as tappable pills. Native radios keep it keyboard and screen-reader friendly; tap again to clear. */
function PillRadio<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: readonly T[];
  value: T | "";
  onChange: (value: T | "") => void;
}) {
  return (
    <ChoiceGroup label={label}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option;
          return (
            <label key={option} className={`${pillClass(selected)} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/30`}>
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
              {option}
            </label>
          );
        })}
      </div>
    </ChoiceGroup>
  );
}

function Uploader({
  label,
  hint,
  kind,
  files,
  onAdd,
  onRemove,
}: {
  label: string;
  hint?: string;
  kind: FileKind;
  files: LocalFile[];
  onAdd: (kind: FileKind, list: FileList | null) => void;
  onRemove: (key: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      <label htmlFor={id} className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-paper px-4 py-5 text-center">
        <span className="text-sm font-medium text-ink">Add files</span>
        <span className="mt-1 text-sm text-muted">JPG, JPEG, PNG, WEBP or SVG</span>
        <input
          id={id}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml,.jpg,.jpeg,.png,.webp,.svg"
          multiple
          onChange={(event) => {
            onAdd(kind, event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {files.map((file) => (
            <li key={file.key} className="flex items-center gap-3 rounded-sm border border-line bg-card p-2">
              <img src={file.preview} alt="" className="size-14 rounded-sm object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{file.name}</p>
                <p className="text-sm text-muted">{formatBytes(file.size)}</p>
              </div>
              <button type="button" className="min-h-11 px-3 text-sm text-ink" onClick={() => onRemove(file.key)}>
                Remove
              </button>
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
  confirmed,
  confirmError,
  onEdit,
  onConfirm,
}: {
  brief: Brief;
  files: LocalFile[];
  confirmed: boolean;
  confirmError: string;
  onEdit: (step: number) => void;
  onConfirm: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {briefSections(brief).map((section) => (
        <ReviewCard key={section.title} title={section.title} onEdit={() => onEdit(section.step)}>
          {section.rows.map((row) => (
            <Row key={row.label} label={row.label} value={display(row.value)} />
          ))}
          {section.list ? <Row label={section.list.label} value={section.list.items.length ? section.list.items.join("\n") : NOT_PROVIDED} /> : null}
          {section.step === 3 ? (
            <div>
              <p className="text-sm text-muted">Files</p>
              <FileLines files={files} empty="No files added — you can send them later" />
            </div>
          ) : null}
        </ReviewCard>
      ))}
      <div className="rounded-lg border border-ink bg-paper p-4">
        <h2 className="font-serif text-2xl text-ink">Everything look right?</h2>
        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-ink"
            checked={confirmed}
            aria-invalid={confirmError ? true : undefined}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          <span className="text-sm text-ink">I confirm these details are correct and I’m happy for PeakSwift to contact me about my website.</span>
        </label>
        {confirmError ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {confirmError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <button type="button" className="min-h-11 px-2 text-sm text-ink underline-offset-4 hover:underline" onClick={onEdit} aria-label={`Edit ${title}`}>
          Edit
        </button>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const empty = value === NOT_PROVIDED;
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-sm whitespace-pre-wrap break-words ${empty ? "text-muted" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function FileLines({ files, empty }: { files: LocalFile[]; empty: string }) {
  if (files.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {files.map((file) => (
        <li key={file.key} className="truncate text-sm text-ink">
          {file.name}
        </li>
      ))}
    </ul>
  );
}
