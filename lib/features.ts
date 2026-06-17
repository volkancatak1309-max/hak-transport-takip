/**
 * Central feature flags.
 *
 * These toggle the *visibility* of optional modules — navigation links and
 * route entry points. The underlying code, server actions, DB tables and
 * migrations are left intact, so re-enabling a module is a one-line change
 * (flip the flag back to `true`) with no data loss.
 *
 * Currently disabled to keep the app focused on the core need:
 * vehicle/driver tracking, who-is-where (live GPS), and working time.
 */
export const FUEL_ENABLED = true;
export const EXPENSE_ENABLED = true;
export const MAINTENANCE_ENABLED = true;
