import { expect, test } from "@playwright/test";
import { resetApp, signInAsOwner, steer } from "./helpers";

test("fills the evidence timeline when a dispute arrives", async ({ page, request }) => {
  await resetApp(request, { savedPayPal: true });

  // A real charge through the fake PayPal. The first charge after a reset is FAKE-CAPTURE-1.
  await page.goto("/");
  await page.getByRole("button", { name: "Try a normal restock" }).click();
  await expect(page.getByTestId("result-card")).toContainText("PayPal charged $34.");

  // The sandbox buyer opens an "unauthorized" dispute on that capture, and PayPal asks the seller for evidence.
  await steer(request, {
    hooks: { disputes: [{ id: "PP-D-TEST1", captureId: "FAKE-CAPTURE-1", status: "WAITING_FOR_SELLER_RESPONSE", withEvidenceLink: true }] },
  });

  await signInAsOwner(page);
  await page.goto("/disputes");
  await expect(page.getByRole("link", { name: /PP-D-TEST1/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Check PayPal for disputes" }).click();
  await expect(page.getByRole("status")).toContainText("Checked PayPal. It lists 1 dispute. Allowance sent evidence for 1.");

  await page.getByRole("link", { name: /PP-D-TEST1/ }).click();
  const timeline = page.getByTestId("dispute-timeline");
  await expect(timeline.getByTestId("step-seen")).toContainText("Seen");
  await expect(timeline.getByTestId("step-matched")).toContainText("FAKE-CAPTURE-1");
  await expect(timeline.getByTestId("step-matched")).toContainText("$34");
  // Evidence went out, with its seconds from "seen". The waiting step is gone, and no stage PayPal
  // has not reached yet (under review, resolved) is drawn.
  const sent = timeline.getByTestId("step-evidence_sent");
  await expect(sent).toContainText("Evidence sent");
  await expect(sent).toContainText(/\d+ seconds? after Allowance first saw the dispute/);
  await expect(timeline.getByTestId("step-waiting")).toHaveCount(0);
  await expect(timeline.getByTestId("step-under_review")).toHaveCount(0);
  await expect(timeline.getByTestId("step-resolved")).toHaveCount(0);
});
