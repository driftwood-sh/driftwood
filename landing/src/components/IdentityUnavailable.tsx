import { CARD } from "../dashboard-shared";

/* Shown when /auth/me could not say who the viewer is (identity.ts returned
   "unavailable"): the backend stayed unreachable past the retry budget, or
   answered with something that is neither a user nor a 401/403. The session
   may be fine, so this is never the sign-in card. */
export default function IdentityUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div role="alert" className={`w-full max-w-sm ${CARD} p-6 text-center`}>
        <p className="m-0 text-[14.5px] font-semibold text-ink">
          Can&rsquo;t reach driftwood right now
        </p>
        <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          We couldn&rsquo;t check your session. Try again in a moment.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 cursor-pointer rounded-full bg-tide px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-tide-deep"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
