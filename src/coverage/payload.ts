import { FlattenMap, encodedMappings } from '@jridgewell/trace-mapping';

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

function isFlatSourceMap(value: unknown): value is RawSourceMap {
  const map = value as RawSourceMap | null;
  return !!map && typeof map === 'object' && map.version === 3 && Array.isArray(map.sources) && typeof map.mappings === 'string';
}

interface IndexSourceMap {
  version: 3;
  file?: string;
  sections: Array<{ offset: { line: number; column: number }; map: unknown }>;
}

export function isIndexSourceMap(value: unknown): value is IndexSourceMap {
  const map = value as IndexSourceMap | null;
  return !!map && typeof map === 'object' && map.version === 3 && Array.isArray(map.sections);
}

function hasValidSections(map: IndexSourceMap): boolean {
  return map.sections.every((section) => {
    const { offset, map: inner } = section ?? {};
    return !!offset && Number.isInteger(offset.line) && Number.isInteger(offset.column)
      && (isFlatSourceMap(inner) || (isIndexSourceMap(inner) && hasValidSections(inner)));
  });
}

// Turbopack and other bundlers emit index maps (top-level `sections`); everything downstream reads flat maps.
export function normalizeSourceMap(value: unknown): RawSourceMap | undefined {
  if (isFlatSourceMap(value)) return value;
  if (!isIndexSourceMap(value) || !hasValidSections(value)) return undefined;
  try {
    const flat = new FlattenMap(value as ConstructorParameters<typeof FlattenMap>[0]);
    return {
      version: 3,
      file: flat.file ?? undefined,
      sources: [...flat.sources],
      sourcesContent: flat.sourcesContent ? [...flat.sourcesContent] : undefined,
      names: [...flat.names],
      mappings: encodedMappings(flat),
    };
  } catch {
    return undefined;
  }
}

export function isSourceMap(value: unknown): boolean {
  return normalizeSourceMap(value) !== undefined;
}

export function isIstanbulFileCoverage(value: unknown): value is IstanbulFileCoverage {
  const fc = value as IstanbulFileCoverage | null;
  return !!fc && typeof fc === 'object' && typeof fc.path === 'string'
    && !!fc.statementMap && !!fc.s && !!fc.fnMap && !!fc.f && !!fc.branchMap && !!fc.b;
}
