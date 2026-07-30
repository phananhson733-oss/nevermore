// @input  -- blog-data-en.ts, blog-data-zh.ts
// @output -- combined MOCK_BLOG_POSTS array (7 posts x 2 locales = 14 rows)
// @pos    -- mock data aggregate for blog data layer, consumed by blog.ts fallback
// once this file is updated, update header comments and _DIR.md in this folder

import { MOCK_BLOG_POSTS_EN } from "./blog-data-en";
import { MOCK_BLOG_POSTS_ZH } from "./blog-data-zh";

export const MOCK_BLOG_POSTS = [...MOCK_BLOG_POSTS_EN, ...MOCK_BLOG_POSTS_ZH];
