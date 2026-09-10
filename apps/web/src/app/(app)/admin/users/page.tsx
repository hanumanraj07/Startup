'use client';

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api-client';

interface AdminUserRow {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  status: string;
  platformRole: string;
  verificationLevel: number;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ data: AdminUserRow[] }>(
        `/admin/users?q=${encodeURIComponent(query)}&limit=20`,
      );
      setResults(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  async function suspend(id: string) {
    setSuspendingId(id);
    try {
      await api.post(`/admin/users/${id}/suspend`, { reason: reasons[id] });
      setResults((rows) => rows?.map((r) => (r.id === id ? { ...r, status: 'SUSPENDED' } : r)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not suspend this user.');
    } finally {
      setSuspendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or phone"
          className="max-w-sm"
        />
        <Button type="submit" loading={loading}>
          <Search className="h-4 w-4" aria-hidden /> Search
        </Button>
      </form>

      {error ? <p className="text-sm text-dispute">{error}</p> : null}

      {results?.length === 0 ? <p className="text-sm text-ink-400">No matches.</p> : null}

      {results?.map((u) => (
        <Card key={u.id}>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink-900">
                  {u.displayName} <span className="text-sm font-normal text-ink-400">({u.platformRole})</span>
                </p>
                <p className="text-sm text-ink-500">
                  {u.email} {u.phone ? `· ${u.phone}` : ''} · level {u.verificationLevel}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  u.status === 'SUSPENDED' ? 'bg-dispute/10 text-dispute' : 'bg-verified/10 text-verified'
                }`}
              >
                {u.status.toLowerCase()}
              </span>
            </div>
            {u.status !== 'SUSPENDED' && u.platformRole !== 'ADMIN' ? (
              <div className="flex items-center gap-2">
                <Textarea
                  placeholder="Reason for suspension"
                  value={reasons[u.id] ?? ''}
                  onChange={(e) => setReasons((r) => ({ ...r, [u.id]: e.target.value }))}
                  rows={1}
                  className="min-h-0"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={(reasons[u.id]?.trim().length ?? 0) < 10}
                  loading={suspendingId === u.id}
                  onClick={() => suspend(u.id)}
                >
                  Suspend
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching&hellip;
        </div>
      ) : null}
    </div>
  );
}
