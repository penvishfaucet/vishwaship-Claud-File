"use client";
import Link from "next/link";

export default function SupportError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="tk-page">
      <div className="tk-empty" role="alert">
        <p>We could not load your tickets right now.</p>
        <div className="row" style={{ gap: 8, justifyContent: "center" }}>
          <button type="button" className="tk-raise" onClick={() => reset()}>Try again</button>
          <Link className="tk-comment" href="/portal/">Back to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
