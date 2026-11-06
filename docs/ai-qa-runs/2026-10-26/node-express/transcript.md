# Transcript: node-express

Model: claude-opus-5-5 · Claude Code 2.1.310 · skills: clikgate-setup, deep-research, design, slides, design-sync, dataviz, artifact-diagramming, artifact-capabilities, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, schedule, claude-api, workflow-authoring, run, run-skill-generator, plugin-authoring

**Tool Skill:** `{"skill":"clikgate-setup","args":"Express backend: web script on landing page `/`, server SDK goal `loan_approved` with NGN amount on POST /applications/:id/approve. API key in CLIKGATE_API_KEY. Unattended; show changes then apply; run npm run typecheck."}`

<details><summary>result</summary>

```
Launching skill: clikgate-setup
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; find . -path ./node_modules -prune -o -type f -print | grep -v '^./.claude/skills' | head -50; cat package.json; S=.claude/skills/clikgate-setup/references; cat $S/server-sdks.md $S/goals.md $S/web.md $S/api-surface.md","de`

<details><summary>result</summary>

```
A variable in this command can't be checked before it runs
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; find . -path ./node_modules -prune -o -path ./.claude/skills -prune -o -type f -print | head -50; cat package.json; cd .claude/skills/clikgate-setup/references; cat server-sdks.md goals.md web.md api-surface.md","descriptio`

<details><summary>result</summary>

```
./README.md
./package-lock.json
./package.json
./tsconfig.json
./src/applications.ts
./src/server.ts
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

## Procedure

1. Read the project: the framework, where visitors land, where the business record is created (sign-up, application, order), and where the goal happens (approval, payment).
2. **Show the plan before changing anything:** the package to install, each file you'll change, and the code you'll add. Then wait for a yes. If the user approved in advance, still show the plan first, then go on.
3. Install the package, then make the edits:
   - capture the click ID on landing;
   - save it with the business record;
   - send the goal where it happens.
4. Run the project's typecheck or tests. Then tell the user:
   - to define the goal in the dashboard (Settings › Goals) if it isn't there yet;
   - to set `CLIKGATE_API_KEY` (a `cg_test_` key while testing).

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

export function onAccountApproved(application: { id: string; clickId: string | null }): v
```
</details>

**Tool Bash:** `{"command":"cd $QA_OUT/runs/node-express/project; cat -n src/server.ts; cat -n src/applications.ts; cat README.md tsconfig.json; ls -a","description":"Read project source files"}`

<details><summary>result</summary>

```
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
# loans-api (QA fixture)

A minimal Express 5 loan-application API used by `ai-guides/qa/run.sh` to check that an AI assistant can add `@clikgate/node` from the guide: keep the click ID on landing, save it with the application, and send `loan_approved` on approval.
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
.
..
.claude
README.md
node_modules
package-lock.json
package.json
src
tsconfig.json
```
</details>

**Assistant:**

Here's the plan. The project is a single Express 5 backend: `src/server.ts` has the routes and `src/applications.ts` is the in-memory store. The landing page is served by this same Express app, so the server SDK's Express middleware can capture the click ID. You don't need the browser script, and you haven't given me a `cg_site_test_` key for it anyway.

**1. Install:** `npm install @clikgate/node` (adds `"@clikgate/node": "^1.0.0"` to `package.json`)

**2. `src/applications.ts`**: store the click ID with the application:
```diff
   amount: string; // naira, e.g. "250000.00"
+  clickId: string | null; // Clikgate click ID captured when the visitor landed
   status: 'pending' | 'approved' | 'declined';
 }
...
-export function createApplication(input: { applicantName: string; applicantEmail: string; amount: string }): Application {
+export function createApplication(input: { applicantName: string; applicantEmail: string; amount: string; clickId: string | null }): Application {
```

**3. `src/server.ts`**: middleware, save the click ID, send the goal:
```diff
 import express from 'express';
+import { Clikgate } from '@clikgate/node';
+import { clikgateMiddleware } from '@clikgate/node/express';
 import { approveApplication, createApplication } from './applications.ts';
 
+const clikgate = new Clikgate(); // reads CLIKGATE_API_KEY
+
 const app = express();
 app.use(express.json());
+app.use(clikgateMiddleware(clikgate)); // keeps ?cgid=… in the _cg_cgid cookie
 ...
     amount: String(req.body.amount ?? '0'),
+    clickId: req.clikgate.clickId,
   });
 ...
     return;
   }
+  clikgate.goal('loan_approved', {
+    clickId: application.clickId,
+    reference: application.id, // our application number, never customer data
+    value: application.amount, // naira as a decimal string, never kobo or a float
+    currency: 'NGN',
+  });
   res.json({ id: application.id, status: application.status });
```

**4. New `.env.example`:** `CLIKGATE_API_KEY=` (no value)

You approved these changes in advance, so I'm applying them now.

**Tool Bash:** `{"command":"npm install @clikgate/node 2>&1 | tail -5 && grep clikgate package.json","description":"Install the Clikgate Node SDK"}`

<details><summary>result</summary>

