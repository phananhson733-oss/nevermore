# apps/marketing/src/components/task-center

Client components for the task center. The pages under `app/[locale]/tasks`, `promotions`, `earnings` and `admin/tasks` render on the server and use these only where the browser has to act.

- `clip-plaza.tsx` — the 素材广场 grid on `/tasks`: 9:16 cards with the clip's still (or the drama's cover), type and 本周爆款 badges; a card opens a dialog laid out like RS Boost's resource page: the clip playing beside the drama's title, chips, 上架时间 · 共 N 集 · 前 M 集免费, synopsis, the clip's download and numbered buttons for the drama's other clips, the claim panel, the 账号报白 banner and the how-to (a signed-out visitor is asked to sign in). A link claimed in a dialog stays shown when it is reopened.
- `claim-panel.tsx` — a drama's promo link as a titled block (短剧推广链接, which opens the drama's page on our site; no 口令), empty with one "get my link" button until claimed; the button POSTs to `/api/tasks/<id>/claim` and the block then holds the link with a copy button, focus moved to it. Below it, a link to that page, so a promoter sees what readers get. Claiming is never a side effect of opening the page. Signed-out visitors get a sign-in link instead.
- `link-block.tsx` — one promo link as RS Boost lays it out: title, what it is for, the URL in a selectable box and a copy button (a dashed placeholder before it is claimed), and a heading level (h3 straight under a page's h2, h4 under the dialog's h3); takes the locale, not the copy object, because server pages render it.
- `drama-info.tsx` — stateless pieces of a drama's details shared by the dialog and `/tasks/<id>`: language, 频道, genre and tag chips, the 上架时间 · 共 N 集 · 前 M 集免费 line, numbered clip downloads, the 账号报白 banner and the how-to.
- `task-tabs.tsx` — the 任务中心 / 我的推广 / 我的收益 tabs at the top of all three promoter pages (server component).
- `accounts-panel.tsx` — the 账号报白 section of /promotions: the promoter's TikTok/Facebook accounts with their status, the submit form, and withdraw for any still waiting for review.
- `admin/` — the admin backend's forms and controls; Chinese only.
