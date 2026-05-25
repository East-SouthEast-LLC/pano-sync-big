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
  const [portalLoading, setPortalLoading] = useState(false);
  const [deleteModal, setDeleteModal]   = useState(false);
  const [deleteInput, setDeleteInput]   = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError]   = useState(null);

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

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      const res = await fetch(`${WORKER_URL}/stripe/portal`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      window.open(url, '_blank');
    } catch (err) {
      alert(`Portal error: ${err.message}`);
    } finally {
      setPortalLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== 'DELETE') return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      const res = await fetch(`${WORKER_URL}/account/delete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      // Sign out after scheduling deletion
      await supabase.auth.signOut();
    } catch (err) {
      setDeleteError(err.message);
      setDeleteLoading(false);
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
        <div className="w-full px-4 py-3 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-sm flex items-center justify-between gap-4 flex-wrap">
          <span>
            Current plan: <span className="font-semibold">{currentTierName}</span>
            {' · '}Status: <span className="font-semibold">{subscription.status}</span>
            {subscription.current_period_end && (
              <span className="ml-2 text-blue-500">
                · Renews {new Date(subscription.current_period_end).toLocaleDateString()}
              </span>
            )}
          </span>
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="text-xs px-3 py-1.5 rounded-md border border-blue-300 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-50 whitespace-nowrap">
            {portalLoading ? 'Loading…' : 'Manage / Cancel →'}
          </button>
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

      {/* ── Danger zone ── */}
      <div className="w-full px-4 py-4 rounded-md border border-red-200 bg-red-50 space-y-2">
        <p className="text-sm font-semibold text-red-700">Danger Zone</p>
        <p className="text-xs text-red-500 leading-relaxed">
          Deleting your account will schedule all projects and images for permanent deletion.
          You will have 30 days before data is removed, with email notifications along the way.
          This cannot be undone.
        </p>
        <button
          onClick={() => { setDeleteModal(true); setDeleteInput(''); setDeleteError(null); }}
          className="text-xs px-3 py-1.5 rounded-md border border-red-400 text-red-600 hover:bg-red-100 transition-colors">
          Delete Account & All Data
        </button>
      </div>

      {/* ── Delete confirmation modal ── */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <h2 className="text-lg font-bold text-red-700">Delete Account</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              This will permanently delete <span className="font-semibold">all your projects and images</span>.
              Your data will remain accessible for 30 days, then be permanently removed.
            </p>
            <ul className="text-xs text-gray-500 space-y-1 pl-2">
              <li>· Day 0 — account marked for deletion, confirmation email sent</li>
              <li>· Day 7 — projects go offline (hidden from map)</li>
              <li>· Day 30 — final warning email</li>
              <li>· Day 37 — all images and data permanently deleted</li>
            </ul>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-700">
                Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>
            {deleteError && (
              <p className="text-xs text-red-600">⚠ {deleteError}</p>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setDeleteModal(false)}
                disabled={deleteLoading}
                className="text-sm px-4 py-2 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE' || deleteLoading}
                className="text-sm px-4 py-2 rounded-md bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {deleteLoading ? 'Processing…' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
