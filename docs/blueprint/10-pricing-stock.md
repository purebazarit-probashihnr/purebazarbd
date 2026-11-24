PRICING: Product has ownerType (COMPANY | VENDOR), vendorId, vendorPrice,
mrp (mrp >= vendorPrice), margin (mrp - vendorPrice) (calculated). Warn
if margin < max shareholder discount (5% of MRP). Price changes:
authorized roles only, saved in pricehistory + audit, affect future
sales only. Category commission % exists but is OFF
(commissionEnabled=false) and unused.
STOCK: Never edit stock directly. Every change is a stockmovements line
(who, when, why, type: GRN, SALE, RETURN, TRANSFER_OUT, TRANSFER_IN,
ADJUSTMENT, COUNT). Current stock = sum of movements. Approval + stock
update = one DB transaction.
GRN: Draft, Approved, Rejected. Vendor or Company purchase. Product
search limited to that vendor. An existing product for that vendor adds
quantity to the same product. Received/accepted/rejected quantities,
vendor challan number. Stock increases only on approval; approved GRN is
not editable (fix with Stock Adjustment).

BARCODES: A product has a primary barcode, `barcodeSource` (`manufacturer`
or `internal`), and optional extra barcodes. Manufacturer EAN-13, EAN-8,
and UPC-A check-digit problems warn but do not block saving. Empty primary
barcode generates an internal `PB-` code; this textual prefix is reserved
for PureBazar and is not a manufacturer EAN/UPC code. Barcode uniqueness
is per owner/vendor across primary and extra codes. Copies for different
vendors share a `productGroupId` but retain separate vendor prices/payables.
POS resolves a barcode to the in-stock vendor copy with the oldest remaining
GRN or transfer-in stock; the cashier can change the vendor copy before sale.
Barcode labels show internal codes by default, with an option to print all.
GRN may create a vendor copy from another vendor's matching item and add it
to the draft receive.

TRANSFER: Requested, Dispatched, Received (confirmed by outlet),
Discrepancy.
ADJUSTMENT: reason mandatory; Super Admin approval above a set value;
logged. STOCK COUNT posts difference as adjustment.