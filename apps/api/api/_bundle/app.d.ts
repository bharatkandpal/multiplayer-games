// Types for the generated `app.js` bundle (see ../../scripts/bundle.mjs).
//
// The bundle is build output and is gitignored, so typecheck would have nothing
// to read. This hand-written declaration points back at the real source, which
// means the handler is checked against `@mpg/server`'s actual signatures rather
// than an `any` — change `createServerlessApiApp` and this still breaks loudly.
export { createApiApp, createServerlessApiApp } from "@mpg/server/app";
