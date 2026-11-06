# apps/marketing/src/components/task-center

Client components for the task center. The pages under `app/[locale]/tasks`, `promotions`, `earnings` and `admin/tasks` render on the server and use these only where the browser has to act.

- `clip-plaza.tsx` — the 素材广场 grid on `/tasks`: 9:16 cards with the clip's still (or the drama's cover), type and 本周爆款 badges; a card opens a dialog that plays the clip, downloads it and holds the drama's claim panel, or asks a signed-out visitor to sign in.
- `claim-panel.tsx` — one "get my promo link" button on a drama page; it POSTs to `/api/tasks/<id>/claim` and then shows the link and code with copy buttons. Claiming is never a side effect of opening the page. Signed-out visitors get a sign-in link instead.
- `copy-row.tsx` — a label, a selectable monospace value and a copy button; takes the locale, not the copy object, because server pages render it.
- `task-tabs.tsx` — the 任务中心 / 我的推广 / 我的收益 tabs at the top of all three promoter pages (server component).
- `accounts-panel.tsx` — the 账号报白 section of /promotions: the promoter's TikTok/Facebook accounts with their status, the submit form, and withdraw for any still waiting for review.
- `admin/` — the admin backend's forms and controls; Chinese only.
