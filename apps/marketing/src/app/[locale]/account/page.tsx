// @input  -- locale route param
// @output -- locale-safe redirect to the default Websites settings module
// @pos    -- canonical entry point for /account

import { redirect } from "next/navigation";

import { localePath } from "@/lib/locale-path";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  redirect(localePath(locale, "/account/websites"));
}
