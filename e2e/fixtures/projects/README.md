# Fixture projects

The projects `npm run e2e` builds the site with (`PROJECTS_DIR=e2e/fixtures/projects`), so the end-to-end tests never
depend on the real `projects/`, which the owner edits in the browser. Eight on purpose, more than the world's six
landmarks: the first six by order have repositories and stand at them, a seventh has only a link, and the last has
neither. The repositories are made up; nothing fetches them without `GITHUB_TOKEN`.

Like `projects/README.md`, this file is not a project: the loader skips it.
