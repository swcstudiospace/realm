/* realm_idle.h: PID 1 loop for `realm-helper idle`.
 *
 * As PID 1 the helper must reap orphaned children and exit on SIGTERM. The
 * kernel gives PID 1 no default action for signals, so handlers are installed
 * explicitly. */
#ifndef REALM_IDLE_H
#define REALM_IDLE_H

/* Reaps every child that has exited, without blocking. Returns the number
 * reaped. With no children left, returns 0. Async-signal-safe. */
int realm_reap_children(void);

/* Installs the SIGTERM, SIGINT and SIGCHLD handlers. Returns 0 or -1. */
int realm_idle_install(void);

/* Blocks until SIGTERM or SIGINT arrives. Returns 0 on a stop request, or -1
 * if the signal mask cannot be set. Requires realm_idle_install first. */
int realm_idle_run(void);

/* Total children reaped by the SIGCHLD handler since installation. */
int realm_idle_reaped(void);

#endif
