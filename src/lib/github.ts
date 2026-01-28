import { graphql } from "@octokit/graphql";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "danielhkuo";

// Types for GitHub API responses
export interface PinnedRepo {
  name: string;
  description: string;
  url: string;
  homepageUrl: string | null;
  primaryLanguage: {
    name: string;
    color: string;
  } | null;
  stargazerCount: number;
  forkCount: number;
  updatedAt: string;
  owner: {
    login: string;
  };
  languages: {
    name: string;
    color: string;
    percentage: number;
  }[];
}

export interface RepoWithReadme extends PinnedRepo {
  readme: string;
}

// GraphQL query to fetch pinned repositories with language breakdown
const PINNED_REPOS_QUERY = `
  query($username: String!) {
    user(login: $username) {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
            name
            description
            url
            homepageUrl
            primaryLanguage {
              name
              color
            }
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges {
                size
                node {
                  name
                  color
                }
              }
              totalSize
            }
            stargazerCount
            forkCount
            updatedAt
            owner {
              login
            }
          }
        }
      }
    }
  }
`;

/**
 * Mock data for development without GitHub token
 */
function getMockRepos(): PinnedRepo[] {
  return [
    {
      name: "example-project",
      description: "A sample project showcasing modern web development",
      url: "https://github.com/danielhkuo/example-project",
      homepageUrl: null,
      primaryLanguage: {
        name: "TypeScript",
        color: "#3178c6",
      },
      languages: [
        { name: "TypeScript", color: "#3178c6", percentage: 65.4 },
        { name: "JavaScript", color: "#f1e05a", percentage: 20.3 },
        { name: "CSS", color: "#563d7c", percentage: 14.3 },
      ],
      stargazerCount: 42,
      forkCount: 7,
      updatedAt: new Date().toISOString(),
      owner: {
        login: "danielhkuo",
      },
    },
  ];
}

/**
 * Mock data with README content for development
 */
function getMockReposWithReadmes(): RepoWithReadme[] {
  return [
    {
      name: "editorial-portfolio",
      description: "A modern portfolio showcasing the Editorial design philosophy",
      url: "https://github.com/danielhkuo/editorial-portfolio",
      homepageUrl: "https://danielhkuo.github.io",
      primaryLanguage: {
        name: "TypeScript",
        color: "#3178c6",
      },
      languages: [
        { name: "TypeScript", color: "#3178c6", percentage: 58.2 },
        { name: "JavaScript", color: "#f1e05a", percentage: 25.1 },
        { name: "CSS", color: "#563d7c", percentage: 16.7 },
      ],
      stargazerCount: 42,
      forkCount: 7,
      updatedAt: new Date().toISOString(),
      owner: {
        login: "danielhkuo",
      },
      readme: `# Editorial Portfolio

This project represents a personal portfolio website that rejects the standard "SaaS/Tech" aesthetic in favor of a **"Digital Print"** or **"Modern Editorial"** philosophy.

## Design Philosophy

The aesthetic goal is "The structure of a dashboard, but the soul of a newspaper."

### Key Features

- **The Canvas:** Warm, off-white Cream/Bone color (#FDFBF7) simulating high-quality paper
- **The Ink:** Soft Black (#1A1A1A) or dark charcoal typography
- **Deconstructed Grid:** Content separated by negative space and hairline dividers
- **Zero Radius:** All corners are sharp (90 degrees)

## Technology Stack

Built with modern web technologies:

- Next.js 16 with App Router
- React 19
- Tailwind CSS v4
- TypeScript
- Automated GitHub Pipeline

## The Automated Pipeline

The flagship feature treats GitHub as a CMS. During build time, the site:

1. Queries the GitHub API for pinned repositories
2. Fetches README.md files from each repository
3. Sanitizes and rewrites relative URLs to absolute paths
4. Renders markdown with editorial typography

> A messy README on GitHub is transformed into a beautiful, cohesive case study without manual editing.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Add your GitHub token to \`.env.local\`:

\`\`\`
GITHUB_TOKEN=your_token_here
GITHUB_USERNAME=your_username
\`\`\`

Visit [localhost:3000](http://localhost:3000) to see your portfolio.

## License

MIT © Daniel Kuo
`,
    },
  ];
}

