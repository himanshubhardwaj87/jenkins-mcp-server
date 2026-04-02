# Jenkins MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude direct access to your Jenkins CI/CD instance. Ask Claude to list jobs, investigate build failures, read logs, and trigger builds — all in natural language, no switching tabs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Machine                             │
│                                                                 │
│  ┌─────────────────┐   stdio (MCP)   ┌────────────────────┐   │
│  │  Claude Code /  │◄───────────────►│  Jenkins MCP       │   │
│  │  Claude Desktop │                 │  Server (Node.js)  │   │
│  └─────────────────┘                 └────────┬───────────┘   │
│                                               │                │
└───────────────────────────────────────────────┼────────────────┘
                                                │ HTTPS
                                                │ REST API
                                                ▼
                                   ┌────────────────────────┐
                                   │   Jenkins Instance     │
                                   │   (any version)        │
                                   │                        │
                                   │  • /api/json           │
                                   │  • /job/.../api/json   │
                                   │  • /job/.../build      │
                                   │  • /job/.../config.xml │
                                   │  • /queue/api/json     │
                                   │  • /computer/api/json  │
                                   └────────────────────────┘
```

### How It Works

```
┌──────────────┐      ┌──────────────────┐      ┌─────────────────┐
│              │      │                  │      │                 │
│    Claude    │─────►│  MCP Server      │─────►│  Jenkins REST   │
│  (AI model)  │      │  (this package)  │      │  API            │
│              │      │                  │      │                 │
│  "Show me    │      │  Calls           │      │  GET /api/json  │
│   failed     │      │  jenkins.        │      │  ?tree=jobs[..] │
│   builds"    │      │  listJobs()      │      │                 │
│              │◄─────│                  │◄─────│  { "jobs": [] } │
│  Shows jobs  │      │  Returns JSON    │      │                 │
│  with status │      │  as text         │      │                 │
└──────────────┘      └──────────────────┘      └─────────────────┘

Transport: Claude spawns the MCP server as a subprocess and communicates
           over stdin/stdout using the MCP JSON-RPC protocol.
           No network port opened — fully local and secure.
```

---

## Is This Generic? Can Others Use It?

**Yes — completely.** The server has zero Provar-specific code. It works with **any Jenkins instance** (Jenkins LTS, Jenkins Cloud, self-hosted, Docker) as long as:

- Jenkins has its REST API enabled (it is by default)
- You have a user account with an API token
- The server can reach Jenkins over HTTPS/HTTP

The only configuration is three environment variables:

| Variable | Description |
|----------|-------------|
| `JENKINS_URL` | Your Jenkins base URL (e.g. `https://ci.mycompany.com`) |
| `JENKINS_USERNAME` | Your Jenkins username |
| `JENKINS_API_TOKEN` | Your Jenkins API token (not password) |

---

## Available Tools (13 total)

| Tool | Description |
|------|-------------|
| `list_jobs` | List all jobs; optionally filter by folder path |
| `search_jobs` | Search jobs by name pattern |
| `get_job_details` | Full job info: health, last builds, build history |
| `list_builds` | Recent builds with status, date, duration |
| `get_build_details` | Single build details including changesets |
| `get_build_log` | Console output (tail by default, full available) |
| `get_test_report` | Test results: pass/fail/skip counts + failed test details |
| `get_failed_builds` | Recent failed builds for a job |
| `diagnose_build_failure` | Combined: build info + log tail + test failures in one shot |
| `get_job_config` | Raw XML job config / Jenkinsfile content |
| `trigger_build` | Trigger a build, with optional parameters |
| `get_queue` | Current build queue (pending/stuck builds) |
| `get_nodes` | Agent/node status (online/offline/busy/idle) |

---

## Implementation Guide

### Prerequisites

- Node.js 18 or later
- A Jenkins instance (any version)
- Claude Code or Claude Desktop

---

### Step 1: Get Your Jenkins API Token

1. Log in to Jenkins
2. Click your username (top right) → **Configure**
3. Scroll to **API Token** → click **Add new Token**
4. Name it (e.g. `claude-mcp`) and click **Generate**
5. Copy the token — you won't see it again

