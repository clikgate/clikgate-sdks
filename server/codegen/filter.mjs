// Shared by every language: reduce openapi.json to the operations an API key can call, give them
// stable names, and down-convert the OpenAPI 3.1 constructs the backend uses to 3.0 (OpenAPI
// Generator's mature path; its 3.1 support is beta). Pure function; no I/O.

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * The backend marks every operation with `x-clikgate-auth`: `api_key`, `dashboard_session`, `staff`,
 * `public`, `sdk_key` or `cli`. The server SDKs expose the `api_key` ones only.
 */
export const AUTH_EXTENSION = 'x-clikgate-auth';
export function apiKeyCallable(op) {
  return op?.[AUTH_EXTENSION] === 'api_key';
}

/**
 * Change 21 (R.41): every backend route declares an audience (`x-audience`: `public`, `sdk`, `dashboard`, `partner`,
 * `webhook`, `staff`, `internal`). The server SDKs are generated from `public` only: `sdk` routes (the mobile and web
 * SDK protocol) are published in `openapi-public.json` but never in the server SDKs. Once a document declares
 * audiences, an operation without one is hidden (the backend treats it so too).
 */
export const AUDIENCE_EXTENSION = 'x-audience';
export const SERVER_SDK_AUDIENCE = 'public';
/** Audiences that must never appear in the file the generator reads (`openapi-public.json` has `public` + `sdk`). */
export const NEVER_PUBLISHED_AUDIENCES = ['staff', 'internal', 'webhook'];
/** Paths no server SDK method may call, whatever the document says. */
export const NEVER_GENERATED_PATHS = [/^\/v1\/staff(\/|$)/, /^\/internal(\/|$)/, /^\/v1\/sdk(\/|$)/];

const operationsOf = (source) =>
  Object.entries(source.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((m) => item?.[m] && typeof item[m] === 'object').map((m) => [m, path, item[m]]),
  );

/** True when any operation carries `x-audience` (the backend's `openapi-public.json` from Change 21 on). */
export function declaresAudiences(source) {
  return operationsOf(source).some(([, , op]) => op[AUDIENCE_EXTENSION] !== undefined);
}

/** `METHOD /path` of every operation whose audience must never reach the generator's input. */
export function neverPublishedOperations(source) {
  return operationsOf(source)
    .filter(([, , op]) => NEVER_PUBLISHED_AUDIENCES.includes(op[AUDIENCE_EXTENSION]))
    .map(([m, path, op]) => `${m.toUpperCase()} ${path} (${AUDIENCE_EXTENSION} ${op[AUDIENCE_EXTENSION]})`);
}

/** Why an operation is left out of the server SDKs, or null when it is generated. */
export function skipReason(path, op, audiences) {
  if (audiences && op[AUDIENCE_EXTENSION] !== SERVER_SDK_AUDIENCE) return `${AUDIENCE_EXTENSION} "${op[AUDIENCE_EXTENSION] ?? 'missing'}"`;
  if (!apiKeyCallable(op)) return `${AUTH_EXTENSION} "${op[AUTH_EXTENSION] ?? 'missing'}"`;
  // Last, so the report's reasons stay as they were; catches a mislabelled operation
  if (NEVER_GENERATED_PATHS.some((re) => re.test(path))) return 'never generated (staff, internal or SDK protocol path)';
  return null;
}

export const camel = (s) =>
  s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');

/** Resource property name of a tag in each language. */
export const resourceName = (tag) => camel(tag.replace(/\bSKAN\b/, 'Skan').replace(/\bSDK\b/, 'Sdk'));

const isNull = (s) => s && typeof s === 'object' && s.type === 'null' && Object.keys(s).length <= 2;

/** Down-convert one schema (recursively) from 3.1 to 3.0. */
export function downconvert(schema) {
  if (Array.isArray(schema)) return schema.map(downconvert);
  if (!schema || typeof schema !== 'object') return schema;
  let s = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'examples' || k === '$schema' || k === 'contentMediaType' || k === 'contentEncoding') continue;
    if (k === 'const') {
      s.enum = [v];
      continue;
    }
    s[k] = ['properties', 'patternProperties', '$defs', 'definitions'].includes(k)
      ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, downconvert(pv)]))
      : downconvert(v);
  }
  if (typeof s.exclusiveMinimum === 'number') {
    s.minimum = s.exclusiveMinimum;
    s.exclusiveMinimum = true;
  }
  if (typeof s.exclusiveMaximum === 'number') {
    s.maximum = s.exclusiveMaximum;
    s.exclusiveMaximum = true;
  }
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== 'null');
    if (types.length !== s.type.length) s.nullable = true;
    if (types.length === 1) s.type = types[0];
    else {
      const { type, ...rest } = s;
      s = { ...rest, anyOf: types.map((t) => ({ type: t })) };
    }
  }
  for (const key of ['anyOf', 'oneOf']) {
    if (!Array.isArray(s[key])) continue;
    const members = s[key].filter((m) => !isNull(m));
    if (members.length === s[key].length) continue;
    const { [key]: _drop, ...rest } = s;
    if (members.length === 0) s = { ...rest, nullable: true };
    else if (members.length === 1) {
      const only = members[0];
      s = only.$ref ? { ...rest, allOf: [only], nullable: true } : { ...rest, ...only, nullable: true };
    } else s = { ...rest, [key]: members, nullable: true };
  }
  return s;
}

