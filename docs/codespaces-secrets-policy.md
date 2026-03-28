# Codespaces And Codex Secrets Policy

## Allowed in secrets managers

These may be stored in GitHub Codespaces secrets, Vercel secrets, Railway variables, or other approved secret managers:

- Supplier login usernames
- Supplier API tokens
- Supplier webhook secrets
- Marketplace API credentials
- Database and queue credentials

## Forbidden everywhere in the repo and Codespaces prompts

Never place the following in repo files, environment files, prompts, scripts, or Codex messages:

- Full payment card numbers
- Payment card expiry values
- Payment security codes
- Full bank account numbers
- Raw payment instrument exports from supplier sites

## Payment handling rule

- Supplier payment methods must be configured directly on the supplier’s official site by an authorized operator.
- Codespaces and Codex are for operational configuration only, not payment instrument entry.
- When documenting payment setup, record only a non-sensitive descriptor such as `corporate virtual card label` or `PayPal Business`.
