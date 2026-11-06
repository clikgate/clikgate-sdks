# Transcript: node-express

Model: claude-opus-5-5 · Claude Code 2.1.310 · skills: clikgate-setup, deep-research, design, slides, design-sync, dataviz, artifact-diagramming, artifact-capabilities, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, schedule, claude-api, workflow-authoring, run, run-skill-generator, plugin-authoring

**Tool Skill:** `{"skill":"clikgate-setup"}`

<details><summary>result</summary>

```
Launching skill: clikgate-setup
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; S=.claude/skills/clikgate-setup/references; cat $S/server-sdks.md $S/goals.md $S/api-surface.md; echo ====; ls -la; cat package.json tsconfig.json 2>/dev/null; find . -path ./node_modules -prune -o -path ./.claude -prune -o`

<details><summary>result</summary>

```
A variable in this command can't be checked before it runs
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; cat .claude/skills/clikgate-setup/references/server-sdks.md .claude/skills/clikgate-setup/references/goals.md .claude/skills/clikgate-setup/references/api-surface.md; echo ====; ls -la; cat package.json tsconfig.json; find `

<details><summary>result</summary>

```
# Server SDKs

Use a server SDK to send goals that happen on the backend (an account approved, a loan disbursed, an order paid), keep the click ID, verify Clikgate webhooks and manage links.

| Language | Package | Status |
|---|---|---|
| Node.js / TypeScript (Node 18+) | `@clikgate/node` 1.0.0 | **available**: `npm install @clikgate/node` |
| Python | `clikgate` | **not available yet**: use the HTTP API below |
| PHP / Laravel | `clikgate/clikgate-php`, `clikgate/clikgate-laravel` | **not available yet**: use the HTTP API below |
| Java / Kotlin / Spring Boot | `com.clikgate:clikgate-java` | **not available yet**: use the HTTP API below |
| C# / .NET | `Clikgate` | **not available yet**: use the HTTP API below |

Don't add a dependency on a package marked "not available yet": it isn't published. Tell the user it is coming, and use the HTTP API.

## Keys

- The server uses an **API key**: `cg_test_…` while testing, `cg_live_…` in production. Read it from the `CLIKGATE_API_KEY` environment variable. Never put it in source code, committed config, the app or the browser.
- Add `CLIKGATE_API_KEY=` to the project's `.env.example` (no value), and tell the user to set the real value themselves.
- Mobile SDK keys (`cg_sdk_…`) and web site keys (`cg_site_…`) don't work on the server.

## Node.js (`@clikgate/node`)

```sh
npm install @clikgate/node
```

Create one client and reuse it. `goal()` never throws: it queues the event and sends it in the background, in batches, with safe retries. `goals.send()` waits and returns the result.

```ts clikgate-check
import { Clikgate } from '@clikgate/node';

const clikgate = new Clikgate(); // reads CLIKGATE_API_KEY

export function onAccountApproved(application: { id: string; clickId: string | null }): void {
  clikgate.goal('account_opened', {
    clickId: application.clickId,
    reference: application.id, // your own reference, never customer data
    value: '2000000',          // normal units, as a string
    currency: 'NGN',
  });
}
```

### Keep the click ID (capture → save → send later)

The pattern: capture the click ID when the visitor lands, save it with the business's own record, and send the goal later from any job.

- **Express:**

  ```ts
  import { clikgateMiddleware } from '@clikgate/node/express';
  app.use(clikgateMiddleware(clikgate));      // keeps ?cgid=… in the _cg_cgid cookie
  // in a handler: req.clikgate.clickId
  ```

- **Fastify:** `await app.register(clikgatePlugin, { client: clikgate })` from `@clikgate/node/fastify`, then `request.clikgate.clickId`.
- **Next.js 16+:** in `proxy.ts`, `export { clikgateProxy as proxy } from '@clikgate/node/next'`. Then read it in a route or server component with `getClickId(await cookies())`. On Next.js 15 and older, the file is `middleware.ts`, with `export { clikgateMiddleware as middleware } from '@clikgate/node/next'`.
- **Without a framework:** `clikgate.clickIds.fromRequest(req)` and `clikgate.clickIds.persist(res, clickId)`.
- **From payment webh
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; ls -la; cat package.json tsconfig.json; find . -path ./node_modules -prune -o -path ./.claude -prune -o -type f -print"}`

<details><summary>result</summary>

