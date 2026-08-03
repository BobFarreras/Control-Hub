/**
 * The content a migration checksum is computed from.
 *
 * Hashing the file bytes directly makes the checksum depend on the checkout, not on the
 * migration. A Windows working tree stores `\r\n` and a Linux one stores `\n`, so the same
 * committed file produced two different checksums and a database migrated from one machine
 * refused every later run from the other with "Applied migration changed". Nothing had
 * changed; only the line endings had.
 *
 * That failure only surfaces where the platforms differ, which in practice means the first
 * deployment to the server.
 *
 * Normalising the line endings is safe because SQL does not distinguish them: the statement
 * executed is identical either way. What is hashed is the meaning of the file, not its bytes.
 */
export function migrationFingerprint(source: string): string {
  return source.replace(/\r\n/g, "\n");
}
