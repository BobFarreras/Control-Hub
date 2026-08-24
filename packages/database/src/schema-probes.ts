/**
 * One named object per migration the infrastructure module needs, so that "is the schema there?"
 * can be answered by a role that owns nothing.
 *
 * The obvious way to answer it is to read `schema_migrations`, and it does not work: that table
 * is created by the migration runner and `control_hub_app` holds no grant on it. Granting one
 * would take a migration, and a check for missing migrations that itself needs a migration is a
 * check that fails exactly when it matters. The catalogue is readable by every role, so the
 * question is asked of the objects instead -- which is also the more honest question, since what
 * broke the afternoon this exists to give back was a missing table and not a missing row.
 *
 * The list lives in this package because this package owns the migrations directory, and the map
 * from an object to the file that creates it is knowledge of that directory. Its own test walks
 * the files and refuses a probe that has drifted from them.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, step 2 of the diagnosis.
 */

export type SchemaProbe = {
  /** The file that creates the object, which is what the screen names. Never a path. */
  migration: string;
  relation: string;
  /**
   * A constraint on that relation, when the migration adds no relation of its own. Null means the
   * relation itself is the evidence.
   */
  constraintName: string | null;
};

/**
 * Every migration the infrastructure module depends on, and one object each.
 *
 * One probe per migration rather than one per table: a migration is applied whole inside a
 * transaction, so any object it creates stands for all of them, and a shorter list is a list that
 * stays true. `0039` adds no relation, so it is answered by the constraint it names.
 */
export const infrastructureSchemaProbes: readonly SchemaProbe[] = [
  { migration: "0030_connectors.sql", relation: "connector_instances", constraintName: null },
  { migration: "0033_connector_records.sql", relation: "connector_records", constraintName: null },
  { migration: "0035_infrastructure_automations.sql", relation: "infra_alert_events", constraintName: null },
  { migration: "0037_infrastructure_hosts.sql", relation: "infra_hosts", constraintName: null },
  {
    migration: "0039_infrastructure_alert_kinds.sql",
    relation: "infra_alert_rules",
    constraintName: "infra_alert_rules_target_kind_check"
  },
  // The inventory reads this table on every dashboard load, so a deployment without it has to
  // be told which file to run rather than answering an unexplained failure.
  { migration: "0042_infrastructure_host_labels.sql", relation: "infra_host_labels", constraintName: null },
  // The projects band reads this on every dashboard load for the same reason, and a deployment
  // that shipped the screen without the table would answer a 500 nobody can place.
  { migration: "0046_vercel_project_links.sql", relation: "infra_project_links", constraintName: null }
];
