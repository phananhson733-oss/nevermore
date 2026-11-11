// @input  -- nothing; a build-time switch
// @output -- PROMOTER_PAGES_VISIBLE: whether 我的推广 (/promotions) and 我的收益 (/earnings) are shown to promoters
// @pos    -- read by the GGBoost header menu, the task center tab row, the two pages, the link on /tasks/<id> and the how-to's last step
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Hidden since 2026-11-10: no header or tab entry, no link from a drama's page
 * or the how-to, and both routes answer 404. Data, APIs and the admin pages
 * (account review, settlement import) are untouched; set this to true to bring
 * the two pages back as they were.
 */
export const PROMOTER_PAGES_VISIBLE: boolean = false;
