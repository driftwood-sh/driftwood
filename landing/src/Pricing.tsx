import { MarketingNav, MarketingFooter } from "./components/MarketingChrome";
import PricingSection from "./components/PricingSection";

export default function Pricing() {
  return (
    <div className="landing pricing-page">
      <MarketingNav pricing />
      <main>
        <PricingSection standalone />
      </main>
      <MarketingFooter homePrefix="/" />
    </div>
  );
}