/**
 * Fetch pinned repositories from GitHub using GraphQL API
 */
export async function fetchPinnedRepos(): Promise<PinnedRepo[]> {
  if (!GITHUB_TOKEN) {
    console.warn("No GITHUB_TOKEN found, using mock data");
    return getMockRepos();
  }

  try {
    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${GITHUB_TOKEN}`,
      },
    });

    const response: any = await graphqlWithAuth(PINNED_REPOS_QUERY, {
      username: GITHUB_USERNAME,
    });

    // Process language data to calculate percentages
    return response.user.pinnedItems.nodes.map((repo: {
      name: string;
      description: string;
      url: string;
      homepageUrl: string | null;
      primaryLanguage: { name: string; color: string } | null;
      languages: { totalSize: number; edges: { size: number; node: { name: string; color: string | null } }[] };
      stargazerCount: number;
      forkCount: number;
      updatedAt: string;
      owner: { login: string };
    }) => {
      const totalSize = repo.languages.totalSize;
      const languages = repo.languages.edges.map((edge: { size: number; node: { name: string; color: string | null } }) => ({
        name: edge.node.name,
        color: edge.node.color || "#858585",
        percentage: totalSize > 0 ? (edge.size / totalSize) * 100 : 0,
      }));

      return {
        name: repo.name,
        description: repo.description,
        url: repo.url,
        homepageUrl: repo.homepageUrl,
        primaryLanguage: repo.primaryLanguage,
        languages,
        stargazerCount: repo.stargazerCount,
        forkCount: repo.forkCount,
        updatedAt: repo.updatedAt,
        owner: repo.owner,
      };
    });
  } catch (error) {
    console.error("Error fetching pinned repos:", error);
    return getMockRepos();
  }
}

/**
 * Fetch README content for a specific repository
 */
export async function fetchReadme(
  owner: string,
  repo: string
): Promise<string> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      {
        headers: {
          Accept: "application/vnd.github.raw",
          ...(GITHUB_TOKEN && { Authorization: `token ${GITHUB_TOKEN}` }),
        },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch README: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    console.error(`Error fetching README for ${owner}/${repo}:`, error);
    return "";
  }
}

/**
 * Sanitize and fix relative URLs in markdown content
 * Converts relative image paths to absolute GitHub raw URLs
 */
export function sanitizeMarkdown(
  markdown: string,
  owner: string,
  repo: string,
  branch: string = "main"
): string {
  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;

  // Fix relative image paths
  let sanitized = markdown.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
    `![$1](${baseUrl}/$2)`
  );

  // Fix relative links to files in the repo
  sanitized = sanitized.replace(
    /\[([^\]]+)\]\((?!https?:\/\/)(?!#)([^)]+)\)/g,
    `[$1](https://github.com/${owner}/${repo}/blob/${branch}/$2)`
  );

  return sanitized;
}

/**
 * Fetch all pinned repos with their READMEs
 */
export async function fetchPinnedReposWithReadmes(): Promise<
  RepoWithReadme[]
> {
  // If no GitHub token, return mock data with README
  if (!GITHUB_TOKEN) {
    console.warn("No GITHUB_TOKEN found, using mock data with README");
    return getMockReposWithReadmes();
  }

  const repos = await fetchPinnedRepos();

  const reposWithReadmes = await Promise.all(
    repos.map(async (repo) => {
      const readme = await fetchReadme(repo.owner.login, repo.name);
      const sanitizedReadme = sanitizeMarkdown(
        readme,
        repo.owner.login,
        repo.name
      );

      return {
        ...repo,
        readme: sanitizedReadme,
      };
    })
  );

  return reposWithReadmes.filter((repo) => repo.readme.length > 0);
}
