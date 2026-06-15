export function ConflictBanner() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-sm text-warn shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_0_28px_-12px_rgb(251_191_36/0.5)]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warn/15 font-bold text-warn ring-1 ring-inset ring-warn/30">
        !
      </span>
      <p className="text-warn/90">
        <span className="font-semibold text-warn">Regional conflict detected.</span> Reviewers
        disagree across markets. Review the verdicts and remediation below.
      </p>
    </div>
  );
}
