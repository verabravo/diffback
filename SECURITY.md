# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by opening a private security advisory on GitHub:

https://github.com/verabravo/diffback/security/advisories/new

Please do not report security vulnerabilities through public GitHub issues.

## Scope

diffback runs locally on your machine and serves a web UI on localhost. It does not:
- Send any data to external servers
- Accept connections from outside localhost
- Store credentials or sensitive information

The review state is stored as a JSON file in the reviewed project directory.
