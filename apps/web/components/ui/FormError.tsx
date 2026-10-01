export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded border border-down/30 bg-down/5 px-3 py-2 text-sm text-down">
      {message}
    </div>
  );
}