function collectRefs(node, out) {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/')) out.add(v.slice('#/components/schemas/'.length));
      else collectRefs(v, out);
    }
  }
}

const JSON_TYPES = ['application/json'];

/**
 * Operations that filter by link metadata: `?metadata[seller_id]=sel_ada`. The backend reads these from the raw
 * query string (`metadata_filters` in clikgate_api src/links/routers/link_routers.py, used by `analytics_filters`),
 * so `openapi.json` doesn't declare them. We add one `metadata` map parameter (deepObject) so every SDK's typed
 * method takes it; each transport sends a map value as `key[sub]=value` (SPEC section 21).
 */
export const METADATA_FILTER_OPERATIONS = [
  'GET /v1/links',
  'GET /v1/analytics/summary',
  'GET /v1/analytics/timeseries',
  'GET /v1/analytics/top-links',
  'GET /v1/analytics/open-in-app',
];
const METADATA_FILTER_PARAM = {
  name: 'metadata',
  in: 'query',
  required: false,
  style: 'deepObject',
  explode: true,
  description: 'Only links whose metadata has these values, e.g. { seller_id: "sel_ada" } (sent as metadata[seller_id]=sel_ada).',
  schema: { type: 'object', additionalProperties: { type: 'string' } },
};

const ID_PREFIX = { link: 'lnk', click: 'clk', campaign: 'cmp', conversion: 'cnv', domain: 'dom', app: 'app', event: 'evt', endpoint: 'whe', job: 'job', report: 'rpt', install: 'ins', organization: 'org', goal: 'gol', funnel: 'fnl', code: 'cod', app_banner: 'jrn', alert: 'alt', rule: 'rul' };

function placeholder(param) {
  const n = param.name;
  const m = /^(.*)_id$/.exec(n);
  if (m) {
    const last = m[1].split('_').pop();
    return ID_PREFIX[last] ? `'${ID_PREFIX[last]}_…'` : `'<${n}>'`;
  }
  return `'<${n}>'`;
}

/**
 * Filter the spec to the operations a server SDK calls: `x-audience: public` (when the document declares audiences)
 * and `x-clikgate-auth: api_key`, never a staff, internal or SDK protocol path.
 * Returns { spec, report } where report lists what was skipped and why.
 */
// Change 12 (S.4): the published SDK packages carry no internal planning references. The backend's descriptions
// sometimes cite its internal plans ("Change 12, B.1: …", "(Part 2, 23)", "X.E10"); the SDK copies drop them.
const REF = String.raw`(?:[Cc]hange \d{2}|Part \d, (?:section )?\d+(?:\.\d+)*|Spec \d+(?:\.\d+)+|X\.[A-Z]\d+|growth \d+[A-Z]?)`;
const LEADING_REF = new RegExp(
  String.raw`(^|[.!?]\s+)(?:${REF}(?:,? (?:[A-Z]{1,2}\.?[\dA-Za-z.]*|route [A-D])(?: \/ [A-Z]{1,2}\.[\dA-Za-z.]+)?)?(?: \([^()]*\))?)(?:[;,] ${REF}(?:,? [A-Z]{1,2}\.[\dA-Za-z.]+)?)*[:;,]\s+(\S)`,
  'gm',
);
const PAREN_REF = new RegExp(String.raw`\s*\((?=[^()]*\b${REF})[^()]*\)`, 'g');
const ANY_REF = new RegExp(String.raw`\b${REF}`);

/** @internal Remove internal plan references from one description; sentences that still cite one are dropped. */
export function scrubDescription(text) {
  if (typeof text !== 'string' || !ANY_REF.test(text)) return text;
  let out = text.replace(PAREN_REF, '');
  // a sentence that starts with a reference ("Change 12, B.1: the goal's kind …") keeps its text
  out = out.replace(LEADING_REF, (_m, before, first) => `${before}${first.toUpperCase()}`);
  if (ANY_REF.test(out)) {
    // a reference inside a sentence: drop that sentence (keep the others)
    out = out
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !ANY_REF.test(sentence))
      .join(' ');
  }
  return out.replace(/[ \t]+$/gm, '').trim();
}

