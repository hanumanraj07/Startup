import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './providers';

/** docs/22, #6: the email driver production was missing. */
describe('ResendEmailProvider', () => {
  it('posts the email to Resend with the key and the configured sender', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"id":"e1"}', { status: 200 }));
    const provider = new ResendEmailProvider('re_test', 'OnSite <no-reply@onsite.example>', fetchImpl as never);

    await provider.send({ to: 'a@example.com', subject: 'Verify your email', body: 'Open this link' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'OnSite <no-reply@onsite.example>',
      to: ['a@example.com'],
      subject: 'Verify your email',
      text: 'Open this link',
    });
  });

  it('throws when Resend refuses, so the delivery is retried', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"domain not verified"}', { status: 403 }));
    const provider = new ResendEmailProvider('re_test', 'x@y.z', fetchImpl as never);

    await expect(provider.send({ to: 'a@example.com', subject: 's', body: 'b' })).rejects.toThrow(/403.*domain not verified/);
  });
});
