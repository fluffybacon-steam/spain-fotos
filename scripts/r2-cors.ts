// scripts/r2-cors.ts
/**
 * Applies the CORS rules that browser-side presigned uploads need.
 * Without this every PUT fails the preflight and uploads die silently.
 *
 *   npm run r2:cors -- https://cala.example.com
 *
 * localhost is always included so development keeps working.
 */
import "./load-env";
import { PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET } from "../src/lib/r2";

const origins = ["http://localhost:3000", ...process.argv.slice(2)];

async function main() {
  await r2.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            // The signature covers Content-Type, so the browser must be allowed
            // to send it on the preflighted PUT.
            AllowedHeaders: ["content-type"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );

  const current = await r2.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
  console.log(`CORS applied to ${BUCKET} for:\n  ${origins.join("\n  ")}`);
  console.log(JSON.stringify(current.CORSRules, null, 2));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);

  // Bucket configuration is an admin-scoped operation. The app's own token is
  // deliberately Object Read & Write, which cannot set CORS — so this failure
  // is expected for anyone following least privilege.
  if (/access denied|forbidden|unauthorized/i.test(message)) {
    console.error(`
  Access Denied — your R2 token can read and write objects, but setting a
  bucket's CORS policy needs admin scope.

  Don't widen the app's token. Set the policy in the dashboard instead:

    Cloudflare dashboard → R2 → ${BUCKET} → Settings → CORS Policy → Edit

  Paste this, adding your production domain to AllowedOrigins when you deploy:

${JSON.stringify(
  [
    {
      AllowedOrigins: origins,
      AllowedMethods: ["GET", "PUT", "HEAD"],
      AllowedHeaders: ["content-type"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ],
  null,
  2,
)
  .split("\n")
  .map((l) => "    " + l)
  .join("\n")}

  Alternatively, create a temporary Admin Read & Write token, re-run this
  script with it, then delete the token.
`);
    process.exit(1);
  }

  console.error(message);
  process.exit(1);
});
