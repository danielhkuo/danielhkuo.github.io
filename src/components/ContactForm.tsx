"use client";

import { useState, useRef } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";

/**
 * ContactForm - Editorial-style form with underlined inputs
 *
 * Features:
 * - Paper-form aesthetic with underlined fields
 * - Web3Forms API integration with JSON submission
 * - hCaptcha spam protection
 * - Client-side validation
 */
export default function ContactForm() {
  const [result, setResult] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const captchaRef = useRef<HCaptcha>(null);

  const onCaptchaChange = (token: string) => {
    setCaptchaToken(token);
  };

  const handleSubmit = async (e: { preventDefault: () => void; currentTarget: HTMLFormElement }) => {
    e.preventDefault();

    if (!captchaToken) {
      setResult("Please complete the captcha");
      return;
    }

    const form = e.currentTarget;

    // Check form validity
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setIsSubmitting(true);
    setResult("Please wait...");

    try {
      const formData = new FormData(form);
      const object = Object.fromEntries(formData);
      object["h-captcha-response"] = captchaToken;
      const json = JSON.stringify(object);

      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: json,
      });

      const data = await response.json();

      if (response.status === 200) {
        setResult(data.message || "Message sent successfully!");
        form.reset();
        setCaptchaToken("");
        captchaRef.current?.resetCaptcha();

        // Clear success message after 5 seconds
        setTimeout(() => {
          setResult("");
        }, 5000);
      } else {
        setResult(data.message || "Something went wrong!");
        captchaRef.current?.resetCaptcha();
      }
    } catch (error) {
      console.error(error);
      setResult("Something went wrong!");
      captchaRef.current?.resetCaptcha();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      <input
        type="hidden"
        name="access_key"
        value="166051ec-a006-47dd-abec-9be280b7432f"
      />
      <input
        type="hidden"
        name="subject"
        value="New Contact Form Submission"
      />
      <input
        type="checkbox"
        name="botcheck"
        style={{ display: "none" }}
        tabIndex={-1}
      />

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

      {/* hCaptcha */}
      <div className="mb-8">
        <HCaptcha
          ref={captchaRef}
          sitekey="50b2fe65-b00b-4b9e-ad62-3ba471098be2"
          reCaptchaCompat={false}
          onVerify={onCaptchaChange}
        />
      </div>

      {/* Submit Button */}
      <div className="mb-4">
        <button
          type="submit"
          disabled={isSubmitting || !captchaToken}
          className="border border-ink px-8 py-3 font-mono text-xs uppercase tracking-wider text-ink hover:bg-ink hover:text-paper transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Sending..." : "Send Message"}
        </button>
      </div>

      {/* Result Message */}
      {result && (
        <p className="font-mono text-sm text-ink/70 mt-4">
          {result}
        </p>
      )}
    </form>
  );
}
