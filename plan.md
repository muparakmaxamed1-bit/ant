# ANTI-THEFT EVIDENCE PLATFORM
## Complete Project Development Plan
### Supabase Edition

---

# 1. PROJECT OVERVIEW

Build a professional, secure, responsive web-based Anti-Theft Evidence Platform designed to help authorized device owners organize digital evidence related to suspected theft incidents.

The platform will allow administrators to create unique evidence links, record visits, review technical information, collect consent-based evidence, manage cases, and generate structured PDF reports for law enforcement.

The system must distinguish verified information from estimated information.

All sensitive browser features, including GPS, camera, and microphone, must require explicit user permission and transparent disclosure.

The application must not contain hidden recording, covert tracking, permission bypasses, or unauthorized collection of private files.

# 2. PROJECT GOALS

The primary objectives are:

- Create and manage investigation cases.
- Generate unique evidence collection links.
- Record link visits with accurate server timestamps.
- Record IP addresses and approximate IP-based location.
- Identify basic browser and operating system information.
- Request browser permission for GPS, camera, and microphone.
- Support active, consent-based GPS sessions.
- Store submitted evidence securely.
- Display collected information in an administrative dashboard.
- Generate professional PDF evidence reports.
- Maintain a reliable audit trail.
- Protect sensitive information against unauthorized access.

# 3. TECHNOLOGY STACK

## Frontend

- HTML5
- CSS3
- JavaScript ES6+
- Bootstrap 5
- Bootstrap Icons
- Chart.js
- Leaflet.js
- OpenStreetMap

## Backend and Database

Use Supabase as the primary backend platform.

- Supabase PostgreSQL — relational database.
- Supabase Authentication — administrator authentication.
- Supabase Storage — evidence file storage.
- Supabase Realtime — live dashboard updates.
- Supabase Edge Functions — secure server-side operations.
- Supabase Row Level Security (RLS) — database access control.

## Additional Libraries

- jsPDF or a suitable PDF generation library.
- Leaflet.js for interactive maps.
- A reliable IP geolocation provider for approximate network location.
- Browser Geolocation API.
- Browser MediaDevices API, subject to permission.

## Hosting and Version Control

- Netlify for frontend hosting.
- GitHub for source code and version control.
- Supabase for backend infrastructure.

# 4. SYSTEM ARCHITECTURE

The application must follow a modular architecture.

Frontend:
HTML + CSS + JavaScript

Backend:
Supabase Edge Functions

Database:
Supabase PostgreSQL

Authentication:
Supabase Auth

File Storage:
Supabase Storage

Live Updates:
Supabase Realtime

Deployment:
Netlify + GitHub

All privileged operations must be performed through secure backend functions.

Never expose the Supabase service role key in frontend JavaScript.

The Supabase publishable key may be used in the frontend with correctly configured RLS policies.

# 5. APPLICATION MODULES

## MODULE A: ADMIN AUTHENTICATION

Build a secure administrator authentication system.

Features:

- Admin login.
- Email and password authentication.
- Password recovery.
- Secure logout.
- Session persistence.
- Role-based access control.
- Protected dashboard routes.

Only authorized administrators may access case management and evidence records.

## MODULE B: ADMIN DASHBOARD

Create a professional dashboard displaying:

- Total investigation cases.
- Total generated links.
- Total link visits.
- Active consent-based GPS sessions.
- Total evidence records.
- Recent activity.
- Case status distribution.
- Approximate geographic distribution of visits.
- Latest submitted evidence.

Dashboard components:

- Statistics cards.
- Activity chart.
- Visit analytics chart.
- Recent cases table.
- Recent evidence table.
- Interactive map.

Use Chart.js for statistics and Leaflet.js for maps.

Do not represent estimated IP locations as verified GPS locations.

## MODULE C: CASE MANAGEMENT

Administrators must be able to:

- Create a new case.
- Edit case information.
- View case details.
- Change case status.
- Archive completed cases.
- Delete cases according to retention policies.
- Search cases.
- Filter cases by status and date.

Each case should contain:

- Case ID.
- Case reference.
- Case title.
- Description.
- Incident date.
- Status.
- Created by.
- Created timestamp.
- Last updated timestamp.

Suggested case statuses:

- Open
- Under Review
- Evidence Collected
- Submitted to Police
- Closed

