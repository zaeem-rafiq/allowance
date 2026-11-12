import { TryIt } from "@/components/try-it/TryIt";

const RULE_CHIPS = ["$120 a week", "Household basics only", "Ask me first over $40", "Never gift cards"];

const STEPS = [
  {
    title: "The parent writes a rule",
    body: "In plain English. Claude turns it into a mandate, and Allowance signs it.",
  },
  {
    title: "PayPal is saved once",
    body: "The parent approves on PayPal's own page. After that, nobody needs to log in.",
  },
  {
    title: "Every cart is checked in code",
    body: "Before PayPal is charged, plain code compares the cart with the signed rule. A web page cannot argue with it.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance · PayPal sandbox demo</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Can you trick my AI into spending your money?
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          My AI restocks the house from a demo store. Hide one line on a product page and see whether it gets past my
          rule:
        </p>
        <ul aria-label="The rule" className="flex flex-wrap gap-2">
          {RULE_CHIPS.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {chip}
            </li>
          ))}
        </ul>
      </header>
      <TryIt />
      <section aria-label="How it works" className="mt-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">How it works</h2>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-1">
              <span className="text-sm font-semibold tabular-nums text-zinc-400">{i + 1}</span>
              <span className="font-medium">{step.title}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{step.body}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-zinc-500">
          PayPal sandbox only: no real money moves. The mandate follows the shape of AP2&apos;s intent mandate but is not
          official AP2.
        </p>
      </section>
    </main>
  );
}
