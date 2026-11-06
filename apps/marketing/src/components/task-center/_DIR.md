# apps/marketing/src/components/task-center

Client components for the task center. The pages under `app/[locale]/tasks`, `earnings` and `admin/tasks` render on the server and use these only where the browser has to act.

- `claim-panel.tsx` — the four channel buttons on a drama page; claiming POSTs to `/api/tasks/<id>/claim` and shows the promo link and code with copy buttons. Signed-out visitors get a sign-in link instead.
- `admin/` — the admin backend's forms and controls; Chinese only.
