# apps/marketing/src/components/task-center/admin

Client controls for `/admin/tasks`. Chinese only, like the admin pages. Every request goes through `admin-fetch.ts` to the same-origin admin API, which answers 404 to anyone not on `TASK_ADMIN_EMAILS`.

- `admin-fetch.ts` — JSON fetch to the admin API and the Chinese message for each error code.
- `drama-form.tsx` — create and edit a drama's details and promo target; a new drama opens its own edit page.
- `drama-admin-controls.tsx` — publish, take down (archived: off the list, existing promo links still redirect), back to draft, cover and clip upload straight from the browser to R2 with progress (one file at a time, the button locked from the first click so a double click cannot upload twice, then the server verifies size and type; a cover is only checked for type, a non-zero size and the 20 MB cap), and asset delete.
- `settlement-import-form.tsx` — pick a CSV and a currency, import it, and list each problem line or unclaimed code when the file is refused.
