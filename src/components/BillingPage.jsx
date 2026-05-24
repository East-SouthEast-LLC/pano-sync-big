// src/components/BillingPage.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const WORKER_URL = 'https://pano-upload-worker.ese-llc.workers.dev';

const TIERS = [
  {
    name: 'Free',
    price: 0,
    storage: '500 MB',
    overage: null,
    price_id: null,
    features: ['500 MB storage', 'Map viewer access', 'Share links', 'Access codes'],
    badge: 'No credit card required',
    badgeStyle: 'text-gray-500',
    tagline: null,
    highlight: false,
  },
  {
    name: 'Starter',
    price: 10,
    storage: '10 GB',
    overage: '$1.00 / GB',
    price_id: 'price_1Ta5KwLw1WmTSYrolucc9mho',
    features: ['10 GB storage', 'Map viewer access', 'Share links', 'Access codes'],
    badge: 'Start Here',
    badgeStyle: 'text-green-600',
    tagline: 'Your plan grows automatically as you add data.',
    highlight: true,
  },
  {
    name: 'Professional',
    price: 30,
    storage: '40 GB',
    overage: '$0.75 / GB',
    price_id: 'price_1Ta5LyLw1WmTSYroTldqSRuQ',
    features: ['40 GB storage', 'Map viewer access', 'Share links', 'Access codes'],
    highlight: false,
    badge: null,
    tagline: null,
  },
  {
    name: 'Business',
    price: 50,
    storage: '100 GB',
    overage: '$0.50 / GB',
    price_id: 'price_1Ta5MgLw1WmTSYroH2g20zui',
    features: ['100 GB storage', 'Map viewer access', 'Share links', 'Access codes'],
    badge: null,
    tagline: null,
    highlight: false,
  },
  {
    name: 'Enterprise',
    price: null,
    storage: '500 GB+',
    overage: 'Custom',
    price_id: 'price_1Ta5RnLw1WmTSYrousgfDOYu',
    features: ['500 GB+ storage', 'Custom pricing', 'Priority support', 'Dedicated map page'],
    badge: null,
    tagline: null,
    highlight: false,
  },
];

