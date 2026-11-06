import express from 'express';
import { approveApplication, createApplication } from './applications.ts';

const app = express();
app.use(express.json());

// Landing page: visitors arrive here from links in ads and messages.
app.get('/', (_req, res) => {
  res.send('<h1>Get a loan in minutes</h1><form method="post" action="/applications">…</form>');
});

// The visitor applies.
app.post('/applications', (req, res) => {
  const application = createApplication({
    applicantName: String(req.body.name ?? ''),
    applicantEmail: String(req.body.email ?? ''),
    amount: String(req.body.amount ?? '0'),
  });
  res.status(201).json({ id: application.id });
});

// A loan officer approves the application, often days later.
app.post('/applications/:id/approve', (req, res) => {
  const application = approveApplication(req.params.id);
  if (!application) {
    res.sendStatus(404);
    return;
  }
  res.json({ id: application.id, status: application.status });
});

app.listen(Number(process.env.PORT ?? 3000));
