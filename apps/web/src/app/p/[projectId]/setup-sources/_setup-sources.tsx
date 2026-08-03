"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Database,
  LoaderCircle,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import {
  useConnectSource,
  type GoogleProvider,
  type PropertySelectionPhase,
} from "@/lib/api/hooks-sources";
import {
  productProfilePath,
  setupSourcesPath,
  type SetupSourceReturnParams,
} from "./_setup-source-flow";
import styles from "./setup-sources.module.css";

const PROVIDERS = ["gsc", "ga4"] as const satisfies readonly GoogleProvider[];

export function SetupSources({
  projectId,
  initialConnectedProviders,
  oauthReturn,
}: {
  readonly projectId: string;
  readonly initialConnectedProviders: readonly GoogleProvider[];
  readonly oauthReturn: SetupSourceReturnParams;
}) {
  const t = useTranslations("sourceSetup");
  const router = useRouter();
  const connect = useConnectSource(projectId);
  const loadIntent = connect.mutateAsync;
  const consumedReturn = useRef(false);
  const [connectedProviders, setConnectedProviders] = useState<
    GoogleProvider[]
  >([...initialConnectedProviders]);
  const [activeProvider, setActiveProvider] =
    useState<GoogleProvider | null>(null);
  const [intent, setIntent] = useState<PropertySelectionPhase | null>(null);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [feedback, setFeedback] = useState<
    | { readonly tone: "success" | "error"; readonly message: string }
    | null
  >(oauthReturn.error ? { tone: "error", message: t("oauthError") } : null);

  useEffect(() => {
    if (consumedReturn.current) return;
    if (oauthReturn.error !== null) {
      consumedReturn.current = true;
      router.replace(setupSourcesPath(projectId), { scroll: false });
      return;
    }
    if (
      oauthReturn.provider === null ||
      oauthReturn.oauthIntentId === null
    ) {
      return;
    }
    consumedReturn.current = true;
    setActiveProvider(oauthReturn.provider);
    void loadIntent({
      provider: oauthReturn.provider,
      request: {
        phase: "property_selection",
        oauthIntentId: oauthReturn.oauthIntentId,
      },
    })
      .then((result) => {
        if (result.phase !== "property_selection") return;
        setIntent(result);
        setSelectedProperty(result.properties[0]?.id ?? "");
        if (result.properties.length === 0) {
          setFeedback({ tone: "error", message: t("noProperties") });
        }
        router.replace(setupSourcesPath(projectId), { scroll: false });
      })
      .catch(() => {
        setFeedback({ tone: "error", message: t("oauthError") });
        router.replace(setupSourcesPath(projectId), { scroll: false });
      });
  }, [loadIntent, oauthReturn, projectId, router, t]);

  async function authorize(provider: GoogleProvider): Promise<void> {
    setFeedback(null);
    setIntent(null);
    setActiveProvider(provider);
    try {
      const result = await connect.mutateAsync({
        provider,
        request: {
          phase: "authorize",
          returnPath: setupSourcesPath(projectId),
        },
      });
      if (result.phase === "authorization") {
        window.location.assign(result.authorizationUrl);
      }
    } catch {
      setFeedback({ tone: "error", message: t("oauthError") });
    }
  }

  async function selectProperty(): Promise<void> {
    if (!intent || selectedProperty.length === 0) return;
    setFeedback(null);
    try {
      const result = await connect.mutateAsync({
        provider: intent.provider,
        request: {
          phase: "select_property",
          oauthIntentId: intent.oauthIntentId,
          externalPropertyId: selectedProperty,
        },
      });
      if (result.phase !== "connected") return;
      setConnectedProviders((current) =>
        current.includes(intent.provider)
          ? current
          : [...current, intent.provider],
      );
      setFeedback({
        tone: "success",
        message: t("connectedFeedback", {
          provider: t(`providers.${intent.provider}.title`),
        }),
      });
      setIntent(null);
      setSelectedProperty("");
      setActiveProvider(null);
    } catch {
      setFeedback({ tone: "error", message: t("oauthError") });
    }
  }

  function continueToProfile(): void {
    router.push(productProfilePath(projectId));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h1 className="gg-page-title" data-app-page-title="">
          {t("title")}
        </h1>
        <p className={styles.subtitle}>{t("subtitle")}</p>
      </header>

      <ol className={styles.progress} aria-label={t("progress.label")}>
        <li data-state="complete">
          <span><Check size={15} aria-hidden="true" /></span>
          <div><strong>{t("progress.product")}</strong><small>{t("progress.complete")}</small></div>
        </li>
        <li data-state="current" aria-current="step">
          <span>2</span>
          <div><strong>{t("progress.sources")}</strong><small>{t("progress.optional")}</small></div>
        </li>
        <li data-state="upcoming">
          <span>3</span>
          <div><strong>{t("progress.profile")}</strong><small>{t("progress.next")}</small></div>
        </li>
      </ol>

      <section className={styles.trustPanel} aria-label={t("privacy.title")}>
        <div className={styles.trustIcon}><ShieldCheck size={23} aria-hidden="true" /></div>
        <div>
          <strong>{t("privacy.title")}</strong>
          <p>{t("privacy.detail")}</p>
        </div>
        <span><LockKeyhole size={14} aria-hidden="true" />{t("privacy.readOnly")}</span>
      </section>

      {feedback ? (
        <div
          className={styles.feedback}
          data-tone={feedback.tone}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.tone === "success" ? <Check size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
          <span>{feedback.message}</span>
        </div>
      ) : null}

      <div className={styles.sourceGrid}>
        {PROVIDERS.map((provider) => {
          const connected = connectedProviders.includes(provider);
          const busy = connect.isPending && activeProvider === provider;
          const Icon = provider === "gsc" ? Search : BarChart3;
          const providerIntent = intent?.provider === provider ? intent : null;
          return (
            <article
              key={provider}
              className={styles.sourceCard}
              data-connected={connected ? "true" : "false"}
            >
              <div className={styles.cardTopline}>
                <span className={styles.providerIcon}><Icon size={24} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className={styles.status} data-connected={connected ? "true" : "false"}>
                  {connected ? t("states.connected") : t("states.optional")}
                </span>
              </div>
              <div className={styles.cardCopy}>
                <p>{t(`providers.${provider}.eyebrow`)}</p>
                <h2>{t(`providers.${provider}.title`)}</h2>
                <span>{t(`providers.${provider}.detail`)}</span>
              </div>
              <ul className={styles.evidenceList}>
                <li><Check size={14} aria-hidden="true" />{t(`providers.${provider}.evidenceOne`)}</li>
                <li><Check size={14} aria-hidden="true" />{t(`providers.${provider}.evidenceTwo`)}</li>
              </ul>

              {providerIntent ? (
                <div className={styles.propertyPicker}>
                  <label htmlFor={`${provider}-onboarding-property`}>
                    {t("property.label")}
                  </label>
                  <select
                    id={`${provider}-onboarding-property`}
                    value={selectedProperty}
                    onChange={(event) => setSelectedProperty(event.target.value)}
                  >
                    {providerIntent.properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.displayName}
                      </option>
                    ))}
                  </select>
                  <p>{t("property.help")}</p>
                  <div className={styles.propertyActions}>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void selectProperty()}
                      disabled={connect.isPending || selectedProperty.length === 0}
                    >
                      {connect.isPending ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : null}
                      {connect.isPending ? t("actions.connecting") : t("actions.confirmProperty")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setIntent(null);
                        setSelectedProperty("");
                        setActiveProvider(null);
                      }}
                      disabled={connect.isPending}
                    >
                      {t("actions.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant={connected ? "secondary" : "primary"}
                  className={styles.connectButton}
                  disabled={connected || busy}
                  onClick={() => void authorize(provider)}
                >
                  {busy ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : connected ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                  {connected
                    ? t("actions.connected")
                    : busy
                      ? t("actions.authorizing")
                      : t("actions.connect")}
                </Button>
              )}
            </article>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerCopy}>
          <Database size={19} aria-hidden="true" />
          <div>
            <strong>
              {connectedProviders.length > 0
                ? t("footer.connectedTitle", { count: connectedProviders.length })
                : t("footer.skipTitle")}
            </strong>
            <p>
              {connectedProviders.length > 0
                ? t("footer.connectedDetail")
                : t("footer.skipDetail")}
            </p>
          </div>
        </div>
        <div className={styles.footerActions}>
          {connectedProviders.length > 0 ? (
            <Button type="button" variant="primary" onClick={continueToProfile}>
              {t("actions.generate")}<ArrowRight size={16} aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={continueToProfile}>
              {t("actions.skip")}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
