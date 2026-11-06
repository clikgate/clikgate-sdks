// Judges one conformance case: the requests the mock recorded plus the outcome the runner reported.
// Zero dependencies; used by server.mjs. Matcher rules are documented in ../README.md ("Matchers").

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UA = /^clikgate-(node|python|php|java|dotnet)\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?) \(([a-z]+) ([0-9][0-9A-Za-z.+-]{0,39}); ([^ ]+) ([^)]+)\)( .*)?$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 300 ? `${s.slice(0, 300)}…` : s;
};

function isMatcher(expected) {
  return isObject(expected) && Object.keys(expected).length >= 1 && Object.keys(expected).every((k) => k.startsWith('$'));
}

/**
 * match(expected, actual, {exact}) → list of failure strings (empty = match).
 * exact=false: objects are subsets (extra actual keys allowed). exact=true: no extra keys.
 * Arrays always need the same length. Matchers: $any, $absent, $regex, $uuid4, $one_of, $len.
 */
export function match(expected, actual, { exact = false, path = '$' } = {}) {
  if (isMatcher(expected)) {
    if ('$any' in expected) return actual === undefined ? [`${path}: expected a value, got nothing`] : [];
    if ('$absent' in expected) return actual === undefined ? [] : [`${path}: expected absent, got ${show(actual)}`];
    if ('$regex' in expected) {
      return typeof actual === 'string' && new RegExp(expected.$regex).test(actual)
        ? []
        : [`${path}: expected string matching /${expected.$regex}/, got ${show(actual)}`];
    }
    if ('$uuid4' in expected) return typeof actual === 'string' && UUID4.test(actual) ? [] : [`${path}: expected a UUID v4, got ${show(actual)}`];
    if ('$one_of' in expected) {
      return expected.$one_of.some((e) => match(e, actual, { exact }).length === 0) ? [] : [`${path}: ${show(actual)} matches none of ${show(expected.$one_of)}`];
    }
    if ('$len' in expected) {
      const n = Array.isArray(actual) || typeof actual === 'string' ? actual.length : -1;
      return n === expected.$len ? [] : [`${path}: expected length ${expected.$len}, got ${n}`];
    }
    return [`${path}: unknown matcher ${show(expected)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array, got ${show(actual)}`];
    if (expected.length !== actual.length) return [`${path}: expected ${expected.length} items, got ${actual.length}: ${show(actual)}`];
    return expected.flatMap((e, i) => match(e, actual[i], { exact, path: `${path}[${i}]` }));
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return [`${path}: expected object, got ${show(actual)}`];
    const failures = [];
    for (const [k, e] of Object.entries(expected)) failures.push(...match(e, actual[k], { exact, path: `${path}.${k}` }));
    if (exact) {
      for (const k of Object.keys(actual)) if (!(k in expected) && actual[k] !== undefined) failures.push(`${path}.${k}: unexpected key (value ${show(actual[k])})`);
    }
    return failures;
  }
  // primitives (numbers compare by value: 1 === 1.0)
  return expected === actual ? [] : [`${path}: expected ${show(expected)}, got ${show(actual)}`];
}

function checkDefaultHeaders(req, i, kase, language) {
  const f = [];
  const h = req.headers;
  const p = `request[${i}] ${req.method} ${req.path}`;
  const key = kase.client.api_key;
  if (h.authorization !== `Bearer ${key}`) f.push(`${p}: authorization must be "Bearer <api_key>", got ${show(h.authorization)}`);
  const ua = UA.exec(h['user-agent'] || '');
  if (!ua) f.push(`${p}: user-agent ${show(h['user-agent'])} doesn't match SPEC section 4`);
  else if (language && ua[1] !== language) f.push(`${p}: user-agent sdk token is ${ua[1]}, runner says ${language}`);
  else if (ua[3] !== ua[1]) f.push(`${p}: user-agent runtime token must be ${ua[1]}, got ${ua[3]}`);
  if (h.accept !== 'application/json') f.push(`${p}: accept must be application/json, got ${show(h.accept)}`);
  if (req.body_text.length > 0 && !/^application\/json\b/.test(h['content-type'] || '')) f.push(`${p}: content-type must be application/json with a body, got ${show(h['content-type'])}`);
  if (req.method === 'POST' || req.method === 'PATCH') {
    if (!h['idempotency-key']) f.push(`${p}: POST/PATCH must send Idempotency-Key`);
  } else if (h['idempotency-key'] !== undefined) f.push(`${p}: ${req.method} must not send Idempotency-Key`);
  return f;
}

