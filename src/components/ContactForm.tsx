"use client";

import { useState, useRef } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { useThemeMode } from "@/lib/theme";

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
  const theme = useThemeMode();
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
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
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
        aria-hidden="true"
        style={{ display: "none" }}
        tabIndex={-1}
      />

      <div className="mb-6">
        <label
          htmlFor="name"
          className="caps-label mb-2 block text-xs text-text-muted"
        >
          Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          className="w-full rounded-2xl border border-divider bg-bg px-4 py-3 font-body text-base text-text-primary placeholder:text-text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Your name"
        />
      </div>

      <div className="mb-6">
        <label
          htmlFor="email"
          className="caps-label mb-2 block text-xs text-text-muted"
        >
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          className="w-full rounded-2xl border border-divider bg-bg px-4 py-3 font-body text-base text-text-primary placeholder:text-text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="your@email.com"
        />
      </div>

      <div className="mb-6">
        <label
          htmlFor="message"
          className="caps-label mb-2 block text-xs text-text-muted"
        >
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          className="min-h-36 w-full resize-y rounded-2xl border border-divider bg-bg px-4 py-3 font-body text-base text-text-primary placeholder:text-text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="What are you building, hiring for, or trying to untangle?"
        />
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-divider bg-bg p-3">
        <HCaptcha
          ref={captchaRef}
          sitekey="50b2fe65-b00b-4b9e-ad62-3ba471098be2"
          reCaptchaCompat={false}
          theme={theme}
          onVerify={onCaptchaChange}
        />
      </div>

      <div className="mb-4">
        <button
          type="submit"
          disabled={isSubmitting || !captchaToken}
          className="rounded-full bg-primary px-7 py-3 font-caps text-xs tracking-[var(--tracking-label)] text-[var(--accent-on)] shadow-sm hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Sending..." : "Send Message"}
        </button>
      </div>

      {result && (
        <p className="caps-label mt-4 text-xs text-text-secondary" role="status">
          {result}
        </p>
      )}
    </form>
  );
}
