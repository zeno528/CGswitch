export interface KVPair { key: string; value: string; }

export function recordToPairs(record: Record<string, string>): KVPair[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export function pairsToRecord(pairs: KVPair[]): Record<string, string> {
  return Object.fromEntries(pairs.filter((pair) => pair.key.trim()).map((pair) => [pair.key.trim(), pair.value.trim()]));
}

export interface ClaudeMcpForm {
  transport: string;
  command: string;
  argsText: string;
  url: string;
  envPairs: KVPair[];
  headerPairs: KVPair[];
  timeout: number | null;
}

function readEntry(text: string): Record<string, unknown> {
  const entry: unknown = JSON.parse(text);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Expected MCP object");
  return entry as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new Error("Expected string map");
  }
  return value as Record<string, string>;
}

export function readClaudeMcpForm(text: string): ClaudeMcpForm {
  const entry = readEntry(text);
  for (const key of ["type", "command", "url"]) {
    if (entry[key] !== undefined && typeof entry[key] !== "string") throw new Error("Expected string");
  }
  const args = entry.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("Expected string arguments");
  if (entry.timeout !== undefined && (typeof entry.timeout !== "number" || !Number.isFinite(entry.timeout))) {
    throw new Error("Expected numeric timeout");
  }
  return {
    transport: entry.type as string ?? (entry.url !== undefined ? "http" : "stdio"),
    command: entry.command as string ?? "",
    argsText: args.join("\n"),
    url: entry.url as string ?? "",
    envPairs: recordToPairs(stringMap(entry.env)),
    headerPairs: recordToPairs(stringMap(entry.headers)),
    timeout: entry.timeout as number ?? null,
  };
}

export function patchClaudeMcpForm(text: string, form: ClaudeMcpForm, field: keyof ClaudeMcpForm): string {
  const entry = readEntry(text);
  const setOptional = (key: string, value: unknown, empty: boolean) => {
    if (empty) delete entry[key]; else entry[key] = value;
  };
  switch (field) {
    case "transport":
      entry.type = form.transport;
      for (const key of form.transport === "stdio" ? ["url", "headers"] : ["command", "args", "env"]) delete entry[key];
      entry[form.transport === "stdio" ? "command" : "url"] = (form.transport === "stdio" ? form.command : form.url).trim();
      if (form.transport === "stdio") {
        const args = form.argsText.split("\n").map((line) => line.trim()).filter(Boolean);
        const env = pairsToRecord(form.envPairs);
        setOptional("args", args, !args.length);
        setOptional("env", env, !Object.keys(env).length);
      } else {
        const headers = pairsToRecord(form.headerPairs);
        setOptional("headers", headers, !Object.keys(headers).length);
      }
      break;
    case "command": entry.command = form.command.trim(); break;
    case "url": entry.url = form.url.trim(); break;
    case "argsText": {
      const args = form.argsText.split("\n").map((line) => line.trim()).filter(Boolean);
      setOptional("args", args, !args.length);
      break;
    }
    case "envPairs":
    case "headerPairs": {
      const record = pairsToRecord(form[field]);
      setOptional(field === "envPairs" ? "env" : "headers", record, !Object.keys(record).length);
      break;
    }
    case "timeout": setOptional("timeout", form.timeout, form.timeout === null); break;
  }
  return `${JSON.stringify(entry, null, 2)}\n`;
}
