/* One flag for "the backend is briefly unreachable and we are retrying".

   The backend is a single Cloud Run instance. After one bad connection the
   platform can stop routing to it for one to three minutes (429 / 503 on
   every request) before a replacement starts. Retrying callers (identity.ts,
   fetch-retry.ts) mark themselves here while they wait, and the dashboard
   shows one "Reconnecting" notice instead of an error or a sign-in card. */

type Listener = () => void;

let waiting = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/* Marks one caller as retrying. Call the returned function once when it is
   done (success or give-up); extra calls are ignored. */
export function beginReconnecting(): () => void {
  waiting += 1;
  if (waiting === 1) emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    waiting -= 1;
    if (waiting === 0) emit();
  };
}

export function isReconnecting(): boolean {
  return waiting > 0;
}

export function subscribeReconnecting(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
