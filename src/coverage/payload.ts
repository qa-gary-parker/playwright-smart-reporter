// Contract between the coverage fixture (test worker) and the coverage collector (reporter).

export const COVERAGE_ATTACHMENT_NAME = 'smart-reporter-coverage';
export const COVERAGE_CONTENT_TYPE = 'application/vnd.smart-reporter.coverage+json';

export interface RawSourceMap {
  version: number;
  sources: Array<string | null>;
  sourcesContent?: Array<string | null>;
  sourceRoot?: string;
  mappings: string;
  names?: string[];
  file?: string;
}

export interface V8ScriptCoverage {
  url: string;
  scriptId?: string;
  source?: string;
  functions: Array<{
    functionName: string;
    isBlockCoverage: boolean;
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>;
  }>;
  // External source map fetched by the fixture; inline maps stay in `source`.
  sourceMap?: RawSourceMap;
  sourceMapUrl?: string;
}

interface Position {
  line: number;
  column: number;
}

export interface Location {
  start: Position;
  end: Position;
}

export interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  fnMap: Record<string, { name: string; decl?: Location; loc: Location }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc?: Location; locations: Location[] }>;
  b: Record<string, number[]>;
}

export interface CoveragePayload {
  version: 1;
  v8?: V8ScriptCoverage[];
  istanbul?: Record<string, IstanbulFileCoverage>;
}

export function isSourceMap(value: unknown): value is RawSourceMap {
  const map = value as RawSourceMap | null;
  return !!map && typeof map === 'object' && map.version === 3 && Array.isArray(map.sources) && typeof map.mappings === 'string';
}

export function isIstanbulFileCoverage(value: unknown): value is IstanbulFileCoverage {
  const fc = value as IstanbulFileCoverage | null;
  return !!fc && typeof fc === 'object' && typeof fc.path === 'string'
    && !!fc.statementMap && !!fc.s && !!fc.fnMap && !!fc.f && !!fc.branchMap && !!fc.b;
}
