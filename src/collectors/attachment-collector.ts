import * as fs from 'fs';
import * as path from 'path';
import type { TestResult } from '@playwright/test/reporter';
import type { AttachmentData, CustomAttachment } from '../types';

export interface AttachmentCollectorOptions {
  cspSafe?: boolean;           // If true, save screenshots as files instead of base64
  outputDir?: string;          // Directory to save screenshot files (required if cspSafe)
}

/**
 * Collects and processes test attachments (screenshots, videos, traces)
 */
export class AttachmentCollector {
  private options: AttachmentCollectorOptions;
  private screenshotCounter: number = 0;

  constructor(options: AttachmentCollectorOptions = {}) {
    this.options = {
      cspSafe: false,
      ...options,
    };
  }

  /**
   * Ensure the output directory exists
   */
  private ensureOutputDir(): string {
    if (!this.options.outputDir) {
      throw new Error('outputDir is required when cspSafe is enabled');
    }
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
    return this.options.outputDir;
  }

  /**
   * Save a screenshot to file and return relative path
   * Screenshots are saved directly in the output directory (same as HTML) for Jenkins compatibility
   */
  private saveScreenshotToFile(buffer: Buffer, contentType: string): string {
    const outputDir = this.ensureOutputDir();
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `screenshot-${++this.screenshotCounter}.${ext}`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, buffer);
    // Return just the filename (same directory as HTML)
    return filename;
  }

  /**
   * Collect all attachments from a test result
   * @param result - Playwright TestResult
   * @returns Attachment data with base64 screenshots (or file paths if cspSafe) and file paths
   */
  collectAttachments(result: TestResult): AttachmentData {
    const attachments: AttachmentData = {
      screenshots: [],
      videos: [],
      traces: [],
      custom: [],  // Issue #15: Support custom attachments
    };

    // Standard Playwright attachment names to exclude from custom collection
    const standardNames = new Set(['screenshot', 'video', 'trace']);

    // Collect screenshots (both standard and custom image attachments)
    const screenshots = result.attachments.filter(
      a => (a.name === 'screenshot' || a.contentType.startsWith('image/'))
    );

    for (const screenshot of screenshots) {
      if (screenshot.body) {
        if (this.options.cspSafe) {
          // Save to file instead of base64
          const relativePath = this.saveScreenshotToFile(screenshot.body, screenshot.contentType);
          attachments.screenshots.push(relativePath);
        } else {
          const dataUri = `data:${screenshot.contentType};base64,${screenshot.body.toString('base64')}`;
          attachments.screenshots.push(dataUri);
        }
      } else if (screenshot.path) {
        try {
          const imgBuffer = fs.readFileSync(screenshot.path);
          if (this.options.cspSafe) {
            // Save to file instead of base64
            const relativePath = this.saveScreenshotToFile(imgBuffer, screenshot.contentType);
            attachments.screenshots.push(relativePath);
          } else {
            const dataUri = `data:${screenshot.contentType};base64,${imgBuffer.toString('base64')}`;
            attachments.screenshots.push(dataUri);
          }
        } catch (err) {
          console.warn(`Failed to read screenshot: ${screenshot.path}`, err);
        }
      }
    }

    // Collect videos
    const videos = result.attachments.filter(
      a => a.name === 'video' && a.contentType.startsWith('video/')
    );

    for (const video of videos) {
      if (video.path) {
        attachments.videos.push(video.path);
      }
    }

    // Collect traces (NEW for PR #2)
    const traces = result.attachments.filter(
      a => a.name === 'trace' && a.path
    );

    for (const trace of traces) {
      if (trace.path) {
        attachments.traces.push(trace.path);
      }
    }

    // Issue #15: Collect custom attachments (non-standard attachments from testInfo.attach())
    const customAttachments = result.attachments.filter(
      a => !standardNames.has(a.name) && !a.contentType.startsWith('image/')
    );

    for (const custom of customAttachments) {
      const customData: CustomAttachment = {
        name: custom.name,
        contentType: custom.contentType,
      };

      if (custom.path) {
        customData.path = custom.path;
      } else if (custom.body) {
        // Convert body to base64 for inline display
        customData.body = custom.body.toString('base64');
      }

      attachments.custom.push(customData);
    }

    return attachments;
  }

  /**
   * Get the first screenshot (for backwards compatibility)
   * @param attachments - Attachment data
   * @returns First screenshot data URI or undefined
   */
  getFirstScreenshot(attachments: AttachmentData): string | undefined {
    return attachments.screenshots[0];
  }

  /**
   * Get the first video path (for backwards compatibility)
   * @param attachments - Attachment data
   * @returns First video path or undefined
   */
  getFirstVideo(attachments: AttachmentData): string | undefined {
    return attachments.videos[0];
  }

  /**
   * Check if test has any attachments
   * @param attachments - Attachment data
   * @returns True if any attachments exist
   */
  hasAttachments(attachments: AttachmentData): boolean {
    return attachments.screenshots.length > 0 ||
           attachments.videos.length > 0 ||
           attachments.traces.length > 0 ||
           attachments.custom.length > 0;
  }
}
