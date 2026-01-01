# SandBox

Lightweight, OS-native sandboxing solution on macOS (`sandbox-exec`) and Linux (`bubblewrap`).

## Features

- agentic code execution (AI agents): with minimal risk of data leaks or system compromise
- secure-by-default dual isolation: Untrusted code runs with strong restrictions - filesystem isolation prevents secret exfiltration (e.g. SSH keys), while network isolation blocks unrestricted outbound access
- minimal performance overhead: No containers / VMs required
- blazingly fast startup times: milliseconds
- cross-platform: macOS and Linux support
- highly configurable: fine-grained control over network and filesystem access
- easy to use: CLI and Node.js library

## Usage

### CLI

```bash
vsbx <command>                    # Run command sandboxed
vsbx --debug <command>            # Debug logging
vsbx --settings <file> <command>  # Custom config
```

### Node.js Library

```javascript
import { type SandboxRuntimeConfig } from "@/core/sandbox/sandbox-config";
import { SandboxManager } from "@/core/manager/sandbox-manager";
import { spawn } from "node:child_process";

const config: SandboxRuntimeConfig = {
  network: {
    allowedDomains: ["example.com", "api.github.com"],
    deniedDomains: [],
  },
  filesystem: {
    denyRead: ["~/.ssh"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env"],
  },
};

await SandboxManager.initialize(config);
const sandboxedCommand = await SandboxManager.wrapWithSandbox(
  "curl https://example.com",
);
const child = spawn(sandboxedCommand, { shell: true, stdio: "inherit" });

child.on("exit", (code) => console.log(`Command exited with code ${code}`));
await SandboxManager.reset();
```

## Configuration

```json
{
  "network": {
    "allowedDomains": [
      "api.github.com",
      "registry.npmjs.org",
      "objects.githubusercontent.com"
    ]
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.config/gh"],
    "allowWrite": ["."]
  }
}
```

### Configuration Options

```json
{
  "network": {
    "allowedDomains":           string[],     // wildcards *. ok, empty = no network
    "deniedDomains":            string[],     // checked first, blocks even if in allowed
    "allowUnixSockets":         string[],     // macOS mostly - dangerous!
    "allowLocalBinding":        boolean       // default false - very dangerous
  },
  "filesystem": {
    "denyRead":                 string[],     // empty = read everywhere
    "allowWrite":               string[],     // empty = write nowhere ← most important!
    "denyWrite":                string[]      // exceptions inside allowWrite (stronger priority)
  },
  "ignoreViolations": {                       // rare - mostly for tooling workarounds
    "<command-pattern>":        string[]
  },
  "enableWeakerNestedSandbox":  boolean,      // only for running inside Docker (much weaker!)
  "mandatoryDenySearchDepth":   number        // Linux only - how deep to scan for dangerous files (default: 3)
}
```

### Default Permissions

| Resource             | Default State              | Restriction Style      | How to open access                    |
| -------------------- | -------------------------- | ---------------------- | ------------------------------------- |
| Network              | Completely blocked         | Allow-list only        | `allowedDomains: ["..."]`             |
| Filesystem - Read    | Allowed everywhere         | Deny-list only         | `denyRead: ["~/.ssh"]`                |
| Filesystem - Write   | Completely blocked         | Allow-list + deny-list | `allowWrite: ["."]` + `denyWrite: []` |
| Unix sockets (Linux) | Creation blocked (seccomp) | Explicit allow         | `allowUnixSockets: [...]`             |
