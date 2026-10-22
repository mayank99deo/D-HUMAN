import { WORDMARK } from "./paths";

export function Wordmark({ className, title = "D-Human" }: { className?: string; title?: string }) {
  return (
    <svg viewBox={WORDMARK.viewBox} className={className} fill="currentColor" role="img" aria-label={title}>
      <path fillRule="evenodd" d={WORDMARK.path} />
    </svg>
  );
}
