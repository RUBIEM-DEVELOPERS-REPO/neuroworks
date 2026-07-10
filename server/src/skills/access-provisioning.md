---
name: access-provisioning
description: Plan least-privilege access provisioning (or deprovisioning) for a role — accounts, groups, systems, approvals, and the revoke plan.
applies_to: [draft-other, plan, access-provisioning]
---

# Skill: Access provisioning plan

## Goal

IT can grant exactly the access a role needs — no more — with an approval trail and a matching revoke plan, so nobody is over-privileged and nothing is orphaned when they leave.

## Structure

```
# Access plan — <Role / Person> · <onboard | role-change | offboard>
**Requested by:** <manager> · **Approver:** <role> · **Effective:** <date>

## Identity
- Account(s) to create: <email / SSO / directory>
- Groups / roles to assign: <group → why this role needs it>

## System access (least privilege)
| System | Access level | Justification | Approver |
|---|---|---|---|
| <CRM> | Read-only | views pipeline | Sales lead |
| <Repo> | Write (team X) | ships code | Eng manager |

## Sensitive / privileged access
- <admin, prod, finance, PII> — extra approval + time-boxed if possible.

## Hardware / endpoints
- <device, MDM enrolment, disk encryption, VPN>

## Verification
- [ ] MFA enforced  [ ] least-privilege confirmed  [ ] access tested by user

## Deprovision plan (for offboarding / on exit)
| System | Action | When | Owner |
|---|---|---|---|
| All SSO | Disable | last day, EOD | IT |
| Data | Transfer ownership to <manager> | before disable | IT |
```

## Rules

- **Least privilege by default.** Start from "no access" and justify each grant — never clone a colleague's full access ("make them like Jane").
- **Every grant has a justification + approver.** Especially privileged/prod/PII/finance.
- **MFA non-negotiable** on every account.
- **Pair provisioning with deprovisioning.** A grant with no revoke owner becomes an orphaned account — the top audit finding.
- **Time-box privileged access** where the platform allows (just-in-time / expiry).
- **Verify, don't assume.** Confirm the user can actually log in and that no extra access leaked in.

## Pitfalls

- "Same as <colleague>" cloning — silently copies over-privilege.
- Standing admin rights that never expire.
- Forgetting non-SSO systems (a SaaS tool outside the directory) at offboarding.
- No data-ownership transfer before disabling an account — work gets locked.
