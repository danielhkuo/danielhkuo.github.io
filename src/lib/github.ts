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

// GraphQL response shape
interface PinnedReposQueryResponse {
  user: {
    pinnedItems: {
      nodes: {
        name: string;
        description: string | null;
        url: string;
        homepageUrl: string | null;
        primaryLanguage: {
          name: string;
          color: string | null;
        } | null;
        languages: {
          totalSize: number;
          edges: {
            size: number;
            node: {
              name: string;
              color: string | null;
            };
          }[];
        };
        stargazerCount: number;
        forkCount: number;
        updatedAt: string;
        owner: {
          login: string;
        };
      }[];
    };
  };
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

    // Use the typed response interface
    const response = await graphqlWithAuth<PinnedReposQueryResponse>(
      PINNED_REPOS_QUERY,
      {
        username: GITHUB_USERNAME,
      }
    );

    // Process language data to calculate percentages
    return response.user.pinnedItems.nodes.map((repo) => {
      const totalSize = repo.languages.totalSize;
      const languages = repo.languages.edges.map((edge) => ({
        name: edge.node.name,
        color: edge.node.color || "#858585",
        percentage: totalSize > 0 ? (edge.size / totalSize) * 100 : 0,
      }));

      return {
        name: repo.name,
        description: repo.description || "",
        url: repo.url,
        homepageUrl: repo.homepageUrl,
        primaryLanguage: repo.primaryLanguage
          ? {
              name: repo.primaryLanguage.name,
              color: repo.primaryLanguage.color || "#858585",
            }
          : null,
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
