# danielhkuo.github.io

My personal site. Each project is a small Markdown file in `projects/` that I
can edit in the browser, and the site rebuilds whenever I push. Built with
Next.js and hosted on GitHub Pages.

## Features

- An entry that is only a terminal: a first visit starts on a lone cursor,
  the window opens out of it, types `neofetch` and prints the bio. Scrolling
  docks it — the window climbs to the top at half speed while the projects
  rise to meet it.
- Projects from `projects/`, one Markdown file each, shown with their language
  breakdown, stars and forks from GitHub, fetched at build time.
- An interactive terminal that holds the site as a small filesystem: `ls`,
  `cd`, `cat` and `open` behave as they do in zsh, markdown files are laid out
  the way glow renders them, and commands and paths tab-complete. Open it by
  clicking the header, from the launcher button, or with Cmd/Ctrl+K.
- Light and dark modes that follow the system, live. `theme dark` or
  `theme light` in the terminal picks one and remembers it; `theme auto` goes
  back to following.
- A contact form backed by Web3Forms, with hCaptcha for spam.
- Static output — the whole site is pre-rendered, no server.

## Getting started

```bash
npm install
npm run dev
```

The projects are the Markdown files in `projects/`; `projects/README.md` gives
the format. To show their stars, forks and languages, set `GITHUB_TOKEN` in
`.env.local`. Without a token the site builds without them.

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
└── lib/          the projects loader and theme helpers
```

## License

MIT
