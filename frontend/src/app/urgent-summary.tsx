import { formatSender, initials, type Mail } from "./mail-detail";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function UrgentSummary({ messages, loading, error, onOpen, onRetry }: {
  messages: Mail[];
  loading: boolean;
  error: string | null;
  onOpen: (message: Mail) => void;
  onRetry: () => void;
}) {
  const unreadCount = messages.filter((message) => message.unread).length;

  return (
    <section aria-labelledby="urgent-summary-heading" aria-busy={loading} className="overflow-hidden rounded-2xl border border-mail-line bg-mail-surface shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-mail-line px-4 py-4 sm:px-6">
        <h2 id="urgent-summary-heading" className="text-sm font-semibold tracking-tight sm:text-base">Priority mail</h2>
        {!loading && (!error || messages.length > 0) && (
          <p className="text-xs tabular-nums text-mail-muted">
            {messages.length} {messages.length === 1 ? "email" : "emails"}{unreadCount > 0 && <> · {unreadCount} unread</>}
          </p>
        )}
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mail-danger-line bg-mail-danger-tint px-5 py-3 text-sm text-mail-danger">
          <p role="alert">Couldn’t load urgent emails.</p>
          <button type="button" onClick={onRetry} className="rounded-lg border border-mail-danger-line bg-mail-surface px-3 py-1.5 font-semibold hover:bg-mail-muted-surface">Try again</button>
        </div>
      )}
      {loading && messages.length === 0 ? (
        <p role="status" className="px-5 py-10 text-center text-sm text-mail-muted">Loading urgent emails…</p>
      ) : messages.length > 0 ? (
        <ul className="divide-y divide-mail-line">
          {messages.map((message) => {
            const sender = formatSender(message.from);
            const date = new Date(message.date);
            const dated = Number.isFinite(date.getTime());
            const preview = message.summary || message.snippet;
            return (
              <li key={message.id}>
                <button type="button" onClick={() => onOpen(message)} className="group flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-mail-muted-surface focus-visible:-outline-offset-2 sm:gap-4 sm:px-6 sm:py-5">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-mail-accent-tint text-xs font-extrabold text-mail-accent sm:size-10">{initials(sender)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3 text-xs text-mail-muted">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold">{sender}</span>
                        {message.unread && <><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-mail-danger" /><span className="sr-only">Unread</span></>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                        {dated && <time dateTime={date.toISOString()} className="whitespace-nowrap">{shortDate.format(date)}</time>}
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4 transition-colors group-hover:text-mail-accent"><path d="m9 6 6 6-6 6" /></svg>
                      </span>
                    </span>
                    <span className={`mt-0.5 block text-sm max-sm:line-clamp-2 sm:truncate ${message.unread ? "font-extrabold" : "font-semibold"}`}>{message.subject}</span>
                    {preview && <span className="mt-1.5 line-clamp-2 text-sm leading-5 text-mail-secondary">{preview}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : !error && (
        <div className="px-5 py-12 text-center">
          <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full bg-mail-success-tint text-mail-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5"><path d="m5 12 4 4L19 6" /></svg>
          </span>
          <p className="mt-3 text-sm font-bold">You&apos;re all caught up</p>
          <p className="mt-1 text-sm text-mail-muted">Emails marked Urgent will appear here.</p>
        </div>
      )}
    </section>
  );
}