```
29 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
    "@clikgate/node": "file:../../.pkgs/clikgate-node-1.0.0.tgz",
```
</details>

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/applications.ts","old_string":"  amount: string; // naira, e.g. \"250000.00\"\n","new_string":"  amount: string; // naira, e.g. \"250000.00\"\n  clickId: string | null; // Clikgate click ID captured wh`

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

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/server.ts","old_string":"import express from 'express';\nimport { approveApplication, createApplication } from './applications.ts';\n\nconst app = express();\napp.use(express.json());\n","new_string":"`

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

**Tool Edit:** `{"replace_all":false,"file_path":"$QA_OUT/runs/node-express/project/src/server.ts","old_string":"    return;\n  }\n  res.json","new_string":"    return;\n  }\n  clikgate.goal('loan_approved', {\n    clickId: application.clickId,\n    reference: application.id, // our appli`

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

**Tool Bash:** `{"command":"npm run typecheck","description":"Run TypeScript typecheck"}`

<details><summary>result</summary>

```
> loans-api@0.1.0 typecheck
> tsc --noEmit
```
</details>

**Assistant:**

Clikgate is added to the Express backend, and `npm run typecheck` (`tsc --noEmit`) passed with no errors. I didn't start the server or send a real goal to Clikgate.

**How it works now:**
1. **Landing on `/`:** a middleware reads the `?cgid=…` click ID from the Clikgate link and keeps it in a first-party cookie.
2. **POST /applications:** the click ID from that cookie is saved with the application in `src/applications.ts`. It's `null` if the visitor didn't come from a Clikgate link.
3. **POST /applications/:id/approve:** the server sends the `loan_approved` goal with:
   - the saved click ID;
   - the application number (e.g. `APP-00001`) as the reference;
   - the approved amount in naira as a decimal string (e.g. `"250000.00"`), never kobo or a float;
   - currency `NGN`.

   No names, emails or other customer data are sent. Because the application number is the reference, approving the same application twice is only counted once. The goal is sent in the background, so the approve response doesn't wait for it.

**Files changed:** `package.json` and `package-lock.json` (new `@clikgate/node` dependency), `src/applications.ts`, `src/server.ts`, and a new `.env.example` containing only `CLIKGATE_API_KEY=`. No key is in the code.

**Things to check:**
- **Package source:** `npm install @clikgate/node` put a local file in `package.json`: `"@clikgate/node": "file:../../.pkgs/clikgate-node-1.0.0.tgz"`, not `^1.0.0` from npm. Your npm setup in this environment resolved it that way. Change it to `^1.0.0` if this project will be built anywhere else.
- **Web script:** I didn't add Clikgate's browser script, because the server already captures the click ID. It would only be needed for sending goals from the browser, and that needs a `cg_site_test_…` site key.

**What you need to do:**
1. Create the `loan_approved` goal in the dashboard (Settings › Goals) if it isn't there yet. Goals that aren't defined are rejected.
2. Set `CLIKGATE_API_KEY` to your `cg_test_…` key while testing. Switch to the `cg_live_…` key only in production, and never commit either key.

## Final message

Clikgate is added to the Express backend, and `npm run typecheck` (`tsc --noEmit`) passed with no errors. I didn't start the server or send a real goal to Clikgate.

**How it works now:**
1. **Landing on `/`:** a middleware reads the `?cgid=…` click ID from the Clikgate link and keeps it in a first-party cookie.
2. **POST /applications:** the click ID from that cookie is saved with the application in `src/applications.ts`. It's `null` if the visitor didn't come from a Clikgate link.
3. **POST /applications/:id/approve:** the server sends the `loan_approved` goal with:
   - the saved click ID;
   - the application number (e.g. `APP-00001`) as the reference;
   - the approved amount in naira as a decimal string (e.g. `"250000.00"`), never kobo or a float;
   - currency `NGN`.

   No names, emails or other customer data are sent. Because the application number is the reference, approving the same application twice is only counted once. The goal is sent in the background, so the approve response doesn't wait for it.

**Files changed:** `package.json` and `package-lock.json` (new `@clikgate/node` dependency), `src/applications.ts`, `src/server.ts`, and a new `.env.example` containing only `CLIKGATE_API_KEY=`. No key is in the code.

**Things to check:**
- **Package source:** `npm install @clikgate/node` put a local file in `package.json`: `"@clikgate/node": "file:../../.pkgs/clikgate-node-1.0.0.tgz"`, not `^1.0.0` from npm. Your npm setup in this environment resolved it that way. Change it to `^1.0.0` if this project will be built anywhere else.
- **Web script:** I didn't add Clikgate's browser script, because the server already captures the click ID. It would only be needed for sending goals from the browser, and that needs a `cg_site_test_…` site key.

**What you need to do:**
1. Create the `loan_approved` goal in the dashboard (Settings › Goals) if it isn't there yet. Goals that aren't defined are rejected.
2. Set `CLIKGATE_API_KEY` to your `cg_test_…` key while testing. Switch to the `cg_live_…` key only in production, and never commit either key.
