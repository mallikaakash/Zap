"use client";

import { api } from "@/lib/client";
import { Logo, Notice, Pill, Spinner, usePoll } from "@/components/ui";

interface Mail {
  id: string;
  to: string;
  subject: string;
  text: string;
  status: string;
  createdAt: string;
}

/** Local demo: every email the app sends, without a mail provider. */
export default function Inbox() {
  const { data, error } = usePoll(() => api<{ emails: Mail[] }>("/api/dev/inbox"), 3000);
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <a href="/"><Logo /></a>
        <Pill tone="warn">Dev inbox</Pill>
      </div>
      <p className="text-sm text-muted">Emails the app sent (or would send). With RESEND_API_KEY set they are also delivered for real.</p>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {!data && !error ? <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading…</p> : null}
      {data?.emails.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : null}
      {data?.emails.map((m) => (
        <details key={m.id} className="card p-4">
          <summary className="cursor-pointer">
            <span className="font-semibold">{m.subject}</span>
            <span className="block text-xs text-muted">to {m.to} · {new Date(m.createdAt).toLocaleString()} · {m.status}</span>
          </summary>
          <pre className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{m.text}</pre>
        </details>
      ))}
    </main>
  );
}
