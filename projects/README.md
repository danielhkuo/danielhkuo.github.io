# Projects

Every project on the site is one Markdown file in this folder. Each build reads them all, this README aside, and the
minimal version, the terminal, the world and the agent files (`agents.md`, `llms.txt`) all list them from here. A
commit to `main` rebuilds and deploys the site, so an edit made in the browser is live a few minutes later.

## The format

```markdown
---
name: Leaf
summary: A small Discord bot, like BeReal but for Discord.
repo: danielhkuo/leaf
link: https://example.com
image: /projects/leaf.png
order: 1
---
A few sentences on what it is and what you did. Markdown works here.
```

- `name` and `summary` are required. The summary is one line.
- `repo` is the GitHub repository, written owner/name. Its stars, forks and languages are fetched at each build.
- `link` is the live site or a write-up: a whole address, starting `https://`.
- `image` is a file in `public/projects/`, written `/projects/` and its name.
- `order` sets the order: lower comes first, a tie goes by name, and a project without one comes last.
- The description under the second `---` may be left empty.
- If a value has a colon in it, or starts with a quote or a symbol, put it in quotes: `summary: "Leaf: a bot"`.

The file's name is the project's key: `leaf.md` is `leaf`. The world remembers which projects a visitor has found by
it, so keep a project's file name once it is live.

## In the browser, on github.com

- **Add:** open this folder, choose **Add file → Create new file**, name it (`my-project.md`), paste the format above,
  fill it in and choose **Commit changes**.
- **Edit:** open the file, choose the pencil (**Edit this file**), change it and choose **Commit changes**.
- **Reorder:** edit the `order` numbers.
- **Remove:** open the file, choose **⋯ → Delete file**, then **Commit changes**.
- **Add an image:** open `public/projects/`, choose **Add file → Upload files** and commit. Then set
  `image: /projects/<file name>` in the project's file.

## If the site does not update

A file with a mistake fails the build, and the live site stays as it was. Open the repository's **Actions** tab, then
the failed **Deploy to GitHub Pages** run and its **Build with Next.js** step. The error names the file and the field;
fix it the same way and commit again.

## With a form: Pages CMS

[Pages CMS](https://pagescms.org) edits these files as a form, set up by `.pages.yml` at the repository's root. Once,
sign in at [app.pagescms.org](https://app.pagescms.org) with GitHub and install its GitHub App on this repository.
Then open the repository on the `main` branch and choose **Projects**. Saving commits to `main`, as an edit on
github.com does; the **Image** field uploads to `public/projects/`. A new project's file is named after its name, and
you can change the file name when you create it.
