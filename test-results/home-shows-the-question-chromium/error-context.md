# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> shows the question
- Location: e2e/home.spec.ts:3:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Can you trick my AI into spending your money?' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'Can you trick my AI into spending your money?' }) with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Can you trick my AI into spending your money?' })

```

```yaml
- img "Zetaris"
- heading "Log in" [level=2]
- text: Username
- textbox "Username":
  - /placeholder: Enter your username
- text: Password
- textbox "Password":
  - /placeholder: Enter your password
- button "Show password"
- button "Sign In"
- text: AI Data Gateway
- heading "Unify, query, and govern all your data" [level=3]
- list:
  - listitem: Data Connection Across Any Source
  - listitem: Drive Intelligent Business Decisions with AI
  - listitem: Enterprise Governance and Access Control
  - listitem: Lightning-fast SQL Across Distributed Data
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | test("shows the question", async ({ page }) => {
  4  |   await page.goto("/");
  5  |   await expect(
  6  |     page.getByRole("heading", {
  7  |       name: "Can you trick my AI into spending your money?",
  8  |     }),
> 9  |   ).toBeVisible();
     |     ^ Error: expect(locator).toBeVisible() failed
  10 | });
  11 | 
```