#!/usr/bin/env node

/**
 * Jenkins MCP Server
 *
 * Provides Claude with tools to interact with a Jenkins CI/CD server:
 * - List and search jobs
 * - View build history, details, and logs
 * - Analyze test failures
 * - Trigger builds
 * - View queue and node status
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JenkinsClient } from "./jenkins-client.js";

// ---------------------------------------------------------------------------
// Configuration from environment variables
// ---------------------------------------------------------------------------
const JENKINS_URL = process.env.JENKINS_URL ?? "";
const JENKINS_USERNAME = process.env.JENKINS_USERNAME ?? "";
const JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN ?? "";

if (!JENKINS_URL || !JENKINS_USERNAME || !JENKINS_API_TOKEN) {
  console.error(
    "Error: JENKINS_URL, JENKINS_USERNAME, and JENKINS_API_TOKEN environment variables are required."
  );
  process.exit(1);
}

const jenkins = new JenkinsClient({
  baseUrl: JENKINS_URL,
  username: JENKINS_USERNAME,
  apiToken: JENKINS_API_TOKEN,
});

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "jenkins-mcp-server",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: list_jobs
// ---------------------------------------------------------------------------
server.tool(
  "list_jobs",
  "List all Jenkins jobs. Optionally filter by folder path.",
  { folderPath: z.string().optional().describe("Folder path (e.g. 'my-folder/sub-folder')") },
  async ({ folderPath }) => {
    try {
      const jobs = await jenkins.listJobs(folderPath);
      const summary = jobs.map((j) => ({
        name: j.name,
        status: colorToStatus(j.color),
        url: j.url,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_job_details
// ---------------------------------------------------------------------------
server.tool(
  "get_job_details",
  "Get detailed information about a Jenkins job including health, last builds, and recent build history.",
  { jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')") },
  async ({ jobPath }) => {
    try {
      const job = await jenkins.getJob(jobPath);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: list_builds
// ---------------------------------------------------------------------------
server.tool(
  "list_builds",
  "List recent builds of a Jenkins job with their status.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    limit: z.number().optional().default(10).describe("Max builds to return (default 10)"),
  },
  async ({ jobPath, limit }) => {
    try {
      const builds = await jenkins.listBuilds(jobPath, limit);
      const summary = builds.map((b) => ({
        number: b.number,
        result: b.result ?? (b.building ? "BUILDING" : "UNKNOWN"),
        date: new Date(b.timestamp).toISOString(),
        duration: formatDuration(b.duration),
        url: b.url,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_build_details
// ---------------------------------------------------------------------------
server.tool(
  "get_build_details",
  "Get detailed information about a specific build including changeSets and actions.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    buildNumber: z.number().describe("Build number"),
  },
  async ({ jobPath, buildNumber }) => {
    try {
      const build = await jenkins.getBuild(jobPath, buildNumber);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(build, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_build_log
// ---------------------------------------------------------------------------
server.tool(
  "get_build_log",
  "Get the console output (log) of a Jenkins build. Use this to diagnose build failures. Returns the last N lines by default to avoid overwhelming output.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    buildNumber: z.number().describe("Build number"),
    maxLines: z.number().optional().default(200).describe("Max lines to return from end of log (default 200)"),
    fullLog: z.boolean().optional().default(false).describe("Return full log instead of tail"),
  },
  async ({ jobPath, buildNumber, maxLines, fullLog }) => {
    try {
      const log = fullLog
        ? await jenkins.getBuildLog(jobPath, buildNumber)
        : await jenkins.getBuildLogTail(jobPath, buildNumber, maxLines);
      return {
        content: [
          {
            type: "text" as const,
            text: log,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_test_report
// ---------------------------------------------------------------------------
server.tool(
  "get_test_report",
  "Get test results for a Jenkins build. Shows passed, failed, and skipped test counts, plus details of failed tests.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    buildNumber: z.number().describe("Build number"),
  },
  async ({ jobPath, buildNumber }) => {
    try {
      const report = await jenkins.getTestReport(jobPath, buildNumber);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_failed_builds
// ---------------------------------------------------------------------------
server.tool(
  "get_failed_builds",
  "Get recent failed builds for a job. Useful for identifying recurring failures.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    limit: z.number().optional().default(10).describe("Max builds to check (default 10)"),
  },
  async ({ jobPath, limit }) => {
    try {
      const failed = await jenkins.getFailedBuilds(jobPath, limit);
      if (failed.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No failed builds found in the last ${limit} builds of ${jobPath}.`,
            },
          ],
        };
      }
      const summary = failed.map((b) => ({
        number: b.number,
        date: new Date(b.timestamp).toISOString(),
        duration: formatDuration(b.duration),
        url: b.url,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: search_jobs
// ---------------------------------------------------------------------------
server.tool(
  "search_jobs",
  "Search for Jenkins jobs by name.",
  { query: z.string().describe("Search query to match against job names") },
  async ({ query }) => {
    try {
      const jobs = await jenkins.searchJobs(query);
      const summary = jobs.map((j) => ({
        name: j.name,
        fullName: j.fullName,
        status: colorToStatus(j.color),
        url: j.url,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text:
              summary.length > 0
                ? JSON.stringify(summary, null, 2)
                : `No jobs found matching "${query}".`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_queue
// ---------------------------------------------------------------------------
server.tool(
  "get_queue",
  "Get the Jenkins build queue showing pending and stuck builds.",
  {},
  async () => {
    try {
      const items = await jenkins.getQueue();
      if (items.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "Build queue is empty." },
          ],
        };
      }
      const summary = items.map((item) => ({
        id: item.id,
        job: item.task.name,
        why: item.why,
        stuck: item.stuck,
        blocked: item.blocked,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_nodes
// ---------------------------------------------------------------------------
server.tool(
  "get_nodes",
  "Get Jenkins agent/node status including online/offline state and executor info.",
  {},
  async () => {
    try {
      const nodes = await jenkins.getNodes();
      const summary = nodes.map((n) => ({
        name: n.displayName,
        status: n.offline ? "OFFLINE" : n.idle ? "IDLE" : "BUSY",
        executors: n.numExecutors,
        temporarilyOffline: n.temporarilyOffline,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: trigger_build
// ---------------------------------------------------------------------------
server.tool(
  "trigger_build",
  "Trigger a new build for a Jenkins job. Optionally pass build parameters.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    parameters: z
      .record(z.string())
      .optional()
      .describe("Build parameters as key-value pairs"),
  },
  async ({ jobPath, parameters }) => {
    try {
      const result = await jenkins.triggerBuild(jobPath, parameters);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_job_config
// ---------------------------------------------------------------------------
server.tool(
  "get_job_config",
  "Get the XML configuration of a Jenkins job. Useful for understanding pipeline definitions and Jenkinsfile content.",
  { jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')") },
  async ({ jobPath }) => {
    try {
      const config = await jenkins.getJobConfig(jobPath);
      return {
        content: [{ type: "text" as const, text: config }],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: diagnose_build_failure
// ---------------------------------------------------------------------------
server.tool(
  "diagnose_build_failure",
  "Analyze a failed build by fetching its details, log tail, and test report (if available). Returns a combined diagnostic summary.",
  {
    jobPath: z.string().describe("Job path (e.g. 'my-folder/my-job')"),
    buildNumber: z.number().describe("Build number to diagnose"),
  },
  async ({ jobPath, buildNumber }) => {
    try {
      const [buildDetail, logTail, testReport] = await Promise.all([
        jenkins.getBuild(jobPath, buildNumber),
        jenkins.getBuildLogTail(jobPath, buildNumber, 150),
        jenkins.getTestReport(jobPath, buildNumber).catch(() => null),
      ]);

      const sections: string[] = [];

      // Build info
      sections.push("## Build Info");
      sections.push(`- **Job:** ${jobPath}`);
      sections.push(`- **Build:** #${buildDetail.number}`);
      sections.push(`- **Result:** ${buildDetail.result ?? "BUILDING"}`);
      sections.push(
        `- **Date:** ${new Date(buildDetail.timestamp).toISOString()}`
      );
      sections.push(`- **Duration:** ${formatDuration(buildDetail.duration)}`);

      // Changes
      if (buildDetail.changeSets?.length > 0) {
        sections.push("\n## Changes");
        for (const cs of buildDetail.changeSets) {
          for (const item of cs.items) {
            sections.push(
              `- ${item.author.fullName}: ${item.msg} (${item.commitId.slice(0, 8)})`
            );
          }
        }
      }

      // Test summary
      if (testReport) {
        sections.push("\n## Test Results");
        const tr = testReport as Record<string, unknown>;
        sections.push(`- **Total:** ${tr.totalCount ?? "N/A"}`);
        sections.push(`- **Passed:** ${tr.passCount ?? "N/A"}`);
        sections.push(`- **Failed:** ${tr.failCount ?? "N/A"}`);
        sections.push(`- **Skipped:** ${tr.skipCount ?? "N/A"}`);

        // Failed test details
        const suites = tr.suites as
          | Array<{ cases: Array<Record<string, unknown>> }>
          | undefined;
        if (suites) {
          const failedCases = suites.flatMap((s) =>
            s.cases.filter(
              (c) =>
                c.status === "FAILED" ||
                c.status === "REGRESSION"
            )
          );
          if (failedCases.length > 0) {
            sections.push("\n### Failed Tests");
            for (const fc of failedCases.slice(0, 20)) {
              sections.push(`\n**${fc.className}.${fc.name}**`);
              if (fc.errorDetails) {
                sections.push(
                  `\`\`\`\n${String(fc.errorDetails).slice(0, 500)}\n\`\`\``
                );
              }
            }
            if (failedCases.length > 20) {
              sections.push(
                `\n... and ${failedCases.length - 20} more failed tests`
              );
            }
          }
        }
      }

      // Console log tail
      sections.push("\n## Console Log (last 150 lines)");
      sections.push("```");
      sections.push(logTail);
      sections.push("```");

      return {
        content: [
          {
            type: "text" as const,
            text: sections.join("\n"),
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function colorToStatus(color: string): string {
  const map: Record<string, string> = {
    blue: "SUCCESS",
    red: "FAILURE",
    yellow: "UNSTABLE",
    grey: "NOT_BUILT",
    disabled: "DISABLED",
    aborted: "ABORTED",
    notbuilt: "NOT_BUILT",
    blue_anime: "BUILDING (was SUCCESS)",
    red_anime: "BUILDING (was FAILURE)",
    yellow_anime: "BUILDING (was UNSTABLE)",
  };
  return map[color] ?? color?.toUpperCase() ?? "UNKNOWN";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

function errorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jenkins MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