---

### Step 2: Install the MCP Server

**Option A — Install from GitHub Packages (recommended)**

Add to your `~/.npmrc`:
```
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
@provartesting:registry=https://npm.pkg.github.com
```

You need a GitHub Personal Access Token with `read:packages` scope.
Create one at: https://github.com/settings/tokens

Then install globally:
```bash
npm install -g @provartesting/jenkins-mcp-server
```

**Option B — Clone and build from source**

```bash
git clone https://github.com/provartesting/jenkins-mcp-server.git
cd jenkins-mcp-server
npm install
npm run build
```

---

### Step 3: Configure Claude Code

Add to your `~/.claude.json` (create if it doesn't exist):

```json
{
  "mcpServers": {
    "jenkins": {
      "command": "npx",
      "args": ["-y", "@provartesting/jenkins-mcp-server"],
      "env": {
        "JENKINS_URL": "https://your-jenkins-instance.example.com",
        "JENKINS_USERNAME": "your-username",
        "JENKINS_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

If you built from source, use:
```json
{
  "mcpServers": {
    "jenkins": {
      "command": "node",
      "args": ["/path/to/jenkins-mcp-server/dist/index.js"],
      "env": {
        "JENKINS_URL": "https://your-jenkins-instance.example.com",
        "JENKINS_USERNAME": "your-username",
        "JENKINS_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

**For Claude Desktop**, add the same `mcpServers` block to:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

---

### Step 4: Verify It Works

Restart Claude Code or Claude Desktop. Then ask:

```
List all my Jenkins jobs
```

You should see a list of your jobs with their current status. If you get an error, check:
- The URL is reachable from your machine
- The API token is correct (not your password)
- The username matches exactly

---

## Usage Examples

Once configured, you can ask Claude things like:

```
Show me the last 5 builds of my "deploy-production" job

Why did build #142 of "integration-tests" fail?

Are there any stuck builds in the queue?

Which agents are currently offline?

Trigger a build of "feature-branch-tests" with BRANCH_NAME=main

Show me all jobs with "regression" in the name

Get the Jenkinsfile for "my-pipeline-job"
```

---

## Building From Source

```bash
# Clone
git clone https://github.com/provartesting/jenkins-mcp-server.git
cd jenkins-mcp-server

# Install dependencies
npm install

# Build TypeScript → dist/
npm run build

# Run (requires env vars)
JENKINS_URL=https://ci.example.com \
JENKINS_USERNAME=admin \
JENKINS_API_TOKEN=abc123 \
node dist/index.js
```

---

## Project Structure

```
jenkins-mcp-server/
├── src/
│   ├── index.ts          # MCP server — tool definitions, request handling
│   └── jenkins-client.ts # Jenkins REST API client
├── dist/                 # Compiled output (generated by npm run build)
├── .env.example          # Environment variable template
├── tsconfig.json
└── package.json
```

### Key Design Decisions

**Pure stdio transport** — Claude spawns the server as a child process. No HTTP server, no ports, no firewall rules needed.

**Environment-variable config** — Credentials never appear in code. Different team members use different tokens.

**Native fetch** — No axios or node-fetch needed (Node.js 18+ has `fetch` built in).

**Tool-per-operation pattern** — Each Jenkins capability is a separate MCP tool with a JSON Schema definition. Claude can discover and call exactly what it needs.

---

## Troubleshooting

**"JENKINS_URL, JENKINS_USERNAME, and JENKINS_API_TOKEN environment variables are required"**
→ The env vars aren't being passed. Check your `~/.claude.json` config.

**"Jenkins API error: 401"**
→ Wrong username or API token. Regenerate the token in Jenkins.

**"Jenkins API error: 403"**
→ Your user lacks permission for that operation (e.g. triggering builds). Check Jenkins permissions.

**"Jenkins API error: 404"**
→ Wrong job path. Use `list_jobs` or `search_jobs` to find the exact name.

**Tools don't appear in Claude**
→ Restart Claude Code/Desktop after editing `~/.claude.json`. Check the MCP server logs with `claude mcp list`.

---

## License

ISC
