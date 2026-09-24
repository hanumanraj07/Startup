'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Check, MapPin } from 'lucide-react';
import type { CategorySlug } from '@onsite/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ApiError, api } from '@/lib/api-client';
import type { CategoryView, CityView } from '@/lib/api-types';
import { categoryIcon } from '@/lib/category-icons';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';

export default function WorkerOnboardingPage() {
  const router = useRouter();
  const { refetchUser } = useAuth();

  const [categories, setCategories] = useState<CategoryView[] | null>(null);
  const [cities, setCities] = useState<CityView[] | null>(null);

  const [city, setCity] = useState<CityView | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [selectedSlugs, setSelectedSlugs] = useState<CategorySlug[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<{ data: CategoryView[] }>('/categories'), api.get<{ data: CityView[] }>('/cities')]).then(
      ([c, ci]) => {
        setCategories(c.data);
        setCities(ci.data);
      },
    );
  }, []);

  function selectCity(c: CityView) {
    setCity(c);
    setLatitude(c.latitude);
    setLongitude(c.longitude);
  }

  function toggleCategory(slug: CategorySlug) {
    setSelectedSlugs((slugs) => (slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug]));
  }

  async function onSubmit() {
    if (!city || latitude === null || longitude === null || selectedSlugs.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/workers/me', {
        baseLocation: { latitude, longitude },
        baseCity: city.name,
        workingRadiusMeters: radiusKm * 1000,
        categorySlugs: selectedSlugs,
      });
      await refetchUser();
      toast({ title: 'Worker profile created', description: 'Browse nearby tasks whenever you’re ready.', variant: 'success' });
      router.push('/feed');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your worker profile. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = city !== null && selectedSlugs.length > 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-ink-900">Become a worker</h1>
        <p className="mt-1 text-ink-500">Tell us where you work from and what you&rsquo;re good at.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Base location</CardTitle>
          <CardDescription>The center point tasks are measured from.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            {cities?.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant={city?.id === c.id ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => selectCity(c)}
              >
                <MapPin className="h-4 w-4" aria-hidden /> {c.name}
              </Button>
            ))}
          </div>
          <Field id="radius" label={`Working radius: ${radiusKm} km`}>
            <input
              id="radius"
              type="range"
              min={1}
              max={50}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-full accent-brand-600"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Choose every kind of task you&rsquo;re willing to accept.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {categories?.map((c) => {
              const Icon = categoryIcon(c.icon);
              const active = selectedSlugs.includes(c.slug);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(c.slug)}
                  className={cn(
                    'relative flex items-center gap-2 rounded-input border p-3 text-left text-sm',
                    'transition-all duration-base ease-onsite hover:-translate-y-0.5 hover:shadow-float',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-paper-0 text-ink-700',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {c.name}
                  {active ? (
                    <motion.span
                      initial={{ scale: 0, rotate: -20 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                      className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-white"
                    >
                      <Check className="h-2.5 w-2.5" aria-hidden />
                    </motion.span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-dispute">{error}</p> : null}

      <Button disabled={!canSubmit} loading={submitting} onClick={onSubmit} className="w-full">
        Start finding work
      </Button>
    </div>
  );
}
