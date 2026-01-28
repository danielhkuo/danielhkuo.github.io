"use client";

import { useState } from "react";

/**
 * ContactForm - Editorial-style form with underlined inputs
 *
 * Features:
 * - Paper-form aesthetic with underlined fields
 * - Integrates with Web3Forms for serverless submission
 * - Success/error state handling
 */
export default function ContactForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("submitting");

    try {
      const formData = new FormData(e.currentTarget);
      formData.append("access_key", "166051ec-a006-47dd-abec-9be280b7432f");

      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setStatus("success");
        e.currentTarget.reset();
      } else {
        setStatus("error");
      }
    } catch (error) {
      setStatus("error");
    }

    setTimeout(() => setStatus("idle"), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {/* Name Field */}
      <div className="mb-8">
        <label
          htmlFor="name"
          className="block font-mono text-xs uppercase tracking-wider text-ink/50 mb-2"
        >
          Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          className="w-full bg-transparent border-0 border-b border-divider pb-2 font-serif text-lg text-ink focus:outline-none focus:border-ink transition-colors"
          placeholder="Your name"
        />
      </div>

      {/* Email Field */}
      <div className="mb-8">
        <label
          htmlFor="email"
          className="block font-mono text-xs uppercase tracking-wider text-ink/50 mb-2"
        >
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          className="w-full bg-transparent border-0 border-b border-divider pb-2 font-serif text-lg text-ink focus:outline-none focus:border-ink transition-colors"
          placeholder="your@email.com"
        />
      </div>

      {/* Message Field */}
      <div className="mb-8">
        <label
          htmlFor="message"
          className="block font-mono text-xs uppercase tracking-wider text-ink/50 mb-2"
        >
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          className="w-full bg-transparent border-0 border-b border-divider pb-2 font-serif text-lg text-ink focus:outline-none focus:border-ink transition-colors resize-none"
          placeholder="Your message..."
        />
      </div>

      {/* Submit Button */}
      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="border border-ink px-8 py-3 font-mono text-xs uppercase tracking-wider text-ink hover:bg-ink hover:text-paper transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "submitting" ? "Sending..." : "Send Message"}
        </button>

        {/* Status Messages */}
        {status === "success" && (
          <span className="font-mono text-xs uppercase tracking-wider text-available">
            Message sent!
          </span>
        )}
        {status === "error" && (
          <span className="font-mono text-xs uppercase tracking-wider text-ink/50">
            Error. Please try again.
          </span>
        )}
      </div>
    </form>
  );
}
