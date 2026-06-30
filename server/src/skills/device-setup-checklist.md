---
name: device-setup-checklist
description: Build a repeatable device setup / provisioning checklist — hardware, OS baseline, security, apps, accounts, and a verification + handover step.
applies_to: [draft-other, checklist, device-setup]
---

# Skill: Device setup checklist

## Goal

Any IT staffer can take a new machine from box to ready-for-work the same way every time — secure, compliant, and verified — and the user signs that it works.

## Structure

```
# Device setup — <device type> · <role / user>
Asset tag: <___> · Serial: <___> · Assigned to: <user> · Date: <___>

## 1. Hardware
- [ ] Inspect, asset-tag, record serial
- [ ] Peripherals (charger, dock, monitor, keyboard)

## 2. OS baseline
- [ ] Latest OS + all updates
- [ ] Enrol in MDM / device management
- [ ] Naming convention applied

## 3. Security (mandatory)
- [ ] Full-disk encryption on (BitLocker/FileVault)
- [ ] Endpoint protection / AV installed + reporting
- [ ] Firewall on · auto-lock ≤5 min · strong local password
- [ ] MFA configured for SSO

## 4. Accounts & access
- [ ] SSO / email signed in (see access-provisioning plan)
- [ ] VPN profile installed + tested
- [ ] Least-privilege confirmed (no local admin unless approved)

## 5. Apps
- [ ] Standard app set (browser, comms, office, role-specific)
- [ ] Auto-update enabled

## 6. Verify & hand over
- [ ] User logs in, opens email + a role app, prints/test as needed
- [ ] Backup / sync confirmed working
- [ ] User acknowledges receipt + acceptable-use policy
```

## Rules

- **Security steps are non-optional** and come before handover — encryption, endpoint protection, MFA, auto-lock.
- **Checkbox format** so it's auditable — who set it up, when, what passed.
- **Verify with the actual user**, not just the imager — "it boots" ≠ "they can work".
- **Record asset tag + serial + assignee** so the device is tracked for its whole life (and recoverable at offboarding).
- **Reference the access-provisioning plan** for accounts rather than duplicating it.

## Pitfalls

- Shipping a device without disk encryption or endpoint protection.
- Granting local admin "to save time" — becomes permanent.
- No asset record — untracked devices can't be recovered or wiped.
- Skipping the user-verification + acknowledgement step.