## MODULE D: UNIQUE LINK GENERATOR

Build a link generation system.

Administrators can:

- Generate unique links.
- Assign links to investigation cases.
- Add link descriptions.
- Set expiration dates.
- Activate or deactivate links.
- View link visit history.
- Copy generated links.
- View link status.

Each link must have a cryptographically secure unique identifier.

Example:

https://yourdomain.com/evidence/UNIQUE_TOKEN

The link must not expose internal database identifiers or administrator information.

## MODULE E: VISIT TRACKING AND IP INTELLIGENCE

When a generated link is opened, record relevant technical information.

Information may include:

- Visit ID.
- Link ID.
- Case ID.
- Server-generated timestamp.
- IP address, subject to applicable privacy requirements.
- Browser information.
- Operating system information.
- Device category when reasonably detectable.
- User agent.
- Approximate IP-based location.
- Referrer when available and appropriate.

IP intelligence may include:

- Country.
- Region.
- City.
- Approximate coordinates.
- Internet service provider when available.

IMPORTANT:

IP geolocation is an estimate. VPNs, proxies, mobile networks, and carrier routing can make location information inaccurate.

The system must never claim that an IP address independently identifies a specific person.

## MODULE F: TRANSPARENT PERMISSION INTERFACE

Create a clear evidence collection page.

Before requesting sensitive permissions, explain:

- What information is requested.
- Why it is requested.
- How it will be used.
- Whether it will be stored.
- Who can access it.
- How the user can stop the process.

Provide separate permission controls for:

1. Location
2. Camera
3. Microphone

Do not combine unrelated permissions into a misleading single consent action.

Record consent status and timestamps.

## MODULE G: GPS LOCATION AND ACTIVE SESSIONS

Use the browser Geolocation API.

Required functionality:

- Request location permission.
- Obtain current coordinates after permission is granted.
- Display latitude and longitude.
- Display location accuracy.
- Record the timestamp of each update.
- Create an active location session.
- Use `watchPosition()` during an active session.
- Provide a visible stop-tracking control.
- Stop location updates when the session ends.
- Record the session start and end timestamps.

GPS information should include:

- Latitude.
- Longitude.
- Accuracy in meters.
- Timestamp.
- Session ID.
- Consent record ID.

Display GPS records on an interactive Leaflet map.

IMPORTANT:

The website can only track location while the browser and supported page session remain active and permission remains available. It must not claim to track someone after the website is closed or permission is revoked.

## MODULE H: CAMERA EVIDENCE

Use the browser MediaDevices API.

Features:

- Explain camera access before requesting permission.
- Request camera access through the browser.
- Display the camera preview.
- Allow a user-initiated photograph.
- Show the captured image.
- Allow confirmation before submission.
- Upload confirmed images to Supabase Storage.
- Save image metadata in PostgreSQL.

Supported evidence formats:

- JPEG
- PNG
- WebP

Apply file size and MIME type validation.

The camera must never be activated secretly.

## MODULE I: MICROPHONE EVIDENCE

Use the browser MediaRecorder API.

Features:

- Explain microphone access.
- Request explicit microphone permission.
- Display recording status.
- Provide start and stop controls.
- Allow playback before submission.
- Require confirmation before uploading.
- Store the recording securely.

Supported formats depend on browser compatibility.

Save metadata including:

- File name.
- File type.
- File size.
- Recording timestamp.
- Related case.
- Related consent record.

Never record audio without the user's clear awareness and permission.

## MODULE J: EVIDENCE MANAGEMENT

Build a central evidence management system.

Evidence categories:

- Visit Records
- IP Intelligence
- GPS Records
- Photographs
- Audio Recordings
- Administrative Notes
- Other Authorized Documents

Each evidence item should include:

- Evidence ID.
- Case ID.
- Related visit ID.
- Evidence category.
- Collection method.
- Collection timestamp.
- Consent reference when applicable.
- Storage path.
- MIME type.
- File size.
- Integrity hash where supported.
- Created timestamp.

Preserve original submitted files.

If evidence is processed, create a separate derivative file and retain the original.

Provide:

- Evidence search.
- Category filters.
- Date filters.
- Evidence preview.
- Secure download.
- Case association.
- Evidence export.

## MODULE K: INTERACTIVE MAP

Use Leaflet.js with OpenStreetMap.

