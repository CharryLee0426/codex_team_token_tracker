import { SiteHeader } from "@/components/header/site-header";
import { LandingRoot } from "@/components/landing/landing-root";
import { Hero } from "@/components/landing/hero";
import { TelemetryStrip } from "@/components/landing/telemetry-strip";
import { FeatureGrid } from "@/components/landing/feature-grid";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProductPreview } from "@/components/landing/product-preview";
import { LandingFooter } from "@/components/landing/landing-footer";

export default function LandingPage() {
  return (
    <LandingRoot>
      <SiteHeader />
      <main>
        <Hero />
        <TelemetryStrip />
        <FeatureGrid />
        <HowItWorks />
        <ProductPreview />
      </main>
      <LandingFooter />
    </LandingRoot>
  );
}
