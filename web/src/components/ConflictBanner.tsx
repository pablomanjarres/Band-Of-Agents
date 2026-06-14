export function ConflictBanner() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200 font-bold text-amber-800">
        !
      </span>
      <p>
        <span className="font-semibold">Regional conflict detected.</span> Reviewers disagree across
        markets. Review the verdicts and remediation below.
      </p>
    </div>
  );
}
