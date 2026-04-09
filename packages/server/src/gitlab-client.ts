import { logger } from "./logger.js";

export interface GitLabMR {
  iid: number;
  title: string;
  author: { username: string };
  source_branch: string;
  target_branch: string;
  state: string;
  updated_at: string;
  web_url: string;
}

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  updated_at: string;
  web_url: string;
}

export interface GitLabIssue {
  iid: number;
  title: string;
  state: string;
  labels: string[];
  assignee?: { username: string };
  updated_at: string;
  web_url: string;
}

export interface GitLabJob {
  id: number;
  name: string;
  stage: string;
  status: string;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: { username: string };
  resolvable: boolean;
  resolved: boolean;
  position?: {
    new_path: string;
    new_line: number;
    old_path: string;
    old_line: number;
  };
}

export interface GitLabDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitLabNote[];
}

export class GitLabClient {
  private baseURL: string;
  private token: string;

  constructor(instanceURL: string, apiToken: string) {
    this.baseURL = instanceURL.replace(/\/$/, "") + "/api/v4";
    this.token = apiToken;
  }

  // --- MR Operations ---

  async listOpenMRs(projectId: string | number): Promise<GitLabMR[]> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/merge_requests?state=opened&per_page=20`);
  }

  async listUpdatedMRs(projectId: string | number, since: string): Promise<GitLabMR[]> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/merge_requests?state=opened&updated_after=${since}&per_page=50`);
  }

  async commentOnMR(projectId: string | number, mrIid: number, body: string): Promise<void> {
    await this.post(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/notes`, { body });
  }

  async approveMR(projectId: string | number, mrIid: number): Promise<void> {
    await this.post(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/approve`, {});
  }

  // --- Issue Operations ---

  async listIssues(projectId: string | number, state = "opened"): Promise<GitLabIssue[]> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/issues?state=${state}&per_page=20`);
  }

  async getIssue(projectId: string | number, issueIid: number): Promise<GitLabIssue> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/issues/${issueIid}`);
  }

  async commentOnIssue(projectId: string | number, issueIid: number, body: string): Promise<void> {
    await this.post(`/projects/${encodeURIComponent(projectId)}/issues/${issueIid}/notes`, { body });
  }

  // --- Pipeline Operations ---

  async listFailedPipelines(projectId: string | number, since?: string): Promise<GitLabPipeline[]> {
    let url = `/projects/${encodeURIComponent(projectId)}/pipelines?status=failed&per_page=10`;
    if (since) url += `&updated_after=${since}`;
    return this.get(url);
  }

  async getPipelineJobs(projectId: string | number, pipelineId: number): Promise<GitLabJob[]> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/pipelines/${pipelineId}/jobs`);
  }

  async getJobLog(projectId: string | number, jobId: number): Promise<string> {
    const res = await fetch(`${this.baseURL}/projects/${encodeURIComponent(projectId)}/jobs/${jobId}/trace`, {
      headers: { "PRIVATE-TOKEN": this.token },
    });
    return res.text();
  }

  // --- MR CRUD ---

  async createMR(
    projectId: string | number,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description?: string
  ): Promise<GitLabMR> {
    return this.post(`/projects/${encodeURIComponent(projectId)}/merge_requests`, {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      ...(description && { description }),
    });
  }

  async getMR(projectId: string | number, mrIid: number): Promise<GitLabMR> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`);
  }

  async getMRChanges(projectId: string | number, mrIid: number): Promise<any> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/changes`);
  }

  // --- Discussion/Thread Operations ---

  async listMRDiscussions(projectId: string | number, mrIid: number): Promise<GitLabDiscussion[]> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/discussions?per_page=100`);
  }

  async replyToDiscussion(
    projectId: string | number,
    mrIid: number,
    discussionId: string,
    body: string
  ): Promise<void> {
    await this.post(
      `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/discussions/${discussionId}/notes`,
      { body }
    );
  }

  async resolveDiscussion(
    projectId: string | number,
    mrIid: number,
    discussionId: string,
    resolved = true
  ): Promise<void> {
    await this.put(
      `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/discussions/${discussionId}`,
      { resolved }
    );
  }

  // --- Notes ---

  async listMRNotes(projectId: string | number, mrIid: number): Promise<GitLabNote[]> {
    return this.get(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/notes?per_page=100&sort=asc`);
  }

  // --- Branch Operations ---

  async createBranch(projectId: string | number, name: string, ref: string): Promise<void> {
    await this.post(`/projects/${encodeURIComponent(projectId)}/repository/branches`, { branch: name, ref });
  }

  // --- Projects ---

  async getProject(projectId: string | number): Promise<any> {
    return this.get(`/projects/${encodeURIComponent(projectId)}`);
  }

  // --- HTTP helpers ---

  private async get<T = any>(path: string): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      headers: { "PRIVATE-TOKEN": this.token },
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ path, status: res.status, body: text.slice(0, 200) }, "GitLab API error");
      throw new Error(`GitLab API ${res.status}: ${text.slice(0, 100)}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T = any>(path: string, body: any): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": this.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ path, status: res.status, body: text.slice(0, 200) }, "GitLab API error");
      throw new Error(`GitLab API ${res.status}: ${text.slice(0, 100)}`);
    }
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) return res.json() as Promise<T>;
    return {} as T;
  }

  private async put<T = any>(path: string, body: any): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      method: "PUT",
      headers: { "PRIVATE-TOKEN": this.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ path, status: res.status, body: text.slice(0, 200) }, "GitLab API error");
      throw new Error(`GitLab API ${res.status}: ${text.slice(0, 100)}`);
    }
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) return res.json() as Promise<T>;
    return {} as T;
  }
}
