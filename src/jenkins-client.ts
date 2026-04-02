/**
 * Jenkins API client using native fetch.
 * Communicates with Jenkins via its JSON REST API.
 */

export interface JenkinsConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly apiToken: string;
}

export interface JenkinsJob {
  readonly name: string;
  readonly url: string;
  readonly color: string;
  readonly fullName?: string;
}

export interface JenkinsBuild {
  readonly number: number;
  readonly url: string;
  readonly result: string | null;
  readonly timestamp: number;
  readonly duration: number;
  readonly displayName: string;
  readonly building: boolean;
}

export interface JenkinsBuildDetail {
  readonly number: number;
  readonly url: string;
  readonly result: string | null;
  readonly timestamp: number;
  readonly duration: number;
  readonly displayName: string;
  readonly building: boolean;
  readonly description: string | null;
  readonly changeSets: readonly ChangeSet[];
  readonly actions: readonly Record<string, unknown>[];
}

export interface ChangeSet {
  readonly items: readonly ChangeSetItem[];
  readonly kind: string;
}

export interface ChangeSetItem {
  readonly commitId: string;
  readonly msg: string;
  readonly author: { readonly fullName: string };
  readonly timestamp: number;
}

export interface JenkinsQueueItem {
  readonly id: number;
  readonly why: string | null;
  readonly task: { readonly name: string; readonly url: string };
  readonly blocked: boolean;
  readonly buildable: boolean;
  readonly stuck: boolean;
}

export interface JenkinsNode {
  readonly displayName: string;
  readonly description: string;
  readonly idle: boolean;
  readonly offline: boolean;
  readonly temporarilyOffline: boolean;
  readonly numExecutors: number;
}

export class JenkinsClient {
  private readonly config: JenkinsConfig;
  private readonly authHeader: string;

  constructor(config: JenkinsConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
    };
    this.authHeader =
      "Basic " +
      Buffer.from(`${this.config.username}:${this.config.apiToken}`).toString(
        "base64"
      );
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Jenkins API error: ${response.status} ${response.statusText} - ${body}`
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  /** List all jobs (top-level or within a folder). */
  async listJobs(folderPath?: string): Promise<readonly JenkinsJob[]> {
    const base = folderPath
      ? `/job/${folderPath.split("/").join("/job/")}`
      : "";
    const data = await this.request<{ jobs: JenkinsJob[] }>(
      `${base}/api/json?tree=jobs[name,url,color,fullName]`
    );
    return data.jobs ?? [];
  }

  /** Get job details including recent builds. */
  async getJob(jobPath: string): Promise<Record<string, unknown>> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    return this.request<Record<string, unknown>>(
      `${encodedPath}/api/json?tree=name,url,color,fullName,description,healthReport[description,score],lastBuild[number,url,result,timestamp,duration],lastSuccessfulBuild[number,url,timestamp],lastFailedBuild[number,url,timestamp],builds[number,url,result,timestamp,duration]{0,10}`
    );
  }

  /** List recent builds of a job. */
  async listBuilds(
    jobPath: string,
    limit: number = 10
  ): Promise<readonly JenkinsBuild[]> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    const data = await this.request<{ builds: JenkinsBuild[] }>(
      `${encodedPath}/api/json?tree=builds[number,url,result,timestamp,duration,displayName,building]{0,${limit}}`
    );
    return data.builds ?? [];
  }

  /** Get detailed info for a specific build. */
  async getBuild(
    jobPath: string,
    buildNumber: number
  ): Promise<JenkinsBuildDetail> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    return this.request<JenkinsBuildDetail>(
      `${encodedPath}/${buildNumber}/api/json`
    );
  }

  /** Get console output (log) for a build. */
  async getBuildLog(
    jobPath: string,
    buildNumber: number
  ): Promise<string> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    return this.request<string>(
      `${encodedPath}/${buildNumber}/consoleText`
    );
  }

  /** Get the last N lines of a build log (useful for large logs). */
  async getBuildLogTail(
    jobPath: string,
    buildNumber: number,
    maxLines: number = 200
  ): Promise<string> {
    const fullLog = await this.getBuildLog(jobPath, buildNumber);
    const lines = fullLog.split("\n");
    if (lines.length <= maxLines) {
      return fullLog;
    }
    return (
      `... [${lines.length - maxLines} lines truncated] ...\n` +
      lines.slice(-maxLines).join("\n")
    );
  }

  /** Get test results for a build. */
  async getTestReport(
    jobPath: string,
    buildNumber: number
  ): Promise<Record<string, unknown>> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    return this.request<Record<string, unknown>>(
      `${encodedPath}/${buildNumber}/testReport/api/json`
    );
  }

  /** Get build queue. */
  async getQueue(): Promise<readonly JenkinsQueueItem[]> {
    const data = await this.request<{ items: JenkinsQueueItem[] }>(
      "/queue/api/json?tree=items[id,why,task[name,url],blocked,buildable,stuck]"
    );
    return data.items ?? [];
  }

  /** Get node/agent information. */
  async getNodes(): Promise<readonly JenkinsNode[]> {
    const data = await this.request<{
      computer: JenkinsNode[];
    }>(
      "/computer/api/json?tree=computer[displayName,description,idle,offline,temporarilyOffline,numExecutors]"
    );
    return data.computer ?? [];
  }

  /** Trigger a build for a job. */
  async triggerBuild(
    jobPath: string,
    parameters?: Record<string, string>
  ): Promise<string> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    if (parameters && Object.keys(parameters).length > 0) {
      const formData = new URLSearchParams();
      const jsonParams = Object.entries(parameters).map(([name, value]) => ({
        name,
        value,
      }));
      formData.append("json", JSON.stringify({ parameter: jsonParams }));

      await this.request(`${encodedPath}/build?delay=0sec`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
    } else {
      await this.request(`${encodedPath}/build?delay=0sec`, {
        method: "POST",
      });
    }
    return `Build triggered for ${jobPath}`;
  }

  /** Get the Jenkinsfile / pipeline config for a job. */
  async getJobConfig(jobPath: string): Promise<string> {
    const encodedPath = `/job/${jobPath.split("/").join("/job/")}`;
    const response = await fetch(
      `${this.config.baseUrl}${encodedPath}/config.xml`,
      {
        headers: {
          Authorization: this.authHeader,
        },
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to get job config: ${response.status} ${response.statusText}`
      );
    }
    return response.text();
  }

  /** Search for jobs by name pattern. */
  async searchJobs(query: string): Promise<readonly JenkinsJob[]> {
    const allJobs = await this.listJobs();
    const lowerQuery = query.toLowerCase();
    return allJobs.filter(
      (job) =>
        job.name.toLowerCase().includes(lowerQuery) ||
        (job.fullName?.toLowerCase().includes(lowerQuery) ?? false)
    );
  }

  /** Get failed builds for a job. */
  async getFailedBuilds(
    jobPath: string,
    limit: number = 10
  ): Promise<readonly JenkinsBuild[]> {
    const builds = await this.listBuilds(jobPath, limit);
    return builds.filter((b) => b.result === "FAILURE");
  }
}
