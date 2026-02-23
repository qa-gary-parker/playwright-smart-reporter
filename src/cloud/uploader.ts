import * as fs from 'fs';
import * as path from 'path';
import type { SmartReporterOptions, TestResultData, CIInfo } from '../types';

const DEFAULT_ENDPOINT = 'https://app.stagewright.dev/api/v1';

interface UploadResult {
  success: boolean;
  runId?: string;
  url?: string;
  error?: string;
  artifactUploadUrls?: Record<string, string>;
}

interface CloudRunPayload {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  durationMs: number;
  passRate: number;
  stabilityScore?: number;
  stabilityGrade?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  ciProvider?: string;
  ciBuildId?: string;
  ciBuildUrl?: string;
  metadata: Record<string, unknown>;
  results: CloudTestResult[];
}

interface CloudTestResult {
  testId: string;
  title: string;
  filePath: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
  errorStack?: string;
  stabilityScore?: number;
  stabilityGrade?: string;
  flakinessIndicator?: string;
  performanceTrend?: string;
  aiSuggestion?: string;
  tags: string[];
  attachments: CloudAttachment[];
  steps: CloudStep[];
}

interface CloudAttachment {
  name: string;
  contentType: string;
  path?: string;
  storagePath?: string;
}

interface CloudStep {
  title: string;
  duration: number;
  category: string;
}

/**
 * Detects CI environment information
 */
function detectCIInfo(): CIInfo | undefined {
  // GitHub Actions
  if (process.env.GITHUB_ACTIONS) {
    return {
      provider: 'github',
      branch: process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF,
      commit: process.env.GITHUB_SHA,
      buildId: process.env.GITHUB_RUN_ID,
    };
  }

  // GitLab CI
  if (process.env.GITLAB_CI) {
    return {
      provider: 'gitlab',
      branch: process.env.CI_COMMIT_REF_NAME,
      commit: process.env.CI_COMMIT_SHA,
      buildId: process.env.CI_PIPELINE_ID,
    };
  }

  // CircleCI
  if (process.env.CIRCLECI) {
    return {
      provider: 'circleci',
      branch: process.env.CIRCLE_BRANCH,
      commit: process.env.CIRCLE_SHA1,
      buildId: process.env.CIRCLE_BUILD_NUM,
    };
  }

  // Jenkins
  if (process.env.JENKINS_URL) {
    return {
      provider: 'jenkins',
      branch: process.env.GIT_BRANCH || process.env.BRANCH_NAME,
      commit: process.env.GIT_COMMIT,
      buildId: process.env.BUILD_NUMBER,
    };
  }

  // Azure DevOps
  if (process.env.TF_BUILD) {
    return {
      provider: 'azure',
      branch: process.env.BUILD_SOURCEBRANCHNAME,
      commit: process.env.BUILD_SOURCEVERSION,
      buildId: process.env.BUILD_BUILDID,
    };
  }

  return undefined;
}

/**
 * Maps TestResultData status to cloud status
 */
function mapStatus(result: TestResultData): 'passed' | 'failed' | 'skipped' | 'flaky' {
  if (result.outcome === 'flaky') return 'flaky';
  if (result.status === 'skipped') return 'skipped';
  if (result.outcome === 'expected') return 'passed';
  if (result.status === 'passed') return 'passed';
  return 'failed';
}

/**
 * Transforms local test results to cloud format
 */
function transformResults(results: TestResultData[]): CloudTestResult[] {
  return results.map((result) => {
    const attachments: CloudAttachment[] = [];

    // Add screenshots
    if (result.attachments?.screenshots) {
      for (const screenshot of result.attachments.screenshots) {
        // Skip base64 data URIs for cloud upload
        if (!screenshot.startsWith('data:')) {
          attachments.push({
            name: path.basename(screenshot),
            contentType: 'image/png',
            path: screenshot,
          });
        }
      }
    }

    // Add videos
    if (result.attachments?.videos) {
      for (const video of result.attachments.videos) {
        attachments.push({
          name: path.basename(video),
          contentType: 'video/webm',
          path: video,
        });
      }
    }

    // Add traces
    if (result.attachments?.traces) {
      for (const trace of result.attachments.traces) {
        attachments.push({
          name: path.basename(trace),
          contentType: 'application/zip',
          path: trace,
        });
      }
    }

    // Add custom attachments
    if (result.attachments?.custom) {
      for (const custom of result.attachments.custom) {
        if (custom.path) {
          attachments.push({
            name: custom.name,
            contentType: custom.contentType,
            path: custom.path,
          });
        }
      }
    }

    return {
      testId: result.testId,
      title: result.title,
      filePath: result.file,
      status: mapStatus(result),
      durationMs: result.duration,
      retryCount: result.retry,
      errorMessage: result.error?.split('\n')[0], // First line only
      errorStack: result.error,
      stabilityScore: result.stabilityScore?.overall,
      stabilityGrade: result.stabilityScore?.grade,
      flakinessIndicator: result.flakinessIndicator,
      performanceTrend: result.performanceTrend,
      aiSuggestion: result.aiSuggestion,
      tags: result.tags || [],
      attachments,
      steps: (result.steps || []).map((step) => ({
        title: step.title,
        duration: step.duration,
        category: step.category,
      })),
    };
  });
}

