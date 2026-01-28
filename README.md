# Editorial Portfolio

This was build with the ITLTDAMWIR Framework- the "I'm Too Lazy To Do Any More Work In Recruiting". Are you honestly tired of updating the projects on your personal site? Here is a quick and easy solution.

## Features

### 🤖 Automated GitHub Pipeline

The flagship feature: your portfolio updates automatically when you push code.

- Fetches pinned repositories from your GitHub profile
- Transforms README files into editorial-style articles
- Sanitizes relative URLs to absolute GitHub paths
- Applies grayscale filter to images (color reveals on hover)

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

To enable the contact form, use Web3Forms.

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

## License

MIT © Daniel Kuo

---

Built with [Next.js](https://nextjs.org) · Deployed on [GitHub Pages](https://pages.github.com)
