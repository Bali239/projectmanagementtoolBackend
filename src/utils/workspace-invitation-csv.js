import { parse } from "csv-parse/sync";
import { createInvitationSchema } from "../schemas/workspace.schema.js";

export class WorkspaceCsvError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function parseWorkspaceInvitationCsv(csv) {
  if (typeof csv !== "string" || !csv.trim()) {
    throw new WorkspaceCsvError("Upload a CSV file containing an email column.");
  }

  let rows;
  try {
    rows = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      max_record_size: 16_384,
      columns(headers) {
        const normalized = headers.map((header) => header.trim().toLowerCase());
        if (!normalized.includes("email")) throw new WorkspaceCsvError("CSV must contain a column named email.");
        return normalized;
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceCsvError) throw error;
    throw new WorkspaceCsvError("The CSV could not be parsed.");
  }
  if (rows.length > 200) throw new WorkspaceCsvError("Import a maximum of 200 rows at a time.", 413);

  const seen = new Set();
  return rows.map((row, index) => {
    const rawEmail = typeof row.email === "string" ? row.email : "";
    const validation = createInvitationSchema.safeParse({ email: rawEmail });
    if (!validation.success) {
      return { row: index + 2, email: rawEmail, status: "invalid", message: "Enter a valid email address." };
    }

    const email = validation.data.email;
    if (seen.has(email)) {
      return { row: index + 2, email, status: "duplicate", message: "Email appears more than once in this CSV." };
    }
    seen.add(email);
    return { row: index + 2, email, status: "ready" };
  });
}