# Business and costing rules

All amounts are whole UGX. A sale is at most UGX 1,000,000,000. No floating-point decimal amounts are stored. Cost apportionment multiplies and divides integer BigInts, rounding to the nearest UGX (half up). Ingredient scale quantities are whole units: scale 1000 and unit kg means 1500 units represent 1.5 kg.

## Bread and money

- Production increases central bread; it earns no revenue.
- Allocation/return is a transfer, never a sale. Unconfirmed bread remains in transit.
- Revenue is actual sold quantity × actual unit price.
- Cash collected includes initial sale payments and later payments, including mobile money.
- Debt is sale total minus accepted non-reversed payments. Database serialization prevents simultaneous later payments exceeding the remaining balance. An offline overpayment may be rejected and retained for review.
- A credit sale requires a customer name. Customer names are scoped to the bakery; use a consistent unique name or add a distinguishing detail for people with the same name.
- There is no aggregate-sales entry, so daily totals cannot duplicate individual transactions.
- Physical counts identify discrepancies. Use an adjustment after review, with a reason. Damaged bread reduces stock and is reported separately.

## Ingredients

Purchases are inventory investment, separate from operating expenses. Each purchase can contain several ingredients. Purchase paid amounts contribute to ingredient inventory value; quantities contribute to stock. Weighted-average carrying value follows purchases and classified adjustments ordered by effective time, with deterministic event tie breaking. Late facts can change estimates; resynchronize before relying on reports.

A count does not silently consume stock. Review:

`previous balance + purchases + incoming adjustments - current count - known outflows`.

Classify differences as estimated production use, wastage, spoilage, measurement discrepancy or other adjustment. Enter only the net change once; the count itself is not a second movement. Negative production-use adjustments reduce carrying value at weighted-average cost and enter estimated production cost. Other negative classifications reduce stock value without pretending they are production consumption. Positive measurement adjustments add quantity with no new purchase spending/value: this changes the average carrying cost and must be reviewed.

## Estimates

The default all-records report uses a uniform ingredient cost estimate for the single bread product:

- Estimated production ingredient cost = classified production use at ingredient weighted average.
- Estimated cost of bread sold = production ingredient cost × sold loaves / produced loaves.
- Estimated gross profit = sales revenue minus estimated ingredient cost of sold bread.
- Estimated net profit = estimated gross profit minus operating expenses minus estimated ingredient cost of damaged bread.
- Revenue minus all classified production use minus expenses is separately labeled a production-period margin, not interchangeable with cost-of-sales profit.

These estimates are shown only when production and classified ingredient costs exist and sold plus damaged bread does not exceed produced bread. They spread cumulative costs over cumulative production, not individual batches. They exclude unclassified ingredient losses and unpriced opening stock. Fuel, wages and other entered operating costs are expensed once and are not allocated to bread inventory. This is deliberately a simple management estimate, not financial statements or exact production costing. Unsold bread remains visible by location; in-transit bread is not part of a location balance until confirmed.

Before using profitability, enter opening inventory through purchases/production or reviewed adjustments, classify stock differences, resolve rejected records and synchronize every phone. Do not claim exact per-batch consumption from a count spanning several batches.
