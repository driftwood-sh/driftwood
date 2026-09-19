import { trackCta } from "../track";

const PLANS = [
  {
    name: "Startup",
    price: "$2,000",
    contacts: "1,000",
    cta: "Book a demo",
    href: "/#book",
    placement: "pricing-startup",
    custom: false,
  },
  {
    name: "Growth",
    price: "$5,000",
    contacts: "5,000",
    cta: "Book a demo",
    href: "/#book",
    placement: "pricing-growth",
    custom: false,
  },
  {
    name: "Enterprise",
    price: "$10,000",
    contacts: "Custom",
    cta: "Book a demo",
    href: "/#book",
    placement: "pricing-enterprise",
    custom: true,
  },
] as const;

const INCLUDED = [
  "Email, LinkedIn and X",
  "Inbox warming",
  "Slack channel with the founders",
];

function Check() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>;
}

export default function PricingSection({ standalone = false }: { standalone?: boolean }) {
  const Heading = standalone ? "h1" : "h2";
  const PlanHeading = standalone ? "h2" : "h3";
  return (
    <section id="pricing" className="pricing-section" aria-labelledby="pricing-title">
      <div className="wrap">
        <div className="pricing-intro">
          <Heading id="pricing-title">Pricing</Heading>
          <p className="pricing-billing">No setup fee. Month to month.</p>
        </div>

        <div className="pricing-plans">
          {PLANS.map((plan) => (
            <article className={`pricing-plan${plan.name === "Growth" ? " pricing-plan-growth" : ""}`} key={plan.name} aria-labelledby={`plan-${plan.name.toLowerCase()}`}>
              <div className="pricing-plan-head">
                <PlanHeading id={`plan-${plan.name.toLowerCase()}`} className="pricing-plan-name">{plan.name}</PlanHeading>
              </div>
              <div className="pricing-rate">
                <p className="pricing-price">{plan.custom && <span className="pricing-from">From</span>}<strong>{plan.price}</strong></p>
                <p className="pricing-cadence">USD per month</p>
              </div>
              <div className="pricing-action">
                <a
                  className="btn pricing-cta"
                  href={plan.href}
                  onClick={() => trackCta(plan.placement)}
                >
                  {plan.cta}<span className="sr-only"> for {plan.name}</span>
                </a>
              </div>
              <div className="pricing-plan-details">
                <ul className="pricing-features">
                  <li className="pricing-allowance"><span><strong>{plan.contacts}</strong> personalized contacts{!plan.custom && " /mo"}</span></li>
                  {INCLUDED.map((feature) => <li key={feature}><Check /><span>{feature}</span></li>)}
                  {plan.custom && (
                    <>
                      <li><Check /><span>SOC 2 and a security review</span></li>
                      <li><Check /><span>Data processing agreement (DPA)</span></li>
                    </>
                  )}
                </ul>
              </div>
            </article>
          ))}
        </div>

        {!standalone && <p className="pricing-page-link"><a href="/pricing">View pricing details <span aria-hidden="true">→</span></a></p>}
      </div>
    </section>
  );
}
