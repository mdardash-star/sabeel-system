# Domain package

This package owns shared business contracts for SUBIL OS.

Initial service-job states:

- pending_assignment
- assigned
- scheduled
- en_route
- arrived
- in_progress
- completed
- cancelled

Allowed normal workflow is pending_assignment to assigned to scheduled to en_route to arrived to in_progress to completed. Cancellation and reassignment are controlled exceptions. Customer phone numbers are not part of technician-facing job views.
