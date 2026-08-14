// @input  — skill slug、locale 路由配置与站点 URL
// @output — Skill 页展示的安装命令（落地路径 + 无 locale 前缀的下载 URL）
// @pos    — Skill 详情页安装区的唯一命令来源；与 skillInstallPath 同为规范落点的权威
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { localeUrl } from "./locale-path";
import { skillInstallPath } from "./skill-content";
import { routing } from "../i18n/routing";

/**
 * The one-line install command shown on a skill page.
 *
 * The download URL is always the default locale's prefix-free one, whichever
 * locale is reading. What it fetches is the SKILL.md itself, which is English
 * on every route because it is the file an agent loads rather than page copy —
 * so a `/zh/` prefix in front of a byte-identical file is noise in a command
 * someone pastes into a shell.
 *
 * If a locale ever ships its own SKILL.md, this has to become locale-aware
 * again: the command would then be fetching the wrong file rather than a
 * longer URL for the right one.
 */
export function skillInstallCommand(slug: string): string {
  const path = skillInstallPath(slug);
  const directory = path.slice(0, path.lastIndexOf("/"));
  const url = localeUrl(routing.defaultLocale, `/skills/${slug}/file`);

  return `mkdir -p ${directory} && curl -fsSL ${url} -o ${path}`;
}
