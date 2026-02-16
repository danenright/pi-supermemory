import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import Supermemory from "supermemory";

// Config from environment
const API_KEY = process.env.SUPERMEMORY_API_KEY;
const CONTAINER_PREFIX = process.env.SUPERMEMORY_CONTAINER || "pi";

// Memory types and scopes
type MemoryType = "preference" | "project-config" | "architecture" | "error-solution" | "learned-pattern" | "conversation";
type MemoryScope = "user" | "project";

function getProjectTag(cwd: string): string {
	// Create a tag from the project directory
	const safeCwd = cwd || process.cwd();
	const projectName = safeCwd.split("/").filter(Boolean).pop() || "default";
	return `${CONTAINER_PREFIX}_project_${projectName}`;
}

function getUserTag(): string {
	const username = process.env.USER || process.env.USERNAME || "default";
	return `${CONTAINER_PREFIX}_user_${username}`;
}

function getClient(): Supermemory | null {
	if (!API_KEY) return null;
	return new Supermemory({ apiKey: API_KEY });
}

// Format context for injection into prompts
function formatContextForPrompt(
	profile: { static?: string[]; dynamic?: string[] } | null,
	userMemories: Array<{ memory?: string; similarity: number }>,
	projectMemories: Array<{ memory?: string; similarity: number }>
): string | null {
	const sections: string[] = [];

	// User profile
	if (profile) {
		const staticFacts = profile.static || [];
		const dynamicFacts = profile.dynamic || [];
		if (staticFacts.length > 0 || dynamicFacts.length > 0) {
			sections.push(`<user_profile>
${[...staticFacts, ...dynamicFacts].join("\n")}
</user_profile>`);
		}
	}

	// User memories (cross-project)
	if (userMemories.length > 0) {
		const memories = userMemories
			.filter(m => m.memory && m.similarity > 0.5)
			.slice(0, 5)
			.map(m => `- ${m.memory}`)
			.join("\n");
		if (memories) {
			sections.push(`<user_memories>
${memories}
</user_memories>`);
		}
	}

	// Project memories
	if (projectMemories.length > 0) {
		const memories = projectMemories
			.filter(m => m.memory && m.similarity > 0.5)
			.slice(0, 10)
			.map(m => `- ${m.memory}`)
			.join("\n");
		if (memories) {
			sections.push(`<project_memories>
${memories}
</project_memories>`);
		}
	}

	if (sections.length === 0) return null;

	return `[SUPERMEMORY CONTEXT]
The following memories and user profile have been retrieved from long-term memory storage.
Use this context to personalize your responses and maintain continuity across sessions.

${sections.join("\n\n")}`;
}

