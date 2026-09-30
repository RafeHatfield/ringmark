// What Google Analytics is allowed to see of a URL. Callers pass only the
// pathname, so query strings are never sent (they carry OAuth authorization
// IDs and search text). Invite tokens are redacted from the path — an invite
// link in a report is an invite anyone can accept.
export function analyticsPath(pathname: string): string {
  return pathname.replace(/^\/invite\/[^/]+/, '/invite/[token]')
}
