# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 3.5.x   | ✅ Active support  |
| 3.4.x   | ✅ Security fixes  |
| < 3.4   | ❌ No support      |

## Reporting a Vulnerability

If you discover a security vulnerability in OpenCode JCE, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email:** Send details to [petratech1830@gmail.com](mailto:petratech1830@gmail.com)
2. **Subject:** `[SECURITY] OpenCode JCE — <brief description>`
3. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix timeline** communicated after assessment
- **Credit** in the changelog (unless you prefer anonymity)

### Scope

The following are in scope:
- Command injection vulnerabilities
- Path traversal attacks
- Secrets exposure (API keys, tokens)
- Arbitrary code execution via config files
- Installer security (install.sh, install.ps1)
- MCP server configuration security

The following are out of scope:
- Vulnerabilities in third-party dependencies (report to the dependency maintainer)
- Social engineering attacks
- Denial of service via normal CLI usage

## Security Best Practices

When using OpenCode JCE:
- Keep your installation updated (`opencode-jce update`)
- Never share your `~/.config/opencode/` directory publicly
- Use environment variables for API keys, not config files
- Review community plugins before installing (`opencode-jce plugin install`)
- Run `opencode-jce doctor` periodically to check your setup
