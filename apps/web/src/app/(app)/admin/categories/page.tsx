'use client';

import { useEffect, useState } from 'react';
import { formatPaise } from '@onsite/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/lib/use-toast';
import { ApiError, api } from '@/lib/api-client';

interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  suggestedMinPaise: number;
  suggestedMaxPaise: number;
  isActive: boolean;
}

interface AdminCity {
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [cities, setCities] = useState<AdminCity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    Promise.all([
      api.get<{ data: AdminCategory[] }>('/admin/categories'),
      api.get<{ data: AdminCity[] }>('/admin/cities'),
    ])
      .then(([c, ci]) => {
        setCategories(c.data);
        setCities(ci.data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load categories and cities.'));
  }

  useEffect(load, []);

  async function toggleCategory(id: string, isActive: boolean) {
    try {
      await api.patch(`/admin/categories/${id}`, { isActive });
      setCategories((rows) => rows?.map((r) => (r.id === id ? { ...r, isActive } : r)) ?? null);
      toast({ title: isActive ? 'Category enabled' : 'Category disabled', variant: 'success' });
    } catch (err) {
      toast({ title: err instanceof ApiError ? err.message : 'Could not update the category.', variant: 'error' });
    }
  }

  async function toggleCity(id: string, isActive: boolean) {
    try {
      await api.patch(`/admin/cities/${id}`, { isActive });
      setCities((rows) => rows?.map((r) => (r.id === id ? { ...r, isActive } : r)) ?? null);
      toast({ title: isActive ? 'City enabled' : 'City disabled', variant: 'success' });
    } catch (err) {
      toast({ title: err instanceof ApiError ? err.message : 'Could not update the city.', variant: 'error' });
    }
  }

  if (error) return <p className="text-sm text-dispute">{error}</p>;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 text-[17px] font-semibold text-ink-900">Categories</h2>
        {!categories ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {categories.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center justify-between gap-4 pt-6">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">
                      {c.name} <span className="text-sm font-normal text-ink-400">({c.slug})</span>
                    </p>
                    <p className="truncate text-sm text-ink-500">{c.description}</p>
                    <p className="tabular text-xs text-ink-400">
                      {formatPaise(c.suggestedMinPaise)} – {formatPaise(c.suggestedMaxPaise)}
                    </p>
                  </div>
                  <Switch checked={c.isActive} onCheckedChange={(checked) => toggleCategory(c.id, checked)} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <NewCategoryForm onCreated={load} />
      </div>

      <div>
        <h2 className="mb-3 text-[17px] font-semibold text-ink-900">Cities</h2>
        {!cities ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {cities.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center justify-between gap-4 pt-6">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">
                      {c.name}, {c.state}
                    </p>
                    <p className="tabular text-xs text-ink-400">
                      {c.latitude.toFixed(4)}, {c.longitude.toFixed(4)} · {(c.radiusMeters / 1000).toFixed(0)} km
                      radius
                    </p>
                  </div>
                  <Switch checked={c.isActive} onCheckedChange={(checked) => toggleCity(c.id, checked)} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <NewCityForm onCreated={load} />
      </div>
    </div>
  );
}

function NewCategoryForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [minRupees, setMinRupees] = useState('');
  const [maxRupees, setMaxRupees] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        Add category
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/admin/categories', {
        slug,
        name,
        description,
        icon,
        suggestedMinPaise: Math.round(Number(minRupees) * 100),
        suggestedMaxPaise: Math.round(Number(maxRupees) * 100),
      });
      toast({ title: 'Category created', variant: 'success' });
      setOpen(false);
      setSlug('');
      setName('');
      setDescription('');
      setIcon('');
      setMinRupees('');
      setMaxRupees('');
      onCreated();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the category.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle>New category</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cat-name" label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field id="cat-slug" label="Slug">
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="local-photography"
                required
              />
            </Field>
          </div>
          <Field id="cat-description" label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="cat-icon" label="Icon name">
              <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="camera" required />
            </Field>
            <Field id="cat-min" label="Suggested min (₹)">
              <Input type="number" min={0} value={minRupees} onChange={(e) => setMinRupees(e.target.value)} required />
            </Field>
            <Field id="cat-max" label="Suggested max (₹)">
              <Input type="number" min={0} value={maxRupees} onChange={(e) => setMaxRupees(e.target.value)} required />
            </Field>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-dispute">
              {formError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" loading={submitting}>
              Create category
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NewCityForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusKm, setRadiusKm] = useState('25');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        Add city
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/admin/cities', {
        name,
        state,
        latitude: Number(latitude),
        longitude: Number(longitude),
        radiusMeters: Math.round(Number(radiusKm) * 1000),
      });
      toast({ title: 'City created', variant: 'success' });
      setOpen(false);
      setName('');
      setState('');
      setLatitude('');
      setLongitude('');
      setRadiusKm('25');
      onCreated();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the city.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle>New city</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="city-name" label="City">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field id="city-state" label="State">
              <Input value={state} onChange={(e) => setState(e.target.value)} required />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="city-lat" label="Latitude">
              <Input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} required />
            </Field>
            <Field id="city-lng" label="Longitude">
              <Input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} required />
            </Field>
            <Field id="city-radius" label="Radius (km)">
              <Input type="number" min={1} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} required />
            </Field>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-dispute">
              {formError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" loading={submitting}>
              Create city
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
