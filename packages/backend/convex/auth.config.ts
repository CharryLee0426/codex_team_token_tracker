/**
 * Clerk → Convex auth. Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard
 * (e.g. https://your-app.clerk.accounts.dev) and create a Clerk JWT template named "convex"
 * with these custom claims:
 *   { "org_id": "{{org.id}}", "org_role": "{{org.role}}", "org_slug": "{{org.slug}}", "org_name": "{{org.name}}",
 *     "email": "{{user.primary_email_address}}", "name": "{{user.full_name}}", "picture": "{{user.image_url}}" }
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
