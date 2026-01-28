# Usage Examples

This document shows practical examples of using the Pi SuperMemory extension.

## Basic Usage

### Remembering Preferences

```
You: Remember that I prefer single quotes in JavaScript

Pi: [uses supermemory tool to store preference]
✓ Memory added to user scope
```

Later, in a different project:

```
You: Create a new React component

Pi: [automatically recalls preference for single quotes]

Here's your component:

const MyComponent = () => {
  return <div className='container'>Hello</div>;  // Uses single quotes!
};
```

### Saving Project Context

```
You: Remember this project uses Supabase for the database with a 'posts' table

Pi: [stores in project scope]

Weeks later...

You: How do I query the posts?

Pi: [recalls Supabase setup from memory]

You can query the posts table using Supabase like this:

const { data: posts } = await supabase
  .from('posts')
  .select('*');
```

### Error Solutions

```
You: I finally fixed that CORS issue by adding this to the vite config

Pi: [stores as error-solution type]

Months later when CORS issues appear again...

Pi: [recalls previous solution]
I see you're having CORS issues. Previously, you fixed this by updating vite.config.ts:

server: {
  cors: {
    origin: '*'
  }
}
```

## Using Slash Commands

### Quick Save with /remember

```
/remember The staging API is at https://api.staging.example.com

[Status notification: Memory saved!]
```

### Search with /recall

```
/recall database connection

[Status notification: Found 3 memories:
1. [project] The database URL is postgresql://localhost:5432/myapp...
2. [user] I prefer using connection pooling in production...
3. [project] Migration scripts are in /db/migrations...]
```

### View Profile with /memory-profile

```
/memory-profile

[Status notification: 
Static facts:
  - Prefers TypeScript over JavaScript
  - Uses Vim keybindings
  - Favorite framework is Next.js
Dynamic facts:
  - Currently working on authentication features
  - Recently learned about edge functions]
```

## Memory Scopes in Action

### User Scope (Cross-Project)

```
Project: my-api
You: Remember that I always use 2-space indentation

Project: my-frontend  
You: Create a config file

Pi: [recalls 2-space preference even though this is a different project]

// .prettierrc
{
  "tabWidth": 2,  // Automatically uses your preference!
  "useTabs": false
}
```

### Project Scope (Isolated)

```
Project: legacy-app
You: Remember this project uses jQuery and Bootstrap

Project: modern-app
You: How should I style this component?

Pi: [doesn't suggest jQuery/Bootstrap since this is a different project]

For this modern React project, I'd recommend using Tailwind CSS or CSS Modules...
```

## Tool Usage Examples

The LLM uses the `supermemory` tool automatically. Here's what those calls look like:

### Adding a Memory

```json
{
  "mode": "add",
  "content": "User prefers dark mode in all applications",
  "type": "preference",
  "scope": "user"
}
```

### Searching Memories

```json
{
  "mode": "search",
  "query": "database schema users table",
  "scope": "project",
  "limit": 5
}
```

### Getting Profile

```json
{
  "mode": "profile",
  "query": "coding preferences"
}
```

### Listing Memories

```json
{
  "mode": "list",
  "scope": "project",
  "limit": 20
}
```

### Deleting a Memory

```json
{
  "mode": "forget",
  "memoryId": "mem_abc123xyz"
}
```

## Advanced Patterns

### Architecture Decisions

```
You: Remember we decided to use the repository pattern for data access

Pi: [stores as architecture type]

Later...

You: Where should I put the user fetching logic?

Pi: [recalls architecture decision]

Based on your repository pattern decision, create a `UserRepository` class in `src/repositories/`...
```

### Contextual Code Generation

```
You: Remember this project uses Zod for validation and tRPC for API routes

Weeks later...

You: Add a new endpoint for creating posts

Pi: [recalls stack from memory]

// router.ts
export const postRouter = router({
  create: publicProcedure
    .input(z.object({
      title: z.string().min(1),
      content: z.string(),
    }))
    .mutation(async ({ input }) => {
      // Implementation
    }),
});
```

### Learning Patterns

```
You: I just learned that using Promise.all with fetch is much faster than sequential awaits

Pi: [stores as learned-pattern]

Later when reviewing code...

Pi: [recalls pattern]

I notice you're fetching data sequentially. You previously learned that Promise.all can be much faster:

// Instead of:
const users = await fetchUsers();
const posts = await fetchPosts();

// Consider:
const [users, posts] = await Promise.all([
  fetchUsers(),
  fetchPosts()
]);
```

## Tips

1. **Be specific** when asking Pi to remember things - specific memories are easier to recall accurately

2. **Use the right scope** - User preferences should be `user` scope, project-specific details should be `project` scope

3. **Classify correctly** - Using appropriate types (`preference`, `architecture`, `error-solution`) helps with organization

4. **Regular cleanup** - Use `/recall` and the `forget` tool to remove outdated memories

5. **Check your profile** - Run `/memory-profile` periodically to see what Pi has learned about you
