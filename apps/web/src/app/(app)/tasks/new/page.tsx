'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, LocateFixed, MapPin, Plus, Trash2 } from 'lucide-react';
import type { ProofType } from '@onsite/types';
import { calculateSplit, formatPaise, rupeesToPaise, ZERO_DEDUCTIONS } from '@onsite/money';
import { MIN_TASK_BUDGET_PAISE, MAX_TASK_BUDGET_PAISE } from '@onsite/validation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StepProgress } from '@/components/ui/step-progress';
import { MoneyBreakdown } from '@/components/ui/money-breakdown';
import { ApiError, api } from '@/lib/api-client';
import type { CategoryView, CityView, ProofRequirement } from '@/lib/api-types';
import { categoryIcon } from '@/lib/category-icons';
import { useAuth } from '@/lib/auth-context';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
import { toast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';

interface DraftTask {
  id: string;
  title: string;
  money: { budgetPaise: number; commissionPaise: number; workerPayoutPaise: number };
}

interface PaymentOrderView {
  id: string;
  status: string;
  razorpay?: { orderId: string; keyId: string | null };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STEPS = ['Category', 'Location', 'Details', 'Proof', 'Review & pay'];

/** Slide direction is a prop (`custom`), not baked into fixed values, so the same variants serve both directions. */
const STEP_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 24 : -24 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -24 : 24 }),
};

/**
 * A rough, client-side illustration only — the server computes and returns
 * the authoritative split the moment the draft is created (see
 * docs/16-security-requirements.md: commission and payout are never taken
 * from the client). 15% mirrors docs/02-business-model.md's headline rate;
 * the real value can differ if the deployment's env overrides it.
 */
const ILLUSTRATIVE_COMMISSION_BPS = 1500;

