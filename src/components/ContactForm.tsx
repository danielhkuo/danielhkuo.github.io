"use client";

import { useState } from "react";

interface ContactFormProps {
  formspreeId?: string;
}

/**
 * ContactForm - Editorial-style form with underlined inputs
 *
 * Features:
 * - Paper-form aesthetic with underlined fields
 * - Integrates with Formspree for serverless submission
 * - Success/error state handling
 */
export default function ContactForm({
  formspreeId = "your_formspree_id",
}: ContactFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");

    try {
      const response = await fetch(
        `https://formspree.io/f/${formspreeId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        }
      );

      if (response.ok) {
        setStatus("success");
        setFormData({ name: "", email: "", message: "" });
      } else {
        setStatus("error");
      }
    } catch (error) {
      setStatus("error");
    }

    setTimeout(() => setStatus("idle"), 3000);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
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
          value={formData.name}
          onChange={handleChange}
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
          value={formData.email}
          onChange={handleChange}
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
          value={formData.message}
          onChange={handleChange}
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