Map features:

- Display consented GPS coordinates.
- Display approximate IP-based locations.
- Distinguish GPS markers from estimated IP markers.
- Show location timestamps.
- Display accuracy information.
- Show location records associated with a case.
- Provide location detail popups.

Use separate marker styles for:

- Verified GPS coordinates.
- Estimated IP locations.

Do not draw movement routes between unrelated records or imply continuous tracking where no continuous session exists.

## MODULE L: POLICE REPORT GENERATOR

Build a professional PDF report generator.

The report should include:

1. Organization or administrator information.
2. Case reference.
3. Case title.
4. Report creation date.
5. Incident description.
6. Generated link information.
7. Visit timeline.
8. IP address records.
9. Approximate IP location information.
10. Browser and device information.
11. Consent records.
12. GPS records, if collected with permission.
13. Photographs, if submitted with permission.
14. Audio recordings, if submitted with permission.
15. Evidence IDs.
16. Collection methods.
17. Integrity information.
18. Data accuracy limitations.
19. Administrator notes.
20. Evidence references.

The report must clearly distinguish:

- Verified technical records.
- User-submitted information.
- Estimated network information.
- Unverified allegations.

Do not label a suspected visitor as a confirmed thief based solely on technical metadata.

Generate a professional, printable PDF with:

- Clear headings.
- Case identification.
- Page numbers.
- Tables.
- Timestamps.
- Evidence references.
- Report generation timestamp.

# 6. SUPABASE DATABASE DESIGN

Use PostgreSQL with UUID primary keys and appropriate foreign-key relationships.

Create the following tables.

## Table: profiles

Fields:

- id UUID PRIMARY KEY REFERENCES auth.users(id)
- full_name TEXT
- role TEXT
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

## Table: cases

Fields:

- id UUID PRIMARY KEY
- case_reference TEXT UNIQUE
- title TEXT
- description TEXT
- incident_date TIMESTAMPTZ
- status TEXT
- created_by UUID REFERENCES profiles(id)
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

## Table: generated_links

Fields:

- id UUID PRIMARY KEY
- case_id UUID REFERENCES cases(id)
- token_hash TEXT UNIQUE
- description TEXT
- is_active BOOLEAN
- expires_at TIMESTAMPTZ
- created_by UUID REFERENCES profiles(id)
- created_at TIMESTAMPTZ

Store a secure token representation rather than exposing internal database IDs.

## Table: visits

Fields:

- id UUID PRIMARY KEY
- link_id UUID REFERENCES generated_links(id)
- case_id UUID REFERENCES cases(id)
- ip_address INET
- browser TEXT
- operating_system TEXT
- device_category TEXT
- user_agent TEXT
- estimated_country TEXT
- estimated_region TEXT
- estimated_city TEXT
- estimated_latitude DOUBLE PRECISION
- estimated_longitude DOUBLE PRECISION
- visited_at TIMESTAMPTZ

## Table: consent_records

Fields:

- id UUID PRIMARY KEY
- visit_id UUID REFERENCES visits(id)
- permission_type TEXT
- consent_status TEXT
- purpose TEXT
- consent_timestamp TIMESTAMPTZ
- revoked_at TIMESTAMPTZ

## Table: location_sessions

Fields:

- id UUID PRIMARY KEY
- visit_id UUID REFERENCES visits(id)
- consent_id UUID REFERENCES consent_records(id)
- status TEXT
- started_at TIMESTAMPTZ
- ended_at TIMESTAMPTZ

## Table: location_records

Fields:

- id UUID PRIMARY KEY
- session_id UUID REFERENCES location_sessions(id)
- latitude DOUBLE PRECISION
- longitude DOUBLE PRECISION
- accuracy DOUBLE PRECISION
- recorded_at TIMESTAMPTZ

## Table: evidence

Fields:

- id UUID PRIMARY KEY
- case_id UUID REFERENCES cases(id)
- visit_id UUID REFERENCES visits(id)
- consent_id UUID REFERENCES consent_records(id)
- evidence_type TEXT
- storage_path TEXT
- mime_type TEXT
- file_size BIGINT
- integrity_hash TEXT
- collected_at TIMESTAMPTZ
- created_at TIMESTAMPTZ

## Table: audit_logs

Fields:

