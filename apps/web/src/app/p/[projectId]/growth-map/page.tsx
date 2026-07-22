import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { GrowthMapClient } from "./_growth-map.tsx";
import styles from "./growth-map.module.css";

interface GrowthMapPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function GrowthMapPage({ params }: GrowthMapPageProps) {
  const { projectId } = await params;
  const t = await getTranslations("growthMap");

  return (
    <Suspense
      fallback={
        <div className={styles.pageState} role="status" aria-live="polite">
          <span className={styles.loadingMark} aria-hidden="true" />
          <p>{t("loadingPortfolio")}</p>
        </div>
      }
    >
      <GrowthMapClient projectId={projectId} />
    </Suspense>
  );
}
