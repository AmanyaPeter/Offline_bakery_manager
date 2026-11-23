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
        t.objectStore("meta").put({
          key: "ingredients:" + i.bakery_id,
          value: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Flour",
              unit: "kg",
              scale: 1000,
            },
          ],
        });
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
    page.getByRole("heading", { name: "Bakery production" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  await context.setOffline(true);
  await page.getByRole("link", { name: "Record Bake" }).click();
  await page.getByLabel("Number of loaves").fill("200");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved on this phone");
  await expect(page.getByText("1 waiting for backup")).toBeVisible();
  await page.reload();
  await expect(page.getByText("200 loaves", { exact: false })).toBeVisible();
  await expect(page.getByText("1 waiting for backup")).toBeVisible();
  await page.getByRole("link", { name: "Sold Bread" }).click();
  await page.getByLabel("Loaves sold").fill("20");
  await page.getByLabel("Price of one loaf (UGX)").fill("2000");
  const amount = page.getByLabel("Money received now (UGX)");
  const fullPayment = page.getByRole("checkbox", {
    name: "Use full sale total",
  });
  await fullPayment.check();
  await expect(amount).toHaveValue("40000");
  await page.getByLabel("Loaves sold").fill("21");
  await expect(amount).toHaveValue("42000");
  await page.getByLabel("Loaves sold").fill("20");
  await page.getByLabel("Payment method").selectOption("credit");
  await expect(amount).toHaveValue("0");
  await expect(fullPayment).not.toBeChecked();
  await expect(fullPayment).toBeDisabled();
  await expect(amount).not.toBeEditable();
  await page.getByLabel("Payment method").selectOption("cash");
  await amount.fill("10000");
  await page.getByLabel("Customer (required for unpaid bread)").fill("Grace");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByText("2 waiting for backup")).toBeVisible();
  await expect(page.getByText("180 loaves", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(
    page.locator("dl div").filter({ hasText: "Customer credit outstanding" }),
  ).toContainText("UGX 30,000");
  await expect(
    page.locator("dl div").filter({ hasText: "Money collected" }),
  ).toContainText("UGX 10,000");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Bought Ingredients" }).click();
  await page
    .getByRole("combobox", { name: "Ingredient", exact: true })
    .selectOption("44444444-4444-4444-8444-444444444444");
  await page.getByLabel("Quantity in the ingredient’s unit").fill("1.5");
  await page.getByLabel("Total paid for this item (UGX)").fill("3000");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByText("3 waiting for backup")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Records", exact: true })
    .click();
  await expect(page.getByText(/Flour: 1.5 kg/)).toBeVisible();
  await page.getByRole("link", { name: "Receive Payment" }).click();
  const sale = page.getByRole("combobox", { name: "Sale", exact: true });
  await expect(sale.getByRole("option").nth(1)).toHaveText(
    /Grace.*UGX 30,000 due/,
  );
  await sale.selectOption({ index: 1 });
  await expect(page.getByLabel("Money received (UGX)")).toHaveAttribute(
    "max",
    "30000",
  );
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
    "Sold Bread›",
    "Received Bread›",
    "Bread Left›",
    "Return Bread›",
    "My Records›",
  ]);
});
