# Website (web script)

One script tag. It keeps the click ID from Clikgate links in a first-party cookie (`_cg_<param>`, default `_cg_cgid`), and can send goals from the page.

The setup command does websites too: `npx @clikgate/setup website` finds the script tag (or adds it to the layout), detects the site's server (Next.js, Express, Laravel, Django, Spring Boot, ASP.NET Core, WordPress, Shopify themes) and, with its own server, adds the `/cg/keep` route and `data-server-endpoint="/cg/keep"`. Every edit is shown as a diff first. `--website-server <nextjs|express|laravel|django|spring-boot|aspnet-core|wordpress|shopify|none>` skips detection; `--web-key cgw_test_…` sets the key for a new tag. You can also add the tag by hand as below.

## Add the script

Put it in the `<head>` of every page, or in the site's layout template:

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_test_…" async></script>
```

| Attribute | Meaning |
|---|---|
| `data-web-key` | the organisation's **publishable web key** (Settings › Developers › Web keys). Use the **test** web key (`cgw_test_…`) while setting up. The user swaps in the live web key (`cgw_live_…`) for production; don't do it for them. A web key isn't secret and isn't an API key: never put an API key in a page |
| `data-param` | the click-ID query parameter (default `cgid`) |
| `data-days` | cookie lifetime in days (default 30) |
| `data-server-endpoint` | optional: a path on the site's own server (for example `/cg/keep`) that saves the click ID from the server, so Safari and iPhone browsers keep it longer than the 7 days they allow a script |
| `data-consent="required"` | nothing is stored or sent until the page calls `Clikgate.setConsent` and allows attribution |

`data-web-key` is needed only for `Clikgate.goal`. It works only from the organisation's **verified websites** and their subdomains (the test key also from `localhost`, `127.0.0.1` and verified tunnels); other origins get `403 origin_not_allowed`. The old `data-site-key` is no longer used by the web script.

## Use it

```html
<script>
  // after a purchase, on the confirmation page
  Clikgate.goal("order_paid", { value: "1500.50", currency: "NGN", reference: "ORD-1001" });
</script>
```

- `Clikgate.goal(key, {value, currency, reference, provider, isFirst})` returns a promise of `{status, reason}` and never throws. `status` is `Clikgate.GoalStatus.COUNTED`, `WAITING` (a Payment goal waiting for its confirmation) or `REFUSED`; the script also answers `queued` while offline and `not_sent` (with the reason: an invalid key, no `data-web-key` with a console warning once, or no consent). The value is in normal units, as a numeric string. Unsent goals are retried on the next page load.
- **The goal must allow it:** browser goals are accepted only for goals with **"Allow from browser"** switched on in the dashboard (off by default; `403 goal_not_allowed_from_browser` otherwise), and an optional maximum browser value applies (`422 browser_value_too_high`). They are stored and reported as "From browser".
- **Values sent from a browser can be changed by the visitor.** For payments and other goals with a value, send from the server ([server-sdks.md](server-sdks.md)). Ask the user before switching "Allow from browser" on for a goal; never do it for payment goals.
- `Clikgate.clickId()` returns the stored click ID (or `null`). For a goal that completes later, put it in a hidden field of the sign-up form and save it with the order or application. The server then sends it as `click_id`.
- **Payment goals:** call the same `Clikgate.goal(key, { provider: Clikgate.Provider.PAYSTACK, reference })` in the gateway's success callback, never with an amount (a value is ignored). "Allow from browser" isn't needed. `data-clikgate-payments="auto"` detects documented checkout success events instead and sends the default Payment goal; the one line is recommended. The payment counts only once a trusted source confirms it: see [payments.md](payments.md).
- `Clikgate.attachToForms(selector)` adds the click ID to forms. `Clikgate.paymentMetadata()` returns metadata for Paystack, Flutterwave and similar checkouts.
- People: `Clikgate.identifyUser({ label, customerId })` links the visitor's click ID to a label (only when the organisation allows labels from the browser, Settings → People) and, as a hint, your customer ID. Resolves `{status, reason, personId}`; never throws. `goal(key, { label })` takes the same label.
- Share buttons: `Clikgate.share.mount("#share", { link: "https://ciz.to/summer", message, apps })` adds WhatsApp, X, Facebook, Telegram, LinkedIn, Email, Copy link and More buttons for a Clikgate link. Each app's button gets its own version of the link (a short ending so Clikgate knows where it was shared) and the share is recorded with `data-web-key`. Use the link exactly as the user gives it or the API's `share_urls`; never build or guess endings yourself. Style it with the `cg-share` classes.
- Consent: `Clikgate.setConsent({ attribution: "granted" })`, plus `getConsent()` and `setConsentRegion(region)`. Wire these to the site's existing consent banner; don't add a new banner.

The full list is in [api-surface.md](api-surface.md) under "Web script".

## Check

Open a test link (on `dev.ciz.to`) that points to the site. The site must be a verified website or `localhost`, see [test-links.md](test-links.md). Then, in the browser console, `Clikgate.clickId()` should return `clk_…`.
