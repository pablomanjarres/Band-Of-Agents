interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="surface mx-auto max-w-xl rounded-2xl p-10 text-center">
      <h1 className="font-display text-3xl text-fg">{title}</h1>
      <p className="mt-2 text-sm text-muted">{description}</p>
      <span className="mt-5 inline-flex items-center rounded-full bg-surface-3 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted ring-1 ring-inset ring-border-strong">
        Coming soon
      </span>
    </div>
  );
}
