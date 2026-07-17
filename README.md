# S&D Express Transport Booking CRM

A complete static PWA + Google Apps Script + Google Sheets transport-booking system. Customers can create and track booking requests. Administrators can manage bookings, availability, vehicles, payments, customers, calendars, reports, settings, quotations, and invoices.

## How the system works

```text
Customer/Admin browser (GitHub Pages)
                 │  JSON over HTTPS
                 ▼
       Google Apps Script Web App
                 │
        validation + business logic
                 │
                 ▼
 Google Sheets database + Google Drive QR/image URLs
```

The public portal never receives private customer lists. Tracking requires both the booking ID and matching phone number. Admin calls require a random six-hour token; passwords are salted and hashed in Apps Script before storage. Booking creation uses a script lock and re-checks overlapping dates inside that lock to prevent double booking.

## Features included

- Responsive premium landing page and fleet cards
- Four-step booking wizard with validation, capacity check, inclusive-day pricing, and availability check
- Manual deposit instructions and optional DuitNow QR
- Privacy-safe booking tracking
- Admin login, collapsible sidebar, mobile drawer, and persisted UI state
- Dashboard KPIs and six-month revenue chart
- Booking search/filter, detail, editing, approval/status workflow, delete, quotation, and invoice printing
- Calendar, vehicle CRUD, payment approval/rejection, customer rollups, reports, and business settings
- Database bootstrap, seeded fleet, audit log, notification extension points, and PWA offline app shell

## 1. Create the Google Sheet

