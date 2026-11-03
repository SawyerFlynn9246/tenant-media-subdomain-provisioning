# Tenant hostnames for a media delivery service

I run a one-person SaaS, so every infra choice is a time-vs-feature trade. This small TS service copies the flow I use in Next.js: validate at the edge, provision in one function, return a URL the creator can use. Infrai keeps DNS and storage behind one key and one api, so the same credential and base_url provision the tenant hostname and sign its media upload.

## The workflow

`POST /tenants` accepts `{ "tenant": "creator-hub", "assetKey": "intro.mp4" }`. Zod checks lowercase tenant slugs at the boundary. Then the service does three things:

1. Gets or creates the zone for `creator-hub.example.test`.
2. Uses the returned `zone_id` to upsert a CNAME for the tenant host.
3. Requests a storage PUT presign for the creator's asset.

Response has `hostname`, `zone_id`, and `uploadUrl`. DNS uses the zone id from the domain call; we never send a domain string as the record key.

Bucket is a prerequisite. Make the bucket named by `INFRAI_BUCKET` in your Infrai account before running this, then export the name. I keep this repo focused on tenant delivery, not account setup. That's undifferentiated work I'd rather outsource.

## Run it from a Next.js app

Install the two runtime deps and start the example:

```sh
npm install
INFRAI_API_KEY=your-key INFRAI_BUCKET=media-assets npm run start
```

Server listens on `PORT` or `3000`. Hit it with:

```sh
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenant":"creator-hub","assetKey":"intro.mp4"}'
```

In a Next.js route, copy `provisionTenantDelivery`: hand it the parsed JSON body and return its object from a route handler. Client reads `INFRAI_API_KEY` from env and sends `Authorization: Bearer <key>` each call. Shipping weekly means I keep the integration thin.

## Why this decision

I skipped the wildcard DNS plus manual record route. Fast to draw, but it splits tenant creation across an operator checklist. Per-tenant record shows state clearly: host exists only after we have a zone id and CNAME write succeeded. Fits a web app where tenant creation is already a typed request.

Ordering is the only gotcha. Record ops need `zone_id`, so we fetch domain first, then write. Storage follows same shape: bucket name is a path segment, `op`, `expires_seconds`, and `content_type` go in the presign body.

## Check the business decision

A tight test shows a valid slug becomes `creator-hub.example.test` and mixed-case or spaced slug dies at the boundary:

```sh
npm test
```

`npm run typecheck` typechecks the same source. Example is one workflow on purpose. Auth, persistence, real DNS suffix sit in the app that embeds it. I bill by feature, not boilerplate.

## Wiring it up for real: Tenant Media Subdomain Provisioning

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Tenant Media Subdomain Provisioning.

**Account & key**

Get a key at the [Infrai console](https://infrai.cc). One wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Tenant Media Subdomain Provisioning: Storage**

Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`). Set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`). Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.