/**
 * Uploads artifact files to presigned URLs
 */
async function uploadArtifacts(
  results: CloudTestResult[],
  artifactUrls: Record<string, string>
): Promise<void> {
  for (const result of results) {
    for (const attachment of result.attachments) {
      if (attachment.path && artifactUrls[attachment.path]) {
        const url = artifactUrls[attachment.path];
        const filePath = attachment.path;

        if (fs.existsSync(filePath)) {
          try {
            const fileBuffer = fs.readFileSync(filePath);
            const response = await fetch(url, {
              method: 'PUT',
              body: fileBuffer,
              headers: {
                'Content-Type': attachment.contentType,
              },
            });

            if (!response.ok) {
              console.warn(`Failed to upload artifact ${filePath}: ${response.status}`);
            }
          } catch (err) {
            console.warn(`Failed to upload artifact ${filePath}:`, err);
          }
        }
      }
    }
  }
}

/**
 * Cloud Uploader - Uploads test results to StageWright Cloud
 */
export class CloudUploader {
  private apiKey: string | undefined;
  private projectId: string | undefined;
  private endpoint: string;
  private uploadArtifacts: boolean;
  private enabled: boolean;

  constructor(options: SmartReporterOptions) {
    // Get API key from options or environment
    this.apiKey = options.apiKey || process.env.STAGEWRIGHT_API_KEY;
    this.projectId = options.projectId || process.env.STAGEWRIGHT_PROJECT_ID;
    this.endpoint = options.cloudEndpoint || DEFAULT_ENDPOINT;
    this.uploadArtifacts = options.uploadArtifacts !== false;

    // Enable if API key is present (unless explicitly disabled)
    this.enabled = options.uploadToCloud !== false && !!this.apiKey;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Upload test results to StageWright Cloud
   */
  async upload(
    results: TestResultData[],
    startTime: number
  ): Promise<UploadResult> {
    if (!this.enabled) {
      return { success: false, error: 'Cloud upload not enabled' };
    }

    if (!this.apiKey) {
      return { success: false, error: 'No API key configured' };
    }

    try {
      const ciInfo = detectCIInfo();
      const duration = Date.now() - startTime;

      // Calculate stats using outcome-based counting
      const passed = results.filter(r =>
        r.status === 'passed' ||
        r.outcome === 'expected' ||
        r.outcome === 'flaky'
      ).length;
      const failed = results.filter(r =>
        r.outcome === 'unexpected' &&
        (r.status === 'failed' || r.status === 'timedOut')
      ).length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const flaky = results.filter(r => r.outcome === 'flaky').length;

      // Calculate average stability score
      const stabilityScores = results
        .filter(r => r.stabilityScore?.overall !== undefined)
        .map(r => r.stabilityScore!.overall);
      const avgStability = stabilityScores.length > 0
        ? Math.round(stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length)
        : undefined;

      // Get stability grade from average
      const getGrade = (score: number): string => {
        if (score >= 95) return 'A+';
        if (score >= 90) return 'A';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
      };

      const cloudResults = transformResults(results);

      const payload: CloudRunPayload = {
        totalTests: results.length,
        passed,
        failed,
        skipped,
        flaky,
        durationMs: duration,
        passRate: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
        stabilityScore: avgStability,
        stabilityGrade: avgStability !== undefined ? getGrade(avgStability) : undefined,
        branch: ciInfo?.branch,
        commitSha: ciInfo?.commit,
        ciProvider: ciInfo?.provider,
        ciBuildId: ciInfo?.buildId,
        metadata: {
          nodeVersion: process.version,
          platform: process.platform,
        },
        results: cloudResults,
      };

      // Upload to cloud
      const response = await fetch(`${this.endpoint}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Upload failed: ${response.status} ${errorBody}`,
        };
      }

      const data = await response.json() as UploadResult;

      // Upload artifacts if enabled and URLs provided
      if (this.uploadArtifacts && data.artifactUploadUrls) {
        await uploadArtifacts(cloudResults, data.artifactUploadUrls);
      }

      return {
        success: true,
        runId: data.runId,
        url: data.url,
      };
    } catch (err) {
      return {
        success: false,
        error: `Upload error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
