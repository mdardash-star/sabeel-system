# SUBIL OS — Core Domain Model

## Organization
Company -> Branch -> City/Service Area.

## Identity
User has a stable SUBIL ID. Phone numbers and login methods are credentials/contact channels, not primary business identifiers.
Roles and permissions are scoped where needed by branch/city.

## Customer
Customer -> Contacts -> Addresses -> Consents -> Orders -> Installed Assets -> Service History -> Conversations.

## Commerce
Product -> Variant -> Price -> Cost -> Order -> Order Item -> Payment -> Fulfillment.
An order item declares fulfillment mode: shipping-only, installation, or service.

## Field Service
Service Job -> Assignment -> Schedule -> Technician -> Workflow Events -> Evidence -> Completion -> Rating.
Required lifecycle: assigned -> scheduled -> en_route -> arrived -> started -> completed -> closed/cancelled.
Customer phone is not exposed to technician by default.

## Assets & Maintenance
Installed Asset -> Product/Serial -> Installation -> Warranty -> Maintenance Plan -> Maintenance Visits -> Reminder Events.

## Finance
Product Cost -> Margin before VAT -> Technician Compensation Policy -> Accrual -> Settlement -> Payment Record.
Policies are versioned so historical calculations remain reproducible.

## Inventory
Warehouse -> Stock Item -> Stock Movement -> Technician Stock -> Purchase Order -> Supplier.

## Communications
Customer Consent -> Channel -> Notification Event -> Template -> Delivery Attempt.
Channels include SMS, WhatsApp, email, push, and supported social messaging integrations.

## Marketing
Segment -> Campaign -> Content -> Channel Publication -> Lead/Session Attribution -> Cart -> Conversion.

## AI
Agent -> Allowed Tools -> Policy -> Approval Request -> Action -> Audit Event.
AI-generated actions must preserve actor, source context, decision and outcome for auditability.

## Cross-cutting rules
- UUID/internal IDs are immutable.
- Timestamps are stored in UTC and displayed in the user's locale.
- Money stores currency and integer minor units where practical.
- VAT is explicit and never mixed into margin rules silently.
- Every state transition is validated server-side.
- Destructive and financial operations are auditable.