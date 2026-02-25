import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { NetworkLogEntry, NetworkLogData } from '../types';

export interface NetworkCollectorOptions {
  /** Filter URLs - only include URLs containing this string */
  urlFilter?: string;
  /** Filter by content types (e.g., ['application/json', 'text/html']) */
  contentTypeFilter?: string[];
  /** Exclude static assets (images, fonts, css, js) */
  excludeStaticAssets?: boolean;
  /** Maximum number of entries to include per test */
  maxEntries?: number;
  /** Include request/response headers */
  includeHeaders?: boolean;
  /** Include request/response bodies (when available) */
  includeBodies?: boolean;
}

const STATIC_ASSET_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i,
  /\.(css|scss|less)$/i,
  /\.(js|mjs|ts|tsx|jsx)$/i,
  /\.(woff|woff2|ttf|eot|otf)$/i,
  /\.(mp4|webm|ogg|mp3|wav)$/i,
];

const STATIC_CONTENT_TYPES = [
  'image/',
  'font/',
  'text/css',
  'application/javascript',
  'text/javascript',
];

/**
 * Collects network logs from Playwright trace files
 */
export class NetworkCollector {
  private options: NetworkCollectorOptions;

  constructor(options: NetworkCollectorOptions = {}) {
    this.options = {
      excludeStaticAssets: true,
      maxEntries: 50,
      includeHeaders: false,
      includeBodies: true,
      ...options,
    };
  }

  /**
   * Extract network logs from a trace zip file
   */
  async collectFromTrace(tracePath: string): Promise<NetworkLogData> {
    const result: NetworkLogData = {
      entries: [],
      totalRequests: 0,
      totalDuration: 0,
      summary: {
        byStatus: {},
        byMethod: {},
        slowest: null,
        errors: [],
      },
    };

    if (!tracePath || !fs.existsSync(tracePath)) {
      return result;
    }

    try {
      const zip = new AdmZip(tracePath);
      const networkEntry = zip.getEntry('0-trace.network');

      if (!networkEntry) {
        return result;
      }

      const networkData = networkEntry.getData().toString('utf8');
      const lines = networkData.trim().split('\n');

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'resource-snapshot' && parsed.snapshot) {
            const entry = this.parseNetworkEntry(parsed.snapshot);
            if (entry && this.shouldInclude(entry)) {
              result.entries.push(entry);
              result.totalRequests++;
              result.totalDuration += entry.duration;

              // Update summary
              const statusGroup = Math.floor(entry.status / 100) * 100;
              result.summary.byStatus[statusGroup] = (result.summary.byStatus[statusGroup] || 0) + 1;
              result.summary.byMethod[entry.method] = (result.summary.byMethod[entry.method] || 0) + 1;

              if (!result.summary.slowest || entry.duration > result.summary.slowest.duration) {
                result.summary.slowest = entry;
              }

              if (entry.status >= 400) {
                result.summary.errors.push(entry);
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      // Sort by timestamp and limit entries
      result.entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      if (this.options.maxEntries && result.entries.length > this.options.maxEntries) {
        result.entries = result.entries.slice(0, this.options.maxEntries);
      }

    } catch (err) {
      console.warn(`Failed to parse trace file: ${tracePath}`, err);
    }

    return result;
  }

  /**
   * Parse a single network entry from trace data
   */
  private parseNetworkEntry(snapshot: any): NetworkLogEntry | null {
    if (!snapshot.request || !snapshot.response) {
      return null;
    }

    const { request, response, time, timings } = snapshot;

    // Extract URL path for cleaner display
    let urlPath: string;
    try {
      const url = new URL(request.url);
      urlPath = url.pathname + url.search;
    } catch {
      urlPath = request.url;
    }

    const entry: NetworkLogEntry = {
      method: request.method,
      url: request.url,
      urlPath,
      status: response.status,
      statusText: response.statusText || this.getStatusText(response.status),
      duration: Math.round(time || 0),
      timestamp: snapshot.startedDateTime,
      contentType: this.getContentType(response),
      requestSize: request.bodySize || 0,
      responseSize: response.bodySize || response.content?.size || 0,
      timings: timings ? {
        dns: Math.round(timings.dns || 0),
        connect: Math.round(timings.connect || 0),
        ssl: Math.round(timings.ssl || 0),
        wait: Math.round(timings.wait || 0),
        receive: Math.round(timings.receive || 0),
      } : undefined,
    };

    // Include headers if requested
    if (this.options.includeHeaders) {
      entry.requestHeaders = this.headersToObject(request.headers);
      entry.responseHeaders = this.headersToObject(response.headers);
    }

    // Include bodies if requested and available
    if (this.options.includeBodies) {
      if (request.postData) {
        entry.requestBody = this.tryParseJson(request.postData);
      }
      // Note: Response bodies are stored in trace resources, not directly in network log
    }

    return entry;
  }

  /**
   * Check if entry should be included based on filters
   */
  private shouldInclude(entry: NetworkLogEntry): boolean {
    // URL filter
    if (this.options.urlFilter && !entry.url.includes(this.options.urlFilter)) {
      return false;
    }

    // Content type filter
    if (this.options.contentTypeFilter?.length) {
      const matches = this.options.contentTypeFilter.some(ct =>
        entry.contentType?.toLowerCase().includes(ct.toLowerCase())
      );
      if (!matches) return false;
    }

    // Exclude static assets
    if (this.options.excludeStaticAssets) {
      // Check URL patterns
      if (STATIC_ASSET_PATTERNS.some(pattern => pattern.test(entry.url))) {
        return false;
      }
      // Check content type
      if (entry.contentType && STATIC_CONTENT_TYPES.some(ct => entry.contentType!.startsWith(ct))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Convert headers array to object
   */
  private headersToObject(headers: Array<{ name: string; value: string }> | undefined): Record<string, string> | undefined {
    if (!headers) return undefined;
    const result: Record<string, string> = {};
    for (const h of headers) {
      // Skip pseudo-headers
      if (!h.name.startsWith(':')) {
        result[h.name.toLowerCase()] = h.value;
      }
    }
    return result;
  }

  /**
   * Get content type from response
   */
  private getContentType(response: any): string | undefined {
    if (response.content?.mimeType) {
      return response.content.mimeType;
    }
    const contentTypeHeader = response.headers?.find(
      (h: any) => h.name.toLowerCase() === 'content-type'
    );
    return contentTypeHeader?.value;
  }

  /**
   * Try to parse JSON, return original string if fails
   */
  private tryParseJson(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Get status text for common HTTP status codes
   */
  private getStatusText(status: number): string {
    const statusTexts: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return statusTexts[status] || '';
  }
}
