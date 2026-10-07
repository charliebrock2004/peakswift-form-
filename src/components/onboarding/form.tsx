import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/brand";
import { prepareUpload } from "@/components/onboarding/prepare-file";
import { AreaField, Button, ChoiceGroup, TextField } from "@/components/ui/controls";
import { copyText } from "@/lib/onboarding/copy-text";
import { formatBytes, MAX_FILES } from "@/lib/onboarding/files";
import {
  briefErrors,
  CONTACT_OPTIONS,
  contactLabel,
  display,
  emptyBrief,
  errorsForStep,
  firstStepForErrors,
  mergeBrief,
  STEPS,
  STYLE_OPTIONS,
  type Brief,
  type ContactMethod,
  type FileKind,
  type Service,
  type StyleChoice,
  type YesNo,
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
      setProgress("Sending…");
      const finalised = await fetch("/api/brief-finalise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: createdBody.token }),
      });
      const finalBody = (await finalised.json()) as { reference?: string; error?: string };
      if (!finalised.ok || !finalBody.reference) throw new Error(finalBody.error || "Could not send the form.");
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
        <p className="text-sm tabular-nums text-muted">
          {step + 1} / {STEPS.length}
        </p>
      </header>
      {step === 0 ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-2">
          <h1 ref={headingRef} tabIndex={-1} className="font-serif text-4xl leading-tight tracking-tight text-ink outline-none sm:text-5xl">
            Welcome to PeakSwift — Let’s Build Your Website
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-soft">
            Congratulations on winning your PeakSwift website! This short form helps us collect everything we need to
            start designing your website. Don’t worry if you don’t have an answer for everything — you can leave
            anything you’re unsure about blank and we’ll help you with it.
          </p>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="h-1 overflow-hidden rounded-full bg-paper-deep" aria-hidden="true">
          <div className="h-full bg-ink" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <form
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
                {step === 0 ? <BusinessStep brief={brief} errors={errors} update={update} /> : null}
                {step === 1 ? <AboutStep brief={brief} update={update} /> : null}
                {step === 2 ? <ServicesStep brief={brief} errors={errors} update={update} /> : null}
                {step === 3 ? (
                  <PhotosStep files={files} note={fileNote} onAdd={addFiles} onRemove={removeFile} groups={stepFiles} />
                ) : null}
                {step === 4 ? (
                  <ReviewsStep brief={brief} update={update} files={stepFiles("review")} note={fileNote} onAdd={addFiles} onRemove={removeFile} />
                ) : null}
                {step === 5 ? <SocialStep brief={brief} update={update} /> : null}
                {step === 6 ? <ContactStep brief={brief} errors={errors} update={update} /> : null}
                {step === 7 ? <DesignStep brief={brief} errors={errors} update={update} /> : null}
                {step === 8 ? <DomainStep brief={brief} errors={errors} update={update} /> : null}
                {step === 9 ? <GoogleStep brief={brief} update={update} /> : null}
                {step === 10 ? <ElseStep brief={brief} update={update} /> : null}
                {step === 11 ? (
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
              {progress ? <p className="mt-4 text-sm text-muted">{progress}</p> : null}
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
                    {sending ? "Sending…" : "Submit website information"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pb-10 text-sm text-muted">
        <p>Website onboarding</p>
        <Link to="/studio" className="underline-offset-4 hover:text-ink hover:underline">
          Studio
        </Link>
      </footer>
    </div>
  );
}

function Success({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-h-screen">
      <header className="mx-auto w-full max-w-3xl px-4 pt-5">
        <Wordmark />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col px-4 py-16">
        <p className="text-sm font-medium text-ok">Sent to PeakSwift</p>
        <h1 className="mt-3 font-serif text-5xl leading-tight tracking-tight text-ink">You’re all set</h1>
        <p className="mt-4 max-w-xl text-base text-ink-soft">
          We’ve got your website information. PeakSwift will use it to start the design, and will be in touch if
          anything else is needed. You can close this page.
        </p>
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

function BusinessStep({
  brief,
  errors,
  update,
}: {
  brief: Brief;
  errors: Record<string, string>;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <TextField className="sm:col-span-2" label="Business name" name="organization" autoComplete="organization" value={brief.businessName} error={errors.businessName} onChange={(event) => update("businessName", event.target.value)} />
      <TextField label="Your name" name="name" autoComplete="name" value={brief.yourName} error={errors.yourName} onChange={(event) => update("yourName", event.target.value)} />
      <TextField label="Phone number" name="tel" type="tel" inputMode="tel" autoComplete="tel" value={brief.phone} error={errors.phone} onChange={(event) => update("phone", event.target.value)} />
      <TextField className="sm:col-span-2" label="Email address" name="email" type="email" inputMode="email" autoComplete="email" value={brief.email} error={errors.email} hint="Email or phone is enough if you only have one." onChange={(event) => update("email", event.target.value)} />
      <TextField className="sm:col-span-2" label="Business address/location" name="address" autoComplete="street-address" value={brief.address} onChange={(event) => update("address", event.target.value)} />
      <AreaField className="sm:col-span-2" label="Opening hours" name="openingHours" value={brief.openingHours} onChange={(event) => update("openingHours", event.target.value)} />
      <AreaField className="sm:col-span-2" label="Areas you cover" name="areasCovered" value={brief.areasCovered} onChange={(event) => update("areasCovered", event.target.value)} />
    </div>
  );
}

function AboutStep({ brief, update }: { brief: Brief; update: <K extends keyof Brief>(key: K, value: Brief[K]) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <AreaField label="What does your business do?" name="whatYouDo" value={brief.whatYouDo} onChange={(event) => update("whatYouDo", event.target.value)} />
      <TextField label="How long have you been trading?" name="howLongTrading" value={brief.howLongTrading} onChange={(event) => update("howLongTrading", event.target.value)} />
      <AreaField label="What makes your business different?" name="whatMakesDifferent" value={brief.whatMakesDifferent} onChange={(event) => update("whatMakesDifferent", event.target.value)} />
      <AreaField label="What would you like customers to know about your business?" name="customerShouldKnow" value={brief.customerShouldKnow} onChange={(event) => update("customerShouldKnow", event.target.value)} />
      <AreaField label="Qualifications, experience or certifications" name="qualifications" value={brief.qualifications} onChange={(event) => update("qualifications", event.target.value)} />
    </div>
  );
}

function ServicesStep({
  brief,
  errors,
  update,
}: {
  brief: Brief;
  errors: Record<string, string>;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
}) {
  function setService(index: number, patch: Partial<Service>) {
    const services = brief.services.map((service, item) => (item === index ? { ...service, ...patch } : service));
    update("services", services);
  }
  return (
    <div className="flex flex-col gap-4">
      {brief.services.map((service, index) => (
        <div key={service.id} className="rounded-lg border border-line bg-paper p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">Service {index + 1}</p>
            {brief.services.length > 1 ? (
              <button
                type="button"
                className="min-h-11 px-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
                onClick={() => update("services", brief.services.filter((_, item) => item !== index))}
              >
                Remove
              </button>
            ) : null}
          </div>
          <div className="flex flex-col gap-4">
            <TextField label="Service name" name={`service-name-${service.id}`} value={service.name} error={errors[`services.${index}.name`]} onChange={(event) => setService(index, { name: event.target.value })} />
            <AreaField label="Short description" name={`service-description-${service.id}`} value={service.description} onChange={(event) => setService(index, { description: event.target.value })} />
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={() => update("services", [...brief.services, { id: `service-${crypto.randomUUID()}`, name: "", description: "" }])}
      >
        + Add another service
      </Button>
    </div>
  );
}

function PhotosStep({
  files,
  note,
  onAdd,
  onRemove,
  groups,
}: {
  files: LocalFile[];
  note: string;
  onAdd: (kind: FileKind, list: FileList | null) => void;
  onRemove: (key: string) => void;
  groups: (kind: FileKind) => LocalFile[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-soft">You can also send additional photos separately if you have lots of them.</p>
      <Uploader label="Logo" hint="JPG, PNG, WEBP or SVG" kind="logo" files={groups("logo")} onAdd={onAdd} onRemove={onRemove} />
      <Uploader label="Photos of work" kind="work" files={groups("work")} onAdd={onAdd} onRemove={onRemove} />
      <Uploader label="Team/self photos" kind="team" files={groups("team")} onAdd={onAdd} onRemove={onRemove} />
      <Uploader label="Other images" kind="other" files={groups("other")} onAdd={onAdd} onRemove={onRemove} />
      {note ? <p className="text-sm text-danger">{note}</p> : null}
      <p className="text-sm text-muted">{files.length === 0 ? "No files added yet. That’s fine." : `${files.length} file${files.length === 1 ? "" : "s"} ready.`}</p>
    </div>
  );
}

function ReviewsStep({
  brief,
  update,
  files,
  note,
  onAdd,
  onRemove,
}: {
  brief: Brief;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
  files: LocalFile[];
  note: string;
  onAdd: (kind: FileKind, list: FileList | null) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AreaField
        label="Do you have customer reviews you’d like displayed on your website?"
        name="reviewsText"
        hint="Paste them here. Names are helpful if you’re happy to show them."
        value={brief.reviewsText}
        onChange={(event) => update("reviewsText", event.target.value)}
      />
      <Uploader label="Review screenshots" hint="Optional" kind="review" files={files} onAdd={onAdd} onRemove={onRemove} />
      {note ? <p className="text-sm text-danger">{note}</p> : null}
    </div>
  );
}

function SocialStep({ brief, update }: { brief: Brief; update: <K extends keyof Brief>(key: K, value: Brief[K]) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <TextField label="Facebook" name="facebook" inputMode="url" placeholder="https://" value={brief.facebook} onChange={(event) => update("facebook", event.target.value)} />
      <TextField label="Instagram" name="instagram" inputMode="url" placeholder="https://" value={brief.instagram} onChange={(event) => update("instagram", event.target.value)} />
      <TextField label="TikTok" name="tiktok" inputMode="url" placeholder="https://" value={brief.tiktok} onChange={(event) => update("tiktok", event.target.value)} />
      <TextField label="Other social media" name="otherSocial" value={brief.otherSocial} onChange={(event) => update("otherSocial", event.target.value)} />
    </div>
  );
}

function ContactStep({
  brief,
  errors,
  update,
}: {
  brief: Brief;
  errors: Record<string, string>;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
}) {
  function toggle(id: ContactMethod) {
    const has = brief.contactMethods.includes(id);
    update("contactMethods", has ? brief.contactMethods.filter((item) => item !== id) : [...brief.contactMethods, id]);
  }
  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup label="How would you like customers to contact you?">
        <div className="grid gap-2">
          {CONTACT_OPTIONS.map((option) => {
            const checked = brief.contactMethods.includes(option.id);
            return (
              <label key={option.id} className="flex min-h-12 items-center gap-3 rounded-sm border border-line bg-paper px-3">
                <input type="checkbox" className="size-5 accent-ink" checked={checked} onChange={() => toggle(option.id)} />
                <span className="text-sm text-ink">{option.label}</span>
              </label>
            );
          })}
        </div>
      </ChoiceGroup>
      <TextField label="Preferred contact email" name="preferredEmail" type="email" inputMode="email" value={brief.preferredEmail} error={errors.preferredEmail} onChange={(event) => update("preferredEmail", event.target.value)} />
      <TextField label="Preferred contact phone number" name="preferredPhone" type="tel" inputMode="tel" value={brief.preferredPhone} error={errors.preferredPhone} onChange={(event) => update("preferredPhone", event.target.value)} />
      <TextField label="WhatsApp number if different" name="whatsappNumber" type="tel" inputMode="tel" value={brief.whatsappNumber} error={errors.whatsappNumber} onChange={(event) => update("whatsappNumber", event.target.value)} />
    </div>
  );
}

function DesignStep({
  brief,
  errors,
  update,
}: {
  brief: Brief;
  errors: Record<string, string>;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
}) {
  function toggle(style: StyleChoice) {
    const has = brief.styles.includes(style);
    update("styles", has ? brief.styles.filter((item) => item !== style) : [...brief.styles, style]);
  }
  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup label="What style would you like for your website?" hint="Choose as many as you like.">
        <div className="flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((style) => {
            const selected = brief.styles.includes(style);
            return (
              <button
                key={style}
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(style)}
                className={`min-h-11 rounded-full px-4 text-sm ${selected ? "bg-accent text-accent-fg" : "border border-line bg-paper text-ink"}`}
              >
                {style}
              </button>
            );
          })}
        </div>
      </ChoiceGroup>
      {brief.styles.includes("Other") ? (
        <TextField label="Other style" name="styleOther" value={brief.styleOther} error={errors.styleOther} onChange={(event) => update("styleOther", event.target.value)} />
      ) : null}
      <TextField label="Preferred colours" name="preferredColours" value={brief.preferredColours} onChange={(event) => update("preferredColours", event.target.value)} />
      <TextField label="Colours you don’t like" name="dislikedColours" value={brief.dislikedColours} onChange={(event) => update("dislikedColours", event.target.value)} />
      <p className="text-sm font-medium text-ink">Websites you like the look of</p>
      <TextField label="Website example 1" name="example1" inputMode="url" placeholder="https://" value={brief.example1} onChange={(event) => update("example1", event.target.value)} />
      <TextField label="Website example 2" name="example2" inputMode="url" placeholder="https://" value={brief.example2} onChange={(event) => update("example2", event.target.value)} />
      <TextField label="Website example 3" name="example3" inputMode="url" placeholder="https://" value={brief.example3} onChange={(event) => update("example3", event.target.value)} />
      <AreaField label="What do you like about these websites?" name="exampleNotes" value={brief.exampleNotes} onChange={(event) => update("exampleNotes", event.target.value)} />
    </div>
  );
}

function DomainStep({
  brief,
  errors,
  update,
}: {
  brief: Brief;
  errors: Record<string, string>;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <YesNoQuestion legend="Do you already own a domain name?" name="domainStatus" value={brief.domainStatus} onChange={(value) => update("domainStatus", value)} />
      {brief.domainStatus === "yes" ? (
        <TextField label="Domain name" name="domainName" placeholder="yourbusiness.co.uk" value={brief.domainName} error={errors.domainName} onChange={(event) => update("domainName", event.target.value)} />
      ) : null}
      {brief.domainStatus === "no" ? <p className="text-sm text-ink-soft">Don’t worry — PeakSwift can help you choose one.</p> : null}
    </div>
  );
}

function GoogleStep({ brief, update }: { brief: Brief; update: <K extends keyof Brief>(key: K, value: Brief[K]) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <YesNoQuestion legend="Do you have a Google Business Profile?" name="gbpStatus" value={brief.gbpStatus} onChange={(value) => update("gbpStatus", value)} />
      {brief.gbpStatus === "yes" ? (
        <TextField label="Google Business Profile URL" name="gbpUrl" inputMode="url" placeholder="https://" value={brief.gbpUrl} onChange={(event) => update("gbpUrl", event.target.value)} />
      ) : null}
    </div>
  );
}

function ElseStep({ brief, update }: { brief: Brief; update: <K extends keyof Brief>(key: K, value: Brief[K]) => void }) {
  return (
    <AreaField
      label="Is there anything else you’d like included on your website?"
      name="anythingElse"
      value={brief.anythingElse}
      onChange={(event) => update("anythingElse", event.target.value)}
    />
  );
}

function YesNoQuestion({
  legend,
  name,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  value: YesNo;
  onChange: (value: YesNo) => void;
}) {
  const options: Array<{ id: YesNo; label: string }> = [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
    { id: "unsure", label: "Not sure" },
  ];
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.id} className={`flex min-h-12 items-center gap-3 rounded-sm border px-3 ${value === option.id ? "border-ink bg-paper" : "border-line bg-card"}`}>
            <input type="radio" name={name} className="size-5 accent-ink" checked={value === option.id} onChange={() => onChange(option.id)} />
            <span className="text-sm text-ink">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
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
  const services = brief.services.filter((service) => service.name || service.description);
  const yesNo = (value: YesNo) => (value === "yes" ? "Yes" : value === "no" ? "No" : value === "unsure" ? "Not sure" : "Not provided");
  return (
    <div className="flex flex-col gap-4">
      <ReviewCard title="Business details" onEdit={() => onEdit(0)}>
        <Row label="Business name" value={display(brief.businessName)} />
        <Row label="Your name" value={display(brief.yourName)} />
        <Row label="Phone number" value={display(brief.phone)} />
        <Row label="Email address" value={display(brief.email)} />
        <Row label="Business address/location" value={display(brief.address)} />
        <Row label="Opening hours" value={display(brief.openingHours)} />
        <Row label="Areas you cover" value={display(brief.areasCovered)} />
      </ReviewCard>
      <ReviewCard title="About your business" onEdit={() => onEdit(1)}>
        <Row label="What does your business do?" value={display(brief.whatYouDo)} />
        <Row label="How long have you been trading?" value={display(brief.howLongTrading)} />
        <Row label="What makes your business different?" value={display(brief.whatMakesDifferent)} />
        <Row label="What would you like customers to know?" value={display(brief.customerShouldKnow)} />
        <Row label="Qualifications, experience or certifications" value={display(brief.qualifications)} />
      </ReviewCard>
      <ReviewCard title="Services" onEdit={() => onEdit(2)}>
        {services.length === 0 ? <p className="text-sm text-muted">Not provided</p> : services.map((service) => (
          <div key={service.id}>
            <p className="text-sm font-medium text-ink">{service.name || "Untitled service"}</p>
            <p className="text-sm whitespace-pre-wrap text-ink-soft">{service.description || "No description"}</p>
          </div>
        ))}
      </ReviewCard>
      <ReviewCard title="Photos & branding" onEdit={() => onEdit(3)}>
        <FileLines files={files.filter((file) => file.kind !== "review")} empty="No files added" />
      </ReviewCard>
      <ReviewCard title="Customer reviews" onEdit={() => onEdit(4)}>
        <Row label="Reviews" value={display(brief.reviewsText)} />
        <FileLines files={files.filter((file) => file.kind === "review")} empty="No review screenshots" />
      </ReviewCard>
      <ReviewCard title="Social media" onEdit={() => onEdit(5)}>
        <Row label="Facebook" value={display(brief.facebook)} />
        <Row label="Instagram" value={display(brief.instagram)} />
        <Row label="TikTok" value={display(brief.tiktok)} />
        <Row label="Other social media" value={display(brief.otherSocial)} />
      </ReviewCard>
      <ReviewCard title="Contact preferences" onEdit={() => onEdit(6)}>
        <Row label="How customers can get in touch" value={brief.contactMethods.length ? brief.contactMethods.map(contactLabel).join(", ") : "Not provided"} />
        <Row label="Preferred contact email" value={display(brief.preferredEmail)} />
        <Row label="Preferred contact phone number" value={display(brief.preferredPhone)} />
        <Row label="WhatsApp number if different" value={display(brief.whatsappNumber)} />
      </ReviewCard>
      <ReviewCard title="Website design" onEdit={() => onEdit(7)}>
        <Row label="Style" value={brief.styles.length ? brief.styles.join(", ") : "Not provided"} />
        {brief.styles.includes("Other") ? <Row label="Other" value={display(brief.styleOther)} /> : null}
        <Row label="Preferred colours" value={display(brief.preferredColours)} />
        <Row label="Colours you don’t like" value={display(brief.dislikedColours)} />
        <Row label="Website example 1" value={display(brief.example1)} />
        <Row label="Website example 2" value={display(brief.example2)} />
        <Row label="Website example 3" value={display(brief.example3)} />
        <Row label="What do you like about these websites?" value={display(brief.exampleNotes)} />
      </ReviewCard>
      <ReviewCard title="Domain" onEdit={() => onEdit(8)}>
        <Row label="Do you already own a domain name?" value={yesNo(brief.domainStatus)} />
        {brief.domainStatus === "yes" ? <Row label="Domain name" value={display(brief.domainName)} /> : null}
        {brief.domainStatus === "no" ? <p className="text-sm text-ink-soft">Don’t worry — PeakSwift can help you choose one.</p> : null}
      </ReviewCard>
      <ReviewCard title="Google Business Profile" onEdit={() => onEdit(9)}>
        <Row label="Do you have a Google Business Profile?" value={yesNo(brief.gbpStatus)} />
        {brief.gbpStatus === "yes" ? <Row label="Google Business Profile URL" value={display(brief.gbpUrl)} /> : null}
      </ReviewCard>
      <ReviewCard title="Anything else" onEdit={() => onEdit(10)}>
        <Row label="Is there anything else you’d like included?" value={display(brief.anythingElse)} />
      </ReviewCard>
      <div className="rounded-lg border border-ink bg-paper p-4">
        <h2 className="font-serif text-2xl text-ink">Everything look good?</h2>
        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-ink"
            checked={confirmed}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          <span className="text-sm text-ink">I confirm that the information I’ve provided is accurate to the best of my knowledge.</span>
        </label>
        {confirmError ? <p className="mt-2 text-sm text-danger">{confirmError}</p> : null}
      </div>
    </div>
  );
}

function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <button type="button" className="min-h-11 px-2 text-sm text-ink underline-offset-4 hover:underline" onClick={onEdit}>
          Edit answers
        </button>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const empty = value === "Not provided";
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
