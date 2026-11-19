// The front door's one switch (mobile spec 2), ready for when the home page takes the phone title (with the desktop
// title, once the owner picks it): a phone gets its own title screen, anything else gets the desktop side. CSS decides on the title's phone query, so nothing flashes and no script chooses; the side not shown
// is display: none, which takes it out of the accessibility tree too. The shown desktop side is display: contents, so
// the page lays out exactly as it did without the switch.

import type { ReactNode } from "react";
import styles from "./PhoneSwitch.module.css";

export default function PhoneSwitch({ phone, children }: { phone: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className={styles.phone} data-side="phone">
        {phone}
      </div>
      <div className={styles.desk} data-side="desk">
        {children}
      </div>
    </>
  );
}
