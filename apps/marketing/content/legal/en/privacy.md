---
title: Privacy Policy
version: 1.0
effectiveDate: 2026-08-07
status: draft
---

GenGrowth is an SEO and GEO diagnostic workbench operated at gengrowth.ai and
app.gengrowth.ai. This policy describes what we collect, why, how long we keep
it, and what you can ask us to do about it.

We have written it against what the software actually does. Where a section
names a cookie, a table, or a permission, that is the real one.

## Who we are

GenGrowth ("we", "us") operates this site and the connected product. For any
privacy question, including the requests described under *Your rights*, contact
us at the address in the *Contact* section below.

## What we collect

### 1. When you use a free tool without signing in

Our free tools (SEO audit, internal link audit, and the calculators) do not
require an account.

- **The address you submit.** We fetch public pages at that address and analyse
  the response.
- **Your IP address.** It is used as the key of a rate-limit counter so one
  visitor cannot exhaust the shared crawl budget. The counter is stored in our
  database with the IP address in the key.
- **A short-lived copy of the crawl result**, keyed by the target hostname, so a
  repeated request within the hour does not re-crawl someone else's site. This
  cache expires after **one hour**.

We do not create an account, a profile, or a saved report from an anonymous tool
run.

### 2. When you connect Google Search Console

Two tools (traffic drop diagnosis and quick wins) read your Search Console data.
Connecting asks Google for exactly one permission:

`https://www.googleapis.com/auth/webmasters.readonly`

That scope is **read-only**. We cannot submit sitemaps, request indexing, change
settings, or write anything to your property. We ask for no other sensitive
scope.

The resulting access token is held in an encrypted, HTTP-only cookie in your own
browser and sent back to us only on the API requests that need it. We do not
store your Search Console data in our database for these tools; the analysis
runs and the result is returned to your browser.

### 3. When you sign in

Signing in with Google gives us your **name and email address**, and nothing
else. We use them to identify your account and to contact you about the service.

### 4. When you join the waitlist or subscribe

We store the **email address** you submit, plus the page you submitted it from,
your interface language, and the referral source. If you later complete the
optional profile step, we also store the **name, company, and role** you enter.

### 5. Analytics

We use Google Analytics 4 (measurement ID `G-71TET2Y97Q`) to understand which
pages are read and which tools are used. It sets the `_ga` and `_ga_71TET2Y97Q`
cookies. Google processes this data as an independent controller under its own
terms.

## What we do not do

- We do not sell personal data.
- We do not use your data, your Search Console data, or the sites you audit to
  train machine-learning models.
- We do not ask for write access to any Google product.
- We do not run advertising or cross-site tracking pixels.

## Cookies

See the [Cookie Policy](/cookies) for the full list, including each cookie's
purpose and lifetime.

## How long we keep it

| Data | Retention |
| --- | --- |
| Free-tool crawl cache | 1 hour |
| Rate-limit counters (contain IP) | Until the counting window closes |
| Search Console access token | In your browser cookie only, until it expires |
| Account name and email | Until you delete the account |
| Waitlist email and profile | Until you ask to be removed |
| Analytics | Per Google Analytics 4 defaults |

## Where it is processed

Our database and file storage run on Supabase in the United States
(`us-west-2`). Application hosting is on Vercel; background processing runs on
Railway. If you are in the EEA or the UK, this means your data is transferred to
the United States.

## Your rights

Depending on where you live, you may have the right to access, correct, delete,
or export your personal data, to object to or restrict processing, and to
withdraw consent. You can also disconnect Search Console at any time from your
[Google account permissions page](https://myaccount.google.com/permissions),
which immediately revokes our read access.

To make a request, contact us at the address below. We will respond within the
period required by the applicable law.

## Children

The service is not directed to children and we do not knowingly collect data
from anyone under 16.

## Changes

We will update the version and effective date at the top of this page when this
policy changes. Material changes will be announced before they take effect.

## Contact

Write to us at the address published on our [contact page](/contact).
