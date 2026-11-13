export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes its own bodies (release notes, long URLs) and they break
  // body-max-line-length on every bump; the subject is still conventional.
  ignores: [(message) => /^chore\(deps(-dev)?\): bump /.test(message)],
}