export default function (pi: ExtensionAPI) {
	const client = getClient();
	let injectedTurns = new Set<number>();
	let lastCwd = "";

	if (!client) {
		console.warn("[supermemory] SUPERMEMORY_API_KEY not set - extension disabled");
		return;
	}

	// Inject relevant memories before each agent turn
	pi.on("before_agent_start", async (event, ctx) => {
		if (!client) return;

		const turnKey = Date.now(); // Use timestamp as turn identifier
		if (injectedTurns.has(turnKey)) return;

		try {
			const userTag = getUserTag();
			const projectTag = getProjectTag(ctx.cwd);
			lastCwd = ctx.cwd;

			// Search for relevant memories based on the user's prompt
			const query = event.prompt.slice(0, 500); // Limit query length

			const [profileResult, userMemoriesResult, projectMemoriesResult] = await Promise.all([
				client.profile({ containerTag: userTag, q: query }).catch(() => null),
				client.search.memories({ q: query, containerTag: userTag, limit: 5 }).catch(() => ({ results: [] })),
				client.search.memories({ q: query, containerTag: projectTag, limit: 10 }).catch(() => ({ results: [] })),
			]);

			const profile = profileResult?.profile || null;
			const userMemories = (userMemoriesResult as any)?.results || [];
			const projectMemories = (projectMemoriesResult as any)?.results || [];

			const memoryContext = formatContextForPrompt(profile, userMemories, projectMemories);

			if (memoryContext) {
				injectedTurns.add(turnKey);
				return {
					message: {
						customType: "supermemory-context",
						content: memoryContext,
						display: false, // Don't show in TUI, just inject into context
					},
				};
			}
		} catch (error) {
			console.error("[supermemory] Error fetching context:", error);
		}
	});

	// Capture conversation after agent completes
	pi.on("agent_end", async (event, ctx) => {
		if (!client) return;

		try {
			const messages = event.messages || [];
			if (messages.length === 0) return;

			// Extract text from messages
			const conversationText = messages
				.map((m: any) => {
					if (m.role === "user" || m.role === "assistant") {
						const content = m.content;
						if (typeof content === "string") return `${m.role}: ${content}`;
						if (Array.isArray(content)) {
							const text = content
								.filter((c: any) => c.type === "text")
								.map((c: any) => c.text)
								.join("\n");
							return text ? `${m.role}: ${text}` : null;
						}
					}
					return null;
				})
				.filter(Boolean)
				.join("\n\n");

			if (!conversationText.trim() || conversationText.length < 50) return;

			// Store conversation in project scope
			const projectTag = getProjectTag(ctx.cwd);
			await client.add({
				content: conversationText.slice(0, 10000), // Limit content size
				containerTag: projectTag,
				metadata: {
					type: "conversation",
					cwd: ctx.cwd,
					timestamp: Date.now(),
				},
			});
		} catch (error) {
			console.error("[supermemory] Error capturing conversation:", error);
		}
	});

	// Register the supermemory tool for the LLM to use
	pi.registerTool({
		name: "supermemory",
		label: "SuperMemory",
		description: `Manage persistent memory across sessions. Use this to:
- Store important information the user wants remembered (preferences, project configs, learned patterns)
- Search for relevant memories
- View user profile (accumulated facts about the user)
- List recent memories
- Forget/delete specific memories

Scopes:
- "user": Cross-project preferences and knowledge (follows the user everywhere)
- "project": Project-specific knowledge (default, stays in current project)`,
		parameters: Type.Object({
			mode: StringEnum(["add", "search", "profile", "list", "forget", "help"] as const, {
				description: "Operation mode",
			}),
			content: Type.Optional(Type.String({ description: "Content to store (for 'add' mode)" })),
			query: Type.Optional(Type.String({ description: "Search query (for 'search' mode)" })),
			type: Type.Optional(StringEnum([
				"preference",
				"project-config",
				"architecture",
				"error-solution",
				"learned-pattern",
				"conversation",
			] as const, { description: "Memory type (for 'add' mode)" })),
			scope: Type.Optional(StringEnum(["user", "project"] as const, {
				description: "Memory scope - 'user' for cross-project, 'project' for project-specific",
			})),
			memoryId: Type.Optional(Type.String({ description: "Memory ID (for 'forget' mode)" })),
			limit: Type.Optional(Type.Number({ description: "Max results (for 'search' and 'list' modes)" })),
		}),
		async execute(toolCallId, params, onUpdate, ctx, signal) {
			if (!client) {
				return {
					content: [{ type: "text", text: "SuperMemory is not configured. Set SUPERMEMORY_API_KEY environment variable." }],
					isError: true,
				};
			}

			const mode = params.mode || "help";
			const userTag = getUserTag();
			// Use safeCwd to handle cases where ctx.cwd might be undefined
			const safeCwd = ctx?.cwd || process.cwd();
			const projectTag = getProjectTag(safeCwd);

			try {
				switch (mode) {
					case "help": {
						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									commands: [
										{ command: "add", description: "Store a new memory", args: ["content", "type?", "scope?"] },
										{ command: "search", description: "Search memories", args: ["query", "scope?", "limit?"] },
										{ command: "profile", description: "View user profile", args: ["query?"] },
										{ command: "list", description: "List recent memories", args: ["scope?", "limit?"] },
										{ command: "forget", description: "Remove a memory", args: ["memoryId"] },
									],
									scopes: {
										user: "Cross-project preferences and knowledge",
										project: "Project-specific knowledge (default)",
									},
									types: ["preference", "project-config", "architecture", "error-solution", "learned-pattern", "conversation"],
								}, null, 2),
							}],
						};
					}

					case "add": {
						if (!params.content) {
							return {
								content: [{ type: "text", text: "Error: 'content' parameter is required for add mode" }],
								isError: true,
							};
						}

						const scope = params.scope || "project";
						const containerTag = scope === "user" ? userTag : projectTag;

						const result = await client.add({
							content: params.content,
							containerTag,
							metadata: {
								type: params.type || "learned-pattern",
								scope,
								cwd: ctx.cwd,
								timestamp: Date.now(),
							},
						});

						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									message: `Memory added to ${scope} scope`,
									id: result.id,
									scope,
									type: params.type,
								}, null, 2),
							}],
						};
					}

					case "search": {
						if (!params.query) {
							return {
								content: [{ type: "text", text: "Error: 'query' parameter is required for search mode" }],
								isError: true,
							};
						}

						const scope = params.scope;
						const limit = params.limit || 10;

						let results: any[] = [];

						if (!scope || scope === "user") {
							const userResults = await client.search.memories({
								q: params.query,
								containerTag: userTag,
								limit,
							});
							results.push(...((userResults as any).results || []).map((r: any) => ({ ...r, scope: "user" })));
						}

						if (!scope || scope === "project") {
							const projectResults = await client.search.memories({
								q: params.query,
								containerTag: projectTag,
								limit,
							});
							results.push(...((projectResults as any).results || []).map((r: any) => ({ ...r, scope: "project" })));
						}

						// Sort by similarity
						results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
						results = results.slice(0, limit);

						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									query: params.query,
									count: results.length,
									results: results.map(r => ({
										id: r.id,
										content: r.memory || r.chunk || r.content,
										similarity: Math.round((r.similarity || 0) * 100),
										scope: r.scope,
									})),
								}, null, 2),
							}],
						};
					}

					case "profile": {
						const result = await client.profile({
							containerTag: userTag,
							q: params.query,
						});

						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									profile: {
										static: result.profile?.static || [],
										dynamic: result.profile?.dynamic || [],
									},
								}, null, 2),
							}],
						};
					}

					case "list": {
						const scope = params.scope || "project";
						const limit = params.limit || 20;
						const containerTag = scope === "user" ? userTag : projectTag;

						const result = await client.documents.list({
							containerTags: [containerTag],
							limit,
							sort: "createdAt",
							order: "desc",
						});

						const documents = (result as any).documents || [];

						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									scope,
									count: documents.length,
									memories: documents.map((d: any) => ({
										id: d.id,
										content: d.content,
										createdAt: d.createdAt,
										metadata: d.metadata,
									})),
								}, null, 2),
							}],
						};
					}

					case "forget": {
						if (!params.memoryId) {
							return {
								content: [{ type: "text", text: "Error: 'memoryId' parameter is required for forget mode" }],
								isError: true,
							};
						}

						// Use forget (soft delete) with containerTag and memory id
						const scope = params.scope || "project";
						const containerTag = scope === "user" ? userTag : projectTag;
						await client.memories.forget({
							containerTag: containerTag,
							id: params.memoryId,
						});

						return {
							content: [{
								type: "text",
								text: JSON.stringify({
									success: true,
									message: `Memory ${params.memoryId} forgotten from ${scope} scope`,
									scope: scope,
								}, null, 2),
							}],
						};
					}

					default:
						return {
							content: [{ type: "text", text: `Unknown mode: ${mode}` }],
							isError: true,
						};
				}
			} catch (error) {
				return {
					content: [{
						type: "text",
						text: `SuperMemory error: ${error instanceof Error ? error.message : String(error)}`,
					}],
					isError: true,
				};
			}
		},
	});

	// Register commands for direct user interaction
	pi.registerCommand("remember", {
		description: "Manually store something in SuperMemory",
		handler: async (args, ctx) => {
			if (!client) {
				ctx.ui.notify("SuperMemory not configured (set SUPERMEMORY_API_KEY)", "error");
				return;
			}

			if (!args?.trim()) {
				ctx.ui.notify("Usage: /remember <text to remember>", "warning");
				return;
			}

			try {
				const projectTag = getProjectTag(ctx.cwd);
				await client.add({
					content: args,
					containerTag: projectTag,
					metadata: {
						type: "learned-pattern",
						scope: "project",
						cwd: ctx.cwd,
						timestamp: Date.now(),
					},
				});
				ctx.ui.notify("Memory saved!", "success");
			} catch (error) {
				ctx.ui.notify(`Failed to save memory: ${error}`, "error");
			}
		},
	});

	pi.registerCommand("recall", {
		description: "Search SuperMemory for relevant memories",
		handler: async (args, ctx) => {
			if (!client) {
				ctx.ui.notify("SuperMemory not configured (set SUPERMEMORY_API_KEY)", "error");
				return;
			}

			if (!args?.trim()) {
				ctx.ui.notify("Usage: /recall <search query>", "warning");
				return;
			}

			try {
				const userTag = getUserTag();
				const projectTag = getProjectTag(ctx.cwd);

				const [userResults, projectResults] = await Promise.all([
					client.search.memories({ q: args, containerTag: userTag, limit: 5 }),
					client.search.memories({ q: args, containerTag: projectTag, limit: 5 }),
				]);

				const allResults = [
					...((userResults as any).results || []).map((r: any) => ({ ...r, scope: "user" })),
					...((projectResults as any).results || []).map((r: any) => ({ ...r, scope: "project" })),
				].sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 10);

				if (allResults.length === 0) {
					ctx.ui.notify("No memories found", "info");
					return;
				}

				const formatted = allResults
					.map((r, i) => `${i + 1}. [${r.scope}] ${(r.memory || r.chunk || "").slice(0, 100)}...`)
					.join("\n");

				ctx.ui.notify(`Found ${allResults.length} memories:\n${formatted}`, "info");
			} catch (error) {
				ctx.ui.notify(`Search failed: ${error}`, "error");
			}
		},
	});

	pi.registerCommand("memory-profile", {
		description: "View your SuperMemory user profile",
		handler: async (args, ctx) => {
			if (!client) {
				ctx.ui.notify("SuperMemory not configured (set SUPERMEMORY_API_KEY)", "error");
				return;
			}

			try {
				const userTag = getUserTag();
				const result = await client.profile({
					containerTag: userTag,
					q: args || undefined,
				});

				const staticFacts = result.profile?.static || [];
				const dynamicFacts = result.profile?.dynamic || [];

				if (staticFacts.length === 0 && dynamicFacts.length === 0) {
					ctx.ui.notify("No profile data yet. Use pi more to build your profile!", "info");
					return;
				}

				const formatted = [
					staticFacts.length > 0 ? `Static facts:\n${staticFacts.map(f => `  - ${f}`).join("\n")}` : "",
					dynamicFacts.length > 0 ? `Dynamic facts:\n${dynamicFacts.map(f => `  - ${f}`).join("\n")}` : "",
				].filter(Boolean).join("\n\n");

				ctx.ui.notify(formatted, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to fetch profile: ${error}`, "error");
			}
		},
	});

	// Show status on session start
	pi.on("session_start", async (_event, ctx) => {
		if (client && ctx.hasUI) {
			ctx.ui.setStatus("supermemory", "🧠");
		}
	});
}
