import { useSyncExternalStore } from "react";
import { isReconnecting, subscribeReconnecting } from "../connection-status.ts";

/* Shown on every dashboard page while a retrying request waits out a short
   backend outage (connection-status.ts). The page underneath stays as it
   was: a signed-in user keeps their shell instead of seeing a sign-in card
   or an error. */
export default function ReconnectingNotice() {
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    isReconnecting,
    () => false,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4"
    >
      {/* Same look as an info toast (DashboardCommon.tsx), placed at the
          top so it never covers a toast. */}
      {reconnecting && (
        <p className="toast-in flex max-w-sm items-center gap-2.5 rounded-xl border border-tide/30 bg-surface px-4 py-3 text-[13.5px] font-medium text-ink shadow-win">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 text-tide" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 7v3M8 5h.01" />
          </svg>
          Reconnecting…
        </p>
      )}
    </div>
  );
}