function checkRequest(exp, req, i, all) {
  const f = [];
  const p = `request[${i}]`;
  if (exp.method && exp.method !== req.method) f.push(`${p}: expected method ${exp.method}, got ${req.method}`);
  if (exp.path && exp.path !== req.path) f.push(`${p}: expected path ${exp.path}, got ${req.path}`);
  if (exp.query !== undefined) f.push(...match(exp.query, req.query, { exact: true, path: `${p}.query` }));
  if (exp.headers) {
    for (const [name, e] of Object.entries(exp.headers)) f.push(...match(e, req.headers[name.toLowerCase()], { path: `${p}.headers.${name.toLowerCase()}` }));
  }
  for (const name of exp.absent_headers || []) if (req.headers[name.toLowerCase()] !== undefined) f.push(`${p}: header ${name} must be absent`);
  if (exp.idempotency_key_same_as !== undefined) {
    const other = all[exp.idempotency_key_same_as];
    if (!other || other.headers['idempotency-key'] !== req.headers['idempotency-key']) {
      f.push(`${p}: Idempotency-Key must equal request[${exp.idempotency_key_same_as}]'s (${show(other && other.headers['idempotency-key'])}), got ${show(req.headers['idempotency-key'])}`);
    }
  }
  if (exp.idempotency_key_differs_from !== undefined) {
    const other = all[exp.idempotency_key_differs_from];
    if (other && other.headers['idempotency-key'] === req.headers['idempotency-key']) f.push(`${p}: Idempotency-Key must differ from request[${exp.idempotency_key_differs_from}]'s`);
  }
  if (exp.json !== undefined || exp.json_subset !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(req.body_text);
    } catch {
      f.push(`${p}: body is not JSON: ${show(req.body_text)}`);
      return f;
    }
    if (exp.json !== undefined) f.push(...match(exp.json, parsed, { exact: true, path: `${p}.json` }));
    if (exp.json_subset !== undefined) f.push(...match(exp.json_subset, parsed, { path: `${p}.json` }));
  }
  if (exp.no_body && req.body_text.length > 0) f.push(`${p}: expected no body, got ${show(req.body_text)}`);
  return f;
}

function checkError(exp, actual, path) {
  if (!actual) return [`${path}: expected error ${exp.class}, got a result`];
  const f = [];
  for (const [k, v] of Object.entries(exp)) {
    if (k === 'message_excludes') {
      for (const s of v) if (String(actual.message || '').includes(s)) f.push(`${path}.message must not contain ${show(s)}`);
    } else if (k === 'message') {
      f.push(...match(v, actual.message, { path: `${path}.message` }));
    } else {
      f.push(...match(v, actual[k] === undefined ? null : actual[k], { path: `${path}.${k}` }));
    }
  }
  return f;
}

/** Judge a finished case. Returns a list of failure strings. */
export function judge(kase, recorded, outcome) {
  const f = [];
  const language = outcome.language;
  const exp = kase.expect || {};

  // construction
  if (exp.construct_error) {
    if (!outcome.construct_error) f.push('expected the client constructor to throw');
    else f.push(...checkError(exp.construct_error, outcome.construct_error, 'construct_error'));
  } else if (outcome.construct_error) {
    f.push(`client constructor threw unexpectedly: ${show(outcome.construct_error)}`);
  }

  // steps
  if (!exp.construct_error) {
    const steps = outcome.steps || [];
    if (steps.length !== kase.steps.length) f.push(`runner reported ${steps.length} step outcomes for ${kase.steps.length} steps`);
    kase.steps.forEach((step, i) => {
      const got = steps[i] || {};
      const p = `step[${i}] ${step.call}`;
      const e = step.expect || {};
      if (e.error) f.push(...checkError(e.error, got.error, `${p}.error`));
      else if (got.error) f.push(`${p}: unexpected error ${show(got.error)}`);
      else if (e.result !== undefined) f.push(...match(e.result, got.result, { exact: !!e.exact, path: `${p}.result` }));
    });
  }

  // requests
  const expectedRequests = exp.requests || [];
  if (recorded.length !== expectedRequests.length) {
    f.push(`expected ${expectedRequests.length} HTTP requests, the mock received ${recorded.length}: ${recorded.map((r) => `${r.method} ${r.raw_path}`).join(', ') || '(none)'}`);
  }
  recorded.forEach((req, i) => {
    if (!kase.skip_default_header_checks) f.push(...checkDefaultHeaders(req, i, kase, language));
    if (expectedRequests[i]) f.push(...checkRequest(expectedRequests[i], req, i, recorded));
  });

  if (exp.sleeps_ms !== undefined) f.push(...match(exp.sleeps_ms, outcome.sleeps_ms || [], { path: 'sleeps_ms' }));
  if (exp.warnings !== undefined) {
    const got = [...(outcome.warnings || [])].sort();
    const want = [...exp.warnings].sort();
    f.push(...match(want, got, { path: 'warnings (sorted)' }));
  }
  if (exp.on_error !== undefined) {
    const got = outcome.on_error || [];
    if (got.length !== exp.on_error.length) f.push(`expected ${exp.on_error.length} on_error calls, got ${got.length}: ${show(got)}`);
    exp.on_error.forEach((e, i) => {
      if (got[i]) f.push(...checkError(e, got[i], `on_error[${i}]`));
    });
  }
  if (exp.logs_exclude) {
    const haystack = [JSON.stringify(outcome.logs || []), JSON.stringify(outcome.on_error || [])].join('\n');
    for (const s of exp.logs_exclude) if (haystack.includes(s)) f.push(`logs or on_error contain ${show(s)}, which must never be logged`);
  }
  return f;
}
