import { useState } from "react";
import { api } from "../api";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

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
    } catch (err: any) {
      setError(err.message || "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center py-16">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">You're All Set!</h2>
          <p className="text-gray-600 mb-2">
            We've received your audit request. A member of our team will reach out
            within 1-2 business days to schedule your on-site visit.
          </p>
          <p className="text-sm text-gray-500">
            Questions? Call us at{" "}
            <a href="tel:+1XXXXXXXXXX" className="text-blue-600 underline">
              (XXX) XXX-XXXX
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero / Header */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white">
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-sm font-semibold tracking-wider uppercase text-blue-400 mb-3">
            Bigfoot Technology
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold mb-4 leading-tight">
            NFL Sunday Ticket Is Changing.
            <br />
            <span className="text-blue-400">Is Your Venue Ready?</span>
          </h1>
          <p className="text-gray-300 max-w-xl mx-auto leading-relaxed">
            DirecTV no longer offers NFL Sunday Ticket for commercial locations.
            The new provider is <strong className="text-white">Everpass</strong>, and most
            venues will need AV upgrades to make the switch. We'll audit your
            setup and build a plan — so you're ready before kickoff.
          </p>
        </div>
      </div>

      {/* Offer Banner */}
      <div className="bg-blue-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-4 text-center">
          <p className="text-sm sm:text-base font-medium">
            On-site AV audit — <strong>$100</strong>
            <span className="mx-2">|</span>
            Credited toward any future project with us
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-1">
            Book Your Site Audit
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Fill out the form below and we'll contact you to schedule.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Business Name */}
            <div>
              <label htmlFor="businessName" className="block text-sm font-medium text-gray-700 mb-1">
                Business Name
              </label>
              <input
                id="businessName"
                type="text"
                value={form.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                placeholder="e.g. The End Zone Sports Bar"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {/* Contact Name */}
            <div>
              <label htmlFor="contactName" className="block text-sm font-medium text-gray-700 mb-1">
                Contact Name
              </label>
              <input
                id="contactName"
                type="text"
                value={form.contactName}
                onChange={(e) => update("contactName", e.target.value)}
                placeholder="First and last name"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {/* Phone & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="(555) 123-4567"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="you@business.com"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {/* Street Address */}
            <div>
              <label htmlFor="street" className="block text-sm font-medium text-gray-700 mb-1">
                Street Address
              </label>
              <input
                id="street"
                type="text"
                value={form.street}
                onChange={(e) => update("street", e.target.value)}
                placeholder="123 Main St"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {/* City / State / Zip */}
            <div className="grid grid-cols-5 gap-4">
              <div className="col-span-2">
                <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  placeholder="City"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="col-span-1">
                <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <select
                  id="state"
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
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
                <label htmlFor="zip" className="block text-sm font-medium text-gray-700 mb-1">
                  Zip Code
                </label>
                <input
                  id="zip"
                  type="text"
                  value={form.zip}
                  onChange={(e) => update("zip", e.target.value)}
                  placeholder="12345"
                  pattern="[0-9]{5}"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {submitting ? "Submitting..." : "Book My Audit"}
            </button>

            <p className="text-xs text-gray-400 text-center">
              By submitting this form you agree to be contacted by Bigfoot Technology
              regarding your AV audit and related services.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
