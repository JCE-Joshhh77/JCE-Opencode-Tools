export interface FailureSignatureInput {
  command?: string;
  errorClass?: string;
  file?: string;
  rootPhrase?: string;
  stackMarker?: string;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80);
}

export function buildFailureSignature(input: FailureSignatureInput): string {
  const parts = [input.command, input.errorClass, input.file, input.rootPhrase, input.stackMarker]
    .map((item) => typeof item === "string" ? slug(item) : "")
    .filter(Boolean);
  return parts.length ? parts.join(".") : "unknown.failure";
}
