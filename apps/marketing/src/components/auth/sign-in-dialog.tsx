// @input  -- ui/dialog, GoogleSignInButton, next-intl
// @output — 登录弹层：标题 + Google 官方按钮 + 授权说明 + 可用目标焦点恢复
// @pos    -- 由 Header 持有开合状态，桌面端与移动端抽屉共用同一个实例
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useMemo, type RefObject } from "react";
import { useTranslations } from "next-intl";

import type { SignedInListener } from "../../lib/auth/gsi-client";
import { signedInHandler, useSignedInListener } from "./use-signed-in-listener";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GoogleSignInButton } from "./google-sign-in-button";

function isUsableReturnFocusTarget(target: HTMLElement): boolean {
  if (!target.isConnected || target.matches(":disabled")) return false;

  const view = target.ownerDocument.defaultView;
  if (view === null) return false;

  for (let element: HTMLElement | null = target; element !== null; element = element.parentElement) {
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
  }

  return true;
}

/**
 * The sign-in panel.
 *
 * A dialog rather than an inline dropdown because Google's button renders in a
 * cross-origin iframe: it must not be clipped by an ancestor's `overflow`, and
 * a focus-trapped modal is the one container that reliably is not.
 *
 * Fully controlled, and mounted once by the Header rather than by each trigger.
 * The mobile trigger lives inside the navigation sheet, and a dialog nested in
 * that sheet would unmount the moment the sheet closed — so the sheet closes
 * and this, its sibling, opens.
 *
 * The body mounts only while open, so the nonce cookie is issued to visitors
 * who actually intend to sign in rather than to every reader of every page.
 */
export function SignInDialog({
  open,
  onOpenChange,
  onSignedIn,
  returnFocusRef,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Called synchronously once a credential became a session, immediately
   * before the reload that follows. Registered for as long as this dialog is
   * mounted, open or not: a credential posted before the dialog closed still
   * completes, and the caller's state must still survive the reload.
   * Returning `false` keeps the page instead of reloading it.
   */
  readonly onSignedIn?: SignedInListener;
  /**
   * Optional stable focus target for flows whose trigger unmounted before the
   * dialog opened, such as the mobile Header sheet. Hidden or disabled targets
   * are ignored so Radix keeps control of its default close-focus handling.
   */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations();
  // Every instance closes itself on a successful credential, so the Header's
  // dialog benefits too; only a caller that passed onSignedIn is forwarded to.
  const listener = useMemo(() => signedInHandler(onOpenChange, onSignedIn), [onOpenChange, onSignedIn]);
  useSignedInListener(listener);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[420px]"
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (target === undefined || target === null || !isUsableReturnFocusTarget(target)) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[19px]">{t("auth.title")}</DialogTitle>
          <DialogDescription className="text-[14px]">
            {t("auth.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="pt-2 pb-1">
          <GoogleSignInButton />
        </div>

        <p className="text-center text-[12.5px] leading-relaxed text-text-dark-secondary">
          {t("auth.consent")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
