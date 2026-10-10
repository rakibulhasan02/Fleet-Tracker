# Fleet Tracker

Node.js + Express + MongoDB fleet management app (deployed on Vercel).

## Environment variables
| Name | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string (required) |
| `JWT_SECRET` | Secret for login tokens (set a long random value in production) |
| `ADMIN_SIGNUP_CODE` | Secret code needed to register an extra Admin |

## Roles
The first account ever registered becomes **Admin**. Driver / Owner / Mechanic sign-ups stay **Pending** until an Admin approves them (Users tab). Accounts created before approvals existed keep working.

| Capability | Admin | Owner | Driver | Mechanic |
|---|:-:|:-:|:-:|:-:|
| Approve / reject registrations, change roles, delete users | ✅ | | | |
| Manage vehicles | all | own | | |
| Assign drivers to vehicles | ✅ | ✅ (own) | | |
| See vehicle status + last location | ✅ | ✅ | own | ✅ |
| Create / cancel trips | ✅ | ✅ (own) | own | |
| Start, complete, delay trips | ✅ | | own | |
| Submit fuel records | ✅ | | ✅ | |
| See fuel costs | ✅ | ✅ | own (read) | |
| Report accident / problem | ✅ | ✅ | ✅ | |
| Check & diagnose problems | ✅ | view | view own | ✅ |
| Repair queue, mark Ready / Under Maintenance | ✅ | | | ✅ |
| Record repairs, replaced parts, update costs | ✅ | | | ✅ (own jobs) |
| See maintenance history & costs | ✅ | ✅ (own vehicles) | no costs | own jobs |
| Fleet reports (date range, CSV, print) | ✅ | ✅ (own) | | |
| Activity log | ✅ | | | |

## Vehicle status flow
`Active (Ready)` → driver reports a problem → `Needs Repair` → mechanic starts work → `In Maintenance` → mechanic marks **Ready** → `Active`.
Trips can only be created/started on vehicles that are Active.
