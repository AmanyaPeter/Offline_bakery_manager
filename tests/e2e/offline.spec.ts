import { test, expect } from "@playwright/test";
const identity = {
  user_id: "11111111-1111-4111-8111-111111111111",
  bakery_id: "22222222-2222-4222-8222-222222222222",
  location_id: "33333333-3333-4333-8333-333333333333",
  role: "manager",
  name: "Test Manager",
};
test("installed shell saves bread offline and survives a reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.evaluate(async (i) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("bakery-manager");
      request.onsuccess = () => {
        const d = request.result;
        const t = d.transaction("meta", "readwrite");
        t.objectStore("meta").put({ key: "identity", value: i });
        t.oncomplete = () => {
          d.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
    await navigator.serviceWorker.ready;
  }, identity);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What would you like to record?" }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("link", { name: "1 Baked Bread" }).click();
  await page.getByLabel("Number of loaves").fill("200");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved on this phone");
  await expect(page.getByText("1 waiting for backup")).toBeVisible();
  await page.reload();
  await expect(page.getByText("200 loaves", { exact: false })).toBeVisible();
  await expect(page.getByText("1 waiting for backup")).toBeVisible();
  await page.getByRole("link", { name: "5 Sold Bread" }).click();
  await page.getByLabel("Loaves sold").fill("20");
  await page.getByLabel("Price of one loaf (UGX)").fill("2000");
  await page.getByLabel("Money received now (UGX)").fill("10000");
  await page.getByLabel("Customer (required for unpaid bread)").fill("Grace");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByText("2 waiting for backup")).toBeVisible();
  await expect(page.getByText("180 loaves", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "7 Reports" }).click();
  await expect(
    page.locator("dl div").filter({ hasText: "Customer credit outstanding" }),
  ).toContainText("UGX 30,000");
  await expect(
    page.locator("dl div").filter({ hasText: "Money collected" }),
  ).toContainText("UGX 10,000");
});
test("seller home keeps the requested action order", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async (i) => {
      await new Promise<void>((resolve) => {
        const r = indexedDB.open("bakery-manager");
        r.onsuccess = () => {
          const t = r.result.transaction("meta", "readwrite");
          t.objectStore("meta").put({
            key: "identity",
            value: { ...i, role: "seller" },
          });
          t.oncomplete = () => resolve();
        };
      });
    },
    { ...identity },
  );
  await page.reload();
  await expect(page.locator("nav.actions a")).toHaveText([
    "1Sold Bread›",
    "2Received Bread›",
    "3Bread Left›",
    "4Return Bread›",
    "5My Records›",
  ]);
});
