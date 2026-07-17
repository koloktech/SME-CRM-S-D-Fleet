# Google Sheets database structure

Do not type these headers manually unless troubleshooting. Running `setupDatabase()` from `google-appscript/code.gs` creates and formats all sheets, verifies headers, seeds the fleet/settings, and creates the first administrator.

| Sheet | Columns |
| --- | --- |
| Bookings | Booking ID, Created Date, Updated Date, Customer ID, Customer Name, Phone, Email, Vehicle ID, Vehicle Name, Pickup Date, Pickup Time, Return Date, Return Time, Pickup Location, Drop Location, Passenger, Trip Type, Rental Days, Daily Rate, Subtotal, Additional Charges, Discount, Total Amount, Payment Status, Booking Status, Customer Notes, Admin Notes |
| Vehicles | Vehicle ID, Vehicle Name, Type, Capacity, Daily Rate, Status, Image URL |
| Customers | Customer ID, Name, Phone, Email, Total Booking, Total Spending, Last Booking |
| Payments | Payment ID, Booking ID, Amount, Payment Method, Receipt Status, Verification Status, Created Date, Updated Date |
| Users | User ID, Email, Password Hash, Salt, Role, Active, Session Token Hash, Session Expiry |
| Settings | Setting Key, Setting Value |
| AuditLog | Timestamp, User, Action, Entity, Entity ID, Details |

Security notes:

- Never put a plain-text password in `Users`. Use `resetAdminPassword(email, newPassword)` from the Apps Script editor.
- Do not rename or rearrange columns. The setup function will stop on a mismatch instead of corrupting data.
- Protect `Users` and `AuditLog` in Google Sheets (Data → Protect sheets and ranges) so only the owner can edit them.
- Give staff access through the CRM, not direct editor access to the spreadsheet.