```
total 96
drwxr-xr-x@  9 user  wheel    288 Oct 26 12:12 .
drwxr-xr-x@  8 user  wheel    256 Oct 26 12:12 ..
drwxr-xr-x@  3 user  wheel     96 Oct 26 12:12 .claude
-rw-r--r--@  1 user  wheel    266 Oct 26 12:12 README.md
drwxr-xr-x@ 72 user  wheel   2304 Oct 26 12:12 node_modules
-rw-r--r--@  1 user  wheel  34604 Oct 26 12:12 package-lock.json
-rw-r--r--@  1 user  wheel    364 Oct 26 12:12 package.json
drwxr-xr-x@  4 user  wheel    128 Oct 26 12:12 src
-rw-r--r--@  1 user  wheel    244 Oct 26 12:12 tsconfig.json
{
  "name": "loans-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "start": "node --experimental-strip-types src/server.ts"
  },
  "dependencies": {
    "express": "5.3.0"
  },
  "devDependencies": {
    "@types/express": "5.0.6",
    "@types/node": "22.20.5",
    "typescript": "6.0.3"
  }
}
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
./README.md
./package-lock.json
./package.json
./tsconfig.json
./src/applications.ts
./src/server.ts
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; cat -n README.md src/server.ts src/applications.ts; ls node_modules/@clikgate 2>&1"}`

<details><summary>result</summary>

```
Exit code 1
     1	# loans-api (QA fixture)
     2	
     3	A minimal Express 5 loan-application API used by `ai-guides/qa/run.sh` to check that an AI assistant can add `@clikgate/node` from the guide: keep the click ID on landing, save it with the application, and send `loan_approved` on approval.
     1	import express from 'express';
     2	import { approveApplication, createApplication } from './applications.ts';
     3	
     4	const app = express();
     5	app.use(express.json());
     6	
     7	// Landing page: visitors arrive here from links in ads and messages.
     8	app.get('/', (_req, res) => {
     9	  res.send('<h1>Get a loan in minutes</h1><form method="post" action="/applications">…</form>');
    10	});
    11	
    12	// The visitor applies.
    13	app.post('/applications', (req, res) => {
    14	  const application = createApplication({
    15	    applicantName: String(req.body.name ?? ''),
    16	    applicantEmail: String(req.body.email ?? ''),
    17	    amount: String(req.body.amount ?? '0'),
    18	  });
    19	  res.status(201).json({ id: application.id });
    20	});
    21	
    22	// A loan officer approves the application, often days later.
    23	app.post('/applications/:id/approve', (req, res) => {
    24	  const application = approveApplication(req.params.id);
    25	  if (!application) {
    26	    res.sendStatus(404);
    27	    return;
    28	  }
    29	  res.json({ id: application.id, status: application.status });
    30	});
    31	
    32	app.listen(Number(process.env.PORT ?? 3000));
     1	// A tiny in-memory loan application store (a stand-in for the real database).
     2	export interface Application {
     3	  id: string;
     4	  applicantName: string;
     5	  applicantEmail: string;
     6	  amount: string; // naira, e.g. "250000.00"
     7	  status: 'pending' | 'approved' | 'declined';
     8	}
     9	
    10	const applications = new Map<string, Application>();
    11	let next = 1;
    12	
    13	export function createApplication(input: { applicantName: string; applicantEmail: string; amount: string }): Application {
    14	  const app: Application = { id: `APP-${String(next++).padStart(5, '0')}`, status: 'pending', ...input };
    15	  applications.set(app.id, app);
    16	  return app;
    17	}
    18	
    19	export function findApplication(id: string): Application | undefined {
    20	  return applications.get(id);
    21	}
    22	
    23	export function approveApplication(id: string): Application | undefined {
    24	  const app = applications.get(id);
    25	  if (app) app.status = 'approved';
    26	  return app;
    27	}
ls: node_modules/@clikgate: No such file or directory
```
</details>

**Tool Bash:** `{"command":"npm install @clikgate/node 2>&1 | tail -5 && grep clikgate package.json"}`

<details><summary>result</summary>

```
29 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
    "@clikgate/node": "file:../../.pkgs/clikgate-node-1.0.0.tgz",
```
</details>

**Assistant:**

npm resolved the package to a local tarball (`file:../../.pkgs/clikgate-node-1.0.0.tgz`), probably because of this environment's npm config. I'll mention that at the end. Now the code edits:

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/applications.ts","old_string":"  status: 'pending' | 'approved' | 'declined';\n}","new_string":"  status: 'pending' | 'approved' | 'declined';\n  clickId: string | null; // Clikgate click ID captured w`

<details><summary>result</summary>

