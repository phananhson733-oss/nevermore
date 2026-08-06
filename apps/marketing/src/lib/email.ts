// @input  — Resend SDK, unsubscribe-token, 环境变量 RESEND_API_KEY / EMAIL_* / UNSUBSCRIBE_SECRET
// @output — welcome / nurture / invite email senders (env used only for GenGrowth's
//           OWN emails; no customer-compliance signal export — see note below)
// @pos    — 邮件服务层，供 API Route 调用（SPEC 2.4.2 Welcome Email）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { Resend } from "resend";
import { generateUnsubscribeToken } from "./unsubscribe-token";

const FROM_EMAIL =
  process.env.EMAIL_FROM || "GenGrowth <onboarding@resend.dev>";

// NOTE: GenGrowth's own email env (UNSUBSCRIBE_SECRET / EMAIL_POSTAL_ADDRESS /
// NEXT_PUBLIC_APP_URL) is used ONLY to send GenGrowth's own emails below
// (buildComplianceFooter / buildUnsubscribeUrl). It must NEVER be used as a
// proxy for an audited customer site's email compliance — the former
// getEmailComplianceSignals() did exactly that (every customer got the same
// verdict from GenGrowth's deploy config) and was removed (PRD V2 §7 / Module G
// hygiene). Customer email compliance (g4) requires real .eml/ESP evidence.

function buildUnsubscribeUrl(subscriberId: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || !process.env.UNSUBSCRIBE_SECRET) return null;
  const token = generateUnsubscribeToken(subscriberId);
  const url = new URL("/api/unsubscribe", appUrl);
  url.searchParams.set("subscriber_id", subscriberId);
  url.searchParams.set("token", token);
  return url.toString();
}

function buildComplianceFooter({
  subscriberId,
  locale,
}: {
  subscriberId?: string;
  locale: string;
}): string {
  const address = process.env.EMAIL_POSTAL_ADDRESS?.trim();
  const unsubscribeUrl = subscriberId
    ? buildUnsubscribeUrl(subscriberId)
    : null;
  const lines: string[] = [];

  if (address) {
    lines.push(
      `<p style="color: #666; font-size: 12px; margin-top: 20px;">${escapeHtml(address)}</p>`,
    );
  }

  if (unsubscribeUrl) {
    const label = locale === "zh" ? "退订邮件" : "Unsubscribe";
    lines.push(
      `<p style="margin-top: 12px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color: #666; font-size: 12px; text-decoration: underline;">${label}</a></p>`,
    );
  }

  return lines.join("");
}

