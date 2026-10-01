export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-6 py-6 lg:px-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-ink-soft">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
