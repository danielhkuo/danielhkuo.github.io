# Editorial Portfolio

A modern portfolio website that rejects standard "SaaS/Tech" aesthetics in favor of a **"Digital Print"** philosophy. Built with Next.js, this portfolio automatically transforms your GitHub repositories into magazine-quality case studies.

## Design Philosophy

> "The structure of a dashboard, but the soul of a newspaper."

### The "Digital Print" Aesthetic

- **The Canvas:** Warm cream/bone background (#FDFBF7) simulating high-quality paper
- **The Ink:** Soft black (#1A1A1A) typography for maximum readability
- **Deconstructed Grid:** Content separated by negative space and hairline dividers
- **Zero Radius:** All corners are sharp (90°) — no rounded corners anywhere
- **Typography:** Cormorant Garamond serif for headings, Geist Mono for metadata

## Features

### 🤖 Automated GitHub Pipeline

The flagship feature: your portfolio updates automatically when you push code.

- Fetches pinned repositories from your GitHub profile
- Transforms README files into editorial-style articles
- Sanitizes relative URLs to absolute GitHub paths
- Applies grayscale filter to images (color reveals on hover)

### 🎨 Interactive Micro-Islands

- **Live Clock:** Real-time timezone display
- **Location Map:** Minimalist location indicator with map link
- **Copy-to-Clipboard:** One-click copying for email/code
- **Contact Form:** Underlined paper-form inputs (Formspree integration)

### 📱 Static Site Generation

- Pre-rendered at build time for maximum performance
- Deployed to GitHub Pages automatically via GitHub Actions
- No server required — pure static HTML

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file:

```bash
# Your GitHub username (required)
GITHUB_USERNAME=your_github_username

# GitHub Personal Access Token (optional but recommended)
# Get one at: https://github.com/settings/tokens
# Required scopes: public_repo, read:user
GITHUB_TOKEN=your_github_token_here
```

**Without a token:** The site will use mock data for development.
**With a token:** The site will fetch your real pinned repositories.

### 3. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 4. Build for Production

```bash
npm run build
```

The static site will be generated in the `out/` directory.

## Customization

### Personal Information

Edit [`src/app/page.tsx`](src/app/page.tsx):

- Update bio text in the "About" section
- Modify tech stack in the "Tools & Technologies" grid
- Change location and timezone in the "Currently" section
- Update email address for contact

### Masthead (Header)

Edit [`src/components/Masthead.tsx`](src/components/Masthead.tsx):

- Replace "Daniel Kuo" with your name
- Update role/title
- Change availability status
- Add your profile photo (replace the placeholder)

### Colors & Typography

Edit [`src/app/globals.css`](src/app/globals.css):

```css
:root {
  --background: #FDFBF7;  /* Paper color */
  --foreground: #1A1A1A;  /* Ink color */
  --available: #16a34a;   /* Status indicator */
  --divider: #e5e5e5;     /* Hairline color */
}
```

### Contact Form

To enable the contact form:

1. Sign up at [Formspree](https://formspree.io/)
2. Create a new form and get your form ID
3. Update the `formspreeId` prop in [`src/app/page.tsx`](src/app/page.tsx):

```tsx
<ContactForm formspreeId="your_formspree_id" />
```

## Deployment to GitHub Pages

### Prerequisites

1. Repository must be named `<username>.github.io`
2. Enable GitHub Pages in repository settings:
   - Go to Settings → Pages
   - Source: GitHub Actions

### Automatic Deployment

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:

1. Builds the site when you push to `main`
2. Fetches your GitHub repositories using the built-in `GITHUB_TOKEN`
3. Deploys to GitHub Pages

### Manual Deployment

```bash
npm run build
# Upload the 'out/' directory to your hosting provider
```

## Project Structure

```plaintext
src/
├── app/
│   ├── layout.tsx        # Root layout with fonts
│   ├── page.tsx          # Home page
│   └── globals.css       # Design system CSS
├── components/
│   ├── Masthead.tsx      # Header with photo/identity
│   ├── ProjectCard.tsx   # Expandable project display
│   ├── EditorialReadme.tsx  # Markdown → Editorial styling
│   ├── LiveTime.tsx      # Real-time clock widget
│   ├── LocationMap.tsx   # Location display
│   ├── CopyButton.tsx    # Copy-to-clipboard
│   └── ContactForm.tsx   # Paper-form inputs
└── lib/
    └── github.ts         # GitHub API integration
```

## Technology Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **Fonts:** Cormorant Garamond (serif), Geist Mono (monospace)
- **Markdown:** react-markdown with remark-gfm
- **Deployment:** GitHub Pages via GitHub Actions

## Design Principles

1. **Content First:** Typography and readability are paramount
2. **No Decoration:** Every element serves a purpose
3. **Negative Space:** Let content breathe
4. **Authentic Materials:** Actual serif fonts, real monospace, true black ink
5. **Print Metaphor:** Grid structure, hairline rules, editorial hierarchy

## Performance

- ✅ Static Site Generation (SSG)
- ✅ Automatic font optimization via `next/font`
- ✅ Pre-rendered at build time
- ✅ No client-side JavaScript for content (only interactive widgets)
- ✅ Optimized for Core Web Vitals

## License

MIT © Daniel Kuo

---

Built with [Next.js](https://nextjs.org) · Deployed on [GitHub Pages](https://pages.github.com)
