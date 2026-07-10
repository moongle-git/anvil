import Link from "next/link";

interface PageShellProps {
  children: React.ReactNode;
}

export function PageShell({ children }: PageShellProps) {
  return (
    <>
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex w-full max-w-5xl items-center px-6 py-4">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-neutral-900"
          >
            anvil
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </main>
    </>
  );
}