export default function NewTaskPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  // +1 slides the new step in from the right (moving forward), -1 from the
  // left (going back) — a plain step index change alone gives no sense of
  // which direction you're moving, which matters more here than on most
  // pages since the whole point of this screen is "one decision at a time."
  const [direction, setDirection] = useState(1);
  function goToStep(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  const [categories, setCategories] = useState<CategoryView[] | null>(null);
  const [cities, setCities] = useState<CityView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState<CategoryView | null>(null);

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [cityNote, setCityNote] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [budgetRupees, setBudgetRupees] = useState('');

  const [proofRequirements, setProofRequirements] = useState<ProofRequirement[]>([]);

  const [draft, setDraft] = useState<DraftTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<{ data: CategoryView[] }>('/categories'), api.get<{ data: CityView[] }>('/cities')])
      .then(([c, ci]) => {
        setCategories(c.data);
        setCities(ci.data);
      })
      .catch(() => setLoadError('Could not load categories. Refresh to try again.'));
  }, []);

  const budgetPaise = useMemo(() => {
    const rupees = Number(budgetRupees);
    if (!budgetRupees || Number.isNaN(rupees)) return null;
    return rupeesToPaise(rupees);
  }, [budgetRupees]);

  const estimate = useMemo(() => {
    if (!budgetPaise || budgetPaise < MIN_TASK_BUDGET_PAISE) return null;
    return calculateSplit(Math.min(budgetPaise, MAX_TASK_BUDGET_PAISE), ILLUSTRATIVE_COMMISSION_BPS, ZERO_DEDUCTIONS);
  }, [budgetPaise]);

  function selectCategory(c: CategoryView) {
    setCategory(c);
    setProofRequirements(
      Array.isArray(c.defaultProofRequirements) && c.defaultProofRequirements.length > 0
        ? c.defaultProofRequirements
        : [{ type: 'PHOTO', label: 'Photo evidence', required: true }],
    );
  }

  function selectCity(c: CityView) {
    setLatitude(c.latitude);
    setLongitude(c.longitude);
    setCityNote(`Must be within ${(c.radiusMeters / 1000).toFixed(0)} km of central ${c.name}.`);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function updateProof(index: number, patch: Partial<ProofRequirement>) {
    setProofRequirements((reqs) => reqs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeProof(index: number) {
    setProofRequirements((reqs) => reqs.filter((_, i) => i !== index));
  }

  function addProof() {
    setProofRequirements((reqs) => [...reqs, { type: 'NOTE', label: '', required: true }]);
  }

  const canAdvance = [
    Boolean(category),
    latitude !== null && longitude !== null && address.trim().length >= 5,
    title.trim().length >= 8 &&
      description.trim().length >= 30 &&
      Boolean(deadlineLocal) &&
      budgetPaise !== null &&
      budgetPaise >= MIN_TASK_BUDGET_PAISE &&
      budgetPaise <= MAX_TASK_BUDGET_PAISE,
    proofRequirements.length > 0 && proofRequirements.every((r) => r.label.trim().length > 0),
  ][step];

  async function createDraft() {
    if (!category || latitude === null || longitude === null || budgetPaise === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const task = await api.post<{ id: string; title: string; money: DraftTask['money'] }>('/tasks', {
        title: title.trim(),
        description: description.trim(),
        categorySlug: category.slug,
        taskLocation: { latitude, longitude },
        taskAddress: address.trim(),
        budgetPaise,
        deadlineAt: new Date(deadlineLocal).toISOString(),
        proofRequirements: proofRequirements.map((r) => ({
          type: r.type,
          label: r.label.trim(),
          required: r.required,
          ...(r.fieldKey ? { fieldKey: r.fieldKey } : {}),
          ...(r.minCount ? { minCount: r.minCount } : {}),
        })),
      });
      setDraft(task);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not create the task. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function fundAndPublish() {
    if (!draft) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await api.post<PaymentOrderView>(
        '/payments/orders',
        { taskId: draft.id },
        { idempotencyKey: `create-${draft.id}` },
      );

      if (order.razorpay?.orderId && order.razorpay.keyId) {
        // Real gateway: the modal completing is not proof of capture — only
        // the signed webhook is (docs/16-security-requirements.md). Poll the
        // server's own view of the payment rather than trusting the modal's
        // callback, and let the requester know that's what's happening.
        const outcome = await openRazorpayCheckout({
          keyId: order.razorpay.keyId,
          orderId: order.razorpay.orderId,
          amountPaise: draft.money.budgetPaise,
          description: draft.title,
          prefillEmail: user?.email,
        });

        if (outcome === 'dismissed') {
          setSubmitError('Payment window closed before completing. Try again when ready.');
          setSubmitting(false);
          return;
        }

        setSubmitError('Confirming your payment with the bank — this can take a few seconds…');
        let captured = false;
        for (let attempt = 0; attempt < 20 && !captured; attempt++) {
          await wait(1500);
          const status = await api.get<PaymentOrderView>(`/payments/${draft.id}`);
          captured = status.status === 'CAPTURED';
        }
        if (!captured) {
          setSubmitError(
            'Payment is still confirming. This page will not auto-publish — check back in a minute, or reload.',
          );
          setSubmitting(false);
          return;
        }
        setSubmitError(null);
      }

      await api.post(`/tasks/${draft.id}/publish`);
      toast({ title: 'Task published', description: 'Funds are held in escrow until you approve the work.', variant: 'success' });
      router.push(`/tasks/${draft.id}`);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Payment or publishing failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <p className="text-sm text-dispute">{loadError}</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Post a task</h1>
        <p className="mt-1 text-ink-500">One decision per screen. Nothing is charged until the last step.</p>
      </div>

      <StepProgress steps={STEPS} current={step} />

      <Card className="overflow-hidden">
        <CardContent className="pt-6">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={STEP_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            >
              {step === 0 && (
                <CategoryStep categories={categories} selected={category} onSelect={selectCategory} />
              )}
              {step === 1 && (
                <LocationStep
                  cities={cities}
                  latitude={latitude}
                  longitude={longitude}
                  address={address}
                  cityNote={cityNote}
                  onSelectCity={selectCity}
                  onUseMyLocation={useMyLocation}
                  onLatChange={setLatitude}
                  onLngChange={setLongitude}
                  onAddressChange={setAddress}
                />
              )}
              {step === 2 && (
                <DetailsStep
                  category={category}
                  title={title}
                  description={description}
                  deadlineLocal={deadlineLocal}
                  budgetRupees={budgetRupees}
                  estimate={estimate}
                  onTitleChange={setTitle}
                  onDescriptionChange={setDescription}
                  onDeadlineChange={setDeadlineLocal}
                  onBudgetChange={setBudgetRupees}
                />
              )}
              {step === 3 && (
                <ProofStep
                  requirements={proofRequirements}
                  onUpdate={updateProof}
                  onRemove={removeProof}
                  onAdd={addProof}
                />
              )}
              {step === 4 && (
                <ReviewStep
                  title={title}
                  description={description}
                  categoryName={category?.name ?? ''}
                  address={address}
                  deadlineLocal={deadlineLocal}
                  proofRequirements={proofRequirements}
                  estimate={estimate}
                  draft={draft}
                  submitting={submitting}
                  submitError={submitError}
                  onCreateDraft={createDraft}
                  onFundAndPublish={fundAndPublish}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" disabled={step === 0 || submitting} onClick={() => goToStep(step - 1)}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button disabled={!canAdvance} onClick={() => goToStep(step + 1)}>
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CategoryStep({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryView[] | null;
  selected: CategoryView | null;
  onSelect: (c: CategoryView) => void;
}) {
  if (!categories) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading categories&hellip;
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[19px] font-semibold text-ink-900">What do you need done?</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((c) => {
          const Icon = categoryIcon(c.icon);
          const active = selected?.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                'relative flex flex-col gap-2 rounded-card border p-4 text-left',
                'transition-all duration-base ease-onsite hover:-translate-y-0.5 hover:shadow-float',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                active ? 'border-brand-600 bg-brand-50' : 'border-line bg-paper-0 hover:bg-paper-100',
              )}
            >
              {active ? (
                <motion.span
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                  className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white"
                >
                  <Check className="h-3 w-3" aria-hidden />
                </motion.span>
              ) : null}
              <Icon className={cn('h-5 w-5', active ? 'text-brand-600' : 'text-ink-500')} aria-hidden />
              <span className="font-medium text-ink-900">{c.name}</span>
              <span className="text-sm text-ink-500">{c.description}</span>
              <span className="tabular text-xs text-ink-400">
                Typically {formatPaise(c.suggestedMinPaise)}&ndash;{formatPaise(c.suggestedMaxPaise)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LocationStep({
  cities,
  latitude,
  longitude,
  address,
  cityNote,
  onSelectCity,
  onUseMyLocation,
  onLatChange,
  onLngChange,
  onAddressChange,
}: {
  cities: CityView[] | null;
  latitude: number | null;
  longitude: number | null;
  address: string;
  cityNote: string | null;
  onSelectCity: (c: CityView) => void;
  onUseMyLocation: () => void;
  onLatChange: (v: number | null) => void;
  onLngChange: (v: number | null) => void;
  onAddressChange: (v: string) => void;
}) {
  const [selectedState, setSelectedState] = useState<string | null>(null);

  // Grouped by state so adding a new city to the picker (any city, any
  // state) is a data change (seed-reference-data.ts), never a code change.
  const states = useMemo(() => {
    if (!cities) return [];
    return [...new Set(cities.map((c) => c.state))].sort();
  }, [cities]);

  const districtsInState = useMemo(
    () => cities?.filter((c) => c.state === selectedState) ?? [],
    [cities, selectedState],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[19px] font-semibold text-ink-900">Where is the task?</h2>
      <p className="text-sm text-ink-500">
        OnSite works anywhere in India. Pick the state and nearest city to get started, then refine the exact
        point — or use your current location below.
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-700">State</span>
        <div className="flex flex-wrap gap-2">
          {states.map((state) => (
            <Button
              key={state}
              type="button"
              variant={selectedState === state ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedState(state)}
            >
              {state}
            </Button>
          ))}
        </div>
      </div>

      {selectedState ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink-700">City</span>
          <div className="flex flex-wrap gap-2">
            {districtsInState.map((c) => (
              <Button key={c.id} type="button" variant="secondary" size="sm" onClick={() => onSelectCity(c)}>
                <MapPin className="h-4 w-4" aria-hidden /> {c.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <details className="text-xs text-ink-400">
        <summary className="cursor-pointer select-none">Why pick a city first?</summary>
        <p className="mt-1">
          It&rsquo;s just a fast way to set the point — the list above is a shortcut for common cities, not a
          restriction. Every task still needs a real, verified worker nearby to actually get done, so if your exact
          town isn&rsquo;t listed, tap &ldquo;Use my current location&rdquo; or type the coordinates directly below.
        </p>
      </details>

      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onUseMyLocation}>
        <LocateFixed className="h-4 w-4" aria-hidden /> Use my current location instead
      </Button>

      {cityNote ? <p className="text-xs text-ink-400">{cityNote}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field id="latitude" label="Latitude">
          <Input
            type="number"
            step="any"
            value={latitude ?? ''}
            onChange={(e) => onLatChange(e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
        <Field id="longitude" label="Longitude">
          <Input
            type="number"
            step="any"
            value={longitude ?? ''}
            onChange={(e) => onLngChange(e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
      </div>
      <Field id="address" label="Exact address" hint="Shop name, street, landmark — whatever gets a worker there.">
        <Textarea value={address} onChange={(e) => onAddressChange(e.target.value)} rows={2} />
      </Field>
    </div>
  );
}

function DetailsStep({
  category,
  title,
  description,
  deadlineLocal,
  budgetRupees,
  estimate,
  onTitleChange,
  onDescriptionChange,
  onDeadlineChange,
  onBudgetChange,
}: {
  category: CategoryView | null;
  title: string;
  description: string;
  deadlineLocal: string;
  budgetRupees: string;
  estimate: ReturnType<typeof calculateSplit> | null;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onDeadlineChange: (v: string) => void;
  onBudgetChange: (v: string) => void;
}) {
  const minDeadline = useMemo(() => {
    const d = new Date(Date.now() + 35 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[19px] font-semibold text-ink-900">The details</h2>
      <Field id="title" label="Task title" hint="Specific enough that a stranger knows exactly what to do.">
        <Input value={title} onChange={(e) => onTitleChange(e.target.value)} maxLength={120} />
      </Field>
      <Field id="description" label="Instructions" hint="Say what to check, and what NOT to do (e.g. do not purchase).">
        <Textarea value={description} onChange={(e) => onDescriptionChange(e.target.value)} rows={5} maxLength={5000} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="deadline" label="Deadline">
          <Input
            type="datetime-local"
            min={minDeadline}
            value={deadlineLocal}
            onChange={(e) => onDeadlineChange(e.target.value)}
          />
        </Field>
        <Field
          id="budget"
          label="Budget (₹)"
          hint={category ? `Typically ${formatPaise(category.suggestedMinPaise)}–${formatPaise(category.suggestedMaxPaise)}` : undefined}
        >
          <Input
            type="number"
            min={300}
            max={50_000}
            value={budgetRupees}
            onChange={(e) => onBudgetChange(e.target.value)}
          />
        </Field>
      </div>
      {estimate ? <MoneyBreakdown {...estimate} estimate /> : null}
    </div>
  );
}

const PROOF_TYPE_LABELS: Record<ProofType, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Video',
  NOTE: 'Written note',
  STRUCTURED_FIELD: 'Structured field',
  SIGNATURE: 'Signature',
};

function ProofStep({
  requirements,
  onUpdate,
  onRemove,
  onAdd,
}: {
  requirements: ProofRequirement[];
  onUpdate: (i: number, patch: Partial<ProofRequirement>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[19px] font-semibold text-ink-900">What proof do you need?</h2>
      <p className="text-sm text-ink-500">Pre-filled from the category. Adjust or add your own.</p>
      <div className="flex flex-col gap-3">
        {requirements.map((r, i) => (
          <div key={i} className="flex items-center gap-2 rounded-card border border-line p-3">
            <select
              value={r.type}
              onChange={(e) => onUpdate(i, { type: e.target.value as ProofType })}
              className="min-h-[var(--tap-min,44px)] rounded-input border border-line bg-paper-0 px-2 text-sm"
            >
              {Object.entries(PROOF_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Input
              className="flex-1"
              value={r.label}
              placeholder="Label, e.g. Sealed box photo"
              onChange={(e) => onUpdate(i, { label: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-sm text-ink-500 whitespace-nowrap">
              <input type="checkbox" checked={r.required} onChange={(e) => onUpdate(i, { required: e.target.checked })} />
              Required
            </label>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => onRemove(i)}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onAdd} className="self-start">
        <Plus className="h-4 w-4" aria-hidden /> Add proof requirement
      </Button>
    </div>
  );
}

function ReviewStep({
  title,
  description,
  categoryName,
  address,
  deadlineLocal,
  proofRequirements,
  estimate,
  draft,
  submitting,
  submitError,
  onCreateDraft,
  onFundAndPublish,
}: {
  title: string;
  description: string;
  categoryName: string;
  address: string;
  deadlineLocal: string;
  proofRequirements: ProofRequirement[];
  estimate: ReturnType<typeof calculateSplit> | null;
  draft: DraftTask | null;
  submitting: boolean;
  submitError: string | null;
  onCreateDraft: () => void;
  onFundAndPublish: () => void;
}) {
  if (draft) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-[19px] font-semibold text-ink-900">Confirm and pay</h2>
        <p className="text-sm text-ink-500">
          Your task is saved as a draft. This is the real amount — nothing changes at payment.
        </p>
        <MoneyBreakdown {...draft.money} />
        {submitError ? <p className="text-sm text-dispute">{submitError}</p> : null}
        <Button variant="gradient" onClick={onFundAndPublish} loading={submitting} className="w-full">
          Fund {formatPaise(draft.money.budgetPaise)} and publish
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[19px] font-semibold text-ink-900">Review before you create it</h2>
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Category" value={categoryName} />
        <Row label="Title" value={title} />
        <Row label="Address" value={address} />
        <Row label="Deadline" value={deadlineLocal ? new Date(deadlineLocal).toLocaleString('en-IN') : ''} />
        <Row label="Proof required" value={proofRequirements.map((r) => r.label).join(', ')} />
      </dl>
      <p className="whitespace-pre-wrap rounded-card bg-paper-100 p-3 text-sm text-ink-700">{description}</p>
      {estimate ? <MoneyBreakdown {...estimate} estimate /> : null}
      {submitError ? <p className="text-sm text-dispute">{submitError}</p> : null}
      <Button onClick={onCreateDraft} loading={submitting} className="w-full">
        Create task
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-900">{value}</dd>
    </div>
  );
}