```
The file $QA_OUT/runs/node-express/project/src/applications.ts has been updated successfully.
```
</details>

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/applications.ts","old_string":"amount: string }): Application {","new_string":"amount: string; clickId: string | null }): Application {"}`

<details><summary>result</summary>

```
The file $QA_OUT/runs/node-express/project/src/applications.ts has been updated successfully.
```
</details>

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/server.ts","old_string":"import express from 'express';\nimport { approveApplication, createApplication } from './applications.ts';\n\nconst app = express();\napp.use(express.json());","new_string":"im`

<details><summary>result</summary>

```
The file $QA_OUT/runs/node-express/project/src/server.ts has been updated successfully.
```
</details>

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/server.ts","old_string":"    amount: String(req.body.amount ?? '0'),\n  });","new_string":"    amount: String(req.body.amount ?? '0'),\n    clickId: req.clikgate.clickId,\n  });"}`

<details><summary>result</summary>

```
The file $QA_OUT/runs/node-express/project/src/server.ts has been updated successfully.
```
</details>

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/server.ts","old_string":"    return;\n  }\n  res.json(","new_string":"    return;\n  }\n  clikgate.goal('loan_approved', {\n    clickId: application.clickId,\n    reference: application.id, // the appl`

<details><summary>result</summary>

```
The file $QA_OUT/runs/node-express/project/src/server.ts has been updated successfully.
```
</details>

**Tool Write:** `{"file_path":"$QA_OUT/runs/node-express/project/.env.example","content":"CLIKGATE_API_KEY=\n"}`

<details><summary>result</summary>

```
File created successfully at: $QA_OUT/runs/node-express/project/.env.example (file state is current in your context — no need to Read it back)
```
</details>

**Tool Bash:** `{"command":"npm run typecheck"}`

<details><summary>result</summary>

```
> loans-api@0.1.0 typecheck
> tsc --noEmit
```
</details>

**Assistant:**

Clikgate is now in the backend: visitors' click IDs are kept when they land, saved with each application, and approving an application sends the `loan_approved` goal with the amount in NGN. `npm run typecheck` passed with no errors. I didn't run the server or send a test goal.

**What changed:**
- **`package.json`:** added `@clikgate/node`. npm installed it from a local file (`file:../../.pkgs/clikgate-node-1.0.0.tgz`) instead of the public npm registry, probably because of this environment's npm settings. Check that this entry is what you want before committing.
- **`src/server.ts`:**
  - creates one Clikgate client, which reads `CLIKGATE_API_KEY` from the environment;
  - adds a step for every request that saves `?cgid=…` from the visitor's Clikgate link in a cookie, so `/` keeps the click ID;
  - `POST /applications` saves that click ID with the application;
  - `POST /applications/:id/approve` sends `loan_approved` with the click ID, the application number (`APP-00001`) as the reference, and the amount as an exact naira string in `NGN`. No name or email is sent.
- **`src/applications.ts`:** `Application` has a new `clickId: string | null` field.
- **`.env.example`:** new file containing just `CLIKGATE_API_KEY=` with no value. No key is written anywhere in the code.

**Before it works:**
- **Create the goal:** define `loan_approved` in the Clikgate dashboard (Settings › Goals). Goals that don't exist there are rejected.
- **Set the key:** put your `cg_test_…` key in `CLIKGATE_API_KEY` when you run the server. For production, use the `cg_live_…` key there instead.

**Limitations:**
- **Repeat approvals:** approving the same application again sends the goal again. Clikgate ignores a repeat with the same goal and reference, so it won't count twice.
- **Amount isn't checked:** a value like `"abc"` is stored as given and the goal will then be rejected. It's worth validating the amount in `POST /applications`.

## Final message

Clikgate is now in the backend: visitors' click IDs are kept when they land, saved with each application, and approving an application sends the `loan_approved` goal with the amount in NGN. `npm run typecheck` passed with no errors. I didn't run the server or send a test goal.

**What changed:**
- **`package.json`:** added `@clikgate/node`. npm installed it from a local file (`file:../../.pkgs/clikgate-node-1.0.0.tgz`) instead of the public npm registry, probably because of this environment's npm settings. Check that this entry is what you want before committing.
- **`src/server.ts`:**
  - creates one Clikgate client, which reads `CLIKGATE_API_KEY` from the environment;
  - adds a step for every request that saves `?cgid=…` from the visitor's Clikgate link in a cookie, so `/` keeps the click ID;
  - `POST /applications` saves that click ID with the application;
  - `POST /applications/:id/approve` sends `loan_approved` with the click ID, the application number (`APP-00001`) as the reference, and the amount as an exact naira string in `NGN`. No name or email is sent.
- **`src/applications.ts`:** `Application` has a new `clickId: string | null` field.
- **`.env.example`:** new file containing just `CLIKGATE_API_KEY=` with no value. No key is written anywhere in the code.

**Before it works:**
- **Create the goal:** define `loan_approved` in the Clikgate dashboard (Settings › Goals). Goals that don't exist there are rejected.
- **Set the key:** put your `cg_test_…` key in `CLIKGATE_API_KEY` when you run the server. For production, use the `cg_live_…` key there instead.

**Limitations:**
- **Repeat approvals:** approving the same application again sends the goal again. Clikgate ignores a repeat with the same goal and reference, so it won't count twice.
- **Amount isn't checked:** a value like `"abc"` is stored as given and the goal will then be rejected. It's worth validating the amount in `POST /applications`.