function scrubDescriptions(node) {
  if (Array.isArray(node)) {
    node.forEach(scrubDescriptions);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'description' && typeof v === 'string') node[k] = scrubDescription(v);
    else scrubDescriptions(v);
  }
}

export function filterSpec(source) {
  const report = { included: 0, skipped: [] };
  const paths = {};
  const usedNames = new Map(); // tag -> Set(names)
  const audiences = declaresAudiences(source);
  report.audiences = audiences;
  const pathKeys = Object.keys(source.paths).sort();
  for (const path of pathKeys) {
    const item = source.paths[path];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const key = `${method.toUpperCase()} ${path}`;
      const why = skipReason(path, op, audiences);
      if (why) {
        report.skipped.push(`${key}: ${why}`);
        continue;
      }
      const body = op.requestBody?.content;
      if (body && !Object.keys(body).some((t) => JSON_TYPES.includes(t))) {
        report.skipped.push(`${key}: non-JSON request body (${Object.keys(body).join(', ')})`);
        continue;
      }
      const tag = (op.tags && op.tags[0]) || 'Default';
      const names = usedNames.get(tag) ?? new Set();
      usedNames.set(tag, names);
      let name = camel(op.summary || op.operationId);
      for (let i = 2; names.has(name); i++) name = `${camel(op.summary || op.operationId)}${i}`;
      names.add(name);

      let successCodes = Object.keys(op.responses || {}).filter((c) => /^2\d\d$/.test(c)).sort();
      // a 2xx without a body (e.g. "200: already received") next to one with a schema: keep the schema'd one
      const withSchema = successCodes.filter((c) => op.responses[c].content?.['application/json']?.schema);
      if (withSchema.length) successCodes = withSchema;
      const responses = {};
      let binary = false;
      for (const code of successCodes) {
        const r = op.responses[code];
        const content = r.content || {};
        if (content['application/json']?.schema) responses[code] = { description: r.description || 'OK', content: { 'application/json': { schema: downconvert(content['application/json'].schema) } } };
        else {
          if (Object.keys(content).some((t) => !JSON_TYPES.includes(t))) binary = true;
          responses[code] = { description: r.description || 'OK' };
        }
      }
      if (successCodes.length === 0) responses.default = { description: 'OK' };

      const params = (op.parameters || []).filter((p) => p.in === 'path' || p.in === 'query').map((p) => ({ ...p, schema: downconvert(p.schema || { type: 'string' }) }));
      if (METADATA_FILTER_OPERATIONS.includes(key) && !params.some((p) => p.name === 'metadata')) params.push(METADATA_FILTER_PARAM);
      const resource = resourceName(tag);
      const args = [...params.filter((p) => p.in === 'path').map(placeholder), ...(op.requestBody ? ['{ … }'] : [])];
      const out = {
        tags: [tag],
        summary: op.summary,
        description: op.description,
        operationId: name,
        parameters: params,
        responses,
        'x-cg-resource': resource,
        'x-cg-path': path,
        'x-cg-path-js': path.replace(/\{([^}]+)\}/g, (_m, n) => '${encodePathSegment(' + camel(n) + ')}'),
        'x-cg-example': `await clikgate.api.${resource}.${name}(${args.join(', ')});`,
      };
      if (binary) out['x-cg-binary'] = true;
      if (op.requestBody) {
        out.requestBody = { required: op.requestBody.required ?? false, content: { 'application/json': { schema: downconvert(op.requestBody.content['application/json'].schema) } } };
      }
      paths[path] = paths[path] || {};
      paths[path][method] = out;
      report.included += 1;
    }
  }

  // keep only reachable schemas
  const schemas = source.components?.schemas || {};
  const keep = new Set();
  const queue = new Set();
  collectRefs(paths, queue);
  while (queue.size) {
    const [n] = queue;
    queue.delete(n);
    if (keep.has(n) || !schemas[n]) continue;
    keep.add(n);
    const refs = new Set();
    collectRefs(schemas[n], refs);
    refs.forEach((r) => !keep.has(r) && queue.add(r));
  }
  const components = { schemas: Object.fromEntries([...keep].sort().map((n) => [n, downconvert(schemas[n])])) };
  report.schemas = keep.size;
  scrubDescriptions(paths);
  scrubDescriptions(components);
  const spec = {
    openapi: '3.0.3',
    info: { title: source.info?.title || 'Clikgate API', version: source.info?.version || '1.0.0', description: 'Filtered for the server SDKs by server/codegen/filter.mjs. Do not edit.' },
    servers: [{ url: 'https://api.clikgate.com' }],
    paths,
    components,
  };
  return { spec, report };
}