1. Sign in to the Google account that should own the system.
2. Open [Google Sheets](https://sheets.google.com) and create a blank spreadsheet named `S&D Express CRM Database`.
3. In the spreadsheet choose **Extensions → Apps Script**. A script project opens, already bound to this spreadsheet.
4. Delete the sample `myFunction` code.
5. Open [`google-appscript/code.gs`](google-appscript/code.gs), copy all of it, and paste it into the Apps Script editor's `Code.gs`.
6. In Apps Script, open **Project Settings**, enable **Show `appsscript.json` manifest file**, then replace its content with [`google-appscript/appsscript.json`](google-appscript/appsscript.json). If Google hides the `webapp` section after saving, that is harmless; deployment settings control it.
7. Save the project and name it `S&D Express CRM API`.

## 2. Build the database automatically

1. At the top of the Apps Script editor, select `setupDatabase` in the function dropdown.
2. Click **Run**.
3. On first run Google asks for authorization. Choose the owner account, review permissions, and allow them. If the app is marked unverified, use **Advanced → Go to S&D Express CRM API (unsafe)**; this is your own private script, not a third-party app.
4. Wait for **Execution completed**.
5. Expand **Execution log** at the bottom. Copy the temporary email/password displayed there and keep it briefly in a password manager.
6. Return to the spreadsheet. These tabs now exist: `Bookings`, `Vehicles`, `Customers`, `Payments`, `Users`, `Settings`, and `AuditLog`.

`setupDatabase()` is safe to rerun. It creates missing sheets and seed rows but preserves existing records. It deliberately stops if an existing header differs from the expected schema.

## 3. Set a permanent administrator password

The initial login is `admin@sdexpress.my` with the random temporary password printed in the setup log.

To replace it:

1. In `Code.gs`, temporarily add this wrapper at the end:

```javascript
function setMyAdminPassword() {
  resetAdminPassword('admin@sdexpress.my', 'Choose-A-Long-Unique-Password');
}
```

2. Save, select `setMyAdminPassword`, and click **Run**.
3. Delete the wrapper immediately and save again so the plain password is not left in source or version history.

The Sheet stores only a unique salt and SHA-256 password hash. Running this function also invalidates any existing login token.

## 4. Configure business and payment details

You can do this after frontend deployment through **Admin → Settings**, or edit the `Setting Value` cells in the `Settings` sheet before the first deployment.

Fill at least:

- `businessName`
- `phone` and `email`
- `address`
- `bankName`, `accountNumber`, and `accountHolder`
- `depositPercentage` (default `50`)
- `duitNowQrUrl` (optional)
- `paymentTerms`

For a DuitNow QR image, upload the image to Google Drive, set sharing to **Anyone with the link – Viewer**, and use a directly viewable HTTPS image URL. A normal Drive sharing page sometimes refuses embedding; a reliable form is:

```text
https://drive.google.com/uc?export=view&id=YOUR_FILE_ID
```

The file ID is the value between `/d/` and `/view` in a Drive sharing URL. Do not use Drive for private receipts with public sharing.

## 5. Deploy the Apps Script API

1. In Apps Script click **Deploy → New deployment**.
2. Click the gear icon and choose **Web app**.
3. Description: `S&D Express CRM API v1`.
4. **Execute as:** `Me` (the spreadsheet owner).
5. **Who has access:** `Anyone`. This is required because the public booking form has no Google login. The API itself restricts private actions with its admin token.
6. Click **Deploy**, authorize if requested, then copy the URL ending in `/exec`.
7. Test it in a browser by opening:

```text
YOUR_EXEC_URL?action=HEALTH
```

You should receive JSON containing `"success":true` and version `1.0.0`.

Important: use the `/exec` URL, never `/dev`. After backend code changes, choose **Deploy → Manage deployments → Edit**, select **New version**, and deploy. Merely saving code does not update an existing production deployment.

## 6. Connect the frontend

Open [`config.js`](config.js) and set the copied URL:

```javascript
window.SD_CONFIG = {
  API_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  APP_NAME: "S&D Express",
  CURRENCY: "MYR"
};
```

This URL is not a secret; it is expected to be visible in the browser. Never add a password, Google API key, spreadsheet ID, or private token to `config.js`.

## 7. Test locally

Do not double-click the HTML files because service workers and some browser security features require HTTP. From the project directory run one of:

```powershell
npx serve .
```

or, if Python is installed:

```powershell
python -m http.server 8080
```

Open the printed localhost URL. Test this sequence:

1. `/booking/`: select a vehicle, dates, customer, and submit.
2. Confirm new rows appear in Bookings, Customers, and Payments.
3. `/track/`: enter the returned booking ID plus customer phone.
4. `/admin/`: log in and update the booking to Confirmed.
5. Attempt another booking for the same vehicle with overlapping dates; it must be rejected.
6. Approve/reject a payment and verify both Payment and Booking status change.
7. Print a quotation/invoice and choose **Save as PDF** in the browser print dialog.

## 8. Publish on GitHub Pages

1. Create a GitHub repository, for example `sd-express-crm`.
2. Commit the whole project after setting `config.js`.
3. Push to the default `main` branch.
4. In GitHub open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select `main`, folder `/ (root)`, then **Save**.
7. Wait for the Pages workflow to finish. The URL is normally `https://YOUR_USERNAME.github.io/sd-express-crm/`.
8. Open the site in a private window and repeat the booking/track/admin smoke test.

All frontend links and PWA paths are repository-relative, so a GitHub project subpath works without editing routes.

## 9. Install the PWA

GitHub Pages supplies HTTPS, which allows the service worker to run. In Chrome/Edge choose **Install S&D Express** from the address bar or browser menu. On iPhone Safari choose **Share → Add to Home Screen**. The interface shell opens offline; bookings and admin data still require internet because Google Sheets is the source of truth.

After changing cached frontend files, increment `CACHE` in [`service-worker.js`](service-worker.js), for example from `sd-express-v1.0.0` to `sd-express-v1.0.1`, so installed devices receive a clean cache.

## Operating workflow

1. A customer submits a request. Status starts as **New Inquiry** and payment as **Waiting Payment**.
2. Admin reviews route/pricing, adds charges or discount, and generates a quotation.
3. Set status to **Quotation Sent**, then **Waiting Deposit**.
4. After receipt arrives through WhatsApp, review it and use the Payments screen. Approval sets payment to **Paid** and booking to **Confirmed**.
5. On departure set **On Trip**; after return set **Completed**.
6. Dashboard/customer/report totals update from the same records.

## Backups and production hardening

- Use Google Drive's Sheet version history and make a scheduled copy of the spreadsheet weekly.
- Protect the `Users` and `AuditLog` sheets from non-owner edits.
- Do not give customers or ordinary staff spreadsheet access.
- Remove departed admins and redeploy/revoke access when ownership changes.
- Review `AuditLog` for sensitive admin mutations.
- The current token model permits one current session per admin user. Add separate rows in `Users` for separate staff rather than sharing credentials.
- Apps Script and Sheets quotas are suitable for an SME workflow, not high-volume multi-tenant SaaS. At larger scale, move data/auth to a managed backend while retaining the frontend service interfaces.

## Notification integrations

`notifyEvent_()` currently logs structured events for new bookings and important status/payment changes. Add MailApp, Telegram, or a WhatsApp provider call inside that function. Keep provider credentials in **Apps Script → Project Settings → Script Properties**, never in Sheets or frontend code.

## Troubleshooting

- **“API is not configured”** — set the `/exec` URL in `config.js` and republish GitHub Pages.
- **HTML/login page instead of JSON** — deployment access is not `Anyone`, or you used `/dev` rather than `/exec`.
- **Changes do not appear** — deploy a new Apps Script version and bump the service-worker cache version for frontend changes.
- **Authorization or missing Sheet error** — run `setupDatabase()` from the Sheet-bound script as the deployment owner.
- **Vehicle always unavailable** — inspect date ranges and booking statuses. New Inquiry through On Trip block overlap; Completed and Cancelled do not.
- **QR image is broken** — verify the Drive image is publicly viewable and use the `uc?export=view&id=` form.
- **Admin immediately signs out** — the six-hour session expired, a password reset invalidated it, or the same user logged in elsewhere.

## Project map

```text
index.html                 Landing page
booking/index.html         Customer booking wizard
track/index.html           Private booking tracking
admin/*.html               CRM screens
css/styles.css             Responsive design system
js/app.js                  Shared API and UI utilities
js/booking.js              Booking and tracking flows
js/auth.js                 Admin token lifecycle
js/admin.js                CRM screens and actions
js/invoice.js              Printable quotation/invoice
google-appscript/code.gs   API and all business logic
manifest.json              PWA metadata
service-worker.js          Offline app shell
```
