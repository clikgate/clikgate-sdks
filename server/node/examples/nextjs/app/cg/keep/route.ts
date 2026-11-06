// Keep the click ID longer (Safari): the web script's data-server-endpoint="/cg/keep" posts the click ID from the
// page URL here, and this server sets the first-party cookie for 30 days (up to 400). It must be served by the same
// host as the website. Add `<script … data-server-endpoint="/cg/keep">` to the web script tag.
import { clikgate } from '../../../lib/clikgate';

export const POST = clikgate.clickIds.keepRoute({ days: 30 });
