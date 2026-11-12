import { TryIt } from "@/components/try-it/TryIt";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance · PayPal sandbox demo</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Can you trick my AI into spending your money?
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          My AI restocks the house from a demo store. Its rule is &ldquo;$120 a week, household basics only, nothing over
          $40 without asking me, never gift cards.&rdquo; Hide one line on a product page and see whether it gets past the
          rule. The rule is checked in plain code at checkout, before PayPal is charged.
        </p>
      </header>
      <TryIt />
    </main>
  );
}