export default function BillingPage({ session, onBack, checkoutStatus }) {
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [checkingOut, setCheckingOut]   = useState(null);

  useEffect(() => {
    async function loadSub() {
      setLoading(true);
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!error && data) setSubscription(data);
      setLoading(false);
    }
    loadSub();
  }, [session]);

  const handleSubscribe = async (price_id, tierName) => {
    if (tierName === 'Enterprise') {
      window.location.href = 'mailto:info@ese-llc.com?subject=Enterprise Subscription Inquiry';
      return;
    }
    if (!price_id) return;

    setCheckingOut(price_id);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;

      const res = await fetch(`${WORKER_URL}/stripe/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ price_id }),
      });

      if (!res.ok) {
        const err = await res.text();
        alert(`Checkout error: ${err}`);
        setCheckingOut(null);
        return;
      }

      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      alert(`Error: ${err.message}`);
      setCheckingOut(null);
    }
  };

  const currentTierName = subscription?.tier
    ? subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)
    : 'Free';

  return (
    <main className="flex flex-col items-center p-5 space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="w-full flex items-center justify-between">
        <h1 className="text-3xl font-bold">Billing & Subscription</h1>
        <button onClick={onBack}
          className="text-xs px-3 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
          ← Back
        </button>
      </div>

      {/* Checkout status banners */}
      {checkoutStatus === 'success' && (
        <div className="w-full px-4 py-3 rounded-md bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
          ✓ Subscription activated — welcome aboard!
        </div>
      )}
      {checkoutStatus === 'cancel' && (
        <div className="w-full px-4 py-3 rounded-md bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
          Checkout was cancelled. You can subscribe any time below.
        </div>
      )}

      {/* Current subscription */}
      {!loading && subscription && (
        <div className="w-full px-4 py-3 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-sm">
          Current plan: <span className="font-semibold">{currentTierName}</span>
          {' · '}Status: <span className="font-semibold">{subscription.status}</span>
          {subscription.current_period_end && (
            <span className="ml-2 text-blue-500">
              · Renews {new Date(subscription.current_period_end).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
      {!loading && !subscription && (
        <div className="w-full px-4 py-3 rounded-md bg-gray-50 border border-gray-200 text-gray-500 text-sm">
          No active subscription. Choose a plan below to get started.
        </div>
      )}

      {/* Pricing cards */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
        {TIERS.map(tier => {
          const isCurrent = currentTierName?.toLowerCase() === tier.name.toLowerCase();
          const isFree    = tier.price === 0;
		  const isLoading = tier.price_id !== null && checkingOut === tier.price_id;

          return (
            <div key={tier.name}
              className={`flex flex-col rounded-xl border p-5 space-y-4 ${
                tier.highlight
                  ? 'border-[#2D2D31] shadow-md bg-white'
                  : isCurrent
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-gray-50'
              }`}>

              {/* Badge row — always rendered to keep alignment */}
              <div className="h-4">
                {tier.badge && (
                  <span className={`text-xs font-semibold uppercase tracking-wide ${tier.badgeStyle}`}>
                    {tier.badge}
                  </span>
                )}
              </div>

              <div>
                <h2 className="text-lg font-bold text-[#2D2D31]">{tier.name}</h2>
                <div className="mt-1">
                  {isFree ? (
                    <span className="text-2xl font-bold text-[#2D2D31]">Free</span>
                  ) : tier.price !== null ? (
                    <span className="text-2xl font-bold text-[#2D2D31]">
                      ${tier.price}<span className="text-sm font-normal text-gray-500">/mo</span>
                    </span>
                  ) : (
                    <span className="text-2xl font-bold text-[#2D2D31]">Custom</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {tier.storage} included{tier.overage ? ` · Overage: ${tier.overage}` : ''}
                </p>
                {tier.tagline && (
                  <p className="text-xs text-green-600 mt-1 font-medium">{tier.tagline}</p>
                )}
              </div>

              <ul className="space-y-1 flex-1">
                {tier.features.map(f => (
                  <li key={f} className="text-xs text-gray-600 flex items-center gap-1">
                    <span className="text-green-500">✓</span> {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSubscribe(tier.price_id, tier.name)}
                disabled={isCurrent || isLoading || isFree}
                className={`w-full py-2 rounded-md text-sm font-medium transition-colors ${
                  isCurrent
                    ? 'bg-gray-200 text-gray-500 cursor-default'
                    : isFree
                    ? 'bg-gray-100 text-gray-400 cursor-default'
                    : isLoading
                    ? 'bg-gray-300 text-gray-500 cursor-default'
                    : tier.highlight
                    ? 'bg-[#2D2D31] text-white hover:bg-black'
                    : 'bg-[#2D2D31] text-white hover:bg-black'
                }`}>
                {isCurrent ? 'Current Plan'
                  : isLoading ? 'Redirecting…'
                  : isFree ? 'Free Forever'
                  : tier.name === 'Enterprise' ? 'Contact Us'
                  : 'Subscribe'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Auto-upgrade note */}
      <div className="w-full px-4 py-3 rounded-md bg-gray-50 border border-gray-200 text-gray-500 text-xs space-y-1">
        <p>
          <span className="font-medium text-gray-700">Your plan adjusts automatically</span> — it upgrades as you add images and downgrades as you remove them. Here are the ranges:
        </p>
        <ul className="mt-1 space-y-0.5 pl-2">
          <li>· <span className="text-gray-700 font-medium">10–29 GB</span> — Starter ($10–$29/mo)</li>
          <li>· <span className="text-gray-700 font-medium">30–66 GB</span> — Professional ($30–$49.50/mo)</li>
          <li>· <span className="text-gray-700 font-medium">67–400 GB</span> — Business ($50–$100/mo)</li>
          <li>· <span className="text-gray-700 font-medium">400+ GB</span> — Enterprise (custom pricing, we'll reach out)</li>
        </ul>
      </div>

      {/* Dormant note */}
      <div className="w-full px-4 py-3 rounded-md bg-gray-50 border border-gray-200 text-gray-500 text-xs">
        <span className="font-medium text-gray-700">Dormant projects</span> — keep images in storage at $0.25/GB/month with the map shape hidden. Useful for archiving completed projects or pausing visibility without losing data.
      </div>

    </main>
  );
}