function injectFooter(html: string, footer: string): string {
  if (!footer) return html;
  return html.replace(/<\/div>\s*$/, `${footer}</div>`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export async function sendWelcomeEmail({
  email,
  name,
  locale,
}: {
  email: string;
  name?: string;
  locale?: string;
}) {
  try {
    const isZh = locale === "zh";
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: isZh
        ? "欢迎加入 GenGrowth 等待列表！"
        : "Welcome to the GenGrowth Waitlist!",
      html: generateWelcomeHtml({ name, locale: locale || "en" }),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err };
  }
}

type NurtureEmailType = "nurture_week_1";

interface NurtureTemplate {
  subject: Record<string, string>;
  body: (name: string, locale: string) => string;
}

const NURTURE_TEMPLATES: Record<NurtureEmailType, NurtureTemplate> = {
  nurture_week_1: {
    subject: {
      en: "Your first week with GenGrowth - what to expect",
      zh: "GenGrowth 第一周 - 你可以期待什么",
    },
    body: (n, locale) =>
      locale === "zh"
        ? `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #0E6B49; font-size: 24px;">Hi ${n}，</h1>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">感谢你加入 GenGrowth 等待列表！以下是我们本周的产品进展和你可以期待的内容。</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">我们的 AI 增长引擎正在持续优化，很快就能为你提供专属的增长策略。</p>
            <p style="color: #666; font-size: 14px; margin-top: 30px;">— GenGrowth 团队</p>
          </div>`
        : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #0E6B49; font-size: 24px;">Hi ${n},</h1>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Thanks for joining the GenGrowth waitlist! Here's what we've been working on this week.</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Our AI growth engine is continuously improving, and we'll have personalized growth strategies ready for you soon.</p>
            <p style="color: #666; font-size: 14px; margin-top: 30px;">— The GenGrowth Team</p>
          </div>`,
  },
};

export async function sendNurtureEmail({
  subscriberId,
  email,
  name,
  locale,
  emailType,
}: {
  subscriberId: string;
  email: string;
  name?: string;
  locale: string;
  emailType: NurtureEmailType;
}) {
  try {
    const resend = getResend();
    const safeName = name
      ? escapeHtml(name)
      : locale === "zh"
        ? "朋友"
        : "there";
    const tmpl = NURTURE_TEMPLATES[emailType];
    const html = injectFooter(
      tmpl.body(safeName, locale),
      buildComplianceFooter({ subscriberId, locale }),
    );

    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: tmpl.subject[locale] ?? tmpl.subject.en,
      html,
    });
    return { success: true as const };
  } catch (err) {
    return { success: false as const, error: err };
  }
}

export async function sendInviteEmail({
  email,
  code,
  expiresAt,
  locale,
}: {
  email: string;
  code: string;
  expiresAt: string;
  locale?: string;
}) {
  try {
    const isZh = locale === "zh";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      throw new Error("NEXT_PUBLIC_APP_URL environment variable is not set");
    }
    const activationLink = `${appUrl}/app/activate?code=${encodeURIComponent(code)}`;
    const expiryDate = new Date(expiresAt).toLocaleDateString(
      isZh ? "zh-CN" : "en-US",
      { year: "numeric", month: "long", day: "numeric" },
    );

    const safeLink = escapeHtml(activationLink);
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: isZh
        ? "GenGrowth 邀请码 — 开始你的免费试用"
        : "Your GenGrowth Invite — Start Your Free Trial",
      html: generateInviteHtml({
        activationLink: safeLink,
        expiryDate,
        locale: locale || "en",
      }),
    });
    return { success: true as const };
  } catch (err) {
    return { success: false as const, error: err };
  }
}

function generateInviteHtml({
  activationLink,
  expiryDate,
  locale,
}: {
  activationLink: string;
  expiryDate: string;
  locale: string;
}): string {
  const isZh = locale === "zh";
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="color: #0E6B49; font-size: 24px;">${isZh ? "你的 GenGrowth 邀请已就绪" : "Your GenGrowth Invite is Ready"}</h1>
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        ${
          isZh
            ? "恭喜！你已被邀请体验 GenGrowth AI 增长引擎。点击下方按钮激活你的账户并开始免费试用。"
            : "Congratulations! You've been invited to try GenGrowth's AI growth engine. Click the button below to activate your account and start your free trial."
        }
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${activationLink}" style="display: inline-block; background-color: #3DDC97; color: #06110C; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-size: 16px; font-weight: 600;">
          ${isZh ? "激活账户" : "Activate Your Account"}
        </a>
      </div>
      <p style="color: #666; font-size: 14px; line-height: 1.5;">
        ${
          isZh
            ? `此邀请将于 ${expiryDate} 过期。如果按钮无法点击，请复制以下链接到浏览器：`
            : `This invite expires on ${expiryDate}. If the button doesn't work, copy this link:`
        }
      </p>
      <p style="color: #999; font-size: 12px; word-break: break-all;">${activationLink}</p>
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        — The GenGrowth Team
      </p>
    </div>
  `;
}

function generateWelcomeHtml({
  name,
  locale,
}: {
  name?: string;
  locale: string;
}): string {
  const isZh = locale === "zh";
  const safeName = name ? escapeHtml(name) : null;
  const greeting = safeName
    ? isZh
      ? `${safeName}，你好！`
      : `Hi ${safeName}!`
    : isZh
      ? "你好！"
      : "Hi there!";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="color: #0E6B49; font-size: 24px;">${greeting}</h1>
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        ${
          isZh
            ? "感谢加入 GenGrowth 等待列表。你将获得早期访问、每周实验报告，以及新用户 7 天免费试用。"
            : "Thanks for joining the GenGrowth waitlist. You'll get early access, weekly experiment reports, and a 7-day free trial for new users."
        }
      </p>
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        ${
          isZh
            ? "我们每周公开实验日志和决策过程——关注我们的博客和社媒保持同步。"
            : "We publish weekly experiment logs and decisions — follow our blog and social channels to stay in sync."
        }
      </p>
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        — The GenGrowth Team
      </p>
    </div>
  `;
}
