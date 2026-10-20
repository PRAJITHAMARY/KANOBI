/** Form-level error banner (DESIGN.md §1.5). Renders nothing without a message. */
export default function FormBanner({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      {message}
    </p>
  );
}
