import * as fs from 'fs';
import * as path from 'path';
import type { TestResultData, QuarantineConfig, QuarantineFile, QuarantineEntry } from '../types';

export class QuarantineGenerator {
  private config: Required<Pick<QuarantineConfig, 'threshold' | 'maxQuarantined' | 'outputFile'>>;

  constructor(config: QuarantineConfig) {
    this.config = {
      threshold: config.threshold ?? 0.3,
      maxQuarantined: config.maxQuarantined ?? 50,
      outputFile: config.outputFile ?? '.smart-quarantine.json',
    };
  }

  generate(results: TestResultData[], outputDir: string): QuarantineFile | null {
    const now = new Date().toISOString();

    const entries: QuarantineEntry[] = results
      .filter(r => r.outcome !== 'skipped')
      .filter(r => r.flakinessScore !== undefined && r.flakinessScore >= this.config.threshold)
      .sort((a, b) => b.flakinessScore! - a.flakinessScore!)
      .slice(0, this.config.maxQuarantined)
      .map(r => ({
        testId: r.testId,
        title: r.title,
        file: r.file,
        flakinessScore: r.flakinessScore!,
        quarantinedAt: now,
      }));

    if (entries.length === 0) {
      return null;
    }

    const quarantineFile: QuarantineFile = {
      generatedAt: now,
      threshold: this.config.threshold,
      entries,
    };

    const filePath = path.resolve(outputDir, this.config.outputFile);
    fs.writeFileSync(filePath, JSON.stringify(quarantineFile, null, 2));

    return quarantineFile;
  }

  getOutputPath(outputDir: string): string {
    return path.resolve(outputDir, this.config.outputFile);
  }
}
