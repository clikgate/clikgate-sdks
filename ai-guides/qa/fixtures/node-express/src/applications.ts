// A tiny in-memory loan application store (a stand-in for the real database).
export interface Application {
  id: string;
  applicantName: string;
  applicantEmail: string;
  amount: string; // naira, e.g. "250000.00"
  status: 'pending' | 'approved' | 'declined';
}

const applications = new Map<string, Application>();
let next = 1;

export function createApplication(input: { applicantName: string; applicantEmail: string; amount: string }): Application {
  const app: Application = { id: `APP-${String(next++).padStart(5, '0')}`, status: 'pending', ...input };
  applications.set(app.id, app);
  return app;
}

export function findApplication(id: string): Application | undefined {
  return applications.get(id);
}

export function approveApplication(id: string): Application | undefined {
  const app = applications.get(id);
  if (app) app.status = 'approved';
  return app;
}
