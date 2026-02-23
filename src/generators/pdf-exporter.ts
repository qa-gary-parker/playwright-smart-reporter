import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { SmartReporterOptions } from '../types';

/**
 * Exports the HTML report as a PDF using Playwright's chromium browser.
 *
 * Playwright-core is loaded via dynamic import to avoid a hard dependency.
 * If playwright-core is not installed or chromium is not available, a warning
 * is logged and null is returned — the reporter will not crash.
 *
 * @param htmlPath - Absolute path to the generated HTML report file
 * @param options - Smart reporter options (unused currently, reserved for future PDF config)
 * @param outputDir - Optional output directory for the PDF. Defaults to the same directory as htmlPath.
 * @returns The absolute path to the generated PDF, or null if generation was skipped/failed
 */
export async function exportPdfReport(
  htmlPath: string,
  options: SmartReporterOptions,
  outputDir?: string,
): Promise<string | null> {
  if (!fs.existsSync(htmlPath)) {
    console.warn('Smart Reporter: HTML report not found. Skipping PDF generation.');
    return null;
  }

  let pw: { chromium: { launch: (opts: { headless: boolean }) => Promise<any> } };
  try {
    pw = await import('playwright-core');
  } catch {
    console.warn('Smart Reporter: PDF export requires playwright-core. Skipping PDF generation.');
    return null;
  }

  const pdfDir = outputDir ?? path.dirname(htmlPath);
  const pdfFilename = path.basename(htmlPath, '.html') + '.pdf';
  const pdfPath = path.resolve(pdfDir, pdfFilename);

  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  let browser: any = null;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
    });
    return pdfPath;
  } catch (err) {
    console.warn('Smart Reporter: PDF generation failed:', err instanceof Error ? err.message : 'Unknown error');
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
