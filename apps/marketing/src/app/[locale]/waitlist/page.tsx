// @input  -- locale route param, WaitlistForm, generatePageMetadata
// @output -- direct-link marketing waitlist page reusing the hardened waitlist form
// @pos    -- explicit /waitlist entry for access notifications on the marketing domain
import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import { generatePageMetadata } from "@/lib/seo";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title: locale === "zh" ? "等待访问开放通知" : "Get Notified When Access Opens",
    description:
      locale === "zh"
        ? "留下邮箱。等 GenGrowth 访问开放后，我们会发邮件通知你。"
        : "Leave your email and GenGrowth will send a note when access opens.",
    locale,
    path: "/waitlist",
    noIndex: true,
  });
}

export default async function WaitlistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();
  const copy =
    locale === "zh"
      ? {
          eyebrow: "GenGrowth 等待列表",
          title: "访问开放时邮件通知我",
          body: "留下邮箱。等 GenGrowth 的访问开放后，我们会给你发一封通知邮件。",
        }
      : {
          eyebrow: "GenGrowth waitlist",
          title: "Email me when access opens",
          body: "Leave your email and we will send you a note when access opens for GenGrowth.",
        };

  return (
    <section className="relative min-h-screen overflow-hidden bg-brand-bg px-6 pt-16 pb-24 md:px-8 md:pt-21">
      <div
        aria-hidden="true"
        className="bg-signal-grid absolute inset-0 opacity-40"
      />
      <div
        aria-hidden="true"
        className="absolute -top-30 right-[8%] hidden h-70 w-100 rounded-full bg-page-glow blur-[12px] md:block"
      />

      <section className="relative mx-auto max-w-xl rounded-card border border-brand-border-card bg-brand-panel p-7 md:p-10">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {copy.eyebrow}
        </p>
        <h1 className="text-page-title mt-4 text-text-dark-primary">
          {copy.title}
        </h1>
        <p className="mt-5 text-[15.5px] leading-[1.65] text-text-dark-secondary">
          {copy.body}
        </p>
        <div className="mt-8">
          <NextIntlClientProvider
            messages={{ waitlist: messages.waitlist }}
          >
            <WaitlistForm source="waitlist-page" />
          </NextIntlClientProvider>
        </div>
      </section>
    </section>
  );
}