- id UUID PRIMARY KEY
- admin_id UUID REFERENCES profiles(id)
- action TEXT
- entity_type TEXT
- entity_id UUID
- created_at TIMESTAMPTZ
- metadata JSONB

Add indexes for frequently queried columns, particularly:

- case_id
- link_id
- visit_id
- created_at
- recorded_at
- status

Use database constraints and appropriate foreign-key deletion rules.

# 7. SUPABASE STORAGE DESIGN

Create private storage buckets:

**evidence-images**
- Authorized submitted photographs.

**evidence-audio**
- Authorized submitted audio recordings.

**evidence-documents**
- Related investigation documents.

Storage requirements:

- Private buckets only.
- Authenticated administrator access.
- Short-lived signed URLs for authorized downloads.
- File type validation.
- File size limits.
- No public evidence URLs.
- Restrictive storage policies.
- Separate evidence metadata from actual file storage.

# 8. ROW LEVEL SECURITY (RLS)

Enable RLS on all sensitive tables.

Policies must ensure:

- Only authenticated and authorized administrators can access cases.
- Administrators can access only the records permitted by their role.
- Evidence files are not publicly accessible.
- Visitors cannot read administrative records.
- Public link submissions cannot read other visitors' information.
- Consent records cannot be modified by unauthorized administrators or visitors.
- Audit logs cannot be modified through ordinary client-side operations.

Use Edge Functions for privileged operations.

Never use the Supabase service role key in browser code.

# 9. EDGE FUNCTIONS

Create secure Supabase Edge Functions for:

1. generate-evidence-link
2. validate-evidence-link
3. record-visit
4. lookup-ip-intelligence
5. create-consent-record
6. start-location-session
7. save-location-record
8. end-location-session
9. submit-image-evidence
10. submit-audio-evidence
11. generate-police-report
12. export-case-evidence

Each function must validate inputs, enforce authorization, handle errors, and avoid exposing private credentials.

Apply rate limits and abuse prevention to public endpoints.

# 10. ADMINISTRATIVE PAGES

Create the following pages:

1. Admin Login
2. Dashboard
3. Cases
4. Create Case
5. Case Details
6. Link Generator
7. Generated Links
8. Visit Activity
9. Visit Details
10. Consent Records
11. GPS Sessions
12. Interactive Map
13. Evidence Library
14. Evidence Details
15. Police Reports
16. Audit Logs
17. Admin Users
18. Settings
19. Profile

# 11. PUBLIC EVIDENCE PAGES

Create a separate responsive public interface for generated evidence links.

Pages:

- Evidence Link Landing Page
- Privacy and Consent Information
- Location Permission Interface
- Camera Permission Interface
- Microphone Permission Interface
- Evidence Review and Submission
- Submission Confirmation
- Invalid or Expired Link Page

The public interface must explain the purpose of evidence collection.

Never imitate a third-party payment service or disguise the purpose of the page.

Do not request unnecessary personal information.

# 12. SECURITY AND PRIVACY REQUIREMENTS

Security is a core requirement.

Implement:

- HTTPS.
- Supabase Authentication.
- PostgreSQL RLS.
- Private Storage.
- Server-side input validation.
- Rate limiting.
- Secure random link tokens.
- Token expiration.
- Audit logging.
- File validation.
- Restricted administrator roles.
- Secure environment variables.
- Data retention policies.
- Authorized evidence exports.

Do not collect:

- Contacts.
- SMS messages.
- Private gallery contents without explicit file selection.
- IMEI through browser fingerprinting.
- Passwords belonging to other services.
- Hidden camera recordings.
- Hidden microphone recordings.
- Location data without permission.

# 13. USER INTERFACE AND DESIGN SYSTEM

Design a professional cybersecurity platform.

Visual direction:

- Dark navy.
- White.
- Blue accents.
- Subtle gray surfaces.
- Clear typography.
- Consistent spacing.
- Professional tables.
- Responsive cards.
- Minimal animations.
- Accessible color contrast.

Dashboard design:

- Sidebar navigation.
- Top navigation bar.
- Statistics cards.
- Charts.
- Activity feed.
- Interactive maps.
- Search and filter controls.

Ensure the application works on:

- Desktop.
- Tablets.
- Android phones.
- iPhones.

# 14. ERROR HANDLING

Implement clear error handling for:

