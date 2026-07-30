// @input  — 无
// @output — WaitlistSubscriber / WaitlistProfile 接口
// @pos    — 等待列表数据类型，对应 SPEC 4.2.13-14 表
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export interface WaitlistSubscriber {
  id: string;
  email: string;
  name?: string;
  company?: string;
  role?: string;
  locale: string;
  source?: string;
  offer_tag: string;
  referred_by: string | null;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  channel_fingerprint_id?: string;
  landing_page?: string;
  referral_code?: string;
  waitlist_status: "waitlist" | "invited" | "trial_activated";
  email_status:
    | "pending"
    | "confirmed"
    | "engaged"
    | "churned"
    | "unsubscribed";
  created_at: string;
}

export interface WaitlistProfile {
  id: string;
  subscriber_id: string;
  field_name: string;
  field_value: string;
  created_at: string;
}
