import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
	// Load Markdown files in the `src/content/projects/` directory.
	loader: glob({ base: './src/content/projects', pattern: '**/*.md' }),
	// Type-check frontmatter using a schema
	schema: z.object({
		title: z.string(),
		description: z.string(),
		tech: z.array(z.string()),
		repoUrl: z.string().url(),
		featured: z.boolean().default(false),
		emoji: z.string().optional(),
	}),
});

export const collections = { projects };