- Invalid links.
- Expired links.
- Inactive links.
- Failed database requests.
- Authentication errors.
- Storage upload failures.
- Permission denied.
- GPS unavailable.
- GPS timeout.
- Camera unavailable.
- Microphone unavailable.
- Network interruptions.
- Unauthorized access.

Never display sensitive server errors or database credentials to visitors.

# 15. DEVELOPMENT ROADMAP

## PHASE 1 — PROJECT FOUNDATION

- Initialize project structure.
- Configure GitHub.
- Configure Supabase project.
- Configure environment variables.
- Build responsive application layout.
- Implement authentication.
- Create administrator profiles.

## PHASE 2 — DATABASE AND SECURITY

- Create PostgreSQL tables.
- Establish foreign keys.
- Create indexes.
- Enable RLS.
- Configure administrator policies.
- Create private Storage buckets.
- Test database security.

## PHASE 3 — CASE MANAGEMENT

- Build case creation.
- Build case editing.
- Build case details.
- Implement case statuses.
- Implement search and filters.

## PHASE 4 — LINK GENERATION

- Implement secure unique tokens.
- Build link generation.
- Implement link validation.
- Implement expiration.
- Implement activation and deactivation.

## PHASE 5 — VISIT INTELLIGENCE

- Record visits.
- Record timestamps.
- Collect appropriate technical metadata.
- Implement IP intelligence.
- Display estimated location.
- Build visit history.

## PHASE 6 — CONSENT AND EVIDENCE COLLECTION

- Build transparent permission screens.
- Implement GPS permission.
- Implement active GPS sessions.
- Implement camera permission.
- Implement user-controlled photographs.
- Implement microphone permission.
- Implement user-controlled audio recording.
- Save consent records.

## PHASE 7 — EVIDENCE MANAGEMENT

- Implement Storage uploads.
- Create evidence metadata.
- Implement evidence search.
- Build evidence preview.
- Implement secure downloads.
- Create audit logs.
- Add integrity verification.

## PHASE 8 — MAP AND ANALYTICS

- Integrate Leaflet.
- Display GPS records.
- Display approximate IP locations.
- Implement visit analytics.
- Implement dashboard charts.
- Implement Realtime updates where appropriate.

## PHASE 9 — POLICE REPORTS

- Build PDF report templates.
- Include evidence references.
- Include timestamps.
- Include collection methods.
- Include accuracy limitations.
- Implement case exports.

## PHASE 10 — TESTING AND DEPLOYMENT

- Test authentication.
- Test RLS.
- Test storage policies.
- Test public link security.
- Test permissions.
- Test GPS session behavior.
- Test file uploads.
- Test PDF reports.
- Test mobile responsiveness.
- Deploy frontend to Netlify.
- Configure production environment variables.
- Perform final security review.

# 16. ACCEPTANCE CRITERIA

The project is considered complete when:

- Administrators can securely log in.
- Administrators can create and manage cases.
- Unique evidence links can be generated.
- Link visits are recorded accurately.
- IP-derived locations are clearly labeled as estimates.
- Consent records are preserved.
- GPS sessions work only with permission and remain visibly active.
- Camera and microphone features require permission and user action.
- Evidence files are stored privately.
- RLS prevents unauthorized access.
- Administrators can view case evidence.
- PDF reports can be generated.
- Audit logs are available.
- The application works on mobile and desktop.

# 17. FINAL DEVELOPMENT INSTRUCTIONS

Build this project as a complete, production-oriented application.

Important instructions:

1. Use Supabase as the only primary database and backend platform.
2. Do not use Firebase.
3. Do not use React, Vue, Angular, or unnecessary frontend frameworks.
4. Use HTML, CSS, and vanilla JavaScript ES6+.
5. Keep frontend code modular and maintainable.
6. Use Supabase Edge Functions for privileged operations.
7. Never expose service role credentials.
8. Apply RLS to every sensitive database table.
9. Do not use mock data as a replacement for required production functionality.
10. Implement each development phase incrementally.
11. Test every major feature before continuing.
12. Provide complete SQL migrations and deployment instructions.
13. Document environment variables in `.env.example`, without real secrets.
14. Include a README.md explaining installation, configuration, and deployment.

The final result must be a functional, secure, professional Anti-Theft Evidence Platform, not merely a static dashboard prototype.