// @input  -- nothing; a build-time switch
// @output -- PROMOTER_PAGES_VISIBLE: whether 我的推广 (/promotions) and 我的收益 (/earnings) are shown to promoters; PROMO_LINKS_VISIBLE: whether the task center shows a drama's 推广链接 and 资源推广链接
// @pos    -- read by the GGBoost header menu, the task center tab row, the two pages, /tasks and its clip dialog, /tasks/<id> and the how-to
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Hidden since 2026-11-10: no header or tab entry, no link from a drama's page
 * or the how-to, and both routes answer 404. Data, APIs and the admin pages
 * (account review, settlement import) are untouched; set this to true to bring
 * the two pages back as they were.
 */
export const PROMOTER_PAGES_VISIBLE: boolean = false;

/**
 * Hidden since 2026-11-10: the clip dialog on /tasks and /tasks/<id> show no
 * 推广链接 or 资源推广链接 (nor the link to the page the first opens), no
 * claim is POSTed, the pages stop loading the visitor's codes, and the how-to
 * drops the steps about copying a link. Codes already handed out keep
 * redirecting through /t/<code>. Set this to true to show the links again.
 */
export const PROMO_LINKS_VISIBLE: boolean = false;
