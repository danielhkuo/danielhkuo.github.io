# danielhkuo.github.io

My personal site. I didn't want to hand-edit a projects page every time I shipped
something, so it pulls my pinned repositories from GitHub at build time and
rebuilds whenever I push. Built with Next.js and hosted on GitHub Pages.

## Features

- Pinned GitHub repos, pulled at build time and shown with their language
  breakdown, stars, and forks.
- An interactive terminal for moving around the site and opening links, with
  tab-completion and command history. Open it from the nav or with Cmd/Ctrl+K.
- Light and dark modes, toggled from the nav or the terminal and remembered
  between visits.
- A contact form backed by Web3Forms, with hCaptcha for spam.
- Static output — the whole site is pre-rendered, no server.

## Getting started

```bash
npm install
npm run dev
```

To fetch real repositories, set `GITHUB_USERNAME` (and optionally `GITHUB_TOKEN`)
in `.env.local`. Without a token the site uses mock data.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the site and
publishes it to GitHub Pages. The repo needs to be named `<username>.github.io`
with Pages set to deploy from GitHub Actions.

To build locally, run `npm run build`; the output goes to `out/`.

## Structure

```
src/
├── app/          layout, home page, global styles
├── components/   masthead, project cards, terminal, contact form, etc.
└── lib/          GitHub fetching and theme helpers
```

## License

MIT
