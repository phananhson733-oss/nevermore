---
title: Privacy Policy
version: 1.2
effectiveDate: 2026-08-12
status: published
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

### 1. When you run the SEO Agent

The SEO Agent requires a verified GenGrowth account. Signing in
with Google creates that account using the identity information described in
section 3. It does not grant us Gmail mailbox, Search Console, or site-ownership
access. Some calculators that do not run a website crawl remain available
without an account.

- **The address you submit.** We fetch same-origin public static HTML at that
  address and analyse the response.
- **Your IP address.** It is used as the key of a rate-limit counter so one
  visitor cannot exhaust the shared crawl budget. The counter is stored in our
  database with the IP address in the key.
- **A short-lived copy of the crawl result**, keyed by the target hostname, so a
  repeated request within the hour does not re-crawl someone else's site. This
  cache expires after **one hour**.

The verified account exists before the Agent runs. The marketing-site run does
not create a saved app project or persisted report.

### 2. When you connect Google Search Console

Two tools (traffic drop diagnosis and quick wins) read your Search Console data.
Connecting asks Google for exactly one permission:

`https://www.googleapis.com/auth/webmasters.readonly`

That scope is **read-only**. We cannot submit sitemaps, request indexing, change
settings, or write anything to your property. We ask for no other sensitive
scope.

The resulting access token, and the refresh token that renews it, are held in an
encrypted, HTTP-only cookie in your own browser and sent back to us only on the
API requests that need it. Keeping the refresh token is what lets a return visit
skip the consent screen; it stays in that cookie for 30 days, extended each time
you use it, up to 90 days from the day you authorised. We hold no copy on our
servers. We do not store your Search Console data in our database for these
tools; the analysis runs and the result is returned to your browser.

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
| Agent crawl cache | 1 hour |
| Rate-limit counters (contain IP) | Until the counting window closes |
| Search Console access and refresh tokens | In your browser cookie only; 30 days, extended on use, up to 90 days from authorisation |
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
withdraw consent. You can disconnect Search Console at any time from the
**Disconnect** control on either connected tool page, which clears the cookie
and revokes our read access at Google in one step; signing out does the same.
You can also do it from your
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
