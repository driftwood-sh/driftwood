import CustomerStories from "./components/CustomerStories";
import { MarketingNav, MarketingFooter } from "./components/MarketingChrome";
import PricingSection from "./components/PricingSection";

export default function Pricing() {
  return (
    <div className="landing pricing-page">
      <MarketingNav pricing />
      <main>
        <PricingSection standalone />
        <CustomerStories />
      </main>
      <MarketingFooter homePrefix="/" description="driftwood is an AI sales agent for personalized outbound: it researches each prospect, writes tailored messages, and sends from your account after human review." />
    </div>
  );
}
