import Image from "next/image";
import { Fragment } from "react";
import { EMAIL, LINKS, PROFILE } from "@/components/terminal/content";
import { profileFacts } from "@/lib/site-content";

/**
 * What `neofetch` prints: the headshot where the distro logo goes, then
 * user@host and the profile as a table. It is the old home page's header, on
 * the same classes (globals.css, "neofetch header"), so the two cannot drift.
 * The facts are a definition list, and the photo's path, the user@host line
 * and the colour blocks are decoration a screen reader skips.
 *
 * `lead` is the copy the page opens on: there the name is the page's one
 * `<h1>`, carrying `id`, and the photo loads first. Printed again by the
 * command, it is ordinary text.
 */
export default function Banner({ id, lead = false }: { id?: string; lead?: boolean }) {
  const Name = lead ? "h1" : "p";
  return (
    <div className="nf-grid mt-nf">
      <div className="nf-face">
        <Image
          src="/headshot.webp"
          alt={`Portrait of ${PROFILE.name}`}
          width={200}
          height={200}
          sizes="(max-width: 640px) 128px, 200px"
          priority={lead}
        />
        <p className="nf-face-path" aria-hidden>
          ~/.face
        </p>
      </div>

      <div className="nf-info">
        {/* The rule neofetch draws under user@host is this line's own border
            here (minimal.css), not the header's <hr>: iOS 26.5 Safari never
            painted the <hr> again once the start animation had held it back. */}
        <p className="nf-host" aria-hidden>
          daniel<span className="nf-at">@</span>portfolio
        </p>

        <dl className="nf-table">
          <dt>Name</dt>
          <dd>
            <Name id={id} className="mt-name">
              {PROFILE.name}
            </Name>
          </dd>
          <dt>Title</dt>
          <dd>{PROFILE.title}</dd>
          {profileFacts().map((fact) => (
            <Fragment key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </Fragment>
          ))}
          <dt>Contact</dt>
          <dd className="mt-nf-contact">
            <a className="nf-link" href={LINKS.email}>
              {EMAIL}
            </a>
            <span aria-hidden> · </span>
            <a className="nf-link" href={LINKS.resume}>
              resume.pdf
            </a>
          </dd>
        </dl>

        {/* neofetch's colour blocks: Terminal.app's sixteen built-in colours. */}
        <div className="nf-swatches" aria-hidden>
          {[0, 8].map((from) => (
            <div key={from}>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} style={{ background: `var(--term-ansi-${from + i})` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
