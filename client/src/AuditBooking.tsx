import { useState } from "react";
import { api } from "./api";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const INPUT_CLASS =
  "block w-full border-b border-gray-300 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-600 focus:outline-none transition-colors";

export default function AuditBooking() {
  const [form, setForm] = useState({
    businessName: "",
    contactName: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    state: "",
    zip: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await api("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Something went wrong.");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Success Screen ── */
  if (submitted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{
          background:
            "linear-gradient(rgba(15, 25, 20, 0.85), rgba(15, 25, 20, 0.92)), url('https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80') center/cover no-repeat",
        }}
      >
        <div className="max-w-md w-full text-center py-16">
          <div className="w-16 h-16 rounded-full border-2 border-teal-600 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-serif text-white mb-3">You're All Set!</h2>
          <p className="text-gray-300 mb-4 leading-relaxed">
            We've received your audit request. A member of our team will reach out
            within 1–2 business days to schedule your on-site visit.
          </p>
          <p className="text-sm text-gray-400 italic font-serif">
            Real Solutions. No Myths.
          </p>
        </div>
      </div>
    );
  }

  /* ── Main Page ── */
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* ── Hero ── */}
      <div
        className="relative text-white"
        style={{
          background:
            "linear-gradient(rgba(15, 25, 20, 0.75), rgba(15, 25, 20, 0.88)), url('https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80') center/cover no-repeat",
        }}
      >
        <div className="max-w-xl mx-auto px-5 py-14 sm:py-20 text-center">
          <p className="text-xs tracking-widest uppercase text-gray-300 mb-5 font-medium">
            Bigfoot Technologies
          </p>
          <h1 className="text-3xl sm:text-4xl font-serif leading-tight mb-5">
            NFL Sunday Ticket
            <br />
            Is Changing.
            <br />
            <span className="text-teal-600">Is Your Venue Ready?</span>
          </h1>
          <p className="text-gray-300 leading-relaxed max-w-lg mx-auto text-sm sm:text-base">
            DirecTV no longer offers NFL Sunday Ticket for commercial locations.
            The new provider is <strong className="text-white">Everpass</strong>, and
            most venues will need AV upgrades to make the switch. We'll audit
            your setup and build a plan&nbsp;— so you're ready before kickoff.
          </p>
          <p className="mt-6 italic font-serif text-gray-400 text-sm">
            Real Solutions.&nbsp; No Myths.
          </p>
        </div>
      </div>

      {/* ── Offer Strip ── */}
      <div className="bg-teal-600 text-white">
        <div className="max-w-xl mx-auto px-5 py-3.5 text-center text-sm sm:text-base font-medium tracking-wide">
          On-site AV audit — <strong>$100</strong>
          <span className="mx-2 opacity-60">|</span>
          Credited toward any future project with us
        </div>
      </div>

      {/* ── Form Section ── */}
      <div className="max-w-xl mx-auto px-5 py-12">
        <h2 className="text-xl font-serif text-gray-900 mb-1">Book Your Site Audit</h2>
        <p className="text-sm text-gray-500 mb-8">
          Fill out the form below and we'll contact you to schedule.
        </p>

        {error && (
          <div className="mb-6 p-3 border border-red-300 bg-red-50 text-red-700 text-sm rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Business Name */}
          <div>
            <label htmlFor="businessName" className="block text-xs font-medium text-gray-900 mb-0.5">
              Business Name <span className="text-gray-400 font-normal">(required)</span>
            </label>
            <input
              id="businessName"
              type="text"
              value={form.businessName}
              onChange={(e) => update("businessName", e.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          {/* Contact Name */}
          <div>
            <label htmlFor="contactName" className="block text-xs font-medium text-gray-900 mb-0.5">
              Contact Name <span className="text-gray-400 font-normal">(required)</span>
            </label>
            <input
              id="contactName"
              type="text"
              value={form.contactName}
              onChange={(e) => update("contactName", e.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          {/* Phone & Email — side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label htmlFor="phone" className="block text-xs font-medium text-gray-900 mb-0.5">
                Phone <span className="text-gray-400 font-normal">(required)</span>
              </label>
              <input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                className={INPUT_CLASS}
                required
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-900 mb-0.5">
                Email <span className="text-gray-400 font-normal">(required)</span>
              </label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                className={INPUT_CLASS}
                required
              />
            </div>
          </div>

          {/* Street */}
          <div>
            <label htmlFor="street" className="block text-xs font-medium text-gray-900 mb-0.5">
              Street Address <span className="text-gray-400 font-normal">(required)</span>
            </label>
            <input
              id="street"
              type="text"
              value={form.street}
              onChange={(e) => update("street", e.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          {/* City / State / Zip */}
          <div className="grid grid-cols-5 gap-4">
            <div className="col-span-2">
              <label htmlFor="city" className="block text-xs font-medium text-gray-900 mb-0.5">
                City <span className="text-gray-400 font-normal">(required)</span>
              </label>
              <input
                id="city"
                type="text"
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                className={INPUT_CLASS}
                required
              />
            </div>
            <div className="col-span-1">
              <label htmlFor="state" className="block text-xs font-medium text-gray-900 mb-0.5">
                State
              </label>
              <select
                id="state"
                value={form.state}
                onChange={(e) => update("state", e.target.value)}
                className={`${INPUT_CLASS} bg-white`}
                required
              >
                <option value="">--</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor="zip" className="block text-xs font-medium text-gray-900 mb-0.5">
                Zip Code
              </label>
              <input
                id="zip"
                type="text"
                value={form.zip}
                onChange={(e) => update("zip", e.target.value)}
                pattern="[0-9]{5}"
                className={INPUT_CLASS}
                required
              />
            </div>
          </div>

          {/* Submit */}
          <div className="pt-2 text-center">
            <button
              type="submit"
              disabled={submitting}
              className="inline-block px-10 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-full tracking-wide transition-colors"
            >
              {submitting ? "Submitting..." : "Schedule Audit"}
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center leading-relaxed">
            By submitting this form you agree to be contacted by Bigfoot Technologies
            regarding your AV audit and related services.
          </p>
        </form>
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-gray-200">
        <div className="max-w-xl mx-auto px-5 py-8 text-center">
          <p className="text-sm font-semibold text-gray-900 mb-2">Bigfoot Technologies</p>
          <p className="text-xs text-gray-500">
            Providing services to the greater Georgia and South Carolina low country.
          </p>
        </div>
      </div>
    </div>
  );
}
