<script lang="ts">
  import { onMount } from "svelte";
  
  // Navigation Links - Global Context
  const navLinks = [
    { label: "About", href: "#" }, // Defaults to top/hero
    { label: "Resume", href: "/resume.pdf" },
    { label: "Contact", href: "mailto:hello@danielkuo.me" }
  ];

  let isScrolled = false;

  function handleScroll() {
    isScrolled = window.scrollY > 20;
  }

  onMount(() => {
    // Initial check
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  });
</script>

<header class:scrolled={isScrolled}>
  <div class="header-container">
    <nav>
      <ul class="nav-list">
        {#each navLinks as link}
          <li>
            <a 
              href={link.href} 
              class="nav-link cds--type-body-short-01"
              target={link.label === "Resume" ? "_blank" : "_self"}
              rel={link.label === "Resume" ? "noopener noreferrer" : undefined}
            >
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  </div>
</header>

<style>
  header {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 900; /* High z-index but below ThemeSwitcher (1000) */
    padding: 1.5rem 0;
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* Glassmorphism Background */
  header::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--background);
    opacity: 0;
    backdrop-filter: blur(0px);
    -webkit-backdrop-filter: blur(0px);
    border-bottom: 1px solid transparent;
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: -1;
  }

  header.scrolled {
    padding: 1rem 0;
  }

  header.scrolled::before {
    opacity: 0.85; /* Translucent background */
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--cds-border-subtle);
  }

  .header-container {
    /* FIX: Changed from 64rem to 56rem to match the main container's max-w-4xl */
    max-width: 56rem; 
    margin: 0 auto;
    padding: 0 1.25rem; /* Match px-5 */
    display: flex;
    justify-content: flex-end; /* Right-align links */
    align-items: center;
  }

  .nav-list {
    display: flex;
    gap: 2rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .nav-link {
    text-decoration: none;
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 1rem;
    position: relative;
    transition: color 0.2s ease;
    padding: 0.5rem 0;
  }

  .nav-link:hover {
    color: var(--primary);
  }

  /* Animated Underline */
  .nav-link::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 2px;
    background-color: var(--primary);
    transform: scaleX(0);
    transform-origin: bottom right;
    transition: transform 0.3s cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  .nav-link:hover::after {
    transform: scaleX(1);
    transform-origin: bottom left;
  }

  /* Mobile Adjustments */
  @media (max-width: 640px) {
    .header-container {
      justify-content: center; /* Center on mobile */
    }
  }
</style>