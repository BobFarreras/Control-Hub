/**
 * The names the API and the worker have to agree on.
 *
 * They live here because they are a contract between two processes rather than a detail of
 * either: the API enqueues a job the worker has to recognise, and a string duplicated in both
 * apps is a string that drifts in one of them on a Friday. Neither app may import the other,
 * so this is the only place the agreement can be written down once.
 *
 * The payload's *validation* stays in the worker, which is where an unparseable job has to be
 * refused. This file holds no zod so that the contracts package keeps no dependencies.
 */

export const systemQueueName = "control-hub-system";

/**
 * Connector work has a queue of its own, and that is a guarantee rather than tidiness.
 *
 * A connector call waits on somebody else's server. Four instances hanging on a thirty-second
 * budget would hold four slots of a shared queue, and the support escalation sweep -- which has
 * a service level attached to it -- would wait behind a provider nobody here controls. Separate
 * queues make that impossible by construction instead of by choosing the right concurrency.
 */
export const connectorQueueName = "control-hub-connectors";

/** Every connector run travels under one job name; the payload says which operation it is. */
export const connectorJobName = "connector-run";
export const connectorIngressJobName = "connector-ingress";

export type ConnectorIngressJobPayload = {
  tenantId: string;
  eventId: string;
};

/**
 * The operation reserved for asking a provider whether it is still there.
 *
 * It is not in any connector's manifest and cannot be: a connector declares the operations it
 * offers, and health is the one thing the runtime asks of all of them.
 */
export const connectorHealthOperation = "health";

export type ConnectorJobPayload = {
  tenantId: string;
  instanceId: string;
  operation: string;
  cursor: string | null;
};
