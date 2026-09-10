'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useTaskSocket } from '@/lib/use-task-socket';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  senderId: string;
  isMine: boolean;
  body: string;
  redactionFlags: string[];
  createdAt: string;
  readAt: string | null;
}

export function ChatPanel({ taskId }: { taskId: string }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ data: ChatMessage[] }>(`/tasks/${taskId}/messages?limit=50`).then(({ data }) => {
      setMessages([...data].reverse());
    });
    api.post(`/tasks/${taskId}/messages/read`).catch(() => undefined);
  }, [taskId]);

  useTaskSocket(taskId, {
    // `isMine` on the broadcast payload is computed once, from the SENDER's
    // perspective, then fanned out identically to the whole room (see
    // realtime.gateway.ts's emitNewMessage — a single `server.to(room).emit`
    // with no per-socket customization). Trusting it here would show the
    // other party's message as "mine" on their own screen. Recomputed from
    // the actually-logged-in user instead — found by watching two real
    // socket connections exchange a message live, not by reading the code.
    onMessage: (raw) => {
      const message = raw as ChatMessage;
      setMessages((prev) => {
        const withCorrectedIsMine = { ...message, isMine: message.senderId === user?.id };
        return prev ? [...prev, withCorrectedIsMine] : [withCorrectedIsMine];
      });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setDraft('');
    try {
      // The server broadcasts our own message back over the socket, so it's
      // not appended here too — appending it now AND on the echo would
      // duplicate every message we send.
      await api.post(`/tasks/${taskId}/messages`, { body });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div ref={scrollRef} className="flex max-h-80 flex-col gap-2 overflow-y-auto py-2">
          {!messages ? (
            <p className="text-sm text-ink-400">Loading&hellip;</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-ink-400">No messages yet. Phone numbers, emails and UPI IDs are redacted automatically.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={cn('flex flex-col', m.isMine ? 'items-end' : 'items-start')}>
                <div
                  className={cn(
                    'max-w-[75%] rounded-card px-3 py-2 text-sm',
                    m.isMine ? 'bg-brand-solid text-white' : 'bg-paper-100 text-ink-900',
                  )}
                >
                  {m.body}
                </div>
                {m.redactionFlags.length > 0 ? (
                  <span className="mt-0.5 text-xs text-progress">Contact info removed</span>
                ) : null}
                <span className="mt-0.5 text-xs text-ink-300">
                  {new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message&hellip;"
            maxLength={2000}
          />
          <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send">
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
